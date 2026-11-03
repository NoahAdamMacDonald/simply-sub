import * as z from 'zod';
import type { IsoDate } from '../dates/iso-date';
import type { Bundle } from './bundle';
import type { Feature } from './feature';
import { isoDateSchema } from './formats';
import {
  bundleInserts,
  catalogRow,
  clearOrder,
  combine,
  copyOf,
  deleteIds,
  featureRow,
  providerDeletes,
  insertStatement,
  inserts,
  maxStatementBytes,
  providerDiff,
  providerInserts,
  providerRows,
  rankMoves,
  rankRowWrites,
  rankStatement,
  rowCount,
  seedTables,
  sqlTable,
  sqlValue,
  storedLinks,
  updateStatement,
  utf8Length,
  type Change,
  type SeedRegistry,
  type SeedRow,
  type SeedTable,
  type SqlValue,
  type StoredProvider,
} from './seed-rows';
import { searchVocabularyKey } from '../search/search-index';
import type { CatalogMeta, CatalogSnapshot, SnapshotProvider } from './snapshot';

export {
  seedTables,
  sqlTable,
  unlimitedRankValue,
  type ProviderRows,
  type SeedRow,
  type SeedTable,
  type StoredProvider,
} from './seed-rows';

// seed.sql for the D1 catalog cache (BLUEPRINT §5.3, §6.3): the statements that bring D1 from what it holds to the
// build's catalog, one per line, each under D1's 100 KB statement limit. D1's free plan allows 100,000 rows written
// a day for the account, and every deploy seeds, so only what changed is written (M11.8): a code-only deploy writes
// nothing, and a price change is that price's row, its plan's and its provider's. The seed counts what it writes the
// way D1 does, and over the catalog's daily share it applies whole providers in the file's order and leaves the rest
// for the next seed, which the catalog row records.

/**
 * The version of the rules that turn a snapshot into rows. Bump it when a migration changes the catalog tables' rows,
 * or when a derived column (monthly_equiv, rank_value) is computed differently, and say its shape in seedShapes: a new
 * format goes through the seed's budget (M11.8). 2: provider_categories (migration 0003, M1.10). 3: provider_features
 * (migration 0004, M11.4). Migration 0005's bookkeeping columns on the catalog row changed no row, so no bump. 4:
 * shape 4, providers' search column and provider_search (migration 0007, M11.8).
 */
export const seedFormat = 4;

/**
 * The rows the catalog may write in a UTC day (M11.8): D1's 100,000 for the account, less the user database's 41,000
 * cap (BLUEPRINT §5.4) and a margin.
 */
export const seedDailyWrites = 50_000;

/** The catalog row's version while D1 has never held a whole catalog: an empty D1 filled over several days. */
export const partialCatalogVersion = '0000000';

/** A seed format, and the shape of the tables its rows are in. */
export interface SeedFormat {
  seedFormat: number;
  shape: number;
}

/**
 * Each seed format's table shape (M11.8). A format that only computes a derived column differently keeps its shape:
 * every provider's rows are compared again, through the budget. A new shape is a migration that creates its tables
 * beside the live ones (providers_s4…), which the seed fills through the budget and then points the API's views at.
 * Migration 0006 named the first shape, 3.
 */
export const seedShapes: Readonly<Record<number, number>> = { 3: 3, 4: 4 };

/** The shape of seedFormat's tables: 4, providers' search column and provider_search (migration 0007, M11.8). */
export const seedShape = 4;

const thisFormat: SeedFormat = { seedFormat, shape: seedShape };

/**
 * What a provider's stored hash starts with: the seed format and a digest of the registry's names its search text holds
 * (searchVocabularyKey), so a new format, or a feature or service category renamed, compares every provider again.
 */
export function hashPrefix(format: number, registry: SeedRegistry): string {
  return `${format}.${searchVocabularyKey(registry.features, registry.categories)}`;
}

/** A provider's hash as D1 keeps it: its SHA-256 after hashPrefix's. */
export function storedHash(prefix: string, sha256: string): string {
  return `${prefix}.${sha256}`;
}

/** Pointing the API's views at a shape's tables: D1 counts each view dropped and created as a row written. */
export function viewChange(shape: number): Change {
  const statements = viewStatements(shape);
  return { statements, writes: statements.length };
}

