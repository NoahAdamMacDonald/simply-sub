import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { API_VERSION } from '../src/routes/health';

const BASE = 'https://sub.simplely.ca/api/v1';

describe('GET /health', () => {
  it('reports the API version in the success envelope, never cached', async () => {
    const response = await exports.default.fetch(`${BASE}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json<{ data: unknown; meta: { generatedAt: string } }>();
    expect(body.data).toEqual({ status: 'ok', apiVersion: API_VERSION });
    expect(body.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('only answers under /api/v1', async () => {
    const response = await exports.default.fetch('https://sub.simplely.ca/health');

    expect(response.status).toBe(404);
  });
});
