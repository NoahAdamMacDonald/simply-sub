import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedSql,
  catalogIds,
  categoriesBody,
  featuresBody,
  maxBundlePlans,
  readCatalogSource,
  type CatalogSnapshot,
  type CatalogSourceFile,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import contract from '../../../docs/api-output-examples.json';
import { bundlesStatements, loadBundles, loadPlan, loadProvider } from '../src/db/lookups';
import app from '../src/index';

// GET /providers/:id, GET /plans/:id and GET /bundles (docs/api-output-examples.json) on the real catalog in data/:
// D1 is seeded with it the way the deploy seeds, the static features.json, categories.json and ids.json are built
// from it, and KV keeps fresh ECB rates, so no test reaches Frankfurter. The examples' prices are illustrative, so
// the tests compare their shapes and key order, and their values where the real catalog has the same prices.
const BASE = 'https://sub.simplely.ca/api/v1';
const cacheControl = 'public, max-age=3600, stale-while-revalidate=86400';
const providerExamples = contract.endpoints['GET /providers/:id'].examples;
const planExamples = contract.endpoints['GET /plans/:id'].examples;
const bundlesExamples = contract.endpoints['GET /bundles'].examples;

/** A success example's body: an endpoint's examples mix success and error bodies, so their types do too. */
function bodyOf<T extends { data?: unknown }>(body: T): T & { data: NonNullable<T['data']> } {
  if (body.data === undefined) {
    throw new Error('This example has no data');
  }
  return body as T & { data: NonNullable<T['data']> };
}

/** Asserts that `response` is an error example's response, headers and body. */
async function expectExample(
  response: Response,
  example: { status: number; headers: Record<string, string | undefined>; body: unknown },
) {
  expect(response.status).toBe(example.status);
  expect(Object.fromEntries(response.headers)).toMatchObject({
    'content-type': example.headers['Content-Type'],
    'cache-control': example.headers['Cache-Control'],
  });
  expect(await response.json()).toEqual(example.body);
}

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
const providerOf = (id: string) => {
  const provider = snapshot.data.providers.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new Error(`No provider ${id} in data/`);
  }
  return provider;
};

/** The static files, as data:build writes them; anything else is missing, which the app's index.html stands for. */
const files: Record<string, unknown> = {
  '/data/catalog/features.json': featuresBody(snapshot),
  '/data/catalog/categories.json': categoriesBody(snapshot),
  '/data/catalog/ids.json': catalogIds(snapshot),
};
const assets = {
  fetch: async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    return Object.hasOwn(files, path)
      ? Response.json(files[path])
      : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
  },
} as unknown as Fetcher;

function get(path: string, headers: Record<string, string> = {}, bindings: Partial<Env> = {}) {
  return Promise.resolve(
    app.fetch(new Request(`${BASE}${path}`, { headers }), { ...env, ASSETS: assets, ...bindings }),
  );
}

type Json = Record<string, unknown>;
interface Picked {
  interval: string;
  amount: number;
  currency: string;
  native: boolean;
  source: { region: string; currency: string };
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
  await keepRates('2026-10-21');
});

async function keepRates(date: string) {
  await env.KV.put(
    'fx:ecb',
    JSON.stringify({
      date,
      rates: perEuro,
      fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }),
  );
}

/** The keys of `value` that `example` also has (documentation notes aside), in `value`'s order. */
function sharedKeys(value: object, example: object): string[] {
  const keys = Object.keys(example).filter((key) => !key.startsWith('_'));
  return Object.keys(value).filter((key) => keys.includes(key));
}

/** Asserts that the keys `value` and `example` share come in the same order in both. */
function expectSameOrder(value: object, example: object) {
  expect(sharedKeys(value, example)).toEqual(sharedKeys(example, value));
}

/** The record's keys, with `pricing` right after `prices`. */
function withPricing(record: object): string[] {
  return Object.keys(record).flatMap((key) => (key === 'prices' ? [key, 'pricing'] : [key]));
}

function expectCatalogHeaders(response: Response) {
  expect(Object.fromEntries(response.headers)).toMatchObject({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl,
    etag: expect.stringMatching(/^"abc1234-[0-9a-f]{4}"$/),
  });
}

