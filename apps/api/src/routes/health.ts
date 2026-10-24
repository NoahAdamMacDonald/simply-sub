import { Hono } from 'hono';

/** The version /health reports. Changes under /v1 are additive only (PROJECT-PLAN §6). */
export const API_VERSION = '1.0.0';

interface CatalogRow {
  version: string;
  built_at: string;
  counts: string;
}

/**
 * GET /health: liveness and version (docs/api-output-examples.json), plus the catalog D1 holds, from
 * the catalog row the seed writes (BLUEPRINT §5.3). Before the first seed there is no row, and only
 * the status and API version are reported.
 */
export const health = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const catalog = await c.env.DB.prepare(
    'SELECT version, built_at, counts FROM catalog',
  ).first<CatalogRow>();
  return c.json(
    {
      data: {
        status: 'ok',
        apiVersion: API_VERSION,
        ...(catalog && {
          catalogVersion: catalog.version,
          catalogUpdatedAt: catalog.built_at,
          counts: JSON.parse(catalog.counts) as unknown,
        }),
      },
      // Timestamps are ISO 8601 in UTC, to the second, as in the examples.
      meta: { generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
    },
    200,
    // The contract's headers. Hono's default is plain application/json; M2.8 sets it for every route.
    { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  );
});
