import * as z from 'zod';
import type { Bundle } from './bundle';
import type { Feature, FeatureValue } from './feature';
import { monthlyEquivalent } from './monthly-equivalent';
import { providerCategories } from './plan-categories';
import type { CatalogMeta, SnapshotProvider } from './snapshot';

// The rows the seed writes to the D1 catalog cache (BLUEPRINT §5.3), the SQL that writes them and what D1 counts for
// it (M11.8): shared by the deploy's seed (seed-sql.ts) and the bot's, which seeds what waits a step at a time
// (seed-resume.ts). index.ts exports neither file's internals from here.

/** D1 rejects a statement longer than this many bytes. */
export const maxStatementBytes = 100_000;

/** rank_value for `unlimited`: above any real number, and still a finite number in JSON. */
export const unlimitedRankValue = 1e308;

export type SqlValue = string | number | null;
/** A table row as the seed writes it and D1 returns it. */
export type SeedRow = Readonly<Record<string, SqlValue>>;

export interface TableShape {
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
export const clearOrder: readonly SeedTable[] = [
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
export const providerTables = [
  'providers',
  'provider_categories',
  'provider_features',
  'plans',
  'prices',
  'plan_features',
] as const;
export type ProviderTable = (typeof providerTables)[number];

/** A provider's rows by table: as the seed writes them, or as D1 holds them (its providers row without json). */
export type ProviderRows = Record<ProviderTable, SeedRow[]>;

/** What D1 holds of a provider the seed changes or removes: its rows, and the bundles' links to its plans. */
export type StoredProvider = ProviderRows & { bundle_plans: SeedRow[] };

/** A change's statements and the rows they write. */
export interface Change {
  statements: string[];
  writes: number;
}

/** A provider's rows, as the seed writes them. */
export function providerRows(
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
export function providerInserts(rows: ProviderRows): Change {
  return inserts(
    providerTables.flatMap((table) => rows[table].map((row) => [table, row] as const)),
  );
}

/**
 * What brings a provider's stored rows to `wanted`: deletes, inserts and updates by each table's key. A plan it no
 * longer has is deleted with its prices, features and bundle links, so their rows aren't deleted again.
 */
export function providerDiff(wanted: ProviderRows, stored: StoredProvider): Change {
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
export function rowCount(stored: StoredProvider): number {
  return Object.values(stored).reduce((sum, rows) => sum + rows.length, 0);
}

/** How many plans a stored bundle's JSON includes: the links deleting it takes. */
export function storedLinks(json: string | undefined): number {
  const parsed = storedBundleSchema.safeParse(json === undefined ? undefined : parsedJson(json));
  return parsed.success ? parsed.data.includes.length : 0;
}
export const storedBundleSchema = z.object({ includes: z.array(z.string()) });

export function combine(changes: readonly Change[]): Change {
  return {
    statements: changes.flatMap((change) => change.statements),
    writes: changes.reduce((sum, change) => sum + change.writes, 0),
  };
}

export function inserts(
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
export function copyOf(stored: StoredProvider): StoredProvider {
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

export function keyOfTable(table: SeedTable): readonly string[] {
  return seedTables[table].key;
}

export function insertWrites(table: SeedTable): number {
  return 1 + seedTables[table].indexes.length;
}

export function updateWrites(table: SeedTable, columns: readonly string[]): number {
  const moved = seedTables[table].indexes.filter((index) =>
    index.some((column) => columns.includes(column)),
  );
  return 1 + moved.length;
}

export function insertStatement(table: SeedTable, row: SeedRow, upsert?: 'upsert'): string {
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

export function whereKey(table: SeedTable, row: SeedRow): string {
  return seedTables[table].key
    .map((column) => `${column} = ${sqlValue(row[column] ?? null)}`)
    .join(' AND ');
}

export function deleteStatement(table: SeedTable, row: SeedRow): string {
  return `DELETE FROM ${table} WHERE ${whereKey(table, row)};`;
}

export function deleteIds(
  table: 'providers' | 'plans' | 'features' | 'bundles',
  ids: readonly string[],
): string[] {
  return ids.length > 0
    ? [`DELETE FROM ${table} WHERE id IN (${ids.map(sqlValue).join(', ')});`]
    : [];
}

export function updateStatement(
  table: SeedTable,
  row: SeedRow,
  columns: readonly string[],
): string {
  return `UPDATE ${table} SET ${columns
    .map((column) => `${column} = ${sqlValue(row[column] ?? null)}`)
    .join(', ')} WHERE ${whereKey(table, row)};`;
}

/**
 * A plan's or provider's value as plan_features or provider_features rows (BLUEPRINT §5.3): an enum's position, the number itself (unlimited is
 * above every number), 1 or 0 for a boolean, and one row per member of a set, with no rank_value.
 */
export function featureRows(
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

export const storedEnumSchema = z.object({
  type: z.literal('enum'),
  values: z.array(z.object({ id: z.string() })),
});

export function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A SQL literal. SQLite strings have no escapes, so a quote is doubled and a line break is spliced in. */
export function sqlValue(value: SqlValue): string {
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

export function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** A feature's row. */
export function featureRow(feature: Feature): SeedRow {
  return { id: feature.id, category: feature.category, json: JSON.stringify(feature) };
}

/** Inserting a bundle and its links to its plans. */
export function bundleInserts(bundle: Bundle): Change {
  return inserts([
    ['bundles', { id: bundle.id, json: JSON.stringify(bundle) }],
    ...bundle.includes.map((planId): [SeedTable, SeedRow] => [
      'bundle_plans',
      { bundle_id: bundle.id, plan_id: planId },
    ]),
  ]);
}

/** The catalog row for a whole catalog, with the day's count when there's a budget. */
export function catalogRow(
  meta: Pick<CatalogMeta, 'catalogVersion' | 'generatedAt' | 'counts'>,
  seedFormat: number,
  counted?: { today: string; written: number },
): SeedRow {
  return {
    id: 1,
    version: meta.catalogVersion,
    built_at: meta.generatedAt,
    seed_format: seedFormat,
    counts: JSON.stringify(meta.counts),
    waiting: 0,
    ...(counted && { written_on: counted.today, written: counted.written }),
  };
}

/** A moved enum value's rows, in one table: the UPDATE that fixes their rank_value. */
export interface RankMove {
  table: 'plan_features' | 'provider_features';
  featureId: string;
  value: string;
  position: number;
  /** Where it was, when the stored JSON shows it. */
  oldPosition?: number;
}

/**
 * The values of an enum that moved since `storedJson` (its features row), in each table that holds its values
 * (plan_features, and provider_features for a provider-wide feature). A new value can't be in an unchanged provider's
 * rows, since that provider would have failed validation. When the stored JSON doesn't show the old order, every
 * value moved.
 */
export function rankMoves(feature: Feature, storedJson: string | undefined): RankMove[] {
  if (feature.type !== 'enum' || storedJson === undefined) return [];
  const parsed = storedEnumSchema.safeParse(parsedJson(storedJson));
  const before = parsed.success ? parsed.data.values.map((option) => option.id) : undefined;
  const tables = feature.providerWide
    ? (['plan_features', 'provider_features'] as const)
    : (['plan_features'] as const);
  return feature.values.flatMap(({ id }, position) =>
    before && (before.indexOf(id) === position || !before.includes(id))
      ? []
      : tables.map((table) => ({
          table,
          featureId: feature.id,
          value: id,
          position,
          ...(before && { oldPosition: before.indexOf(id) }),
        })),
  );
}

/** The UPDATE of a moved value's rows: only those whose rank is wrong are written. */
export function rankStatement(move: RankMove): string {
  return `UPDATE ${move.table} SET rank_value = ${move.position} WHERE feature_id = ${sqlValue(move.featureId)} AND value = ${sqlValue(move.value)} AND rank_value IS NOT ${move.position};`;
}

/** What a rank UPDATE writes for each row it changes. */
export function rankRowWrites(move: RankMove): number {
  return updateWrites(move.table, ['rank_value']);
}
