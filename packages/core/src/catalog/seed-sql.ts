import * as z from 'zod';
import type { IsoDate } from '../dates/iso-date';
import type { Bundle } from './bundle';
import type { Feature, FeatureValue } from './feature';
import { isoDateSchema } from './formats';
import { monthlyEquivalent } from './monthly-equivalent';
import { providerCategories } from './plan-categories';
import type { CatalogSnapshot, SnapshotProvider } from './snapshot';

// seed.sql for the D1 catalog cache (BLUEPRINT §5.3, §6.3): the statements that bring D1 from what it holds to the
// build's catalog, one per line, each under D1's 100 KB statement limit. D1's free plan allows 100,000 rows written
// a day for the account, and every deploy seeds, so only what changed is written (M11.8): a code-only deploy writes
// nothing, and a price change is that price's row, its plan's and its provider's. The seed counts what it writes the
// way D1 does, and over the catalog's daily share it applies whole providers in the file's order and leaves the rest
// for the next seed, which the catalog row records.

/** D1 rejects a statement longer than this many bytes. */
const maxStatementBytes = 100_000;

/**
 * The version of the rules that turn a snapshot into rows. Bump it when a migration changes the catalog tables' rows,
 * or when a derived column (monthly_equiv, rank_value) is computed differently: rows written under another format are
 * replaced by a full reseed. 2: provider_categories (migration 0003, M1.10). 3: provider_features (migration 0004,
 * M11.4). Migration 0005's bookkeeping columns on the catalog row (M11.8) changed no row, so no bump.
 */
export const seedFormat = 3;

/** rank_value for `unlimited`: above any real number, and still a finite number in JSON. */
export const unlimitedRankValue = 1e308;

/**
 * The rows the catalog may write in a UTC day (M11.8): D1's 100,000 for the account, less the user database's 41,000
 * cap (BLUEPRINT §5.4) and a margin.
 */
export const seedDailyWrites = 50_000;

/** The catalog row's version while D1 has never held a whole catalog: an empty D1 filled over several days. */
export const partialCatalogVersion = '0000000';

type SqlValue = string | number | null;
/** A table row as the seed writes it and D1 returns it. */
export type SeedRow = Readonly<Record<string, SqlValue>>;

interface TableShape {
  /** Its primary key's columns. */
  readonly key: readonly string[];
  /** Each secondary index's columns. */
  readonly indexes: readonly (readonly string[])[];
}

/**
 * The catalog tables' keys and secondary indexes, as apps/api/migrations/ makes them (a test in apps/api reads them
 * back from D1). D1 counts a row written for each row inserted and an entry in each of its table's indexes, each row
 * deleted (a cascade's too, but no index entries), and each row updated with an entry for each index the update moves.
 */
export const seedTables = {
  providers: { key: ['id'], indexes: [] },
  provider_categories: { key: ['category', 'provider_id'], indexes: [] },
  provider_features: { key: ['feature_id', 'value', 'provider_id'], indexes: [] },
  plans: { key: ['id'], indexes: [['provider_id']] },
  prices: {
    key: ['plan_id', 'region', 'currency', 'interval', 'interval_count'],
    indexes: [['region', 'monthly_equiv']],
  },
  plan_features: {
    key: ['plan_id', 'feature_id', 'value'],
    indexes: [['feature_id', 'rank_value']],
  },
  features: { key: ['id'], indexes: [] },
  bundles: { key: ['id'], indexes: [] },
  bundle_plans: { key: ['bundle_id', 'plan_id'], indexes: [['plan_id']] },
  catalog: { key: ['id'], indexes: [] },
} as const satisfies Record<string, TableShape>;
export type SeedTable = keyof typeof seedTables;

/** Children first, though the ON DELETE CASCADE keys would clear them anyway. */
const clearOrder: readonly SeedTable[] = [
  'catalog',
  'bundle_plans',
  'bundles',
  'plan_features',
  'features',
  'prices',
  'plans',
  'provider_features',
  'provider_categories',
  'providers',
];

/** The tables a provider's rows are in, parents first. */
const providerTables = [
  'providers',
  'provider_categories',
  'provider_features',
  'plans',
  'prices',
  'plan_features',
] as const;
type ProviderTable = (typeof providerTables)[number];

/** A provider's rows by table: as the seed writes them, or as D1 holds them (its providers row without json). */
export type ProviderRows = Record<ProviderTable, SeedRow[]>;

/** What D1 holds of a provider the seed changes or removes: its rows, and the bundles' links to its plans. */
export type StoredProvider = ProviderRows & { bundle_plans: SeedRow[] };

