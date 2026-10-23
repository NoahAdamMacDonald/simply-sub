import { Hono } from 'hono';

/** The version /health reports. Changes under /v1 are additive only (PROJECT-PLAN §6). */
export const API_VERSION = '1.0.0';

/**
 * GET /health: liveness and version (docs/api-output-examples.json). catalogVersion,
 * catalogUpdatedAt and counts are added once D1 holds a seeded catalog (M0.8, M1.5).
 */
export const health = new Hono<{ Bindings: Env }>().get('/', (c) =>
  c.json(
    {
      data: { status: 'ok', apiVersion: API_VERSION },
      // Timestamps are ISO 8601 in UTC, to the second, as in the examples.
      meta: { generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
    },
    200,
    // The contract's headers. Hono's default is plain application/json; M2.8 sets it for every route.
    { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  ),
);
