import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// GET /catalog (docs/api-output-examples.json) against the stand-in static files in
// test/fixtures/assets/: data/catalog/index.json lists CA, EU and US, at catalog version c4f9a21.
const BASE = 'https://sub.simplely.ca/api/v1';
const cacheControl = 'public, max-age=3600, stale-while-revalidate=86400';

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`${BASE}${path}`, { headers });
}

/** The fixture file the response should be, byte for byte. */
async function fixture(path: string): Promise<string> {
  return (await env.ASSETS.fetch(`https://assets.local${path}`)).text();
}

describe('GET /catalog', () => {
  it('sends the full snapshot with the catalog version as its ETag', async () => {
    const response = await get('/catalog');

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      etag: '"c4f9a21"',
    });
    expect(await response.text()).toBe(await fixture('/data/catalog.json'));
  });

  it.each([
    ['CA', 'CA'],
    ['US', 'US'],
    ['EU', 'EU'],
    // A Swede with no Swedish prices in the catalog gets the EU's.
    ['SE', 'EU'],
  ])('sends ?region=%s the %s file', async (region, file) => {
    const response = await get(`/catalog?region=${region}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"c4f9a21"');
    expect(await response.text()).toBe(await fixture(`/data/catalog/${file}.json`));
  });

  it.each(['NZ', 'GLOBAL'])(
    'sends ?region=%s, which has no file, the full snapshot',
    async (region) => {
      const response = await get(`/catalog?region=${region}`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(await fixture('/data/catalog.json'));
    },
  );

  it.each(['"c4f9a21"', 'W/"c4f9a21"', '"0000000", "c4f9a21"', '*'])(
    'answers If-None-Match: %s with 304 Not Modified',
    async (ifNoneMatch) => {
      const response = await get('/catalog?region=CA', { 'If-None-Match': ifNoneMatch });

      expect(response.status).toBe(304);
      expect(response.headers.get('ETag')).toBe('"c4f9a21"');
      expect(response.headers.get('Cache-Control')).toBe(cacheControl);
      expect(await response.text()).toBe('');
    },
  );

  it('sends the body when the ETag it was given is an older version', async () => {
    const response = await get('/catalog', { 'If-None-Match': '"0000000"' });

    expect(response.status).toBe(200);
  });

  it.each([
    [
      '?region=UK',
      [
        {
          param: 'region',
          issue: '"UK" isn\'t an ISO 3166-1 region code: use GB for the United Kingdom.',
        },
      ],
    ],
    [
      '?region=ca',
      [
        {
          param: 'region',
          issue:
            '"ca" isn\'t an ISO 3166-1 alpha-2 region code (CA, US, GB), a group (EU) or GLOBAL.',
        },
      ],
    ],
    ['?region=CA&region=US', [{ param: 'region', issue: 'Give one region.' }]],
    [
      '?currency=CAD',
      [{ param: 'currency', issue: 'Unknown parameter. GET /catalog takes only region.' }],
    ],
  ])('refuses %s with 400 bad_request', async (query, details) => {
    const response = await get(`/catalog${query}`);

    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      error: { code: 'bad_request', message: expect.any(String), details },
    });
  });

  it('can’t probe for a region file, since a missing one is answered with the app', async () => {
    const response = await env.ASSETS.fetch('https://assets.local/data/catalog/NZ.json');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/html/);
    await response.body?.cancel();
  });

  it('reports a deploy without the catalog files as an internal error', async () => {
    const appOnly = {
      fetch: async () =>
        new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
    };
    const response = await app.fetch(new Request(`${BASE}/catalog`), {
      ...env,
      ASSETS: appOnly as unknown as Fetcher,
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'The catalog files are missing from this deploy.' },
    });
  });
});
