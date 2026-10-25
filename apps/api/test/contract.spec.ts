import {
  buildCatalogData,
  buildCatalogIndex,
  buildCatalogMeta,
  buildSeedSql,
  catalogIds,
  categoriesBody,
  ecbRatesUrl,
  errorBodySchema,
  featuresBody,
  pngBody,
  readCatalogSource,
  regionSnapshot,
  successBodySchemas,
  type CatalogSnapshot,
  type CatalogSourceFile,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import contract from '../../../docs/api-output-examples.json';
import app from '../src/index';
import { ico, png } from './icon-images';

// The contract tests (PROJECT-PLAN M2.7): every example in docs/api-output-examples.json for an endpoint that's
// built is sent to the Worker as its request says, and the answer must match it: the status, the headers the
// Worker sends, and a body that the endpoint's schema accepts (core's successBodySchemas; error bodies exactly as
// the example shows). packages/core/test/catalog/contract.spec.ts holds the examples to the same schemas, so the
// examples and the code can't drift apart. A new example is tested without a new test.
//
// The Worker runs on the real catalog in data/, built and seeded under the examples' catalog version, with the
// static files data:build writes. Frankfurter and the icon services are stand-ins; a few examples need them in a
// particular state (setups). The examples' prices and other values are illustrative, so a success body is held to
// its schema and its meta's keys, not to the example's values.

interface Example {
  title: string;
  request: { method: string; url: string; headers?: Record<string, string> };
  response: { status: number; headers: Record<string, string>; body: unknown };
}
interface Endpoint {
  phase?: number;
  examples: Example[];
}

const endpoints = Object.entries(
  (contract as unknown as { endpoints: Record<string, Endpoint> }).endpoints,
);
const built = endpoints
  .filter(([, { phase }]) => phase === undefined)
  .flatMap(([endpoint, { examples }]) =>
    examples.map((example) => [`${endpoint} "${example.title}"`, endpoint, example] as const),
  );

/** The examples' catalog version, so ETags and If-None-Match can be compared as they are. */
const catalogVersion = 'c4f9a21';
/** Headers the Worker doesn't send: CORS arrives with M2.8, and Cloudflare's edge compresses. */
const notTheWorkers = ['access-control-allow-origin', 'content-encoding'];

/** ECB rates per euro on the examples' date: 1 EUR = 1.5060 CAD and 1 USD = 1.3806 CAD. */
const perEuro = { CAD: 1.506, CHF: 0.92, GBP: 0.84, USD: 1.506 / 1.3806 };

interface Setup {
  /** Frankfurter answers with today's rates unless it's down. */
  frankfurter?: 'down';
  /** Rates KV kept from before, now out of date. */
  keptRates?: 'stale';
  /** What DuckDuckGo's icon service has for the site: by default, like Google's, nothing. */
  duckduckgo?: Uint8Array<ArrayBuffer>;
}

/** The state an example needs, by its title. */
const setups: Record<string, Setup> = {
  'Frankfurter is down: last good rates are served': { frankfurter: 'down', keptRates: 'stale' },
  'Frankfurter is down and nothing is cached yet': { frankfurter: 'down' },
  'Icon for a custom subscription': { duckduckgo: ico(png(64)) },
};

function snapshotOf(): CatalogSnapshot {
  const files: CatalogSourceFile[] = [
    ...structuredClone(env.TEST_CATALOG.files),
    ...env.TEST_CATALOG.logos.map((file) => ({ file, bytes: new Uint8Array() })),
  ];
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  return {
    data,
    meta: buildCatalogMeta(data, { catalogVersion, generatedAt: '2026-10-22T03:12:45Z' }),
  };
}

const snapshot = snapshotOf();
const index = buildCatalogIndex(snapshot.meta);

/** The static files, as data:build writes them; anything else is missing, which the app's index.html stands for. */
const files: Record<string, unknown> = {
  '/data/catalog.json': snapshot,
  '/data/catalog/index.json': index,
  '/data/catalog/features.json': featuresBody(snapshot),
  '/data/catalog/categories.json': categoriesBody(snapshot),
  '/data/catalog/ids.json': catalogIds(snapshot),
  ...Object.fromEntries(
    index.regions.map((region) => [
      `/data/catalog/${region}.json`,
      regionSnapshot(snapshot, region),
    ]),
  ),
};
const assets = {
  fetch: async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    return Object.hasOwn(files, path)
      ? Response.json(files[path])
      : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
  },
} as unknown as Fetcher;

const upstream = vi.spyOn(globalThis, 'fetch');
vi.spyOn(console, 'warn').mockImplementation(() => undefined);

