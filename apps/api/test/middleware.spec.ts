import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { png } from './icon-images';
import { catalogAssets, catalogSnapshot, seedCatalog } from './seeded-catalog';
import { freshRateLimitWindow } from './rate-limit-window';

// What every /api/* request goes through (src/middleware.ts, M2.8): the API's headers, JSON errors for unknown paths
// and unexpected throws, the per-IP rate limits and the edge cache, on the real catalog.
const BASE = 'https://sub.simplely.ca/api/v1';
const snapshot = catalogSnapshot('abc1234');
const assets = catalogAssets(snapshot);

/** A D1 or KV binding that fails the test's request if anything reads it. */
const broken = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error('This binding was read');
    },
  },
);
const brokenDb = broken as unknown as D1Database;
const brokenKv = broken as unknown as KVNamespace;
/** Static files with no catalog in them: every path gets the app's index.html. */
const withoutFiles = {
  fetch: async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }),
} as unknown as Fetcher;

/** A request as a test makes it: no execution context, so no edge cache, and no CF-Connecting-IP, so no limit. */
function get(path: string, headers: Record<string, string> = {}, bindings: Partial<Env> = {}) {
  return Promise.resolve(
    app.fetch(new Request(`${BASE}${path}`, { headers }), { ...env, ASSETS: assets, ...bindings }),
  );
}

/** A request with an execution context, as in production, waiting for what it does after answering. */
async function getWithContext(
  path: string,
  headers: Record<string, string> = {},
  bindings: Partial<Env> = {},
): Promise<Response> {
  const context = createExecutionContext();
  const response = await app.fetch(
    new Request(`${BASE}${path}`, { headers }),
    { ...env, ASSETS: assets, ...bindings },
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

const upstream = vi.spyOn(globalThis, 'fetch');
const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
vi.spyOn(console, 'warn').mockImplementation(() => undefined);

beforeAll(() => seedCatalog(snapshot));

beforeEach(async () => {
  upstream.mockReset();
  errors.mockClear();
  await env.KV.put(
    'fx:ecb',
    JSON.stringify({
      date: '2026-10-21',
      rates: { CAD: 1.506, USD: 1.09 },
      fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }),
  );
});

function expectApiHeaders(response: Response) {
  expect(Object.fromEntries(response.headers)).toMatchObject({
    'access-control-allow-origin': 'https://sub.simplely.ca',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  });
}

describe("the API's headers", () => {
  it('are on every answer: a success, a 304, a 400, a 404 and a 500', async () => {
    const ok = await get('/providers/netflix');
    const answers = [
      ok,
      await get('/providers/netflix', { 'If-None-Match': ok.headers.get('ETag') ?? '' }),
      await get('/providers/netflix?colour=red'),
      await get('/providers/netflx'),
      await get('/nothing-here'),
      await get('/providers/netflix', {}, { DB: brokenDb }),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([200, 304, 400, 404, 404, 500]);
    answers.forEach(expectApiHeaders);
  });
});

describe('the error middleware', () => {
  it.each([
    ['an unknown path', 'GET', '/api/v1/nothing-here'],
    ['a route without its id', 'GET', '/api/v1/plans'],
    ['another API version', 'GET', '/api/v2/providers'],
    ['a write to a read-only route', 'POST', '/api/v1/providers'],
  ])('answers %s with the JSON 404', async (_case, method, path) => {
    const response = await app.fetch(
      new Request(`https://sub.simplely.ca${path}`, { method }),
      env,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expectApiHeaders(response);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: `No API route answers ${method} ${path}.` },
    });
  });

  it('answers an unexpected throw with 500 internal, and logs the route but never the URL', async () => {
    const response = await get('/icon?domain=secret-clinic.example', {}, { KV: brokenKv });

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'Something went wrong on our side. Try again later.' },
    });
    expect(errors.mock.calls).toEqual([['Unexpected Error answering GET /api/v1/icon.']]);
  });
});

describe('the rate limits', () => {
  it('give an IP 60 requests a minute, then 429 with Retry-After, while another IP goes on', async () => {
    await freshRateLimitWindow();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      statuses.push((await get('/health', { 'CF-Connecting-IP': '203.0.113.1' })).status);
    }
    const limited = await get('/health', { 'CF-Connecting-IP': '203.0.113.1' });
    const other = await get('/health', { 'CF-Connecting-IP': '203.0.113.2' });

    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    expect(limited.status).toBe(429);
    expect(Object.fromEntries(limited.headers)).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '60',
    });
    expectApiHeaders(limited);
    expect(await limited.json()).toEqual({
      error: { code: 'rate_limited', message: 'Too many requests. Try again in 60 seconds.' },
    });
    expect(other.status).toBe(200);
  });

  it('give an IP 10 requests a minute to /icon', async () => {
    await freshRateLimitWindow();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await get('/icon?domain=localhost', { 'CF-Connecting-IP': '203.0.113.9' })).status,
      );
    }

    expect(statuses).toEqual([...Array<number>(10).fill(400), 429]);
  });

  it("don't limit a request that didn't come through Cloudflare's edge (no CF-Connecting-IP)", async () => {
    const statuses = new Set<number>();
    for (let i = 0; i < 70; i++) {
      statuses.add((await get('/health')).status);
    }

    expect([...statuses]).toEqual([200]);
  });
});

describe('the edge cache', () => {
  it("keeps a D1 route's answer and gives it again, If-None-Match too, without reading D1", async () => {
    const first = await getWithContext('/providers/netflix?region=CA');
    const again = await getWithContext(
      '/providers/netflix?region=CA',
      {},
      { DB: brokenDb, KV: brokenKv },
    );
    const etag = first.headers.get('ETag') ?? '';
    const unchanged = await getWithContext(
      '/providers/netflix?region=CA',
      { 'If-None-Match': etag },
      { DB: brokenDb, KV: brokenKv },
    );

    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(await again.text()).toBe(await first.text());
    expectApiHeaders(again);
    expect(unchanged.status).toBe(304);
  });

  it('keeps an /icon answer, so the icon services are asked once', async () => {
    upstream.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      return url.startsWith('https://icons.duckduckgo.com/')
        ? new Response(png(64), { headers: { 'Content-Type': 'image/png' } })
        : new Response(png(16), { status: 404 });
    });

    await getWithContext('/icon?domain=cached-gym.example');
    const asked = upstream.mock.calls.length;
    const again = await getWithContext('/icon?domain=cached-gym.example', {}, { KV: brokenKv });

    expect(asked).toBeGreaterThan(0);
    expect(again.status).toBe(200);
    expect(again.headers.get('X-Icon-Source')).toBe('duckduckgo');
    expect(upstream.mock.calls.length).toBe(asked);
  });

  it('keeps no error, no static-file route and nothing for a request without an execution context', async () => {
    await getWithContext('/providers/netflx');
    await getWithContext('/features');
    await getWithContext('/providers/netflix');

    const error = await getWithContext('/providers/netflx', {}, { DB: brokenDb });
    const features = await getWithContext('/features', {}, { ASSETS: withoutFiles });
    const direct = await get('/providers/netflix', {}, { DB: brokenDb });

    expect(error.status).toBe(500);
    expect(features.status).toBe(500);
    expect(direct.status).toBe(500);
  });
});