/** What D1 holds, as far as the seed needs to know. readSeedState reads it from seedStateQueries' results. */
export interface SeedState {
  /** The catalog row, or undefined when there is none: a new database, or one a migration has just rebuilt. */
  catalog?: {
    version: string;
    seedFormat: number;
    /** How many providers and bundles the last seed left for the next one (M11.8). */
    waiting: number;
    /** The UTC day of the last seed that counted its writes, and how many rows the seeds wrote that day. */
    writtenOn?: IsoDate;
    written: number;
  };
  /** Provider id → the hash it was written with. */
  providers: ReadonlyMap<string, string>;
  /** Feature id → its json column. */
  features: ReadonlyMap<string, string>;
  /** Bundle id → its json column. */
  bundles: ReadonlyMap<string, string>;
  /** How many rows each table holds, for what a full reseed deletes. */
  rows: Readonly<Record<SeedTable, number>>;
}

/** The queries that read D1's SeedState, in the order readSeedState expects their results. */
export const seedStateQueries = [
  'SELECT version, seed_format, waiting, written_on, written FROM catalog',
  'SELECT id, hash FROM providers',
  'SELECT id, json FROM features',
  'SELECT id, json FROM bundles',
  `SELECT ${clearOrder.map((table) => `(SELECT COUNT(*) FROM ${table}) AS ${table}`).join(', ')}`,
];

const countSchema = z.int().nonnegative();
const seedStateResultsSchema = z.tuple([
  z
    .array(
      z.object({
        version: z.string(),
        seed_format: z.int(),
        waiting: countSchema,
        written_on: isoDateSchema.nullable(),
        written: countSchema,
      }),
    )
    .max(1),
  z.array(z.object({ id: z.string(), hash: z.string() })),
  z.array(z.object({ id: z.string(), json: z.string() })),
  z.array(z.object({ id: z.string(), json: z.string() })),
  z.tuple([z.record(z.enum(Object.keys(seedTables) as SeedTable[]), countSchema)]),
]);

/** D1's SeedState, from the rows each of seedStateQueries returned. Throws on rows of another shape. */
export function readSeedState(results: readonly unknown[]): SeedState {
  const [[catalog], providers, features, bundles, [rows]] = seedStateResultsSchema.parse(results);
  return {
    ...(catalog && {
      catalog: {
        version: catalog.version,
        seedFormat: catalog.seed_format,
        waiting: catalog.waiting,
        ...(catalog.written_on !== null && { writtenOn: catalog.written_on }),
        written: catalog.written,
      },
    }),
    providers: new Map(providers.map((row) => [row.id, row.hash])),
    features: new Map(features.map((row) => [row.id, row.json])),
    bundles: new Map(bundles.map((row) => [row.id, row.json])),
    rows,
  };
}

/**
 * The providers whose rows the seed compares (storedRowQueries): those D1 holds under another hash, and those the
 * catalog no longer has. None when the seed replaces everything.
 */
export function providersToRead(
  snapshot: CatalogSnapshot,
  { providerHashes, current }: Pick<SeedOptions, 'providerHashes' | 'current'>,
): string[] {
  const state = comparable(current);
  if (!state) return [];
  const ids = new Set(snapshot.data.providers.map((provider) => provider.id));
  return [...state.providers].flatMap(([id, hash]) =>
    !ids.has(id) || providerHashes.get(id) !== hash ? [id] : [],
  );
}

/** The queries that read the rows of the providers `ids`, in the order readStoredRows expects their results. */
export function storedRowQueries(ids: readonly string[]): string[] {
  const list = ids.map(sqlValue).join(', ');
  const plans = `SELECT id FROM plans WHERE provider_id IN (${list})`;
  return [
    `SELECT id, name, category, spend_category, hash FROM providers WHERE id IN (${list})`,
    `SELECT category, provider_id FROM provider_categories WHERE provider_id IN (${list})`,
    `SELECT feature_id, value, provider_id, rank_value FROM provider_features WHERE provider_id IN (${list})`,
    `SELECT id, provider_id, name, json FROM plans WHERE provider_id IN (${list})`,
    `SELECT plan_id, region, currency, amount, interval, interval_count, monthly_equiv FROM prices WHERE plan_id IN (${plans})`,
    `SELECT plan_id, feature_id, value, rank_value FROM plan_features WHERE plan_id IN (${plans})`,
    `SELECT bundle_id, plan_id FROM bundle_plans WHERE plan_id IN (${plans})`,
  ];
}

const rowsSchema = z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])));

