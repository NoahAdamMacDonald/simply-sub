import { describe, expect, it } from 'vitest';
import {
  apiPickedPrice,
  buildCatalogData,
  providersBody,
  providersCursor,
  readCatalogSource,
  searchProviders,
  type FxRates,
  type PickedPrice,
  type ProvidersQuery,
} from '../../src';
import { catalog } from '../catalog/catalog-files';

const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { CHF: 0.581, EUR: 0.664, USD: 0.7243 },
};

function matchesFor(query: ProvidersQuery) {
  const source = readCatalogSource(catalog());
  const { providers } = buildCatalogData(source, 'https://sub.simplely.ca/icons/');
  return searchProviders(providers, query, {
    features: source.features,
    categories: source.categories,
    fx,
    today: '2026-10-23',
  });
}

describe('apiPickedPrice', () => {
  it('rounds amounts to 2 decimals and the rate to 4, keeping the key order', () => {
    const picked: PickedPrice = {
      interval: 'month',
      intervalCount: 1,
      amount: 5 / 0.664,
      currency: 'CAD',
      monthlyEquivalent: 5 / 0.664,
      autoRenew: false,
      native: false,
      source: { region: 'GLOBAL', amount: 5, currency: 'EUR' },
      fx: { rate: 1 / 0.664, date: '2026-10-21', source: fx.source },
    };

    const rounded = apiPickedPrice(picked);

    expect(rounded).toEqual({
      ...picked,
      amount: 7.53,
      monthlyEquivalent: 7.53,
      fx: { rate: 1.506, date: '2026-10-21', source: fx.source },
    });
    expect(Object.keys(rounded)).toEqual(Object.keys(picked));
  });
});

describe('providersBody', () => {
  const query: ProvidersQuery = {
    q: 'vpn',
    region: 'CA',
    currency: 'CAD',
    sort: 'relevance',
    limit: 20,
  };

  it("writes each result in the contract's shape, with rounded prices", () => {
    const body = providersBody(matchesFor(query), {
      query,
      offset: 0,
      catalogVersion: 'abc1234',
      fxDate: fx.date,
    });

    expect(body.data[0]).toEqual({
      provider: {
        id: 'mullvad',
        name: 'Mullvad VPN',
        category: 'vpn',
        website: 'https://mullvad.net',
        iconUrl: 'https://sub.simplely.ca/icons/mullvad.webp',
      },
      matchedPlans: [
        {
          id: 'mullvad.vpn',
          name: 'Mullvad VPN',
          matchedKeys: ['vpn.included', 'vpn.unlimited-traffic'],
          pricing: [
            expect.objectContaining({ interval: 'month', amount: 7.53, native: false }),
            expect.objectContaining({ interval: 'year', amount: 90.36, monthlyEquivalent: 7.53 }),
          ],
          bestMonthlyEquivalent: 7.53,
          lastVerified: '2026-10-20',
          stale: false,
        },
      ],
      bestPlanId: 'mullvad.vpn',
      matchedOn: ['name', 'category:vpn', 'feature:vpn.included', 'feature:vpn.unlimited-traffic'],
    });
    expect(body.data[1]).toMatchObject({ bestPlanId: 'proton.free' });
    expect(body.meta).toEqual({
      catalogVersion: 'abc1234',
      query,
      total: 2,
      nextCursor: null,
      fxDate: '2026-10-21',
    });
  });

  it('leaves prices and fxDate out without a region', () => {
    const plain: ProvidersQuery = { sort: 'name', limit: 20 };
    const body = providersBody(matchesFor(plain), {
      query: plain,
      offset: 0,
      catalogVersion: 'abc1234',
    });

    expect(body.data[0].matchedPlans[0]).toEqual({
      id: 'crave.standard',
      name: 'Standard With Ads',
      matchedKeys: [],
      lastVerified: '2026-10-20',
      stale: false,
    });
    expect(Object.keys(body.meta)).toEqual(['catalogVersion', 'query', 'total', 'nextCursor']);
  });

  it('pages through the results with the cursor', () => {
    const paged: ProvidersQuery = { sort: 'name', limit: 3 };
    const matches = matchesFor(paged);

    const first = providersBody(matches, { query: paged, offset: 0, catalogVersion: 'abc1234' });
    const second = providersBody(matches, { query: paged, offset: 3, catalogVersion: 'abc1234' });

    expect(first.data.map((result) => result.provider.id)).toEqual(['crave', 'mullvad', 'netflix']);
    expect(first.meta).toMatchObject({ total: 4, nextCursor: providersCursor(3) });
    expect(second.data.map((result) => result.provider.id)).toEqual(['proton']);
    expect(second.meta).toMatchObject({ total: 4, nextCursor: null });
  });

  it('gives an empty page past the end', () => {
    const paged: ProvidersQuery = { sort: 'name', limit: 3 };

    expect(
      providersBody(matchesFor(paged), { query: paged, offset: 30, catalogVersion: 'abc1234' }),
    ).toMatchObject({ data: [], meta: { total: 4, nextCursor: null } });
  });
});
