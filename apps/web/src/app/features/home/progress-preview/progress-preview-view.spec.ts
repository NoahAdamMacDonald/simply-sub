import type { CatalogSnapshot, FxRates, Price } from '@simply-sub/core';
import { money, providerCards } from './progress-preview-view';

// TEMPORARY: see progress-preview.ts.

function price(region: string, currency: string, amount: number): Price {
  return {
    region,
    currency,
    amount,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-23',
  };
}

const catalog = {
  data: {
    features: [
      { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
    ],
    providers: [
      {
        id: 'netflix',
        name: 'Netflix',
        website: 'https://www.netflix.com',
        iconUrl: 'https://sub.simplely.ca/icons/netflix.webp',
        category: 'streaming',
        spendCategory: 'streaming',
        plans: [
          {
            id: 'netflix.standard',
            name: 'Standard',
            features: { 'streaming.ad-free': true },
            prices: [price('CA', 'CAD', 18.99), price('US', 'USD', 19.99)],
          },
          {
            id: 'netflix.premium',
            name: 'Premium',
            features: {},
            prices: [price('US', 'USD', 26.99)],
          },
        ],
      },
    ],
  },
} as unknown as CatalogSnapshot;

const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { USD: 0.7243 },
};

describe('providerCards', () => {
  it("prices each plan for the region, and marks one it isn't sold in", () => {
    const [netflix] = providerCards(catalog, 'CA', 'CAD', fx);

    expect(netflix.icon).toBe('/icons/netflix.webp');
    expect(netflix.plans[0]).toMatchObject({
      availability: 'offered',
      prices: [{ text: `${money(18.99, 'CAD')} / month` }],
      features: ['Ad free: yes'],
    });
    expect(netflix.plans[1].availability).toBe('not-offered');
  });

  it('converts a price in another currency, with ≈ and where it came from', () => {
    const usd: FxRates = { ...fx, base: 'USD', rates: { CAD: 1.3806 } };
    const [netflix] = providerCards(catalog, 'CA', 'USD', usd);

    expect(netflix.plans[0].prices[0].text).toMatch(/^≈ /);
    expect(netflix.plans[0].prices[0].title).toContain('Converted from');
  });

  it("calls a plan's availability unknown where the provider has no prices", () => {
    const [netflix] = providerCards(catalog, 'GB', 'CAD', fx);

    expect(netflix.plans.map((plan) => plan.availability)).toEqual(['unknown', 'unknown']);
  });
});