/** The stored rows of the providers `ids`, by provider, from storedRowQueries' results. Throws on another shape. */
export function readStoredRows(
  ids: readonly string[],
  results: readonly unknown[],
): Map<string, StoredProvider> {
  const [providers, categories, features, plans, prices, planFeatures, links] = z
    .tuple([rowsSchema, rowsSchema, rowsSchema, rowsSchema, rowsSchema, rowsSchema, rowsSchema])
    .parse(results);
  const stored = new Map<string, StoredProvider>(
    ids.map((id) => [
      id,
      {
        providers: [],
        provider_categories: [],
        provider_features: [],
        plans: [],
        prices: [],
        plan_features: [],
        bundle_plans: [],
      },
    ]),
  );
  const providerOfPlan = new Map(plans.map((plan) => [plan['id'], plan['provider_id']]));
  const put = (table: keyof StoredProvider, providerId: SqlValue | undefined, row: SeedRow) => {
    const found = typeof providerId === 'string' ? stored.get(providerId) : undefined;
    if (!found) throw new Error(`${table} row of a provider that wasn't asked for`);
    found[table].push(row);
  };
  for (const row of providers) put('providers', row['id'], row);
  for (const row of categories) put('provider_categories', row['provider_id'], row);
  for (const row of features) put('provider_features', row['provider_id'], row);
  for (const row of plans) put('plans', row['provider_id'], row);
  for (const row of prices) put('prices', providerOfPlan.get(row['plan_id']), row);
  for (const row of planFeatures) put('plan_features', providerOfPlan.get(row['plan_id']), row);
  for (const row of links) put('bundle_plans', providerOfPlan.get(row['plan_id']), row);
  return stored;
}

/**
 * What D1 holds once `snapshot` is seeded in full, as readSeedState reads it: for comparing a build with the one D1
 * holds without asking D1 (the pull request's estimate in CI, and tests).
 */
export function seedStateOf(
  snapshot: CatalogSnapshot,
  providerHashes: ReadonlyMap<string, string>,
): SeedState {
  const stored = storedRowsOf(snapshot, providerHashes);
  const byJson = (items: readonly { id: string }[]) =>
    new Map(items.map((item) => [item.id, JSON.stringify(item)]));
  const count = (table: keyof StoredProvider) =>
    [...stored.values()].reduce((sum, rows) => sum + rows[table].length, 0);
  return {
    catalog: { version: snapshot.meta.catalogVersion, seedFormat, waiting: 0, written: 0 },
    providers: new Map(
      snapshot.data.providers.map((provider) => [
        provider.id,
        providerHashes.get(provider.id) ?? '',
      ]),
    ),
    features: byJson(snapshot.data.features),
    bundles: byJson(snapshot.data.bundles),
    rows: {
      providers: count('providers'),
      provider_categories: count('provider_categories'),
      provider_features: count('provider_features'),
      plans: count('plans'),
      prices: count('prices'),
      plan_features: count('plan_features'),
      features: snapshot.data.features.length,
      bundles: snapshot.data.bundles.length,
      bundle_plans: count('bundle_plans'),
      catalog: 1,
    },
  };
}

/** The rows D1 holds of each provider once `snapshot` is seeded, as readStoredRows reads them. */
export function storedRowsOf(
  snapshot: CatalogSnapshot,
  providerHashes: ReadonlyMap<string, string>,
): Map<string, StoredProvider> {
  const features = new Map(snapshot.data.features.map((feature) => [feature.id, feature]));
  const featureOf = (featureId: string) => {
    const feature = features.get(featureId);
    if (!feature) throw new Error(`${featureId} isn't a feature`);
    return feature;
  };
  return new Map(
    snapshot.data.providers.map((provider) => {
      const rows = providerRows(provider, providerHashes.get(provider.id) ?? '', featureOf);
      const plans = new Set(provider.plans.map((plan) => plan.id));
      return [
        provider.id,
        {
          ...rows,
          // D1's row is read without its json, which the hash stands for.
          providers: rows.providers.map((row) =>
            Object.fromEntries(Object.entries(row).filter(([column]) => column !== 'json')),
          ),
          bundle_plans: snapshot.data.bundles.flatMap((bundle) =>
            bundle.includes
              .filter((planId) => plans.has(planId))
              .map((planId) => ({ bundle_id: bundle.id, plan_id: planId })),
          ),
        },
      ];
    }),
  );
}

export interface SeedOptions {
  /** Provider id → a SHA-256 of `JSON.stringify(provider)`, its json column, from the caller: core has no crypto. */
  providerHashes: ReadonlyMap<string, string>;
  /** What D1 holds (readSeedState). Without it, the seed replaces everything. */
  current?: SeedState;
  /** The stored rows of providersToRead's providers (storedRowQueries, readStoredRows), which the seed compares. */
  rows?: ReadonlyMap<string, StoredProvider>;
  /**
   * The UTC day and the rows the catalog may write in one (seedDailyWrites), less what the day's seeds wrote already.
   * Without it, nothing is held back and the catalog row's daily count isn't kept.
   */
  budget?: { today: IsoDate; daily: number };
}

