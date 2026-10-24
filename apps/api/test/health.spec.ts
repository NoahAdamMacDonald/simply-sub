import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { API_VERSION } from '../src/routes/health';

const BASE = 'https://sub.simplely.ca/api/v1';
const counts = { providers: 5, plans: 10, addOns: 3, bundles: 1, features: 19 };

describe('GET /health', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalog').run();
  });

  it('reports the API version in the success envelope, never cached', async () => {
    const response = await exports.default.fetch(`${BASE}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json<{ data: unknown; meta: { generatedAt: string } }>();
    // Before the first seed, D1 holds no catalog.
    expect(body.data).toEqual({ status: 'ok', apiVersion: API_VERSION });
    expect(body.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('reports the catalog version, build time and counts that the seed recorded', async () => {
    await env.DB.prepare(
      `INSERT INTO catalog (id, version, built_at, seed_format, counts)
       VALUES (1, 'c4f9a21', '2026-10-22T03:12:45Z', 1, ?)`,
    )
      .bind(JSON.stringify(counts))
      .run();

    const response = await exports.default.fetch(`${BASE}/health`);

    expect((await response.json<{ data: unknown }>()).data).toEqual({
      status: 'ok',
      apiVersion: API_VERSION,
      catalogVersion: 'c4f9a21',
      catalogUpdatedAt: '2026-10-22T03:12:45Z',
      counts,
    });
  });

  it('only answers under /api/v1', async () => {
    const response = await exports.default.fetch('https://sub.simplely.ca/health');

    expect(response.status).toBe(404);
  });
});
