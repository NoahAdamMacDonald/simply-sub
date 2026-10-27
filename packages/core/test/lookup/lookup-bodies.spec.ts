import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  bundlesBody,
  bundlesBodySchema,
  planBody,
  planBodySchema,
  providerBody,
  providerBodySchema,
  readCatalogSource,
  type CatalogSourceFile,
  type FxRates,
  type SnapshotProvider,
} from '../../src';
import { catalog, catalogWith } from '../catalog/catalog-files';
import { issues } from '../catalog/helpers';

const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { CHF: 0.581, EUR: 0.664, USD: 0.7243 },
};
const usd: FxRates = { ...fx, base: 'USD', rates: { CAD: 1.3806, CHF: 0.8022, EUR: 0.9168 } };
const canada = { query: { region: 'CA', currency: 'CAD' }, fx, catalogVersion: 'abc1234' };

function catalogOf(files: CatalogSourceFile[] = catalog()) {
  const source = readCatalogSource(files);
  const { providers, bundles } = buildCatalogData(source, 'https://sub.simplely.ca/icons/');
  const providerOf = (id: string): SnapshotProvider => {
    const found = providers.find((provider) => provider.id === id);
    if (!found) {
      throw new Error(`No provider ${id}`);
    }
    return found;
  };
  return { registry: source.features, providers, bundles, providerOf };
}

const { registry, providers, bundles, providerOf } = catalogOf();
const netflix = providerOf('netflix');
const planOf = (provider: SnapshotProvider, id: string) => {
  const found = provider.plans.find((plan) => plan.id === id);
  if (!found) {
    throw new Error(`No plan ${id}`);
  }
  return found;
};

describe('providerBody', () => {
  it("keeps the provider as written, with each item's rounded picked prices right after its own", () => {
    const body = providerBody(netflix, canada);

    expect(Object.keys(body.data)).toEqual(Object.keys(netflix));
    expect(Object.keys(body.data.plans[1])).toEqual([
      'id',
      'name',
      'link',
      'features',
      'featureLabels',
      'prices',
      'pricing',
      'addOnIds',
      'addOnLimit',
    ]);
    expect(body.data.plans[1].pricing).toEqual([
      {
        interval: 'month',
        intervalCount: 1,
        amount: 18.99,
        currency: 'CAD',
        monthlyEquivalent: 18.99,
        autoRenew: true,
        native: true,
        source: { region: 'CA', amount: 18.99, currency: 'CAD' },
      },
    ]);
    expect(body.data.addOns?.[0].pricing).toEqual([
      expect.objectContaining({ amount: 7.99, currency: 'CAD', native: true }),
    ]);
    expect(body.meta).toEqual({
      catalogVersion: 'abc1234',
      region: 'CA',
      currency: 'CAD',
      fxDate: '2026-10-21',
    });
  });

  it('gives a plan not sold in the region no prices, but keeps it', () => {
    const premium = providerBody(netflix, canada).data.plans[2];

    expect(premium).toEqual(planOf(netflix, 'netflix.premium'));
    expect(premium).not.toHaveProperty('pricing');
  });

  it('converts a price in another currency and rounds it the way the API writes money', () => {
    const [plan] = providerBody(providerOf('mullvad'), canada).data.plans;

    expect(plan.pricing?.[0]).toMatchObject({
      amount: 7.53,
      currency: 'CAD',
      native: false,
      fx: { rate: 1.506, date: '2026-10-21' },
    });
  });

  it('is the provider as written without a region, and meta only the version', () => {
    expect(providerBody(netflix, { query: {}, catalogVersion: 'abc1234' })).toEqual({
      data: netflix,
      meta: { catalogVersion: 'abc1234' },
    });
  });
});

describe('planBody', () => {
  const standard = planOf(netflix, 'netflix.standard');

  it('adds its provider, rank keys, add-ons and bundles where the contract puts them', () => {
    const body = planBody(netflix, standard, {
      ...canada,
      registry,
      bundleIds: ['bundle.netflix-crave'],
    });

    expect(Object.keys(body.data)).toEqual([
      'id',
      'name',
      'provider',
      'link',
      'features',
      'providedRankKeys',
      'featureLabels',
      'prices',
      'pricing',
      'addOns',
      'addOnLimit',
      'bundleIds',
    ]);
    expect(body.data.provider).toEqual({
      id: 'netflix',
      name: 'Netflix',
      website: 'https://example.com',
      iconUrl: 'https://sub.simplely.ca/icons/netflix.webp',
      category: 'streaming',
      spendCategory: 'streaming',
      cancelUrl: 'https://www.netflix.com/cancelplan',
    });
    expect(body.data.providedRankKeys).toEqual([
      'video.quality=480p',
      'video.quality=720p',
      'video.quality=1080p',
      'streaming.ad-free',
      'streaming.concurrent-streams=1',
      'streaming.concurrent-streams=2-4',
    ]);
    expect(body.data.addOns).toEqual([
      {
        ...netflix.addOns?.[0],
        pricing: [expect.objectContaining({ amount: 7.99, native: true })],
      },
    ]);
    expect(body.data.bundleIds).toEqual(['bundle.netflix-crave']);
    expect(body.meta).toEqual(providerBody(netflix, canada).meta);
  });

  it('leaves out the rank keys, add-ons and bundles a plan has none of, and prices without a region', () => {
    const body = planBody(
      netflix,
      { ...planOf(netflix, 'netflix.standard-ads'), features: {} },
      { query: {}, catalogVersion: 'abc1234', registry, bundleIds: [] },
    );

    expect(Object.keys(body.data)).toEqual([
      'id',
      'name',
      'provider',
      'link',
      'features',
      'prices',
    ]);
    expect(body.meta).toEqual({ catalogVersion: 'abc1234' });
  });

  it('gives a plan not sold in the region no prices', () => {
    const body = planBody(netflix, planOf(netflix, 'netflix.premium'), {
      ...canada,
      registry,
      bundleIds: [],
    });

    expect(body.data).not.toHaveProperty('pricing');
    expect(body.data.prices).toEqual(planOf(netflix, 'netflix.premium').prices);
  });
});