describe('GET /providers/:id', () => {
  it('answers the Netflix example: the record as written, with Canadian prices on every plan and add-on', async () => {
    const url = new URL(providerExamples[0].request.url);
    const example = bodyOf(providerExamples[0].response.body);
    const response = await get(`${url.pathname.replace('/api/v1', '')}${url.search}`);

    expect(response.status).toBe(200);
    expectCatalogHeaders(response);
    const body = await response.json<{
      data: Json & { plans: Json[]; addOns: Json[] };
      meta: Json;
    }>();
    const netflix = providerOf('netflix');
    expect(body.meta).toEqual({ ...example.meta, catalogVersion: 'abc1234' });
    expect(Object.keys(body.data)).toEqual(Object.keys(netflix));
    expectSameOrder(body.data, example.data);
    for (const [index, plan] of body.data.plans.entries()) {
      expect(Object.keys(plan)).toEqual(withPricing(netflix.plans[index]));
      // Netflix's Canadian prices are the example's.
      const shown = example.data.plans.find((candidate) => candidate.id === plan['id']);
      expect(plan['pricing']).toEqual(shown?.pricing);
    }
    for (const [index, addOn] of body.data.addOns.entries()) {
      expect(Object.keys(addOn)).toEqual(withPricing(netflix.addOns?.[index] ?? {}));
      const shown = example.data.addOns?.find((candidate) => candidate.id === addOn['id']);
      expect(addOn['pricing']).toEqual(shown?.pricing);
    }
  });

  it("answers the Proton example's query with Proton's own CAD prices, the free plan native", async () => {
    const response = await get('/providers/proton?region=CA&currency=CAD');

    expect(response.status).toBe(200);
    const body = await response.json<{
      data: Json & { plans: (Json & { pricing: Picked[] })[] };
      meta: Json;
    }>();
    const example = bodyOf(providerExamples[1].response.body);
    expect(body.meta).toEqual({ ...example.meta, catalogVersion: 'abc1234' });
    expectSameOrder(body.data, example.data);
    const proton = providerOf('proton');
    expect(body.data.plans.map((plan) => Object.keys(plan))).toEqual(proton.plans.map(withPricing));
    for (const plan of body.data.plans) {
      expect(plan.pricing.length).toBeGreaterThan(0);
      expect(plan.pricing.every((price) => price.currency === 'CAD' && price.native)).toBe(true);
    }
    expect(body.data.plans[0].pricing[0]).toMatchObject({ amount: 0, native: true });
  });

  it("gives a plan or add-on not sold in the region no prices, and an unknown one the fallback's", async () => {
    const canada = await (
      await get('/providers/disney-plus?region=CA')
    ).json<{ data: { plans: Json[]; addOns: Json[] } }>();
    const britain = await (
      await get('/providers/netflix?region=GB')
    ).json<{ data: { plans: { pricing: Picked[] }[] }; meta: Json }>();

    const priced = (items: Json[]) =>
      items.filter((item) => 'pricing' in item).map((item) => item['id']);
    expect(priced(canada.data.plans)).toEqual([
      'disney-plus.standard-ads',
      'disney-plus.standard',
      'disney-plus.premium',
    ]);
    expect(priced(canada.data.addOns)).not.toContain('disney-plus.extra-member-with-ads');
    // Netflix has no British prices: unknown there, so the US price is converted, as pickPrice falls back.
    expect(britain.meta).toMatchObject({ region: 'GB', currency: 'GBP' });
    expect(britain.data.plans[0].pricing[0]).toMatchObject({
      currency: 'GBP',
      native: false,
      source: { region: 'US', currency: 'USD' },
    });
  });

  it('answers the unknown provider example exactly, with its suggestion', async () => {
    await expectExample(await get('/providers/netflx'), providerExamples[2].response);
  });

  it('suggests a provider for an id that is not a slug, and nothing when no id is close', async () => {
    const capital = await (await get('/providers/Netflix')).json();
    const far = await (await get('/providers/streamco')).json();

    expect(capital).toEqual({
      error: {
        code: 'not_found',
        message: "No provider with id 'Netflix'.",
        details: [{ suggestion: 'netflix' }],
      },
    });
    expect(far).toEqual({
      error: { code: 'not_found', message: "No provider with id 'streamco'." },
    });
  });

  it('still answers 404 without a suggestion when ids.json is missing', async () => {
    const response = await get('/providers/netflx', {}, { ASSETS: env.ASSETS });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: "No provider with id 'netflx'." },
    });
  });

  it('lists no prices without a region, and needs no exchange rates', async () => {
    await env.KV.delete('fx:ecb');

    const response = await get('/providers/netflix');

    expect(response.status).toBe(200);
    const body = await response.json<{ data: unknown; meta: Json }>();
    expect(body).toEqual({ data: providerOf('netflix'), meta: { catalogVersion: 'abc1234' } });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a currency without a region, and an unknown parameter', async () => {
    const response = await get('/providers/netflix?currency=CAD&sort=name');

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: {
        code: 'bad_request',
        message: '2 query parameters are invalid.',
        details: [
          {
            param: 'sort',
            issue: 'Unknown parameter. GET /providers/:id takes region and currency.',
          },
          { param: 'currency', issue: 'Needs region: prices are picked for a region, such as CA.' },
        ],
      },
    });
  });

  it('answers 502 when a region needs rates and there are none', async () => {
    await env.KV.delete('fx:ecb');

    const response = await get('/providers/netflix?region=CA');

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'upstream_unavailable' } });
  });

  it('answers If-None-Match with 304, and gives another region or rates date another ETag', async () => {
    const etag = (await get('/providers/netflix?region=CA')).headers.get('ETag') ?? '';
    const cached = await get('/providers/netflix?region=CA', { 'If-None-Match': etag });
    const us = (await get('/providers/netflix?region=US')).headers.get('ETag');
    await keepRates('2026-10-22');
    const newRates = (await get('/providers/netflix?region=CA')).headers.get('ETag');

    expect(cached.status).toBe(304);
    expect(cached.headers.get('ETag')).toBe(etag);
    expect(await cached.text()).toBe('');
    expect(new Set([etag, us, newRates]).size).toBe(3);
  });
});

