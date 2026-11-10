import { describe, expect, it } from 'vitest';
import {
  availability,
  buildCatalogIndex,
  countryOf,
  coverageGaps,
  groupsOf,
  isSubdivision,
  pickPrice,
  providerAvailability,
  regionPrices,
  subdivisionIn,
  validateCatalog,
  formatCatalogIssue,
  type Price,
  type Provider,
} from '../../src';
import { catalog, edited, today } from './catalog-files';

// Prices and availability by province or state (M11.17, BLUEPRINT §4.7, §4.12): a province is part of its country,
// as a country is part of its group, so the user's own (Settings' subdivision) decides where it's given, and a
// province's prices live in its country's file. A fictional carrier stands in: one plan priced for Canada, one priced
// by province, and one sold only in Quebec.

function price(region: string, amount: number, currency = 'CAD'): Price {
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

type Seller = Pick<Provider, 'plans' | 'availableIn'>;

function seller(plans: Price[][], availableIn?: string[]): Seller {
  return {
    plans: plans.map((prices, index) => ({
      id: `example.plan-${index}`,
      name: `Plan ${index}`,
      link: 'https://example.com/plans',
      features: {},
      prices,
    })),
    ...(availableIn && { availableIn }),
  };
}

const national = [price('CA', 45)];
const byProvince = [price('CA-QC', 40), price('CA-ON', 50)];
const quebecOnly = [price('CA-QC', 35)];
const carrier = seller([national, byProvince, quebecOnly]);

describe('provinces as regions', () => {
  it('knows the provinces and states Settings lists, each part of its country', () => {
    expect([isSubdivision('CA-QC'), isSubdivision('US-NY'), isSubdivision('CA-XX')]).toEqual([
      true,
      true,
      false,
    ]);
    expect([isSubdivision('CA'), isSubdivision('FR-75')]).toEqual([false, false]);
    expect([countryOf('CA-QC'), countryOf('US-NY'), countryOf('CA'), countryOf('EU')]).toEqual([
      'CA',
      'US',
      'CA',
      'EU',
    ]);
    // A province's groups are its country, then the country's: a country's are as before.
    expect(groupsOf('CA-QC')).toEqual(['CA']);
    expect(groupsOf('DE')).toEqual(['EU']);
  });

  it('gives the user’s province only for their own country', () => {
    const ontario = { country: 'CA', subdivision: 'CA-ON' };
    expect(subdivisionIn('CA', ontario)).toBe('CA-ON');
    // An item bought in the US is priced for the US as a whole.
    expect(subdivisionIn('US', ontario)).toBeUndefined();
    expect(subdivisionIn('CA', { country: 'CA' })).toBeUndefined();
    expect(subdivisionIn('CA', undefined)).toBeUndefined();
  });
});

describe('pickPrice, by province', () => {
  const amounts = (prices: Price[], subdivision?: string) =>
    pickPrice(prices, {
      region: 'CA',
      currency: 'CAD',
      ...(subdivision && { subdivision }),
    }).map((picked) => [picked.source.region, picked.amount]);

  it('picks the user’s province first, then their country', () => {
    expect(amounts([...national, ...byProvince], 'CA-ON')).toEqual([['CA-ON', 50]]);
    expect(amounts([...national, ...byProvince], 'CA-QC')).toEqual([['CA-QC', 40]]);
    expect(amounts([...national, ...byProvince], 'CA-BC')).toEqual([['CA', 45]]);
  });

  it('picks the country’s price without a province, and a province’s when the country has none', () => {
    expect(amounts([...national, ...byProvince])).toEqual([['CA', 45]]);
    expect(amounts(byProvince)).toEqual([['CA-QC', 40]]);
  });

  it('ignores a province of another country', () => {
    const prices = pickPrice([...national, price('US', 30, 'USD')], {
      region: 'US',
      subdivision: 'CA-QC',
      currency: 'USD',
    });
    expect(prices.map((picked) => picked.source.region)).toEqual(['US']);
  });
});

describe('availability, by province', () => {
  it('is offered where the user’s province or its country has a price', () => {
    expect(availability(national, carrier, 'CA', 'CA-ON')).toBe('offered');
    expect(availability(byProvince, carrier, 'CA', 'CA-ON')).toBe('offered');
    expect(availability(quebecOnly, carrier, 'CA', 'CA-QC')).toBe('offered');
  });

  it('isn’t offered in another province once the provider is priced anywhere in the country', () => {
    expect(availability(quebecOnly, carrier, 'CA', 'CA-ON')).toBe('not-offered');
    expect(availability(byProvince, carrier, 'CA', 'CA-BC')).toBe('not-offered');
    // Priced only by province, with no country price at all.
    expect(availability(quebecOnly, seller([quebecOnly, byProvince]), 'CA', 'CA-NS')).toBe(
      'not-offered',
    );
  });

  it('counts a country as sold where any of its provinces is, without the user’s province', () => {
    expect(availability(quebecOnly, carrier, 'CA')).toBe('offered');
    expect(providerAvailability(seller([quebecOnly]), 'CA')).toBe('offered');
  });

  it('takes availableIn’s provinces as the full list', () => {
    const credit = seller([national], ['CA-BC']);
    expect(providerAvailability(credit, 'CA', 'CA-BC')).toBe('offered');
    expect(providerAvailability(credit, 'CA', 'CA-ON')).toBe('not-offered');
    expect(availability(national, credit, 'CA', 'CA-ON')).toBe('not-offered');
    // A country covers its provinces.
    expect(providerAvailability(seller([national], ['CA']), 'CA', 'CA-QC')).toBe('offered');
    // Unknown elsewhere, as before.
    expect(providerAvailability(seller([quebecOnly]), 'US', undefined)).toBe('unknown');
  });
});

describe('the region files and coverage, with provinces', () => {
  it('keeps a province’s prices in its country’s file, and writes no file of its own', () => {
    expect(regionPrices([...national, ...byProvince, price('US', 30, 'USD')], 'CA')).toEqual([
      ...national,
      ...byProvince,
    ]);
    expect(regionPrices(quebecOnly, 'CA')).toEqual(quebecOnly);
    const index = buildCatalogIndex({
      catalogVersion: 'abc1234',
      generatedAt: '2026-11-10T00:00:00Z',
      regions: ['CA', 'CA-ON', 'CA-QC', 'GLOBAL', 'US-NY'],
      counts: { providers: 1, plans: 3, addOns: 0, bundles: 0, features: 0 },
    });
    expect(index.regions).toEqual(['CA', 'US']);
  });

  it('sees no gap for a plan sold in some of a country’s provinces', () => {
    const provider = {
      id: 'example',
      plans: (carrier.plans as Provider['plans']).map((plan) => ({ ...plan })),
    } as Provider;
    expect(coverageGaps([provider])).toEqual([
      // The national plan has no Quebec price of its own, which its country's covers; Quebec's plan isn't in Ontario.
      { provider: 'example', plan: 'example.plan-2', region: 'CA-ON', why: 'priced' },
    ]);
  });
});

describe('validateCatalog, with provinces', () => {
  const messages = (path: (string | number)[], value: unknown) =>
    validateCatalog(edited(catalog(), 'data/providers/crave.yaml', path, value), today)
      .filter((issue) => issue.severity === 'error')
      .map(formatCatalogIssue);

  it('takes a province in a price and in availableIn', () => {
    expect(messages(['plans', 0, 'prices', 0, 'region'], 'CA-QC')).toEqual([]);
    expect(messages(['availableIn'], ['CA-QC', 'CA-ON'])).toEqual([]);
  });

  it('refuses a province the catalog doesn’t know, and one where only a country fits', () => {
    expect(messages(['plans', 0, 'prices', 0, 'region'], 'CA-XX')).toEqual([
      "data/providers/crave.yaml:0 plans.0.prices.0.region: \"CA-XX\" isn't a province or state the catalog knows: Canada's and the US's (CA-QC, US-NY)",
    ]);
    // Ways to pay, card networks and currencies stay a country's: the schema refuses a province as their key.
    expect(
      messages(['acceptedNetworks'], {
        'CA-QC': {
          networks: ['visa'],
          url: 'https://www.crave.ca/en/faq',
          quotes: ['Visa'],
        },
      })[0],
    ).toBe('data/providers/crave.yaml:0 acceptedNetworks.CA-QC: Invalid key in record');
  });

  it('needs availableIn to cover a province’s price', () => {
    expect(
      messages(['availableIn'], ['CA-ON']).filter((message) => message.includes('availableIn has')),
    ).toEqual([]);
    expect(
      validateCatalog(
        edited(
          edited(catalog(), 'data/providers/crave.yaml', ['availableIn'], ['CA-ON']),
          'data/providers/crave.yaml',
          ['plans', 0, 'prices', 0, 'region'],
          'CA-QC',
        ),
        today,
      )
        .map(formatCatalogIssue)
        .filter((message) => message.includes('availableIn has')),
    ).toEqual([
      'data/providers/crave.yaml:0 plans.0.prices.0.region: availableIn has no CA-QC, but this plan is priced there: add CA-QC to it',
    ]);
  });
});
