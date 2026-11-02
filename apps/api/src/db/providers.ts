import {
  rankKeyOptions,
  type Feature,
  type ProvidersQuery,
  type RankKeyOption,
  type SnapshotProvider,
} from '@simply-sub/core';
import { providerOf } from './lookups';

// The D1 reads behind GET /providers (BLUEPRINT §5.3, §7.1). D1 counts every row a query scans as read, 5 million a
// day on the free plan, so SQL only narrows the providers down where an index can: a rank key through plan_features'
// (feature_id, rank_value) index or provider_features' key (M11.4), a provider by its primary key. Every filter is
// applied again, exactly, by core's searchProviders on the providers' JSON (its plans' features merged with the
// provider's), so SQL may let extra providers through but never drops one.

export interface CatalogRows {
  /** The catalog version D1 holds: the catalog row the seed writes. Undefined before the first seed. */
  version?: string;
  providers: SnapshotProvider[];
  /** What the reads cost, as D1 bills them. */
  rowsRead: number;
}

/** The catalog version D1 holds, from its one catalog row (1 row read), or undefined before the first seed. */
export async function catalogVersion(db: D1Database): Promise<string | undefined> {
  return (await db.prepare('SELECT version FROM catalog').first<{ version: string }>())?.version;
}

/**
 * The catalog version and the providers that can match `query`, in one batch, so both describe the same seed. With
 * rank keys, only providers with a plan that has every one; with a category, only that category's; otherwise every
 * provider.
 */
export async function loadProviders(
  db: D1Database,
  query: ProvidersQuery,
  features: readonly Feature[],
): Promise<CatalogRows> {
  const { sql, bindings } = providersStatement(query, features);
  const [catalog, providers] = await db.batch([
    db.prepare('SELECT version FROM catalog'),
    db.prepare(sql).bind(...bindings),
  ]);
  const version = (catalog.results[0] as { version: string } | undefined)?.version;
  return {
    ...(version !== undefined && { version }),
    providers: providers.results.map(providerOf),
    rowsRead: catalog.meta.rows_read + providers.meta.rows_read,
  };
}

/** The SELECT of the providers that can match `query`, and its bindings: never the query's text itself. */
export function providersStatement(
  query: ProvidersQuery,
  features: readonly Feature[],
): { sql: string; bindings: (string | number)[] } {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  const options = features.flatMap(rankKeyOptions);
  const required = (query.feature ?? []).flatMap(
    (key) => options.find((option) => option.key === key) ?? [],
  );
  if (required.length > 0) {
    // A key a plan states, or its provider for every plan (M11.4). Plans that state their own value instead are left to
    // core: a provider passes each key on its own, so one plan needn't have them all.
    for (const option of required) {
      const plans = providingRows(option, 'plan_features', 'plan_id');
      const provider = providingRows(option, 'provider_features', 'provider_id');
      bindings.push(...plans.values, ...provider.values);
      // Plan ids are <provider id>.<slug>.
      conditions.push(
        `id IN (SELECT substr(plan_id, 1, instr(plan_id, '.') - 1) FROM (${plans.sql}) UNION ${provider.sql})`,
      );
    }
  }
  if (query.category !== undefined) {
    // Any category its plans are in (provider_categories, M1.10), through the table's key.
    conditions.push('id IN (SELECT provider_id FROM provider_categories WHERE category = ?)');
    bindings.push(query.category);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return { sql: `SELECT json FROM providers${where}`, bindings };
}

/**
 * The plan_features or provider_features rows that provide `option` (PROJECT-PLAN §3.2), through plan_features'
 * (feature_id, rank_value) index or provider_features' key: rank_value is a boolean's 1 or 0 and a number itself, so
 * a boolean or a tier is a range of it. An enum lists the values at or above the key's, so a seed with another value
 * order can't make it wrong; a set member is a row.
 */
function providingRows(
  { feature, option }: RankKeyOption,
  table: 'plan_features' | 'provider_features',
  column: 'plan_id' | 'provider_id',
): {
  sql: string;
  values: (string | number)[];
} {
  const plans = `SELECT ${column} FROM ${table} WHERE feature_id = ?`;
  switch (feature.type) {
    case 'boolean':
      return { sql: `${plans} AND rank_value >= 1`, values: [feature.id] };
    case 'number': {
      const tier = feature.tiers?.find((candidate) => candidate.id === option);
      return { sql: `${plans} AND rank_value >= ?`, values: [feature.id, tier?.min ?? 0] };
    }
    case 'enum': {
      const values = feature.values
        .slice(feature.values.findIndex((value) => value.id === option))
        .map((value) => value.id);
      return {
        sql: `${plans} AND value IN (${values.map(() => '?').join(', ')})`,
        values: [feature.id, ...values],
      };
    }
    case 'set':
      return {
        sql: `${plans} AND rank_value IS NULL AND value = ?`,
        values: [feature.id, option ?? ''],
      };
  }
}