describe('GET /plans/:id', () => {
  it("answers the Disney+ Premium example: provider, rank keys, add-ons and bundles in the contract's places", async () => {
    const response = await get('/plans/disney-plus.premium?region=CA&currency=CAD');

    expect(response.status).toBe(200);
    expectCatalogHeaders(response);
    const body = await response.json<{ data: Json; meta: Json }>();
    const example = bodyOf(planExamples[0].response.body);
    expect(body.meta).toEqual({ ...example.meta, catalogVersion: 'abc1234' });
    expect(Object.keys(body.data)).toEqual([
      'id',
      'name',
      'provider',
      'link',
      'features',
      'providedRankKeys',
      'prices',
      'pricing',
      'addOns',
      'addOnLimit',
      'bundleIds',
    ]);
    expectSameOrder(body.data, example.data);
    const disney = providerOf('disney-plus');
    expect(body.data['provider']).toEqual({
      id: 'disney-plus',
      name: 'Disney+',
      website: disney.website,
      iconUrl: 'https://sub.simplely.ca/icons/disney-plus.png',
      category: 'streaming',
      spendCategory: 'streaming',
      acceptedNetworks: disney.acceptedNetworks,
    });
    expectSameOrder(body.data['provider'] as Json, example.data.provider);
    // The example's plan lists fewer features: the real one also has kids profiles and French content.
    expect(body.data['providedRankKeys']).toEqual([
      ...example.data.providedRankKeys,
      'streaming.kids-profiles',
      'streaming.french-content',
    ]);
    expect(body.data['pricing']).toEqual(example.data.pricing);
    expect(body.data['addOns']).toEqual([
      {
        ...disney.addOns?.find((addOn) => addOn.id === 'disney-plus.extra-member-premium'),
        pricing: example.data.addOns?.[0].pricing,
      },
    ]);
    expect(body.data['bundleIds']).toEqual(example.data.bundleIds);
  });

  it('leaves out the add-ons and bundles a plan has none of, and prices without a region', async () => {
    const body = await (await get('/plans/mullvad.vpn')).json<{ data: Json; meta: Json }>();

    expect(Object.keys(body.data)).toEqual([
      'id',
      'name',
      'provider',
      'link',
      'features',
      'providedRankKeys',
      'prices',
    ]);
    expect(body.meta).toEqual({ catalogVersion: 'abc1234' });
  });

  it('answers the unknown plan example exactly, and suggests across providers', async () => {
    const provider = await (await get('/plans/netflx.premium')).json();
    const notAPlan = await (await get('/plans/netflix')).json();

    await expectExample(await get('/plans/netflix.premum'), planExamples[1].response);
    expect(provider).toMatchObject({ error: { details: [{ suggestion: 'netflix.premium' }] } });
    expect(notAPlan).toEqual({
      error: { code: 'not_found', message: "No plan with id 'netflix'." },
    });
  });

  it('answers If-None-Match with 304', async () => {
    const etag = (await get('/plans/netflix.standard?region=CA')).headers.get('ETag') ?? '';

    const response = await get('/plans/netflix.standard?region=CA', { 'If-None-Match': etag });

    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe(etag);
  });
});

