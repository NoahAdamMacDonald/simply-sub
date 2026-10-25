import * as z from 'zod';
import type { Bundle } from './bundle';
import type { Feature, FeatureValue } from './feature';
import { monthlyEquivalent } from './monthly-equivalent';
import type { CatalogSnapshot, SnapshotProvider } from './snapshot';

// seed.sql for the D1 catalog cache (BLUEPRINT §5.3, §6.3): the statements that bring D1 from what it holds to the
// build's catalog, one per line, each under D1's 100 KB statement limit. D1's free plan allows 100,000 rows written
// a day and every deploy seeds, so only what changed is written: a code-only deploy writes nothing, and a price
// change rewrites one provider.

/** D1 rejects a statement longer than this many bytes. */
const maxStatementBytes = 100_000;

/**
 * The version of the rules that turn a snapshot into rows. Bump it when a migration changes the catalog tables, or
 * when a derived column (monthly_equiv, rank_value) is computed differently: rows written under another format are
 * replaced by a full reseed.
 */
export const seedFormat = 1;

/** rank_value for `unlimited`: above any real number, and still a finite number in JSON. */
export const unlimitedRankValue = 1e308;

/** Children first, though the ON DELETE CASCADE keys would clear them anyway. */
const tables = [
  'catalog',
  'bundle_plans',
  'bundles',
  'plan_features',
  'features',
  'prices',
  'plans',
  'providers',
];

/** What D1 holds, as far as the seed needs to know. readSeedState reads it from seedStateQueries' results. */
export interface SeedState {
  /** The catalog row, or undefined when there is none: a new database, or one a migration has just rebuilt. */
  catalog?: { version: string; seedFormat: number };
  /** Provider id → the hash it was written with. */
  providers: ReadonlyMap<string, string>;
  /** Feature id → its json column. */
  features: ReadonlyMap<string, string>;
  /** Bundle id → its json column. */
  bundles: ReadonlyMap<string, string>;
}

/** The queries that read D1's SeedState, in the order readSeedState expects their results. */
export const seedStateQueries = [
  'SELECT version, seed_format FROM catalog',
  'SELECT id, hash FROM providers',
  'SELECT id, json FROM features',
  'SELECT id, json FROM bundles',
];

const seedStateResultsSchema = z.tuple([
  z.array(z.object({ version: z.string(), seed_format: z.int() })).max(1),
  z.array(z.object({ id: z.string(), hash: z.string() })),
  z.array(z.object({ id: z.string(), json: z.string() })),
  z.array(z.object({ id: z.string(), json: z.string() })),
]);

/** D1's SeedState, from the rows each of seedStateQueries returned. Throws on rows of another shape. */
export function readSeedState(results: readonly unknown[]): SeedState {
  const [[catalog], providers, features, bundles] = seedStateResultsSchema.parse(results);
  return {
    ...(catalog && { catalog: { version: catalog.version, seedFormat: catalog.seed_format } }),
    providers: new Map(providers.map((row) => [row.id, row.hash])),
    features: new Map(features.map((row) => [row.id, row.json])),
    bundles: new Map(bundles.map((row) => [row.id, row.json])),
  };
}

export interface SeedOptions {
  /** Provider id → a SHA-256 of `JSON.stringify(provider)`, its json column, from the caller: core has no crypto. */
  providerHashes: ReadonlyMap<string, string>;
  /** What D1 holds (readSeedState). Without it, the seed replaces everything. */
  current?: SeedState;
}

type SqlValue = string | number | null;

/**
 * The SQL that makes D1's catalog match `snapshot`, one statement per line, or '' when it already does. With no
 * `current` state, no catalog row, or one written under another seedFormat, it replaces everything. Otherwise it
 * writes only what changed:
 * - A new provider, or one whose hash changed, is deleted (the cascade takes its plans, prices, plan features and
 *   bundle links) and inserted again, and unchanged bundles are linked to its plans again. A removed one is deleted.
 * - A feature whose JSON changed is upserted, never deleted and inserted, which would cascade to every plan's rows
 *   for it. When an enum's values move, the rows whose rank_value moved are updated. A removed feature is deleted.
 * - A bundle whose JSON changed is replaced, and a removed one deleted.
 * - The catalog row is written when the version changes.
 */