/** The statements that bring D1 to a snapshot, and what they cost. */
export interface SeedPlan {
  /** One statement per line, or '' when D1 already holds the build. */
  sql: string;
  /** The rows they write, as D1 counts them (seedTables). */
  writes: number;
  /** The providers and bundles left for the next seed, over the day's budget, in the catalog's order. */
  waiting: string[];
}

/**
 * The SQL that makes D1's catalog match `snapshot`: planSeed's statements. Throws where planSeed does.
 */
export function buildSeedSql(snapshot: CatalogSnapshot, options: SeedOptions): string {
  return planSeed(snapshot, options).sql;
}

/** A change's statements and the rows they write. */
interface Change {
  statements: string[];
  writes: number;
}

/**
 * The statements that make D1's catalog match `snapshot`, what they write, and what's left for the next seed. With
 * no `current` state, no catalog row while D1 holds rows, or a catalog row written under another seedFormat, it
 * replaces everything. Otherwise it writes only what changed:
 * - A changed provider's rows are compared with what D1 holds (`rows`): a row it no longer has is deleted (a plan
 *   takes its prices, features and bundle links), a new one inserted, and one whose other columns changed updated.
 *   A new provider is inserted, and a removed one deleted with everything that goes with it.
 * - A feature whose JSON changed is upserted, never deleted and inserted, which would cascade to every plan's rows
 *   for it. When an enum's values move, the rows whose rank_value moved are updated. A removed feature is deleted
 *   once nothing waits.
 * - A bundle whose JSON changed is replaced, and a removed one deleted.
 * - Over the day's budget, the changed providers are applied whole, in the catalog's order, until the next one
 *   wouldn't fit; the rest wait, and so do the bundles that include their plans. The catalog row then keeps the
 *   last whole catalog's version (partialCatalogVersion before there is one), so the API's ETags change once the
 *   last of them is written, and records how many wait (/health says so).
 * - The catalog row is written when the version, what waits or the day's count changes.
 */