describe('GET /bundles', () => {
  const bundle = snapshot.data.bundles[0];

  it("answers the example's query: the bundles with Disney+ Premium, priced for Canada with savings", async () => {
    const response = await get(`/bundles${new URL(bundlesExamples[0].request.url).search}`);

    expect(response.status).toBe(200);
    expectCatalogHeaders(response);
    const body = await response.json<{ data: Json[]; meta: Json }>();
    const example = bodyOf(bundlesExamples[0].response.body);
    expect(body.meta).toEqual({
      ...example.meta,
      catalogVersion: 'abc1234',
      total: 1,
    });
    const [result] = body.data;
    expect(Object.keys(result)).toEqual([
      'id',
      'name',
      'soldBy',
      'includes',
      'link',
      'prices',
      'pricing',
      'savings',
      'features',
    ]);
    expectSameOrder(result, example.data[0]);
    expect(result['includes']).toEqual([
      {
        planId: 'disney-plus.premium',
        providerId: 'disney-plus',
        providerName: 'Disney+',
        planName: 'Premium',
        iconUrl: 'https://sub.simplely.ca/icons/disney-plus.png',
        standalone: { amount: 16.99, currency: 'CAD', interval: 'month', intervalCount: 1 },
      },
      {
        planId: 'crave.premium',
        providerId: 'crave',
        providerName: 'Crave',
        planName: 'Premium',
        iconUrl: 'https://sub.simplely.ca/icons/crave.png',
        standalone: { amount: 22, currency: 'CAD', interval: 'month', intervalCount: 1 },
      },
    ]);
    for (const [index, included] of (result['includes'] as Json[]).entries()) {
      expect(Object.keys(included)).toEqual(Object.keys(example.data[0].includes[index]));
    }
    expect(result['prices']).toEqual(bundle.prices);
    expect(result['pricing']).toEqual([
      {
        interval: 'month',
        intervalCount: 1,
        amount: 29.25,
        currency: 'CAD',
        monthlyEquivalent: 29.25,
        autoRenew: true,
        native: true,
        source: { region: 'CA', amount: 29.25, currency: 'CAD' },
      },
    ]);
    // 16.99 + 22.00 = 38.99, less 29.25.
    expect(result['savings']).toEqual([
      {
        interval: 'month',
        intervalCount: 1,
        standaloneTotal: 38.99,
        bundlePrice: 29.25,
        amount: 9.74,
        currency: 'CAD',
        percent: 25,
      },
    ]);
    expect(Object.keys((result['savings'] as Json[])[0])).toEqual(
      Object.keys(example.data[0].savings[0]),
    );
    // Disney+ Premium's features, with Crave's live sports; the higher download count is Disney+'s.
    expect(result['features']).toEqual({
      ...providerOf('disney-plus').plans.find((plan) => plan.id === 'disney-plus.premium')
        ?.features,
      'streaming.live': ['sports'],
    });
  });

  it('expands the plans and unites their features without a region, with no prices or savings', async () => {
    const body = await (
      await get('/bundles?plans=crave.premium,netflix.standard')
    ).json<{ data: Json[]; meta: Json }>();

    expect(body.meta).toEqual({ catalogVersion: 'abc1234', total: 1 });
    expect(Object.keys(body.data[0])).toEqual([
      'id',
      'name',
      'soldBy',
      'includes',
      'link',
      'prices',
      'features',
    ]);
    expect(
      (body.data[0]['includes'] as Json[]).every((included) => !('standalone' in included)),
    ).toBe(true);
  });

  it('prices a bundle where it has only a fallback price, but shows no savings there', async () => {
    const body = await (
      await get('/bundles?plans=disney-plus.premium&region=US')
    ).json<{ data: (Json & { includes: Json[]; pricing: Picked[] })[]; meta: Json }>();

    expect(body.meta).toMatchObject({
      region: 'US',
      currency: 'USD',
      total: 1,
      fxDate: '2026-10-21',
    });
    const [result] = body.data;
    expect(result.pricing[0]).toMatchObject({
      currency: 'USD',
      native: false,
      source: { region: 'CA' },
    });
    expect(result).not.toHaveProperty('savings');
    expect(result.includes[0]['standalone']).toEqual({
      amount: 21.49,
      currency: 'USD',
      interval: 'month',
      intervalCount: 1,
    });
  });

  it('finds nothing for a plan that no bundle includes', async () => {
    const body = await (await get('/bundles?plans=netflix.premium&region=CA')).json();

    expect(body).toEqual({
      data: [],
      meta: {
        catalogVersion: 'abc1234',
        region: 'CA',
        currency: 'CAD',
        total: 0,
        fxDate: '2026-10-21',
      },
    });
  });

  it('refuses a plan the catalog lacks, with the plan it looks like, as the example shows', async () => {
    const example = bundlesExamples[1];
    const response = await get('/bundles?plans=disney-plus.premum,crave.premium,netflix.ultra');

    await expectExample(
      await get(`/bundles${new URL(example.request.url).search}`),
      example.response,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: {
        code: 'bad_request',
        message: "Invalid query parameter 'plans'.",
        details: [
          {
            param: 'plans',
            issue:
              '"disney-plus.premum" isn\'t a plan (did you mean disney-plus.premium?); "netflix.ultra" isn\'t a plan.',
          },
        ],
      },
    });
  });

  it('refuses a missing, malformed or too long list of plans', async () => {
    const issues = async (query: string) =>
      (await (await get(`/bundles${query}`)).json<{ error: { details: unknown[] } }>()).error
        .details;
    const many = Array.from({ length: maxBundlePlans + 1 }, (_, index) => `netflix.plan-${index}`);

    expect(await issues('?region=CA')).toEqual([
      {
        param: 'plans',
        issue: 'Needed: the plan ids to find bundles for, such as netflix.standard.',
      },
    ]);
    expect(await issues('?plans=Netflix')).toEqual([
      {
        param: 'plans',
        issue: '"Netflix" isn\'t a plan id: use <provider id>.<slug>, such as netflix.standard.',
      },
    ]);
    expect(await issues(`?plans=${many.join(',')}`)).toEqual([
      { param: 'plans', issue: `List at most ${maxBundlePlans} plan ids.` },
    ]);
  });

  it('answers If-None-Match with 304', async () => {
    const query = '/bundles?plans=crave.premium&region=CA';
    const etag = (await get(query)).headers.get('ETag') ?? '';

    const response = await get(query, { 'If-None-Match': etag });

    expect(response.status).toBe(304);
  });
});

