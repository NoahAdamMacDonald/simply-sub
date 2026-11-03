import {
  buildCatalogMeta,
  buildSeedSql,
  ecbCurrencies,
  providersCursor,
  readProvidersQuery,
  rebaseRates,
  searchProviders,
  seedShape,
  type CatalogSnapshot,
  type EcbRates,
  type ProviderMatch,
  type SnapshotProvider,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPricePage, walkSql } from '../src/db/price-pages';
import { catalogRow, loadProviders } from '../src/db/providers';
import app from '../src/index';
import { catalogAssets, catalogSnapshot } from './seeded-catalog';

// GET /providers' pages sorted from the cheapest (M11.8, shape 5), on a catalog of a few hundred providers: the tests'
// own, copied under other names and prices, in more currencies, with their free plans and names that tie. A page read
// through provider_prices must be the page that reading every provider gives, for any region, page and filter core
// applies, and parse only about twice the matches it needs.

/** ECB rates per euro: more currencies than the tests' catalog has, so copies can be priced in them. */
const ecb: EcbRates = {
  date: '2026-10-21',
  rates: {
    AUD: 1.63,
    CAD: 1.506,
    CHF: 0.92,
    GBP: 0.84,
    JPY: 165.2,
    NZD: 1.8,
    SEK: 11.4,
    USD: 1.506 / 1.3806,
  },
};
const today = '2026-11-03';
const copies = 240;

/** The tests' catalog's `provider` again as copy `n`: its own id and name, prices scaled, some in other currencies. */
function copyOf(provider: SnapshotProvider, n: number): SnapshotProvider {
  const id = `${provider.id}-${n}`;
  const scale = 0.5 + ((n * 37) % 23) / 10;
  const currency = (code: string) =>
    n % 4 === 1 && code === 'USD'
      ? 'SEK'
      : n % 4 === 2 && code === 'EUR'
        ? 'GBP'
        : n % 7 === 3 && code === 'CAD'
          ? 'JPY'
          : n % 9 === 5 && code === 'USD'
            ? 'NZD'
            : code;
  // Names that tie once normalized, and accents, which core's order ignores.
  const name =
    n % 40 === 7
      ? 'Crème Brûlée'
      : n % 40 === 8
        ? 'creme  brulee'
        : `${provider.name} ${String.fromCharCode(97 + ((n * 7) % 26))}${n}`;
  return {
    ...provider,
    id,
    name,
    plans: provider.plans.map((plan) => ({
      ...plan,
      id: `${id}.${plan.id.slice(provider.id.length + 1)}`,
      prices: plan.prices.map((price) => ({
        ...price,
        currency: currency(price.currency),
        amount: price.amount === 0 ? 0 : Math.round(price.amount * scale * 100) / 100,
      })),
    })),
  };
}

function manyProviders(): CatalogSnapshot {
  const { data } = catalogSnapshot('abc1234');
  const providers = Array.from({ length: copies }, (_, n) =>
    copyOf(data.providers[n % data.providers.length], n),
  );
  const many = { ...data, providers, bundles: [] };
  return {
    data: many,
    meta: buildCatalogMeta(many, {
      catalogVersion: 'abc1234',
      generatedAt: '2026-11-03T00:00:00Z',
    }),
  };
}

const snapshot = manyProviders();
const { features, categories } = snapshot.data;

beforeAll(async () => {
  const statements = buildSeedSql(snapshot, {
    providerHashes: new Map(snapshot.data.providers.map((provider) => [provider.id, 'hash'])),
  })
    .trimEnd()
    .split('\n');
  for (let at = 0; at < statements.length; at += 2000) {
    await env.DB.batch(statements.slice(at, at + 2000).map((sql) => env.DB.prepare(sql)));
  }
}, 120_000);

/** A query as GET /providers reads it, with the context core searches in. */
function read(params: Record<string, string>) {
  const queries = Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, [value]]),
  );
  const result = readProvidersQuery(queries, {
    features,
    categories,
    currencies: ecbCurrencies(ecb),
  });
  if ('problems' in result) throw new Error(JSON.stringify(result.problems));
  const { query } = result;
  const fx = rebaseRates(ecb, query.currency ?? 'USD');
  if (!fx) throw new Error(`No rates for ${query.currency}`);
  const search = (providers: SnapshotProvider[]) =>
    searchProviders(providers, query, { features, categories, fx, today });
  return { query, fx, search };
}

const ids = (matches: readonly ProviderMatch[]) => matches.map((match) => match.provider.id);

/** Every match, from every provider read: what GET /providers gives without the price walk. */
async function everyMatch(params: Record<string, string>) {
  const { query, search } = read(params);
  const rows = await loadProviders(env.DB, query, features, { shape: seedShape });
  return { matches: search(rows.providers), rowsRead: rows.rowsRead };
}

/** The page at `offset`, through the price walk. */
async function walked(params: Record<string, string>, offset: number) {
  const { query, fx, search } = read(params);
  const held = await catalogRow(env.DB);
  if (!held) throw new Error('Not seeded');
  return loadPricePage(env.DB, query, {
    currencies: held.currencies,
    providers: held.providers,
    fx,
    window: offset + query.limit + 1,
    search,
  });
}