export function planSeed(snapshot: CatalogSnapshot, options: SeedOptions): SeedPlan {
  const { data, meta } = snapshot;
  const { providerHashes, current, rows, budget } = options;
  const features = new Map(data.features.map((feature) => [feature.id, feature]));
  const featureOf = (featureId: string, listedBy: string) => {
    const feature = features.get(featureId);
    if (!feature) {
      throw new Error(
        `${listedBy} lists ${featureId}, which isn't a feature: run npm run data:validate`,
      );
    }
    return feature;
  };
  const rowsOf = (provider: SnapshotProvider) => {
    const hash = providerHashes.get(provider.id);
    if (hash === undefined) {
      throw new Error(`No hash for provider ${provider.id}`);
    }
    return providerRows(provider, hash, featureOf);
  };
  const featureRow = (feature: Feature): SeedRow => ({
    id: feature.id,
    category: feature.category,
    json: JSON.stringify(feature),
  });
  const bundleChange = (bundle: Bundle): Change =>
    inserts([
      ['bundles', { id: bundle.id, json: JSON.stringify(bundle) }],
      ...bundle.includes.map((planId): [SeedTable, SeedRow] => [
        'bundle_plans',
        { bundle_id: bundle.id, plan_id: planId },
      ]),
    ]);
  const catalogRow = (written?: number): SeedRow => ({
    id: 1,
    version: meta.catalogVersion,
    built_at: meta.generatedAt,
    seed_format: seedFormat,
    counts: JSON.stringify(meta.counts),
    waiting: 0,
    ...(budget && written !== undefined && { written_on: budget.today, written }),
  });

  const state = comparable(current);
  if (!state) {
    // Everything again: what D1 holds is deleted, then the whole catalog inserted (features first: plan_features
    // rows refer to them).
    const deleted = current
      ? clearOrder.reduce((sum, table) => sum + current.rows[table], 0)
      : undefined;
    const change = combine([
      {
        statements: clearOrder.map((table) => `DELETE FROM ${table};`),
        writes: deleted ?? 0,
      },
      inserts(
        data.features.map((feature): [SeedTable, SeedRow] => ['features', featureRow(feature)]),
        'upsert',
      ),
      ...data.providers.map((provider) => providerInserts(rowsOf(provider))),
      ...data.bundles.map(bundleChange),
    ]);
    const used = usedToday(current, budget);
    const writes = change.writes + 1;
    change.statements.push(insertStatement('catalog', catalogRow(used + writes), 'upsert'));
    return finished(change.statements, writes, []);
  }

  const providerIds = new Set(data.providers.map((provider) => provider.id));
  const storedOf = (id: string) => {
    const found = rows?.get(id);
    if (!found) {
      throw new Error(`No stored rows for provider ${id}: read them with storedRowQueries`);
    }
    return found;
  };
  const changedProviders = data.providers.filter(
    (provider) => state.providers.get(provider.id) !== providerHashes.get(provider.id),
  );
  const removedProviders = [...state.providers.keys()].filter((id) => !providerIds.has(id));
  const changedFeatures = data.features.filter(
    (feature) => state.features.get(feature.id) !== JSON.stringify(feature),
  );
  const removedFeatures = [...state.features.keys()].filter((id) => !features.has(id));
  const bundleIds = new Set(data.bundles.map((bundle) => bundle.id));
  const changedBundles = data.bundles.filter(
    (bundle) => state.bundles.get(bundle.id) !== JSON.stringify(bundle),
  );
  const removedBundles = [...state.bundles.keys()].filter((id) => !bundleIds.has(id));

  // What D1 holds of each changed provider, which the rank updates below bring up to date first.
  const stored = new Map(
    changedProviders
      .filter((provider) => state.providers.has(provider.id))
      .map((provider) => [provider.id, copyOf(storedOf(provider.id))]),
  );
  const unchanged = data.providers.filter((provider) => !changedProviders.includes(provider));
  const rankChange = combine(
    changedFeatures.map((feature) =>
      rankUpdates(feature, state.features.get(feature.id), unchanged, stored),
    ),
  );
  const fixed = combine([
    inserts(
      changedFeatures.map((feature): [SeedTable, SeedRow] => ['features', featureRow(feature)]),
      'upsert',
      (feature) => (state.features.has(String(feature['id'])) ? 'update' : 'insert'),
    ),
    rankChange,
    {
      statements: deleteIds('providers', removedProviders),
      writes: removedProviders.reduce((sum, id) => sum + rowCount(storedOf(id)), 0),
    },
  ]);
  const bundleDeletes = (ids: readonly string[]): Change => ({
    statements: deleteIds('bundles', ids),
    writes: ids.reduce((sum, id) => sum + 1 + storedLinks(state.bundles.get(id)), 0),
  });
  const bundleCosts =
    bundleDeletes([
      ...removedBundles,
      ...changedBundles.filter((bundle) => state.bundles.has(bundle.id)).map(({ id }) => id),
    ]).writes + changedBundles.reduce((sum, bundle) => sum + bundleChange(bundle).writes, 0);
  const featureDeletes: Change = {
    statements: deleteIds('features', removedFeatures),
    writes: removedFeatures.length,
  };

  // Whole providers in the catalog's order, until the next one wouldn't fit in what's left of the day.
  const used = usedToday(current, budget);
  const room = budget ? budget.daily - used : Infinity;
  let left = room - fixed.writes - bundleCosts - featureDeletes.writes - 1;
  const overBudget = left < 0;
  const applied: Change[] = [];
  const waitingProviders = new Set<string>();
  if (overBudget) {
    changedProviders.forEach((provider) => waitingProviders.add(provider.id));
  } else {
    for (const provider of changedProviders) {
      const before = stored.get(provider.id);
      const change = before
        ? providerDiff(rowsOf(provider), before)
        : providerInserts(rowsOf(provider));
      if (waitingProviders.size > 0 || change.writes > left) {
        waitingProviders.add(provider.id);
        continue;
      }
      left -= change.writes;
      applied.push(change);
    }
  }
  // A bundle waits with any provider whose plans it includes.
  const providerOfPlan = (planId: string) => planId.slice(0, planId.indexOf('.'));
  const waitingBundles = changedBundles.filter(
    (bundle) =>
      overBudget || bundle.includes.some((planId) => waitingProviders.has(providerOfPlan(planId))),
  );
  const waiting = [...waitingProviders, ...waitingBundles.map((bundle) => bundle.id)];
  const readyBundles = changedBundles.filter((bundle) => !waitingBundles.includes(bundle));
  // Not even the catalog row fits: the day's rows are spent.
  if (room < 1) return finished([], 0, waiting);

  const change = overBudget
    ? { statements: [], writes: 0 }
    : combine([
        bundleDeletes([
          ...removedBundles,
          ...readyBundles.filter((bundle) => state.bundles.has(bundle.id)).map(({ id }) => id),
        ]),
        fixed,
        ...applied,
        ...readyBundles.map(bundleChange),
        waiting.length === 0 ? featureDeletes : { statements: [], writes: 0 },
      ]);

  // The catalog row: the build's version once nothing waits, else the last whole catalog's.
  const complete = waiting.length === 0;
  const versionChanged = complete && state.catalog?.version !== meta.catalogVersion;
  const waitingChanged = (state.catalog?.waiting ?? 0) !== waiting.length;
  // With a budget, the day's count goes up with every write.
  const counted = budget !== undefined && change.statements.length > 0;
  if (versionChanged || waitingChanged || counted) {
    const writes = change.writes + 1;
    const written = used + writes;
    if (complete || !state.catalog) {
      const row = complete
        ? catalogRow(written)
        : {
            ...catalogRow(written),
            version: partialCatalogVersion,
            waiting: waiting.length,
          };
      change.statements.push(insertStatement('catalog', row, 'upsert'));
    } else {
      change.statements.push(
        updateStatement(
          'catalog',
          {
            id: 1,
            waiting: waiting.length,
            ...(budget && { written_on: budget.today, written }),
          },
          ['waiting', ...(budget ? ['written_on', 'written'] : [])],
        ),
      );
    }
    return finished(change.statements, writes, waiting);
  }
  return finished(change.statements, change.writes, waiting);
}