export function buildSeedSql(
  snapshot: CatalogSnapshot,
  { providerHashes, current }: SeedOptions,
): string {
  const { data, meta } = snapshot;
  const features = new Map(data.features.map((feature) => [feature.id, feature]));
  const statements: string[] = [];
  const insert = (table: string, row: Record<string, SqlValue>, upsertKey?: string) => {
    const columns = Object.keys(row);
    const upsert = upsertKey
      ? ` ON CONFLICT (${upsertKey}) DO UPDATE SET ${columns
          .filter((column) => column !== upsertKey)
          .map((column) => `${column} = excluded.${column}`)
          .join(', ')}`
      : '';
    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${Object.values(row).map(sqlValue).join(', ')})${upsert};`,
    );
  };
  const deleteRows = (table: string, ids: readonly string[]) => {
    if (ids.length > 0) {
      statements.push(`DELETE FROM ${table} WHERE id IN (${ids.map(sqlValue).join(', ')});`);
    }
  };
  const hashOf = (provider: SnapshotProvider) => {
    const hash = providerHashes.get(provider.id);
    if (hash === undefined) {
      throw new Error(`No hash for provider ${provider.id}`);
    }
    return hash;
  };

  const insertFeature = (feature: Feature) =>
    insert(
      'features',
      { id: feature.id, category: feature.category, json: JSON.stringify(feature) },
      'id',
    );
  const insertProvider = (provider: SnapshotProvider) => {
    insert('providers', {
      id: provider.id,
      name: provider.name,
      category: provider.category,
      spend_category: provider.spendCategory,
      hash: hashOf(provider),
      json: JSON.stringify(provider),
    });
    for (const plan of provider.plans) {
      insert('plans', {
        id: plan.id,
        provider_id: provider.id,
        name: plan.name,
        json: JSON.stringify(plan),
      });
      for (const price of plan.prices) {
        insert('prices', {
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
        const feature = features.get(featureId);
        if (!feature) {
          throw new Error(
            `${plan.id} lists ${featureId}, which isn't a feature: run npm run data:validate`,
          );
        }
        for (const row of featureRows(feature, value, plan.id)) {
          insert('plan_features', { plan_id: plan.id, feature_id: featureId, ...row });
        }
      }
    }
  };
  const linkBundle = (bundle: Bundle, planIds: readonly string[]) => {
    for (const planId of planIds) {
      insert('bundle_plans', { bundle_id: bundle.id, plan_id: planId });
    }
  };
  const insertBundle = (bundle: Bundle) => {
    insert('bundles', { id: bundle.id, json: JSON.stringify(bundle) });
    linkBundle(bundle, bundle.includes);
  };
  const writeCatalog = () =>
    insert(
      'catalog',
      {
        id: 1,
        version: meta.catalogVersion,
        built_at: meta.generatedAt,
        seed_format: seedFormat,
        counts: JSON.stringify(meta.counts),
      },
      'id',
    );

  const state = current?.catalog?.seedFormat === seedFormat ? current : undefined;
  if (!state?.catalog) {
    statements.push(...tables.map((table) => `DELETE FROM ${table};`));
    // Features first: plan_features rows refer to them.
    data.features.forEach(insertFeature);
    data.providers.forEach(insertProvider);
    data.bundles.forEach(insertBundle);
    writeCatalog();
  } else {
    const changedProviders = data.providers.filter(
      (provider) => state.providers.get(provider.id) !== hashOf(provider),
    );
    const changedFeatures = data.features.filter(
      (feature) => state.features.get(feature.id) !== JSON.stringify(feature),
    );
    const changedBundles = data.bundles.filter(
      (bundle) => state.bundles.get(bundle.id) !== JSON.stringify(bundle),
    );
    const removed = (stored: ReadonlyMap<string, string>, items: readonly { id: string }[]) => {
      const ids = new Set(items.map((item) => item.id));
      return [...stored.keys()].filter((id) => !ids.has(id));
    };
    /** The ids of `items` that D1 holds an older version of. */
    const stale = (items: readonly { id: string }[], stored: ReadonlyMap<string, string>) =>
      items.map((item) => item.id).filter((id) => stored.has(id));

    deleteRows('bundles', [
      ...removed(state.bundles, data.bundles),
      ...stale(changedBundles, state.bundles),
    ]);
    deleteRows('providers', [
      ...removed(state.providers, data.providers),
      ...stale(changedProviders, state.providers),
    ]);
    changedFeatures.forEach(insertFeature);
    deleteRows('features', removed(state.features, data.features));
    for (const feature of changedFeatures) {
      statements.push(...rankUpdates(feature, state.features.get(feature.id)));
    }
    changedProviders.forEach(insertProvider);
    changedBundles.forEach(insertBundle);
    // Deleting a provider took the links of every bundle that includes one of its plans.
    const replacedPlans = new Set(
      changedProviders.flatMap((provider) => provider.plans.map((plan) => plan.id)),
    );
    for (const bundle of data.bundles) {
      if (!changedBundles.includes(bundle)) {
        linkBundle(
          bundle,
          bundle.includes.filter((planId) => replacedPlans.has(planId)),
        );
      }
    }
    if (state.catalog.version !== meta.catalogVersion) {
      writeCatalog();
    }
  }

  for (const statement of statements) {
    if (utf8Length(statement) > maxStatementBytes) {
      throw new Error(
        `A seed statement is over D1's ${maxStatementBytes}-byte limit: ${statement.slice(0, 80)}…`,
      );
    }
  }
  return statements.length === 0 ? '' : `${statements.join('\n')}\n`;
}

/**
 * A plan's value as plan_features rows (BLUEPRINT §5.3): an enum's position, the number itself (unlimited is
 * above every number), 1 or 0 for a boolean, and one row per member of a set, with no rank_value.
 */
function featureRows(
  feature: Feature,
  value: FeatureValue,
  planId: string,
): { value: string; rank_value: number | null }[] {
  const wrongType = () =>
    new Error(
      `${planId}: ${JSON.stringify(value)} isn't a ${feature.id} value: run npm run data:validate`,
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
 * unchanged providers stale. One UPDATE per moved value fixes them, writing only the rows whose rank is wrong. A new
 * value can't be in an unchanged provider's rows, since that provider would have failed validation. When the stored
 * JSON doesn't show the old order, every value gets an UPDATE.
 */
function rankUpdates(feature: Feature, storedJson: string | undefined): string[] {
  if (feature.type !== 'enum' || storedJson === undefined) {
    return [];
  }
  const stored = storedEnumSchema.safeParse(parsedJson(storedJson));
  const before = stored.success ? stored.data.values.map((option) => option.id) : undefined;
  return feature.values.flatMap(({ id }, position) =>
    before && (before.indexOf(id) === position || !before.includes(id))
      ? []
      : [
          `UPDATE plan_features SET rank_value = ${position} WHERE feature_id = ${sqlValue(feature.id)} AND value = ${sqlValue(id)} AND rank_value IS NOT ${position};`,
        ],
  );
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