describe('price pages (M11.8, shape 5)', () => {
  const queries: Record<string, string>[] = [
    { region: 'CA' },
    { region: 'US', limit: '7' },
    { region: 'GB', limit: '50' },
    { region: 'DE', currency: 'USD' },
    { region: 'AU' },
    { region: 'JP', limit: '5' },
    { region: 'SE', limit: '1' },
    { region: 'CA', interval: 'year' },
    { region: 'CA', interval: 'week' },
    { region: 'CA', nativeOnly: 'true' },
    { region: 'CA', maxPrice: '8' },
    { region: 'US', minPrice: '20' },
    { region: 'CA', minPrice: '5', maxPrice: '15' },
  ];

  it('gives the page that reading every provider gives, and knows whether another follows', async () => {
    for (const params of queries) {
      const { matches: all } = await everyMatch(params);
      const { query } = read(params);
      for (const offset of [0, 1, 19, 20, 60, 150, copies - 1]) {
        const page = await walked(params, offset);
        const end = offset + query.limit;
        const at = { ...params, offset };
        // Every match it gives is in its place: the first of every match there is, in order.
        expect({ at, matches: ids(page.matches) }).toEqual({
          at,
          matches: ids(all.slice(0, page.matches.length)),
        });
        expect({ at, page: ids(page.matches.slice(offset, end)) }).toEqual({
          at,
          page: ids(all.slice(offset, end)),
        });
        expect({ at, more: page.matches.length > end }).toEqual({ at, more: all.length > end });
        expect(page.version).toBe('abc1234');
      }
    }
  });

  it('parses twice the matches a first page needs, and reads that many rows of each currency', async () => {
    const held = await catalogRow(env.DB);
    const currencies = held?.currencies.length ?? 0;
    const firstPages: Record<string, string>[] = [
      { region: 'CA' },
      { region: 'US', limit: '50' },
      { region: 'GB', limit: '1' },
    ];
    for (const params of firstPages) {
      const { query } = read(params);
      const n = Math.max(32, 2 * (query.limit + 1));
      const page = await walked(params, 0);
      const { rowsRead } = await everyMatch(params);
      expect({ params, rounds: page.rounds }).toEqual({ params, rounds: 1 });
      // Where reading every provider parses them all.
      expect(page.providersRead).toBeLessThanOrEqual(n);
      expect(rowsRead).toBe(1 + copies);
      // The catalog row twice, n rows of each currency at most, and about 2 a provider read by its key.
      expect(page.rowsRead).toBeLessThanOrEqual(2 + currencies * n + 2 * page.providersRead);
    }
  });

  it('walks further, then reads every provider, when few providers match', async () => {
    // No copy is sold by the week.
    const page = await walked({ region: 'CA', interval: 'week' }, 0);
    expect(page.matches).toEqual([]);
    expect(page.rounds).toBe(2);
  });

  it('reads every provider when a seed writes between its reads', async () => {
    let batches = 0;
    const racing = {
      prepare: (sql: string) => env.DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        batches++;
        if (batches === 2) await env.DB.prepare('UPDATE catalog SET written = written + 1').run();
        return env.DB.batch(statements);
      },
    } as unknown as D1Database;
    const { query, fx, search } = read({ region: 'CA' });
    const held = await catalogRow(env.DB);
    const page = await loadPricePage(racing, query, {
      currencies: held?.currencies ?? [],
      providers: held?.providers ?? 0,
      fx,
      window: query.limit + 1,
      search,
    });
    expect(batches).toBe(3);
    expect(ids(page.matches)).toEqual(ids((await everyMatch({ region: 'CA' })).matches));
  });

  it('walks each currency through provider_prices’ key, and reads each provider by its key', async () => {
    const held = await catalogRow(env.DB);
    expect(held?.currencies).toEqual([
      'AUD',
      'CAD',
      'CHF',
      'EUR',
      'GBP',
      'JPY',
      'NZD',
      'SEK',
      'USD',
    ]);
    const plan = async (sql: string) =>
      (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>()).results.map(
        (row) => row.detail,
      );
    // In the key's order, with no sort of its own.
    expect(await plan(walkSql('CAD', 42))).toEqual([
      `SEARCH provider_prices_s${seedShape} USING PRIMARY KEY (currency=?)`,
    ]);
    expect(
      await plan("SELECT search AS json FROM providers WHERE id IN ('crave-0', 'tsn-1')"),
    ).toEqual([`SEARCH providers_s${seedShape} USING PRIMARY KEY (id=?)`]);
  });
});

describe('GET /providers sorted by price', () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 503 }));

  it('pages through every match in order with nextCursor, with a total only from the dearest', async () => {
    await env.KV.put(
      'fx:ecb',
      JSON.stringify({ ...ecb, fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }),
    );
    const bindings = { ...env, ASSETS: catalogAssets(snapshot) };
    for (const sort of ['price_asc', 'price_desc']) {
      const pages: string[] = [];
      let cursor: string | null = '';
      while (cursor !== null) {
        const response = await app.fetch(
          new Request(
            `https://sub.simplely.ca/api/v1/providers?region=CA&sort=${sort}&limit=50${cursor ? `&cursor=${cursor}` : ''}`,
          ),
          bindings,
        );
        expect(response.status).toBe(200);
        const body = await response.json<{
          data: { provider: { id: string } }[];
          meta: { total?: number; nextCursor: string | null };
        }>();
        const all = ids((await everyMatch({ region: 'CA', sort })).matches);
        // From the dearest, every provider is read (price-pages.ts), so the total is known.
        expect(body.meta.total).toBe(sort === 'price_asc' ? undefined : all.length);
        pages.push(...body.data.map((result) => result.provider.id));
        cursor = body.meta.nextCursor;
      }
      expect(pages).toEqual(ids((await everyMatch({ region: 'CA', sort })).matches));
    }
    expect(providersCursor(50)).toMatch(/^p/);
  });
});