/** What D1 holds, when the seed can compare with it: a catalog row of this seedFormat, or an empty D1. */
function comparable(current: SeedState | undefined): SeedState | undefined {
  if (!current) return undefined;
  if (current.catalog) return current.catalog.seedFormat === seedFormat ? current : undefined;
  const empty = Object.values(current.rows).every((count) => count === 0);
  return empty ? current : undefined;
}

/** The rows the day's seeds wrote already: the catalog row's count, when it's today's. */
function usedToday(current: SeedState | undefined, budget: SeedOptions['budget']): number {
  return budget && current?.catalog?.writtenOn === budget.today ? current.catalog.written : 0;
}

/** The plan, its statements checked against D1's statement limit. */
function finished(statements: string[], writes: number, waiting: string[]): SeedPlan {
  for (const statement of statements) {
    if (utf8Length(statement) > maxStatementBytes) {
      throw new Error(
        `A seed statement is over D1's ${maxStatementBytes}-byte limit: ${statement.slice(0, 80)}…`,
      );
    }
  }
  return {
    sql: statements.length === 0 ? '' : `${statements.join('\n')}\n`,
    writes: statements.length === 0 ? 0 : writes,
    waiting,
  };
}

/** A provider's rows, as the seed writes them. */
function providerRows(
  provider: SnapshotProvider,
  hash: string,
  featureOf: (featureId: string, listedBy: string) => Feature,
): ProviderRows {
  const rows: ProviderRows = {
    providers: [
      {
        id: provider.id,
        name: provider.name,
        category: provider.category,
        spend_category: provider.spendCategory,
        hash,
        json: JSON.stringify(provider),
      },
    ],
    // Every category its plans are in, so GET /providers?category= finds it by any of them.
    provider_categories: providerCategories(provider).map((category) => ({
      category,
      provider_id: provider.id,
    })),
    // Its provider-wide features once, not once per plan (M11.4).
    provider_features: Object.entries(provider.features ?? {}).flatMap(([featureId, value]) =>
      featureRows(featureOf(featureId, provider.id), value, provider.id).map((row) => ({
        feature_id: featureId,
        value: row.value,
        provider_id: provider.id,
        rank_value: row.rank_value,
      })),
    ),
    plans: [],
    prices: [],
    plan_features: [],
  };
  for (const plan of provider.plans) {
    rows.plans.push({
      id: plan.id,
      provider_id: provider.id,
      name: plan.name,
      json: JSON.stringify(plan),
    });
    for (const price of plan.prices) {
      rows.prices.push({
        plan_id: plan.id,
        region: price.region,
        currency: price.currency,
        amount: price.amount,
        interval: price.interval,
        interval_count: price.intervalCount,
        monthly_equiv: monthlyEquivalent(price),
      });
    }
    for (const [featureId, value] of Object.entries(plan.features)) {
      for (const row of featureRows(featureOf(featureId, plan.id), value, plan.id)) {
        rows.plan_features.push({ plan_id: plan.id, feature_id: featureId, ...row });
      }
    }
  }
  return rows;
}

/** Inserting a new provider's rows, parents first. */
function providerInserts(rows: ProviderRows): Change {
  return inserts(
    providerTables.flatMap((table) => rows[table].map((row) => [table, row] as const)),
  );
}

/**
 * What brings a provider's stored rows to `wanted`: deletes, inserts and updates by each table's key. A plan it no
 * longer has is deleted with its prices, features and bundle links, so their rows aren't deleted again.
 */