describe('bundlesBody', () => {
  const [bundle] = bundles;

  it('expands the plans, adds prices and savings after the stored prices, and unites the features', () => {
    const body = bundlesBody(bundles, providers, { ...canada, registry });

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
    expect(result.includes).toEqual([
      {
        planId: 'netflix.standard',
        providerId: 'netflix',
        providerName: 'Netflix',
        planName: 'Standard',
        iconUrl: 'https://sub.simplely.ca/icons/netflix.webp',
        standalone: { amount: 18.99, currency: 'CAD', interval: 'month', intervalCount: 1 },
      },
      {
        planId: 'crave.premium',
        providerId: 'crave',
        providerName: 'Crave',
        planName: 'Premium',
        iconUrl: 'https://sub.simplely.ca/icons/crave.webp',
        standalone: { amount: 22, currency: 'CAD', interval: 'month', intervalCount: 1 },
      },
    ]);
    expect(result.pricing).toEqual([expect.objectContaining({ amount: 35, native: true })]);
    // 18.99 + 22 = 40.99, less 35: 5.99, or 14.6%.
    expect(result.savings).toEqual([
      {
        interval: 'month',
        intervalCount: 1,
        standaloneTotal: 40.99,
        bundlePrice: 35,
        amount: 5.99,
        currency: 'CAD',
        percent: 14.6,
      },
    ]);
    expect(result.features).toEqual({
      'video.quality': '4k',
      'streaming.ad-free': true,
      'streaming.concurrent-streams': 2,
      'streaming.live': ['tv-channels', 'sports'],
    });
    expect(body.meta).toEqual({
      catalogVersion: 'abc1234',
      region: 'CA',
      currency: 'CAD',
      total: 1,
      fxDate: '2026-10-21',
    });
  });

  it('has no prices, standalone prices or savings without a region', () => {
    const body = bundlesBody(bundles, providers, {
      query: {},
      catalogVersion: 'abc1234',
      registry,
    });

    expect(Object.keys(body.data[0])).toEqual([
      'id',
      'name',
      'soldBy',
      'includes',
      'link',
      'prices',
      'features',
    ]);
    expect(body.data[0].includes.map((included) => Object.keys(included))).toEqual([
      ['planId', 'providerId', 'providerName', 'planName', 'iconUrl'],
      ['planId', 'providerId', 'providerName', 'planName', 'iconUrl'],
    ]);
    expect(body.meta).toEqual({ catalogVersion: 'abc1234', total: 1 });
  });

  it("prices a bundle where it's unknown with its fallback price, but compares nothing there", () => {
    const body = bundlesBody(bundles, providers, {
      query: { region: 'US', currency: 'USD' },
      fx: usd,
      catalogVersion: 'abc1234',
      registry,
    });

    const [result] = body.data;
    expect(result.pricing).toEqual([
      expect.objectContaining({
        currency: 'USD',
        native: false,
        source: expect.objectContaining({ region: 'CA' }),
      }),
    ]);
    expect(result).not.toHaveProperty('savings');
    expect(result.includes[0].standalone).toEqual({
      amount: 19.99,
      currency: 'USD',
      interval: 'month',
      intervalCount: 1,
    });
  });

  it('leaves out a bundle not offered in the region', () => {
    const craveInCanada = catalogOf(
      catalogWith('data/providers/crave.yaml', ['availableIn'], ['CA']),
    );

    const body = bundlesBody(craveInCanada.bundles, craveInCanada.providers, {
      query: { region: 'US', currency: 'USD' },
      fx: usd,
      catalogVersion: 'abc1234',
      registry,
    });

    expect(body).toEqual({
      data: [],
      meta: {
        catalogVersion: 'abc1234',
        region: 'US',
        currency: 'USD',
        total: 0,
        fxDate: '2026-10-21',
      },
    });
  });

  it('sorts the bundles by id', () => {
    const first = { ...bundle, id: 'bundle.a-first' };

    const body = bundlesBody([bundle, first], providers, { ...canada, registry });

    expect(body.data.map((result) => result.id)).toEqual(['bundle.a-first', bundle.id]);
  });

  it('fails loudly when a provider it needs is missing', () => {
    expect(() => bundlesBody(bundles, [netflix], { ...canada, registry })).toThrow(
      'Provider crave is missing',
    );
  });
});

describe('the bodies, against the contract schemas', () => {
  const contexts = [
    ['priced for Canada', canada],
    ['without a region', { query: {}, catalogVersion: 'abc1234' }],
  ] as const;

  it.each(contexts)('are valid %s', (_name, context) => {
    for (const provider of providers) {
      expect(issues(providerBodySchema, providerBody(provider, context))).toEqual([]);
      for (const plan of provider.plans) {
        const body = planBody(provider, plan, {
          ...context,
          registry,
          bundleIds: ['bundle.netflix-crave'],
        });
        expect(issues(planBodySchema, body)).toEqual([]);
      }
    }
    expect(
      issues(bundlesBodySchema, bundlesBody(bundles, providers, { ...context, registry })),
    ).toEqual([]);
  });
});