/** Frankfurter, Google's icon service (which redirects to gstatic.com) and DuckDuckGo's, in `setup`'s state. */
function serve(setup: Setup) {
  upstream.mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === ecbRatesUrl) {
      return setup.frankfurter === 'down'
        ? new Response('down', { status: 503 })
        : Response.json(
            Object.entries({ EUR: 1, ...perEuro }).map(([quote, rate]) => ({
              date: '2026-10-21',
              base: 'EUR',
              quote,
              rate,
            })),
          );
    }
    if (url.startsWith('https://www.google.com/s2/favicons')) {
      return new Response(null, {
        status: 301,
        headers: { Location: 'https://t0.gstatic.com/faviconV2?size=128' },
      });
    }
    if (url.startsWith('https://icons.duckduckgo.com/') && setup.duckduckgo) {
      return new Response(setup.duckduckgo, { headers: { 'Content-Type': 'image/x-icon' } });
    }
    if (
      url.startsWith('https://t0.gstatic.com/') ||
      url.startsWith('https://icons.duckduckgo.com/')
    ) {
      return new Response(png(16), { status: 404, headers: { 'Content-Type': 'image/png' } });
    }
    throw new Error(`An example fetched ${url}`);
  });
}

beforeAll(async () => {
  const sql = buildSeedSql(snapshot, {
    providerHashes: new Map(snapshot.data.providers.map((provider) => [provider.id, 'hash'])),
  });
  await env.DB.batch(
    sql
      .trimEnd()
      .split('\n')
      .map((statement) => env.DB.prepare(statement)),
  );
});

beforeEach(async () => {
  upstream.mockReset();
  for (const { name } of (await env.KV.list()).keys) {
    await env.KV.delete(name);
  }
});

/** A copy of `value` without the documentation notes (keys that start with _). */
function withoutNotes(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutNotes);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, item]) => [key, withoutNotes(item)]),
    );
  }
  return value;
}

/** Each problem Zod finds with `value`, as `path: message`. */
function issues(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('every example of a built endpoint, sent to the Worker', () => {
  it('covers every built endpoint, and has a setup only for examples that exist', () => {
    const titles = built.map(([, , example]) => example.title);

    expect(new Set(built.map(([, endpoint]) => endpoint))).toEqual(
      new Set(Object.keys(successBodySchemas)),
    );
    expect(Object.keys(setups).filter((title) => !titles.includes(title))).toEqual([]);
  });

  it.each(built)('%s', async (_name, endpoint, { title, request, response }) => {
    const setup = setups[title] ?? {};
    serve(setup);
    if (setup.keptRates === 'stale') {
      await env.KV.put(
        'fx:ecb',
        JSON.stringify({ date: '2026-10-20', rates: perEuro, fetchedAt: '2026-10-21T06:00:01Z' }),
      );
    }

    const answer = await app.fetch(
      new Request(request.url, { method: request.method, headers: request.headers }),
      { ...env, ASSETS: assets },
    );

    expect(answer.status).toBe(response.status);
    for (const [name, value] of Object.entries(response.headers)) {
      if (notTheWorkers.includes(name.toLowerCase())) {
        continue;
      }
      // A D1 route's ETag ends with a hash of the query as read, which the catalog behind it decides.
      const hashed = /^"([0-9a-f]{7})-[0-9a-f]{4}"$/.exec(value);
      if (name === 'ETag' && hashed) {
        expect(answer.headers.get(name), name).toMatch(new RegExp(`^"${hashed[1]}-[0-9a-f]{4}"$`));
      } else {
        expect(answer.headers.get(name), name).toBe(value);
      }
    }
    if (!('ETag' in response.headers)) {
      expect(answer.headers.get('ETag')).toBeNull();
    }

    const schema = successBodySchemas[endpoint as keyof typeof successBodySchemas];
    if (response.status === 304) {
      expect(await answer.text()).toBe('');
    } else if (response.status >= 400) {
      const body = await answer.json();
      expect(issues(errorBodySchema, body)).toEqual([]);
      expect(body).toEqual(withoutNotes(response.body));
    } else if (schema === pngBody) {
      expect((await answer.arrayBuffer()).byteLength).toBeGreaterThan(0);
    } else {
      const body = await answer.json<{ meta?: object }>();
      const example = withoutNotes(response.body) as { meta?: object };
      expect(issues(schema, body)).toEqual([]);
      expect(Object.keys(body.meta ?? {})).toEqual(Object.keys(example.meta ?? {}));
    }
  });
});
