import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// GET /features and GET /categories (docs/api-output-examples.json) against the stand-in static
// files in test/fixtures/assets/: data/catalog/index.json is at catalog version c4f9a21, and
// features.json and categories.json stand in for the bodies data:build writes.
const BASE = 'https://sub.simplely.ca/api/v1';
const cacheControl = 'public, max-age=3600, stale-while-revalidate=86400';

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`${BASE}${path}`, { headers });
}

/** The fixture file the response should be, byte for byte. */
async function fixture(path: string): Promise<string> {
  return (await env.ASSETS.fetch(`https://assets.local${path}`)).text();
}

describe.each([
  ['/features', '/data/catalog/features.json'],
  ['/categories', '/data/catalog/categories.json'],
])('GET %s', (route, file) => {
  it(`sends ${file} with the catalog version as its ETag`, async () => {
    const response = await get(route);

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      etag: '"c4f9a21"',
    });
    expect(await response.text()).toBe(await fixture(file));
  });

  it.each(['"c4f9a21"', 'W/"c4f9a21"', '*'])(
    'answers If-None-Match: %s with 304 Not Modified',
    async (ifNoneMatch) => {
      const response = await get(route, { 'If-None-Match': ifNoneMatch });

      expect(response.status).toBe(304);
      expect(response.headers.get('ETag')).toBe('"c4f9a21"');
      expect(response.headers.get('Cache-Control')).toBe(cacheControl);
      expect(await response.text()).toBe('');
    },
  );

  it('sends the body when the ETag it was given is an older version', async () => {
    const response = await get(route, { 'If-None-Match': '"0000000"' });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(await fixture(file));
  });

  it.each([
    [
      '?category=vpn',
      "Invalid query parameter 'category'.",
      [{ param: 'category', issue: `Unknown parameter. GET ${route} takes none.` }],
    ],
    [
      '?region=CA&limit=5',
      '2 query parameters are invalid.',
      [
        { param: 'region', issue: `Unknown parameter. GET ${route} takes none.` },
        { param: 'limit', issue: `Unknown parameter. GET ${route} takes none.` },
      ],
    ],
  ])('refuses %s with 400 bad_request', async (query, message, details) => {
    const response = await get(`${route}${query}`);

    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ error: { code: 'bad_request', message, details } });
  });

  it('never reads D1', async () => {
    const response = await app.fetch(new Request(`${BASE}${route}`), {
      ...env,
      DB: undefined as unknown as D1Database,
    });

    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it(`reports a deploy without ${file} as an internal error`, async () => {
    // Every other file is there; the missing one is answered with the app, as the SPA fallback does.
    const withoutFile = {
      fetch: (input: RequestInfo | URL) =>
        new URL(String(input instanceof Request ? input.url : input)).pathname === file
          ? new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })
          : env.ASSETS.fetch(input),
    };
    const response = await app.fetch(new Request(`${BASE}${route}`), {
      ...env,
      ASSETS: withoutFile as unknown as Fetcher,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'The catalog files are missing from this deploy.' },
    });
  });
});