function providerDiff(wanted: ProviderRows, stored: StoredProvider): Change {
  const keyOf = (table: SeedTable, row: SeedRow) =>
    seedTables[table].key.map((column) => String(row[column])).join('\u0000');
  const plansNow = new Set(wanted.plans.map((plan) => plan['id']));
  const goneIds = stored.plans.map((plan) => String(plan['id'])).filter((id) => !plansNow.has(id));
  const gone = new Set<SqlValue>(goneIds);
  const goneRows = (table: 'prices' | 'plan_features' | 'bundle_plans') =>
    stored[table].filter((row) => gone.has(row['plan_id'])).length;
  const changes: Change[] = [
    {
      statements: deleteIds('plans', goneIds),
      writes:
        goneIds.length + goneRows('prices') + goneRows('plan_features') + goneRows('bundle_plans'),
    },
  ];
  // Parents before children: a new plan's row before its prices.
  for (const table of providerTables) {
    const before = new Map(
      stored[table]
        .filter(
          (row) => !gone.has(row['plan_id']) && !gone.has(table === 'plans' ? row['id'] : null),
        )
        .map((row) => [keyOf(table, row), row]),
    );
    const after = new Map(wanted[table].map((row) => [keyOf(table, row), row]));
    const deletes = [...before].filter(([key]) => !after.has(key)).map(([, row]) => row);
    const statements = deletes.map((row) => deleteStatement(table, row));
    let writes = deletes.length;
    for (const [key, row] of after) {
      const old = before.get(key);
      if (!old) {
        statements.push(insertStatement(table, row));
        writes += insertWrites(table);
        continue;
      }
      // A column D1's row wasn't read with (a provider's json) changes with the others (its hash).
      const changed = Object.keys(row).filter(
        (column) => column in old && old[column] !== row[column],
      );
      if (changed.length === 0) continue;
      const columns = [...changed, ...Object.keys(row).filter((column) => !(column in old))];
      statements.push(updateStatement(table, row, columns));
      writes += updateWrites(table, columns);
    }
    changes.push({ statements, writes });
  }
  return combine(changes);
}

/** All the rows a stored provider has, which deleting it writes. */
function rowCount(stored: StoredProvider): number {
  return Object.values(stored).reduce((sum, rows) => sum + rows.length, 0);
}

/** How many plans a stored bundle's JSON includes: the links deleting it takes. */
function storedLinks(json: string | undefined): number {
  const parsed = storedBundleSchema.safeParse(json === undefined ? undefined : parsedJson(json));
  return parsed.success ? parsed.data.includes.length : 0;
}
const storedBundleSchema = z.object({ includes: z.array(z.string()) });

function combine(changes: readonly Change[]): Change {
  return {
    statements: changes.flatMap((change) => change.statements),
    writes: changes.reduce((sum, change) => sum + change.writes, 0),
  };
}

function inserts(
  rows: readonly (readonly [SeedTable, SeedRow])[],
  upsert?: 'upsert',
  kind: (row: SeedRow) => 'insert' | 'update' = () => 'insert',
): Change {
  return {
    statements: rows.map(([table, row]) => insertStatement(table, row, upsert)),
    writes: rows.reduce(
      (sum, [table, row]) =>
        sum +
        (kind(row) === 'insert'
          ? insertWrites(table)
          : updateWrites(
              table,
              Object.keys(row).filter((column) => !keyOfTable(table).includes(column)),
            )),
      0,
    ),
  };
}

/** A stored provider's rows in new lists, which rankUpdates replaces rows in. */
function copyOf(stored: StoredProvider): StoredProvider {
  return {
    providers: [...stored.providers],
    provider_categories: [...stored.provider_categories],
    provider_features: [...stored.provider_features],
    plans: [...stored.plans],
    prices: [...stored.prices],
    plan_features: [...stored.plan_features],
    bundle_plans: [...stored.bundle_plans],
  };
}

function keyOfTable(table: SeedTable): readonly string[] {
  return seedTables[table].key;
}

function insertWrites(table: SeedTable): number {
  return 1 + seedTables[table].indexes.length;
}

function updateWrites(table: SeedTable, columns: readonly string[]): number {
  const moved = seedTables[table].indexes.filter((index) =>
    index.some((column) => columns.includes(column)),
  );
  return 1 + moved.length;
}