describe('the D1 reads', () => {
  it('read the catalog row and one provider for a provider, and the catalog row alone for an unknown one', async () => {
    const found = await loadProvider(env.DB, 'netflix');
    const missing = await loadProvider(env.DB, 'netflx');

    expect(found).toMatchObject({
      version: 'abc1234',
      provider: providerOf('netflix'),
      rowsRead: 2,
    });
    expect(missing).toEqual({ version: 'abc1234', rowsRead: 1 });
  });

  it("read a plan's provider and one index entry per bundle that includes it", async () => {
    const rows = await loadPlan(env.DB, 'disney-plus.premium');

    expect(rows).toMatchObject({
      version: 'abc1234',
      provider: providerOf('disney-plus'),
      bundleIds: ['bundle.disney-crave-premium'],
      rowsRead: 3,
    });
  });

  it('read the bundles and the providers they need through primary keys and indexes, never a table scan', async () => {
    const one = await loadBundles(env.DB, ['disney-plus.premium']);
    const rows = await loadBundles(env.DB, ['disney-plus.premium', 'netflix.premium']);
    const statements = bundlesStatements(2);
    const plans = await Promise.all(
      Object.values(statements).map((sql) =>
        env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .bind('disney-plus.premium', 'netflix.premium')
          .all<{ detail: string }>(),
      ),
    );
    const details = plans.flatMap((plan) => plan.results.map((row) => row.detail));

    expect(rows.plans.sort()).toEqual(['disney-plus.premium', 'netflix.premium']);
    expect(rows.bundles.map((found) => found.id)).toEqual(['bundle.disney-crave-premium']);
    expect(rows.providers.map((provider) => provider.id).sort()).toEqual(['crave', 'disney-plus']);
    // D1 counts about two rows for each primary-key or index lookup.
    expect([one.rowsRead, rows.rowsRead]).toEqual([11, 18]);
    expect(details).toEqual(
      expect.arrayContaining([
        'SEARCH plans USING PRIMARY KEY (id=?)',
        'SEARCH b USING PRIMARY KEY (id=?)',
        'SEARCH bundle_plans USING COVERING INDEX idx_bundle_plans_plan (plan_id=?)',
        'SEARCH s USING PRIMARY KEY (id=?) LEFT-JOIN',
        'SEARCH m USING COVERING INDEX idx_bundle_plans_plan (plan_id=?)',
        'SEARCH bp USING PRIMARY KEY (bundle_id=?)',
        'SEARCH p USING PRIMARY KEY (id=?)',
      ]),
    );
    expect(details.filter((detail) => detail.startsWith('SCAN'))).toEqual([]);
  });
});
