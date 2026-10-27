import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedSql,
  categoriesBody,
  featuresBody,
  providersCursor,
  readCatalogSource,
  type CatalogSnapshot,
  type CatalogSourceFile,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import contract from '../../../docs/api-output-examples.json';
import { loadProviders, providersStatement } from '../src/db/providers';
import app from '../src/index';

// GET /providers (docs/api-output-examples.json) on the real catalog in data/: D1 is seeded with it the way the
// deploy seeds, the static features.json and categories.json are built from it, and KV keeps fresh ECB rates, so no
// test reaches Frankfurter.
const BASE = 'https://sub.simplely.ca/api/v1';
const cacheControl = 'public, max-age=3600, stale-while-revalidate=86400';
const examples = contract.endpoints['GET /providers'].examples;

/** ECB rates per euro: 1 EUR = 1.5060 CAD and 1 USD = 1.3806 CAD, as in the examples. */
const perEuro = { CAD: 1.506, CHF: 0.92, GBP: 0.84, USD: 1.506 / 1.3806 };

function snapshotOf(): CatalogSnapshot {
  const files: CatalogSourceFile[] = [
    ...structuredClone(env.TEST_CATALOG.files),
    ...env.TEST_CATALOG.logos.map((file) => ({ file, bytes: new Uint8Array() })),
  ];
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  return {
    data,
    meta: buildCatalogMeta(data, {
      catalogVersion: 'abc1234',
      generatedAt: '2026-10-24T00:00:00Z',
    }),
  };
}

const snapshot = snapshotOf();

/** The static files, as data:build writes them; anything else is missing, which the app's index.html stands for. */
const assets = {
  fetch: async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const body =
      path === '/data/catalog/features.json'
        ? featuresBody(snapshot)
        : path === '/data/catalog/categories.json'
          ? categoriesBody(snapshot)
          : undefined;
    return body
      ? Response.json(body)
      : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
  },
} as unknown as Fetcher;

function get(query: string, headers: Record<string, string> = {}, bindings: Partial<Env> = {}) {
  return Promise.resolve(
    app.fetch(new Request(`${BASE}/providers${query}`, { headers }), {
      ...env,
      ASSETS: assets,
      ...bindings,
    }),
  );
}

interface Body {
  data: {
    provider: { id: string; category: string };
    matchedPlans: {
      id: string;
      matchedKeys: string[];
      pricing?: { currency: string; native: boolean; fx?: { rate: number } }[];
      bestMonthlyEquivalent?: number;
    }[];
    bestPlanId: string;
    matchedOn: string[];
  }[];
  meta: {
    catalogVersion: string;
    query: unknown;
    total: number;
    nextCursor: string | null;
    fxDate?: string;
  };
}

const upstream = vi.spyOn(globalThis, 'fetch');
vi.spyOn(console, 'warn').mockImplementation(() => undefined);

