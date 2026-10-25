import type { Bundle, SnapshotProvider } from '@simply-sub/core';

// The D1 reads behind GET /providers/:id, GET /plans/:id and GET /bundles (BLUEPRINT §5.3, §7.1). D1 counts every
// row a query scans as read, so each lookup goes through a primary key or the bundle_plans (plan_id) index. A plan id
// starts with its provider's id, and the provider's JSON holds its plans and add-ons, so the plans table is read only
// to check that plans exist. Each read is one batch with the catalog row, so the version describes the rows even if
// a seed ran in between.

export interface ProviderRows {
  /** The catalog version D1 holds: the catalog row the seed writes. Undefined before the first seed. */
  version?: string;
  provider?: SnapshotProvider;
  /** What the reads cost, as D1 bills them. */
  rowsRead: number;
}

/** The catalog version and the provider `id`, if there is one. */
export async function loadProvider(db: D1Database, id: string): Promise<ProviderRows> {
  const [catalog, providers] = await db.batch([
    db.prepare('SELECT version FROM catalog'),
    db.prepare('SELECT json FROM providers WHERE id = ?').bind(id),
  ]);
  return {
    ...versionOf(catalog),
    ...(providers.results.length > 0 && {
      provider: parsedJson<SnapshotProvider>(providers.results[0]),
    }),
    rowsRead: catalog.meta.rows_read + providers.meta.rows_read,
  };
}

export interface PlanRows extends ProviderRows {
  /** The bundles that include the plan, by id. */
  bundleIds: string[];
}

/** The catalog version, the provider of `planId` (whose JSON holds the plan) and the bundles that include it. */
export async function loadPlan(db: D1Database, planId: string): Promise<PlanRows> {
  const [catalog, providers, bundles] = await db.batch([
    db.prepare('SELECT version FROM catalog'),
    db.prepare('SELECT json FROM providers WHERE id = ?').bind(providerIdOf(planId)),
    db
      .prepare('SELECT bundle_id FROM bundle_plans WHERE plan_id = ? ORDER BY bundle_id')
      .bind(planId),
  ]);
  return {
    ...versionOf(catalog),
    ...(providers.results.length > 0 && {
      provider: parsedJson<SnapshotProvider>(providers.results[0]),
    }),
    bundleIds: bundles.results.map((row) => (row as { bundle_id: string }).bundle_id),
    rowsRead: catalog.meta.rows_read + providers.meta.rows_read + bundles.meta.rows_read,
  };
}

export interface BundleRows {
  version?: string;
  /** Which of the plan ids asked for exist. */
  plans: string[];
  /** The bundles that include any of them. */
  bundles: Bundle[];
  /** Every provider those bundles include a plan of or are sold by. */
  providers: SnapshotProvider[];
  rowsRead: number;
}

/** The catalog version, which of `planIds` exist, and the bundles that include any of them with their providers. */
export async function loadBundles(db: D1Database, planIds: readonly string[]): Promise<BundleRows> {
  const statements = bundlesStatements(planIds.length);
  const [catalog, plans, bundles, providers] = await db.batch([
    db.prepare('SELECT version FROM catalog'),
    ...[statements.plans, statements.bundles, statements.providers].map((sql) =>
      db.prepare(sql).bind(...planIds),
    ),
  ]);
  const bundleRows = bundles.results as { json: string; seller: string | null }[];
  // A seller is often one of its bundle's plans' providers too: the same row, so the same text.
  const providerJson = new Set([
    ...(providers.results as { json: string }[]).map((row) => row.json),
    ...bundleRows.flatMap((row) => (row.seller === null ? [] : [row.seller])),
  ]);
  return {
    ...versionOf(catalog),
    plans: plans.results.map((row) => (row as { id: string }).id),
    bundles: bundleRows.map((row) => JSON.parse(row.json) as Bundle),
    providers: [...providerJson].map((json) => JSON.parse(json) as SnapshotProvider),
    rowsRead: [catalog, plans, bundles, providers].reduce(
      (sum, result) => sum + result.meta.rows_read,
      0,
    ),
  };
}

/**
 * GET /bundles' statements for `count` plan ids, bound as ?1 to ?count: the plan ids that exist, by primary key; the
 * bundles that include any of them, through bundle_plans' (plan_id) index, each with its seller's row; and the
 * providers of every plan in those bundles, through bundle_plans' primary key. Joins, unlike IN subqueries, read
 * each index entry once (EXPLAIN QUERY PLAN and rows_read in test/lookups.spec.ts).
 */
export function bundlesStatements(count: number): {
  plans: string;
  bundles: string;
  providers: string;
} {
  const ids = Array.from({ length: count }, (_, index) => `?${index + 1}`).join(', ');
  return {
    plans: `SELECT id FROM plans WHERE id IN (${ids})`,
    // A LEFT JOIN, so a bundle without its seller fails loudly in core instead of disappearing.
    bundles: [
      'SELECT b.json, s.json AS seller FROM bundles b',
      " LEFT JOIN providers s ON s.id = b.json ->> '$.soldBy'",
      ` WHERE b.id IN (SELECT bundle_id FROM bundle_plans WHERE plan_id IN (${ids}))`,
    ].join(''),
    // Plan ids are <provider id>.<slug>.
    providers: [
      'SELECT DISTINCT p.json FROM bundle_plans m',
      ' JOIN bundle_plans bp ON bp.bundle_id = m.bundle_id',
      " JOIN providers p ON p.id = substr(bp.plan_id, 1, instr(bp.plan_id, '.') - 1)",
      ` WHERE m.plan_id IN (${ids})`,
    ].join(''),
  };
}

/** Plan ids are <provider id>.<slug>. */
function providerIdOf(planId: string): string {
  return planId.slice(0, planId.indexOf('.'));
}

function versionOf(catalog: D1Result): { version?: string } {
  const version = (catalog.results[0] as { version: string } | undefined)?.version;
  return version === undefined ? {} : { version };
}

/** A json column: the record exactly as the seed wrote it, key order included. */
function parsedJson<T>(row: unknown): T {
  return JSON.parse((row as { json: string }).json) as T;
}
