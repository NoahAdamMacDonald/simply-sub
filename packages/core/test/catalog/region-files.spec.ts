import { describe, expect, it } from 'vitest';
import {
  availability,
  buildCatalogData,
  buildCatalogIndex,
  buildCatalogMeta,
  catalogIndexSchema,
  catalogSnapshotSchema,
  globalRegion,
  isoRegions,
  pickPrice,
  readCatalogSource,
  regionFileFor,
  regionGroups,
  regionPrices,
  regionSnapshot,
  type CatalogSnapshot,
  type CatalogSourceFile,
  type FxRates,
  type Price,
} from '../../src';
import { catalog, edited } from './catalog-files';
import { issues } from './helpers';

function price(region: string, currency: string, amount = 9.99): Price {
  return {
    region,
    currency,
    amount,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { AUD: 1.09, CHF: 0.581, EUR: 0.664, GBP: 0.5571, JPY: 108.42, USD: 0.7243 },
};

/**
 * The test catalog with prices in more places: a group (EU) and a member with its own price (DE), a plan sold in
 * the US, Australia and Japan but not Canada, a bundle priced in two regions and a provider with availableIn.
 */
function worldCatalog(): CatalogSourceFile[] {
  const edits: [string, (string | number)[], unknown][] = [
    [
      'data/providers/netflix.yaml',
      ['plans', 0, 'prices'],
      [
        price('CA', 'CAD', 7.99),
        price('US', 'USD', 8.99),
        price('EU', 'EUR', 6.99),
        price('DE', 'EUR', 5.99),
      ],
    ],
    [
      'data/providers/netflix.yaml',
      ['plans', 2, 'prices'],
      [price('US', 'USD', 26.99), price('AU', 'AUD', 28.99), price('JP', 'JPY', 2290)],
    ],
    [
      'data/providers/netflix.yaml',
      ['addOns', 0, 'prices'],
      [price('CA', 'CAD', 7.99), price('EU', 'EUR', 4.99)],
    ],
    [
      'data/providers/crave.yaml',
      ['plans', 1, 'prices'],
      [price('CA', 'CAD', 22), price('CH', 'CHF', 20)],
    ],
    ['data/providers/crave.yaml', ['availableIn'], ['CA', 'CH']],
    [
      'data/bundles/netflix-crave.yaml',
      ['prices'],
      [price('CA', 'CAD', 35), price('US', 'USD', 30)],
    ],
  ];
  return edits.reduce((files, [file, path, value]) => edited(files, file, path, value), catalog());
}

function snapshotOf(files = worldCatalog()): CatalogSnapshot {
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  return {
    data,
    meta: buildCatalogMeta(data, {
      catalogVersion: 'abc1234',
      generatedAt: '2026-10-23T12:00:00Z',
    }),
  };
}

/** Every priced item in a snapshot, by id, with the provider that sells it. */
function itemsOf({ data }: CatalogSnapshot) {
  const providers = new Map(data.providers.map((provider) => [provider.id, provider]));
  return [
    ...data.providers.flatMap((provider) =>
      [...provider.plans, ...(provider.addOns ?? [])].map((item) => ({ ...item, provider })),
    ),
    ...data.bundles.map((bundle) => {
      const provider = providers.get(bundle.soldBy);
      if (!provider) {
        throw new Error(`${bundle.id} is sold by ${bundle.soldBy}, which isn't a provider`);
      }
      return { ...bundle, provider };
    }),
  ];
}

describe('regionPrices', () => {
  const prices = [
    price('US', 'USD'),
    price('EU', 'EUR'),
    price('DE', 'EUR'),
    price('DE', 'USD'),
    price('GLOBAL', 'CHF'),
  ];

  it("keeps only the region's own prices, in every currency it has", () => {
    expect(regionPrices(prices, 'DE')).toEqual([price('DE', 'EUR'), price('DE', 'USD')]);
  });

  it("keeps the group's prices for a member without its own", () => {
    expect(regionPrices(prices, 'SE')).toEqual([price('EU', 'EUR')]);
  });

  it('keeps every price, in order, when neither has one: any can be the fallback', () => {
    expect(regionPrices(prices, 'CA')).toEqual(prices);
    expect(regionPrices([], 'CA')).toEqual([]);
  });
});

describe('regionSnapshot', () => {
  const snapshot = snapshotOf();
  const canada = regionSnapshot(snapshot, 'CA');

  it('keeps every item, with only the prices that apply in the region', () => {
    expect(itemsOf(canada).map((item) => item.id)).toEqual(
      itemsOf(snapshot).map((item) => item.id),
    );
    const netflix = canada.data.providers.find((provider) => provider.id === 'netflix');
    expect(
      netflix?.plans.map((plan) => plan.prices.map((p) => `${p.region} ${p.currency}`)),
    ).toEqual([['CA CAD'], ['CA CAD'], ['US USD', 'AU AUD', 'JP JPY']]);
    expect(canada.data.bundles[0].prices).toEqual([price('CA', 'CAD', 35)]);
  });

  it('changes nothing but prices and meta.region', () => {
    const { meta, data } = canada;
    expect(meta).toEqual({ ...snapshot.meta, region: 'CA' });
    expect(Object.keys(meta)).toEqual([
      'catalogVersion',
      'generatedAt',
      'region',
      'regions',
      'counts',
    ]);
    expect(data.features).toBe(snapshot.data.features);
    expect(Object.keys(data.providers[2])).toEqual(Object.keys(snapshot.data.providers[2]));
    expect(issues(catalogSnapshotSchema, canada)).toEqual([]);
  });
});

describe('buildCatalogIndex', () => {
  it('lists a file for every priced country and group, but not GLOBAL', () => {
    const index = buildCatalogIndex(snapshotOf().meta);
    expect(index).toEqual({
      catalogVersion: 'abc1234',
      generatedAt: '2026-10-23T12:00:00Z',
      regions: ['AU', 'CA', 'CH', 'DE', 'EU', 'JP', 'US'],
    });
    expect(issues(catalogIndexSchema, index)).toEqual([]);
  });
});

describe('regionFileFor', () => {
  const index = buildCatalogIndex(snapshotOf().meta);

  it.each([
    ['CA', 'CA'],
    ['DE', 'DE'],
    ['SE', 'EU'],
    ['EU', 'EU'],
    ['NZ', undefined],
    ['GLOBAL', undefined],
  ])('serves %s from %s', (region, file) => {
    expect(regionFileFor(region, index)).toBe(file);
  });
});

describe('the file each region is served', () => {
  // Every region a buyer can be in, and every currency they can show prices in, including one nothing is priced in.
  const snapshot = snapshotOf();
  const index = buildCatalogIndex(snapshot.meta);
  const regions = [...isoRegions, ...Object.keys(regionGroups), globalRegion];
  const currencies = [
    ...new Set(itemsOf(snapshot).flatMap((item) => item.prices.map((p) => p.currency))),
    'GBP',
  ];
  const full = itemsOf(snapshot);
  const served = new Map(
    index.regions.map((code) => [code, itemsOf(regionSnapshot(snapshot, code))]),
  );

  it('gives pickPrice and availability the same answers as the full catalog, for every currency', () => {
    for (const region of regions) {
      const code = regionFileFor(region, index);
      const items = code === undefined ? full : (served.get(code) ?? []);
      expect(items).toHaveLength(full.length);
      full.forEach((item, position) => {
        const trimmed = items[position];
        expect(
          availability(trimmed.prices, trimmed.provider, region),
          `${item.id} in ${region}`,
        ).toBe(availability(item.prices, item.provider, region));
        for (const currency of currencies) {
          for (const rates of [fx, undefined]) {
            const context = {
              region,
              currency,
              ...(item.provider.billingCurrency && {
                billingCurrency: item.provider.billingCurrency,
              }),
              ...(rates && { fx: rates }),
            };
            expect(
              pickPrice(trimmed.prices, context),
              `${item.id} in ${region}, ${currency}`,
            ).toEqual(pickPrice(item.prices, context));
          }
        }
      });
    }
  });

  it('is smaller than the full catalog where the region has prices', () => {
    const count = (items: typeof full) => items.reduce((sum, item) => sum + item.prices.length, 0);
    expect(count(served.get('CA') ?? [])).toBeLessThan(count(full));
    expect(count(served.get('EU') ?? [])).toBeLessThan(count(full));
  });
});