beforeAll(async () => {
  const sql = buildSeedSql(snapshot, {
    providerHashes: new Map(snapshot.data.providers.map((p) => [p.id, 'hash'])),
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
  upstream.mockResolvedValue(new Response('down', { status: 503 }));
  await env.KV.put(
    'fx:ecb',
    JSON.stringify({
      date: '2026-10-21',
      rates: perEuro,
      fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }),
  );
});

/** The keys at every level of a JSON value, so a response can be compared with an example's shape. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length > 0 ? [shape(value[0])] : [];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, item]) => [key, shape(item)]),
    );
  }
  return typeof value;
}

describe('GET /providers', () => {
  it("answers the first example's query: 4K streaming in Canada, cheapest first", async () => {
    const [example] = examples;
    const response = await get(new URL(example.request.url).search);

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      etag: expect.stringMatching(/^"abc1234-[0-9a-f]{4}"$/),
    });
    const body = await response.json<Body>();
    expect(shape(body)).toEqual(shape(example.response.body));
    expect(body.data.map((result) => result.provider.id)).toEqual([
      'disney-plus',
      'crave',
      'netflix',
    ]);
    expect(body.meta).toEqual({
      ...example.response.body.meta,
      catalogVersion: 'abc1234',
      total: 3,
    });
    const best = body.data.map((result) => result.matchedPlans[0].bestMonthlyEquivalent ?? 0);
    expect(best).toEqual([...best].sort((a, b) => a - b));
    for (const result of body.data) {
      expect(result.matchedOn).toEqual(['feature:video.quality=4k']);
      expect(result.bestPlanId).toBe(result.matchedPlans[0].id);
      for (const plan of result.matchedPlans) {
        expect(plan.matchedKeys).toEqual(['video.quality=4k']);
        expect(plan.pricing?.every((price) => price.currency === 'CAD' && price.native)).toBe(true);
      }
    }
  });

  it("answers the second example's query: 'vpn', with prices converted from EUR", async () => {
    const example = examples[1];
    const response = await get(new URL(example.request.url).search);

    expect(response.status).toBe(200);
    const body = await response.json<Body>();
    expect(shape(body)).toEqual(shape(example.response.body));
    expect(body.meta).toEqual({
      ...example.response.body.meta,
      catalogVersion: 'abc1234',
      total: 2,
    });
    const [mullvad, proton] = body.data;
    expect(mullvad.provider.id).toBe('mullvad');
    // Every rank key whose name or alias says VPN: Unlimited VPN traffic, and Multi-hop as "double vpn".
    expect(mullvad.matchedOn).toEqual([
      'name',
      'category:vpn',
      'feature:vpn.included',
      'feature:vpn.unlimited-traffic',
      'feature:vpn.multi-hop',
    ]);
    expect(mullvad.matchedPlans[0].pricing?.[0]).toMatchObject({
      currency: 'CAD',
      native: false,
      fx: { rate: 1.506 },
    });
    expect(proton.provider.id).toBe('proton');
    expect(proton.matchedOn[0]).toBe('alias:proton vpn');
    expect(proton.bestPlanId).toBe('proton.free');
  });

  it("refuses the third example's query exactly as the example shows", async () => {
    const example = examples[2];
    const response = await get(new URL(example.request.url).search);

    expect(response.status).toBe(example.response.status);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': example.response.headers['Content-Type'],
      'cache-control': example.response.headers['Cache-Control'],
    });
    expect(await response.json()).toEqual(example.response.body);
  });

  it('answers If-None-Match with the ETag it sent with 304 Not Modified', async () => {
    const query = '?q=netflix&region=CA';
    const etag = (await get(query)).headers.get('ETag') ?? '';

    const response = await get(query, { 'If-None-Match': etag });

    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe(etag);
    expect(response.headers.get('Cache-Control')).toBe(cacheControl);
    expect(await response.text()).toBe('');
  });

  it('gives another query, or the same one with other rates, another ETag', async () => {
    const first = (await get('?q=netflix&region=CA')).headers.get('ETag');
    const other = (await get('?q=netflix&region=US')).headers.get('ETag');
    await env.KV.put(
      'fx:ecb',
      JSON.stringify({
        date: '2026-10-22',
        rates: perEuro,
        fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      }),
    );
    const newRates = (await get('?q=netflix&region=CA')).headers.get('ETag');

    expect(new Set([first, other, newRates]).size).toBe(3);
  });

  it("never shows a Canadian a plan that's sold in the US only", async () => {
    const plans = async (region: string) =>
      (await (await get(`?q=disney&region=${region}`)).json<Body>()).data[0].matchedPlans.map(
        (plan) => plan.id,
      );

    expect(await plans('CA')).not.toContain('disney-plus.with-ads');
    expect(await plans('US')).toContain('disney-plus.with-ads');
  });

  it('finds a provider by any category its plans are in, with the plans in it', async () => {
    const body = await (await get('?category=vpn&region=CA&sort=name')).json<Body>();

    // Proton is a privacy suite; its VPN Plus, Free and suites are VPNs too, but Mail, Drive and Pass Plus aren't.
    expect(body.data.map((result) => result.provider.id)).toEqual(['mullvad', 'proton']);
    const [, proton] = body.data;
    expect(proton.provider.category).toBe('privacy-suite');
    expect(proton.matchedOn).toEqual(['category:vpn']);
    expect(proton.matchedPlans.map((plan) => plan.id)).toEqual([
      'proton.free',
      'proton.vpn-plus',
      'proton.unlimited',
      'proton.duo',
      'proton.family',
    ]);
  });

  it('lists every provider by name without a region, with no prices and no exchange rates', async () => {
    await env.KV.delete('fx:ecb');

    const response = await get('');

    expect(response.status).toBe(200);
    const body = await response.json<Body>();
    expect(body.data.map((result) => result.provider.id)).toEqual(
      [...snapshot.data.providers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((provider) => provider.id),
    );
    expect(
      body.data.every((result) => result.matchedPlans.every((plan) => plan.pricing === undefined)),
    ).toBe(true);
    expect(body.meta).toEqual({
      catalogVersion: 'abc1234',
      query: { sort: 'name', limit: 20 },
      total: snapshot.data.providers.length,
      nextCursor: null,
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 502 when prices need rates and there are none', async () => {
    await env.KV.delete('fx:ecb');

    const response = await get('?region=CA');

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ error: { code: 'upstream_unavailable' } });
  });

  it('pages through the results with meta.nextCursor', async () => {
    const pages: string[][] = [];
    let cursor: string | null = '';
    while (cursor !== null) {
      const body: Body = await (
        await get(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      ).json<Body>();
      pages.push(body.data.map((result) => result.provider.id));
      expect(body.meta.total).toBe(snapshot.data.providers.length);
      cursor = body.meta.nextCursor;
    }

    expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
    expect(pages.flat()).toEqual(
      (await (await get('')).json<Body>()).data.map((result) => result.provider.id),
    );
    expect(providersCursor(2)).toMatch(/^p/);
  });

  it('refuses a rank key that is not in the registry', async () => {
    const response = await get('?feature=video.quality%3D8k');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'bad_request',
        message: "Invalid query parameter 'feature'.",
        details: [
          { param: 'feature', issue: '"8k" isn\'t a video.quality value (480p, 720p, 1080p, 4k).' },
        ],
      },
    });
  });

  it('reports a deploy without the static registry files as an internal error', async () => {
    const response = await get('', {}, { ASSETS: env.ASSETS });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'The catalog files are missing from this deploy.' },
    });
  });
});

describe('the D1 reads', () => {
  const { features } = snapshot.data;

  it('read the catalog row and every provider row when nothing narrows them', async () => {
    const rows = await loadProviders(env.DB, { sort: 'name', limit: 20 }, features);

    expect(rows.version).toBe('abc1234');
    expect(rows.providers.map((provider) => provider.id).sort()).toEqual(
      snapshot.data.providers.map((provider) => provider.id).sort(),
    );
    expect(rows.rowsRead).toBe(1 + snapshot.data.providers.length);
  });

  it('read only the providers with a plan in the category, through provider_categories', async () => {
    const query = { category: 'vpn', sort: 'name', limit: 20 } as const;
    const vpn = await loadProviders(env.DB, query, features);
    const { sql, bindings } = providersStatement(query, features);
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...bindings)
      .all<{ detail: string }>();

    expect(vpn.providers.map((provider) => provider.id).sort()).toEqual(['mullvad', 'proton']);
    expect(plan.results.map((row) => row.detail)).toEqual(
      expect.arrayContaining([
        'SEARCH providers USING PRIMARY KEY (id=?)',
        'SEARCH provider_categories USING PRIMARY KEY (category=?)',
      ]),
    );
    expect(plan.results.some((row) => /^SCAN/.test(row.detail))).toBe(false);
  });

  it('read only the providers with a plan that has every rank key, through the indexes', async () => {
    const query = {
      feature: ['video.quality=4k', 'streaming.ad-free', 'streaming.live=sports'],
      sort: 'name',
      limit: 20,
    } as const;
    const uhd = await loadProviders(
      env.DB,
      { feature: ['video.quality=4k', 'streaming.ad-free'], sort: 'name', limit: 20 },
      features,
    );
    const { sql, bindings } = providersStatement(
      { ...query, feature: [...query.feature] },
      features,
    );
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...bindings)
      .all<{ detail: string }>();

    expect(uhd.providers.map((provider) => provider.id).sort()).toEqual([
      'crave',
      'disney-plus',
      'netflix',
    ]);
    expect(plan.results.map((row) => row.detail)).toEqual(
      expect.arrayContaining([
        'SEARCH providers USING PRIMARY KEY (id=?)',
        'SEARCH plan_features USING COVERING INDEX idx_pf_feature (feature_id=?)',
        'SEARCH plan_features USING COVERING INDEX idx_pf_feature (feature_id=? AND rank_value>?)',
        'SEARCH plan_features USING COVERING INDEX idx_pf_feature (feature_id=? AND rank_value=?)',
      ]),
    );
    expect(plan.results.some((row) => /^SCAN (plan_features|providers)/.test(row.detail))).toBe(
      false,
    );
  });
});