/** The statements that point the API's views at a shape's tables (M11.8). */
export function viewStatements(shape: number): string[] {
  // The catalog row is a table of its own, and the API finds provider_search's text by its shape's name (MATCH can't
  // go through a view).
  return clearOrder
    .filter((table) => table !== 'catalog' && table !== 'provider_search')
    .flatMap((table) => [
      `DROP VIEW IF EXISTS ${table};`,
      `CREATE VIEW ${table} AS SELECT * FROM ${sqlTable(shape, table)};`,
    ]);
}

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

/**
 * The queries that read D1's SeedState from a shape's tables (the code's, by default), in the order readSeedState
 * expects their results. The catalog row is the catalog's own.
 */
export function seedStateQueries(shape = seedShape): string[] {
  const table = (name: SeedTable) => sqlTable(shape, name);
  return [
    'SELECT version, seed_format, waiting, written_on, written FROM catalog',
    `SELECT id, hash FROM ${table('providers')}`,
    `SELECT id, json FROM ${table('features')}`,
    `SELECT id, json FROM ${table('bundles')}`,
    `SELECT ${clearOrder.map((name) => `(SELECT COUNT(*) FROM ${table(name)}) AS ${name}`).join(', ')}`,
  ];
}

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
  {
    providerHashes,
    current,
    format = thisFormat,
  }: Pick<SeedOptions, 'providerHashes' | 'current' | 'format'>,
): string[] {
  const mode = seedMode(current, format);
  if (mode.kind === 'full') return [];
  const prefix = hashPrefix(format.seedFormat, snapshot.data);
  const hashes = new Map([...providerHashes].map(([id, sha]) => [id, storedHash(prefix, sha)]));
  return [...mode.state.providers].flatMap(([id, hash]) => (hashes.get(id) !== hash ? [id] : []));
}

/**
 * The queries that read the rows of the providers `ids` from a shape's tables (the code's, by default), in the order
 * readStoredRows expects their results.
 */
export function storedRowQueries(ids: readonly string[], shape = seedShape): string[] {
  const list = ids.map(sqlValue).join(', ');
  const table = (name: SeedTable) => sqlTable(shape, name);
  const plans = `SELECT id FROM ${table('plans')} WHERE provider_id IN (${list})`;
  return [
    `SELECT id, name, category, spend_category, hash FROM ${table('providers')} WHERE id IN (${list})`,
    `SELECT provider_id, text FROM ${table('provider_search')} WHERE provider_id IN (${list})`,
    `SELECT category, provider_id FROM ${table('provider_categories')} WHERE provider_id IN (${list})`,
    `SELECT feature_id, value, provider_id, rank_value FROM ${table('provider_features')} WHERE provider_id IN (${list})`,
    `SELECT id, provider_id, name, json FROM ${table('plans')} WHERE provider_id IN (${list})`,
    `SELECT plan_id, region, currency, amount, interval, interval_count, monthly_equiv FROM ${table('prices')} WHERE plan_id IN (${plans})`,
    `SELECT plan_id, feature_id, value, rank_value FROM ${table('plan_features')} WHERE plan_id IN (${plans})`,
    `SELECT bundle_id, plan_id FROM ${table('bundle_plans')} WHERE plan_id IN (${plans})`,
  ];
}

const rowsSchema = z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])));