function insertStatement(table: SeedTable, row: SeedRow, upsert?: 'upsert'): string {
  const columns = Object.keys(row);
  const key: readonly string[] = seedTables[table].key;
  const conflict = upsert
    ? ` ON CONFLICT (${key.join(', ')}) DO UPDATE SET ${columns
        .filter((column) => !key.includes(column))
        .map((column) => `${column} = excluded.${column}`)
        .join(', ')}`
    : '';
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => sqlValue(row[column] ?? null)).join(', ')})${conflict};`;
}

function whereKey(table: SeedTable, row: SeedRow): string {
  return seedTables[table].key
    .map((column) => `${column} = ${sqlValue(row[column] ?? null)}`)
    .join(' AND ');
}

function deleteStatement(table: SeedTable, row: SeedRow): string {
  return `DELETE FROM ${table} WHERE ${whereKey(table, row)};`;
}

function deleteIds(
  table: 'providers' | 'plans' | 'features' | 'bundles',
  ids: readonly string[],
): string[] {
  return ids.length > 0
    ? [`DELETE FROM ${table} WHERE id IN (${ids.map(sqlValue).join(', ')});`]
    : [];
}

function updateStatement(table: SeedTable, row: SeedRow, columns: readonly string[]): string {
  return `UPDATE ${table} SET ${columns
    .map((column) => `${column} = ${sqlValue(row[column] ?? null)}`)
    .join(', ')} WHERE ${whereKey(table, row)};`;
}

/**
 * A plan's or provider's value as plan_features or provider_features rows (BLUEPRINT §5.3): an enum's position, the number itself (unlimited is
 * above every number), 1 or 0 for a boolean, and one row per member of a set, with no rank_value.
 */
function featureRows(
  feature: Feature,
  value: FeatureValue,
  listedBy: string,
): { value: string; rank_value: number | null }[] {
  const wrongType = () =>
    new Error(
      `${listedBy}: ${JSON.stringify(value)} isn't a ${feature.id} value: run npm run data:validate`,
    );
  switch (feature.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw wrongType();
      return [{ value: String(value), rank_value: value ? 1 : 0 }];
    case 'number':
      if (value === 'unlimited') return [{ value, rank_value: unlimitedRankValue }];
      if (typeof value !== 'number') throw wrongType();
      return [{ value: String(value), rank_value: value }];
    case 'enum': {
      const position = feature.values.findIndex((option) => option.id === value);
      if (typeof value !== 'string' || position < 0) throw wrongType();
      return [{ value, rank_value: position }];
    }
    case 'set':
      if (!Array.isArray(value)) throw wrongType();
      return value.map((member) => ({ value: member, rank_value: null }));
  }
}

const storedEnumSchema = z.object({
  type: z.literal('enum'),
  values: z.array(z.object({ id: z.string() })),
});

/**
 * An enum's rank_value is its value's position, so a value that moved (1440p added before 4k) leaves the rows of
 * unchanged providers stale. One UPDATE per moved value and table (plan_features, and provider_features for a
 * provider-wide feature) fixes them, writing only the rows whose rank is wrong. A new value can't be in an unchanged
 * provider's rows, since that provider would have failed validation. When the stored JSON doesn't show the old
 * order, every value gets an UPDATE. The changed providers' stored rows (`stored`) are brought up to date with it,
 * so comparing them doesn't update the same rows again; what it writes is counted from those rows and the unchanged
 * providers' values.
 */
function rankUpdates(
  feature: Feature,
  storedJson: string | undefined,
  unchanged: readonly SnapshotProvider[],
  stored: ReadonlyMap<string, StoredProvider>,
): Change {
  if (feature.type !== 'enum' || storedJson === undefined) {
    return { statements: [], writes: 0 };
  }
  const parsed = storedEnumSchema.safeParse(parsedJson(storedJson));
  const before = parsed.success ? parsed.data.values.map((option) => option.id) : undefined;
  const tables = feature.providerWide
    ? (['plan_features', 'provider_features'] as const)
    : (['plan_features'] as const);
  const change: Change = { statements: [], writes: 0 };
  feature.values.forEach(({ id }, position) => {
    if (before && (before.indexOf(id) === position || !before.includes(id))) return;
    for (const table of tables) {
      change.statements.push(
        `UPDATE ${table} SET rank_value = ${position} WHERE feature_id = ${sqlValue(feature.id)} AND value = ${sqlValue(id)} AND rank_value IS NOT ${position};`,
      );
      // The unchanged providers' rows hold the value at its old rank, unless it's where it was.
      const unchangedRows = unchanged.reduce(
        (sum, provider) =>
          sum +
          (table === 'provider_features'
            ? Number(provider.features?.[feature.id] === id)
            : provider.plans.filter((plan) => plan.features[feature.id] === id).length),
        0,
      );
      const oldPosition = before?.indexOf(id);
      const staleUnchanged = oldPosition === position ? 0 : unchangedRows;
      let staleStored = 0;
      for (const rows of stored.values()) {
        rows[table] = rows[table].map((row) => {
          if (
            row['feature_id'] !== feature.id ||
            row['value'] !== id ||
            row['rank_value'] === position
          ) {
            return row;
          }
          staleStored++;
          return { ...row, rank_value: position };
        });
      }
      change.writes += (staleUnchanged + staleStored) * updateWrites(table, ['rank_value']);
    }
  });
  return change;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A SQL literal. SQLite strings have no escapes, so a quote is doubled and a line break is spliced in. */
function sqlValue(value: SqlValue): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${value} can't be stored in D1`);
    }
    return String(value);
  }
  const quoted = `'${value.replaceAll("'", "''")}'`;
  return quoted.replaceAll('\r', "' || char(13) || '").replaceAll('\n', "' || char(10) || '");
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
