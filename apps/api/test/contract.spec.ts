import {
  addDays,
  calendarBody,
  ecbRatesUrl,
  errorBodySchema,
  pngBody,
  successBodySchemas,
  syncBody,
  type CalendarFeed,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import contract from '../../../docs/api-output-examples.json';
import { utcDay, utcTimestamp } from '../src/http';
import app from '../src/index';
import { feedRow } from '../src/routes/cal';
import { secretHash } from '../src/writes';
import { ico, png } from './icon-images';
import { catalogAssets, catalogSnapshot, seedCatalog } from './seeded-catalog';

// The contract tests (PROJECT-PLAN M2.7): every example in docs/api-output-examples.json for an endpoint that's
// built is sent to the Worker as its request says, and the answer must match it: the status, the headers the
// Worker sends, and a body that the endpoint's schema accepts (core's successBodySchemas; error bodies exactly as
// the example shows). packages/core/test/catalog/contract.spec.ts holds the examples to the same schemas, so the
// examples and the code can't drift apart. A new example is tested without a new test.
//
// The Worker runs on the real catalog in data/, built and seeded under the examples' catalog version, with the
// static files data:build writes. Frankfurter and the icon services are stand-ins; a few examples need them in a
// particular state (setups), the live calendar's the example's feed set, sync's its chain and a join link its link. The examples' prices and
// other values are illustrative, so a success body is held to its schema and its meta's keys, not to the example's
// values; a calendar file, written from the feed set, is held to the example's text, and a sealed copy to its bytes.

interface Example {
  title: string;
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    /** A body of bytes: a sealed sync copy. */
    bodyBase64?: string;
  };
  response: { status: number; headers: Record<string, string>; body: unknown; bodyBase64?: string };
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
/** A header the Worker doesn't send: Cloudflare's edge compresses. */
const notTheWorkers = ['content-encoding'];

/** ECB rates per euro on the examples' date: 1 EUR = 1.5060 CAD and 1 USD = 1.3806 CAD. */
const perEuro = { CAD: 1.506, CHF: 0.92, GBP: 0.84, USD: 1.506 / 1.3806 };

interface Setup {
  /** Frankfurter answers with today's rates unless it's down. */
  frankfurter?: 'down';
  /** Rates KV kept from before, now out of date. */
  keptRates?: 'stale';
  /** What DuckDuckGo's icon service has for the site: by default, like Google's, nothing. */
  duckduckgo?: Uint8Array<ArrayBuffer>;
  /** POST /cal's example's feed set is stored, as it made it. */
  feedSet?: true;
  /** GET /sync/:chain's example's chain is stored, at version 3. */
  syncChain?: true;
  /** DELETE /join/:id's example's link is stored, with its sealed code, working for 10 more minutes. */
  joinLink?: true;
}

/** The state an example needs, by its title. */
const setups: Record<string, Setup> = {
  'Frankfurter is down: last good rates are served': { frankfurter: 'down', keptRates: 'stale' },
  'Frankfurter is down and nothing is cached yet': { frankfurter: 'down' },
  'Icon for a custom subscription': { duckduckgo: ico(png(64)) },
  'Feed contents': { feedSet: true },
  'Unchanged since the app last fetched it': { feedSet: true },
  'Change a feed set': { feedSet: true },
  'Wrong manage key': { feedSet: true },
  'Revoke a feed set': { feedSet: true },
  "Read the chain's copy": { syncChain: true },
  'Unchanged since this device read it': { syncChain: true },
  'Wrong auth secret': { syncChain: true },
  'Replace the copy after reading version 3': { syncChain: true },
  'Another device wrote first': { syncChain: true },
  'Start a chain that already exists': { syncChain: true },
  'Delete the synced copy': { syncChain: true },
  'Take the sealed code, once': { joinLink: true },
};

/** Stores the chain GET /sync/:chain's example reads, at version 3, with the example's sealed copy. */
async function storeExampleChain(): Promise<void> {
  const { request, response } = contract.endpoints['GET /sync/:chain']
    .examples[0] as unknown as Example;
  const copy = response.bodyBase64 ?? '';
  await env.USER_DB.prepare(
    `INSERT INTO sync_chains (id, secret_hash, version, copy, size, updated_at, expires_on)
     VALUES (?, ?, 3, ?, ?, '2026-10-29T18:20:00Z', ?)`,
  )
    .bind(
      new URL(request.url).pathname.split('/').at(-1),
      await secretHash((request.headers?.['Authorization'] ?? '').replace(/^Bearer /, '')),
      copy,
      atob(copy).length,
      addDays(utcDay(new Date()), 180),
    )
    .run();
}

/** Stores the join link DELETE /join/:id's example takes, with its sealed code, for 10 more minutes. */
async function storeExampleJoinLink(): Promise<void> {
  const { request, response } = contract.endpoints['DELETE /join/:id']
    .examples[0] as unknown as Example;
  await env.USER_DB.prepare('INSERT INTO join_links (id_hash, sealed, expires_at) VALUES (?, ?, ?)')
    .bind(
      await secretHash(new URL(request.url).pathname.split('/').at(-1) ?? ''),
      response.bodyBase64 ?? '',
      utcTimestamp(new Date(Date.now() + 600_000)),
    )
    .run();
}

/**
 * Stores the feed set POST /cal's example made, under its id, manage key and tokens, at the time the GET example's
 * file was written.
 */
async function storeExampleFeedSet(): Promise<void> {
  const create = contract.endpoints['POST /cal'].examples[0];
  const { feeds } = create.request.body as { feeds: CalendarFeed[] };
  const { data } = create.response.body as unknown as {
    data: { id: string; manageKey: string; feeds: { token: string }[] };
  };
  const { id, manageKey, feeds: links } = data;
  const db = env.USER_DB;
  await db.batch([
    db
      .prepare('INSERT INTO cal_sets (id, manage_hash, expires_on) VALUES (?, ?, ?)')
      .bind(id, await secretHash(manageKey), addDays(utcDay(new Date()), 180)),
    ...(await Promise.all(
      feeds.map(async (feed, index) => {
        const row = await feedRow(feed, '2026-10-29T18:20:00Z');
        return db
          .prepare(
            'INSERT INTO cal_feeds (token_hash, set_id, content_hash, ics, updated_at) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(
            await secretHash(links[index].token),
            id,
            row.content_hash,
            row.ics,
            '2026-10-29T18:20:00Z',
          );
      }),
    )),
  ]);
}

/** A header whose value is new each time: what of it can be compared. */
const madeEachTime: Record<string, (value: string) => RegExp> = {
  // A new feed set's id.
  Location: (value) => new RegExp(`^${value.replace(/[A-Za-z0-9_-]{22}$/, '[A-Za-z0-9_-]{22}')}$`),
};

const snapshot = catalogSnapshot(catalogVersion);
const assets = catalogAssets(snapshot);

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

beforeAll(() => seedCatalog(snapshot));

beforeEach(async () => {
  upstream.mockReset();
  for (const { name } of (await env.KV.list()).keys) {
    await env.KV.delete(name);
  }
  await env.USER_DB.batch([
    env.USER_DB.prepare('DELETE FROM cal_feeds'),
    env.USER_DB.prepare('DELETE FROM cal_sets'),
    env.USER_DB.prepare('DELETE FROM sync_chains'),
    env.USER_DB.prepare('DELETE FROM join_links'),
    env.USER_DB.prepare('DELETE FROM price_reports'),
  ]);
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
    if (setup.feedSet) {
      await storeExampleFeedSet();
    }
    if (setup.syncChain) {
      await storeExampleChain();
    }
    if (setup.joinLink) {
      await storeExampleJoinLink();
    }

    const answer = await app.fetch(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body !== undefined && { body: JSON.stringify(withoutNotes(request.body)) }),
        ...(request.bodyBase64 !== undefined && {
          body: Uint8Array.from(atob(request.bodyBase64), (char) => char.charCodeAt(0)),
        }),
      }),
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
      } else if (name in madeEachTime) {
        expect(answer.headers.get(name), name).toMatch(madeEachTime[name](value));
      } else {
        expect(answer.headers.get(name), name).toBe(value);
      }
    }
    if (!('ETag' in response.headers)) {
      expect(answer.headers.get('ETag')).toBeNull();
    }

    const schema = successBodySchemas[endpoint as keyof typeof successBodySchemas];
    if (response.status === 304 || response.status === 204 || response.status === 202) {
      expect(await answer.text()).toBe('');
    } else if (response.status >= 400) {
      const body = await answer.json();
      expect(issues(errorBodySchema, body)).toEqual([]);
      expect(body).toEqual(withoutNotes(response.body));
    } else if (schema === calendarBody) {
      expect(await answer.text()).toBe(response.body);
    } else if (schema === syncBody) {
      const bytes = new Uint8Array(await answer.arrayBuffer());
      expect(btoa(String.fromCharCode(...bytes))).toBe(response.bodyBase64);
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