/** The stored rows of the providers `ids`, by provider, from storedRowQueries' results. Throws on another shape. */
export function readStoredRows(
  ids: readonly string[],
  results: readonly unknown[],
): Map<string, StoredProvider> {
  const [providers, search, categories, features, plans, prices, planFeatures, links] = z
    .tuple([
      rowsSchema,
      rowsSchema,
      rowsSchema,
      rowsSchema,
      rowsSchema,
      rowsSchema,
      rowsSchema,
      rowsSchema,
    ])
    .parse(results);
  const stored = new Map<string, StoredProvider>(
    ids.map((id) => [
      id,
      {
        providers: [],
        provider_search: [],
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
  for (const row of search) put('provider_search', row['provider_id'], row);
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
  format = thisFormat,
): SeedState {
  const stored = storedRowsOf(snapshot, providerHashes, format);
  const byJson = (items: readonly { id: string }[]) =>
    new Map(items.map((item) => [item.id, JSON.stringify(item)]));
  const count = (table: keyof StoredProvider) =>
    [...stored.values()].reduce((sum, rows) => sum + rows[table].length, 0);
  return {
    catalog: {
      version: snapshot.meta.catalogVersion,
      seedFormat: format.seedFormat,
      waiting: 0,
      written: 0,
    },
    providers: new Map(
      snapshot.data.providers.map((provider) => [
        provider.id,
        storedHash(
          hashPrefix(format.seedFormat, snapshot.data),
          providerHashes.get(provider.id) ?? '',
        ),
      ]),
    ),
    features: byJson(snapshot.data.features),
    bundles: byJson(snapshot.data.bundles),
    rows: {
      providers: count('providers'),
      provider_search: count('provider_search'),
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
  format = thisFormat,
): Map<string, StoredProvider> {
  const registry = { features: snapshot.data.features, categories: snapshot.data.categories };
  return new Map(
    snapshot.data.providers.map((provider) => {
      const rows = providerRows(
        provider,
        storedHash(
          hashPrefix(format.seedFormat, snapshot.data),
          providerHashes.get(provider.id) ?? '',
        ),
        registry,
      );
      const plans = new Set(provider.plans.map((plan) => plan.id));
      return [
        provider.id,
        {
          ...rows,
          // D1's row is read without its json and search, which the hash stands for.
          providers: rows.providers.map((row) =>
            Object.fromEntries(
              Object.entries(row).filter(([column]) => column !== 'json' && column !== 'search'),
            ),
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
  /** The format and shape to seed: the code's (seedFormat, seedShape), but for tests of a new one. */
  format?: SeedFormat;
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
  const format = options.format ?? thisFormat;
  const { shape } = format;
  const prefix = hashPrefix(format.seedFormat, data);
  const rowsOf = (provider: SnapshotProvider) => {
    const hash = providerHashes.get(provider.id);
    if (hash === undefined) {
      throw new Error(`No hash for provider ${provider.id}`);
    }
    return providerRows(provider, storedHash(prefix, hash), data);
  };
  const bundleChange = (bundle: Bundle) => bundleInserts(shape, bundle);
  const catalogRowOf = (written: number) =>
    catalogRow(meta, format.seedFormat, budget && { today: budget.today, written });

  const mode = seedMode(current, format);
  if (mode.kind === 'full') {
    // Everything again: what D1 holds is deleted, then the whole catalog inserted (features first: plan_features
    // rows refer to them).
    const deleted = current
      ? clearOrder.reduce((sum, table) => sum + current.rows[table], 0)
      : undefined;
    const change = combine([
      {
        statements: clearOrder.map((table) => `DELETE FROM ${sqlTable(shape, table)};`),
        writes: deleted ?? 0,
      },
      inserts(
        shape,
        data.features.map((feature): [SeedTable, SeedRow] => ['features', featureRow(feature)]),
        'upsert',
      ),
      ...data.providers.map((provider) => providerInserts(shape, rowsOf(provider))),
      ...data.bundles.map(bundleChange),
      // The API reads what was just written, whichever shape the views were on.
      viewChange(shape),
    ]);
    const used = usedToday(current, budget);
    const writes = change.writes + 1;
    change.statements.push(
      insertStatement(shape, 'catalog', catalogRowOf(used + writes), 'upsert'),
    );
    return finished(change.statements, writes, []);
  }
  const { state } = mode;

  const storedOf = (id: string) => {
    const found = rows?.get(id);
    if (!found) {
      throw new Error(`No stored rows for provider ${id}: read them with storedRowQueries`);
    }
    return found;
  };
  const {
    removedProviders,
    changedFeatures,
    removedFeatures,
    changedBundles,
    removedBundles,
    ...diff
  } = seedDiff(
    {
      meta,
      providers: data.providers.map((provider) => {
        const hash = providerHashes.get(provider.id);
        if (hash === undefined) throw new Error(`No hash for provider ${provider.id}`);
        return { id: provider.id, hash: storedHash(prefix, hash) };
      }),
      features: data.features,
      bundles: data.bundles,
    },
    state,
  );
  const changedIds = new Set(diff.changedProviders.map(({ id }) => id));
  const changedProviders = data.providers.filter((provider) => changedIds.has(provider.id));

  // What D1 holds of each changed provider, which the rank updates below bring up to date first.
  const stored = new Map(
    changedProviders
      .filter((provider) => state.providers.has(provider.id))
      .map((provider) => [provider.id, copyOf(storedOf(provider.id))]),
  );
  const unchanged = data.providers.filter((provider) => !changedProviders.includes(provider));
  const rankChange = combine(
    changedFeatures.map((feature) =>
      rankUpdates(shape, feature, state.features.get(feature.id), unchanged, stored),
    ),
  );
  const fixed = combine([
    inserts(
      shape,
      changedFeatures.map((feature): [SeedTable, SeedRow] => ['features', featureRow(feature)]),
      'upsert',
      (feature) => (state.features.has(String(feature['id'])) ? 'update' : 'insert'),
    ),
    rankChange,
    {
      statements: providerDeletes(shape, removedProviders),
      writes: removedProviders.reduce((sum, id) => sum + rowCount(storedOf(id)), 0),
    },
  ]);
  const bundleDeletes = (ids: readonly string[]): Change => ({
    statements: deleteIds(shape, 'bundles', ids),
    writes: ids.reduce((sum, id) => sum + 1 + storedLinks(state.bundles.get(id)), 0),
  });
  const bundleCosts =
    bundleDeletes([
      ...removedBundles,
      ...changedBundles.filter((bundle) => state.bundles.has(bundle.id)).map(({ id }) => id),
    ]).writes + changedBundles.reduce((sum, bundle) => sum + bundleChange(bundle).writes, 0);
  const featureDeletes: Change = {
    statements: deleteIds(shape, 'features', removedFeatures),
    writes: removedFeatures.length,
  };

  // Whole providers in the catalog's order, until the next one wouldn't fit in what's left of the day.
  const used = usedToday(current, budget);
  const room = budget ? budget.daily - used : Infinity;
  // What must fit with the providers: the registry's changes, the bundles, the catalog row, and a switch of views.
  const views = mode.switchViews ? viewChange(shape).writes : 0;
  let left = room - fixed.writes - bundleCosts - featureDeletes.writes - views - 1;
  const overBudget = left < 0;
  const applied: Change[] = [];
  const waitingProviders = new Set<string>();
  if (overBudget) {
    changedProviders.forEach((provider) => waitingProviders.add(provider.id));
  } else {
    for (const provider of changedProviders) {
      const before = stored.get(provider.id);
      const change = before
        ? providerDiff(shape, rowsOf(provider), before)
        : providerInserts(shape, rowsOf(provider));
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
        // A new shape's tables (or an empty D1's) whole at last: the API's views go to them.
        waiting.length === 0 && mode.switchViews
          ? viewChange(shape)
          : { statements: [], writes: 0 },
      ]);

  // The catalog row: the build's version once nothing waits, else the last whole catalog's.
  const complete = waiting.length === 0;
  // A new format whole names itself in the catalog row even when the catalog didn't change (a code-only shape).
  const versionChanged =
    complete &&
    (state.catalog?.version !== meta.catalogVersion ||
      state.catalog.seedFormat !== format.seedFormat);
  const waitingChanged = (state.catalog?.waiting ?? 0) !== waiting.length;
  // With a budget, the day's count goes up with every write.
  const counted = budget !== undefined && change.statements.length > 0;
  if (versionChanged || waitingChanged || counted) {
    const writes = change.writes + 1;
    const written = used + writes;
    if (complete || !state.catalog) {
      const row = complete
        ? catalogRowOf(written)
        : {
            ...catalogRowOf(written),
            version: partialCatalogVersion,
            waiting: waiting.length,
          };
      change.statements.push(insertStatement(shape, 'catalog', row, 'upsert'));
    } else {
      change.statements.push(
        updateStatement(
          shape,
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

/** What the seed brings D1 to: the build, from its snapshot (planSeed) or the seed index (seedNext, M11.8). */
export interface SeedTarget {
  meta: Pick<CatalogMeta, 'catalogVersion' | 'generatedAt' | 'counts'>;
  /** Each provider's id and hash, in the catalog's order. */
  providers: readonly { id: string; hash: string }[];
  features: readonly Feature[];
  bundles: readonly Bundle[];
}

/** What differs between the build and D1, by hash or JSON, before any row is read. */
export interface SeedDiff {
  /** The providers D1 holds under another hash, or not at all, in the catalog's order. */
  changedProviders: { id: string; hash: string }[];
  removedProviders: string[];
  changedFeatures: Feature[];
  removedFeatures: string[];
  changedBundles: Bundle[];
  removedBundles: string[];
}

/** What the build changes in D1: a provider by its hash, a feature or bundle by its JSON. */
export function seedDiff(target: SeedTarget, state: SeedState): SeedDiff {
  const idsOf = (items: readonly { id: string }[]) => new Set(items.map((item) => item.id));
  const providers = idsOf(target.providers);
  const features = idsOf(target.features);
  const bundles = idsOf(target.bundles);
  return {
    changedProviders: target.providers.filter(({ id, hash }) => state.providers.get(id) !== hash),
    removedProviders: [...state.providers.keys()].filter((id) => !providers.has(id)),
    changedFeatures: target.features.filter(
      (feature) => state.features.get(feature.id) !== JSON.stringify(feature),
    ),
    removedFeatures: [...state.features.keys()].filter((id) => !features.has(id)),
    changedBundles: target.bundles.filter(
      (bundle) => state.bundles.get(bundle.id) !== JSON.stringify(bundle),
    ),
    removedBundles: [...state.bundles.keys()].filter((id) => !bundles.has(id)),
  };
}

/**
 * How the seed brings D1 to `format` (M11.8). Row by row (`rows`) when it can compare with what the shape's tables
 * hold: a catalog row of a format with this shape (a format that only computes a derived column differently
 * compares every provider again, its hashes being under the old format), a catalog row of another shape (the new
 * shape's tables, beside the live ones, then switched to), or an empty D1. Everything again (`full`) without D1's
 * state, with rows but no catalog row, or with a format from before shapes.
 */
function seedMode(
  current: SeedState | undefined,
  format: SeedFormat,
): { kind: 'full' } | { kind: 'rows'; state: SeedState; switchViews: boolean } {
  if (!current) return { kind: 'full' };
  const live = current.catalog?.seedFormat;
  if (live === undefined) {
    const empty = Object.values(current.rows).every((count) => count === 0);
    return empty ? { kind: 'rows', state: current, switchViews: true } : { kind: 'full' };
  }
  const liveShape = live === format.seedFormat ? format.shape : seedShapes[live];
  if (liveShape === undefined) return { kind: 'full' };
  // An empty D1's fill names no version until it's whole, and its views may be another shape's (the migrations').
  return {
    kind: 'rows',
    state: current,
    switchViews: liveShape !== format.shape || current.catalog?.version === partialCatalogVersion,
  };
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
  shape: number,
  feature: Feature,
  storedJson: string | undefined,
  unchanged: readonly SnapshotProvider[],
  stored: ReadonlyMap<string, StoredProvider>,
): Change {
  const change: Change = { statements: [], writes: 0 };
  for (const move of rankMoves(feature, storedJson)) {
    change.statements.push(rankStatement(shape, move));
    // The unchanged providers' rows hold the value at its old rank.
    const unchangedRows = unchanged.reduce(
      (sum, provider) =>
        sum +
        (move.table === 'provider_features'
          ? Number(provider.features?.[feature.id] === move.value)
          : provider.plans.filter((plan) => plan.features[feature.id] === move.value).length),
      0,
    );
    let staleStored = 0;
    for (const rows of stored.values()) {
      rows[move.table] = rows[move.table].map((row) => {
        if (
          row['feature_id'] !== feature.id ||
          row['value'] !== move.value ||
          row['rank_value'] === move.position
        ) {
          return row;
        }
        staleStored++;
        return { ...row, rank_value: move.position };
      });
    }
    change.writes += (unchangedRows + staleStored) * rankRowWrites(move);
  }
  return change;
}
