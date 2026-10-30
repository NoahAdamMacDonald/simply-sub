import { describe, expect, it } from 'vitest';
import {
  regionalPrices,
  regionalPrompt,
  type Price,
  type RegionalAnswer,
  type RegionalContext,
} from '../../src';

// A region's prices for a provider the catalog has (M10.12): the request, and the check that keeps only prices quoted
// word for word on the region's page, with their amount, in its currency.

const monthly: Price = {
  region: 'CA',
  currency: 'CAD',
  amount: 18.99,
  interval: 'month',
  intervalCount: 1,
  autoRenew: true,
  lastVerified: '2026-10-20',
  sourceUrl: 'https://help.example.com/node/1/ca',
};
const context: RegionalContext = {
  provider: {
    id: 'example',
    name: 'Example',
    plans: [
      { id: 'example.standard', name: 'Standard', prices: [monthly] },
      { id: 'example.premium', name: 'Premium', prices: [{ ...monthly, amount: 24.99 }] },
    ],
  },
  region: 'GB',
  pages: [
    {
      name: 'pricing',
      kind: 'pricing',
      url: 'https://help.example.com/node/1/gb',
      text: 'Plans in the United Kingdom. Standard: £12.99 a month. Premium: £18.99 a month. Prices include VAT.',
    },
  ],
};
const price = (changes: Partial<RegionalAnswer['prices'][number]>) => ({
  plan: 'example.standard',
  amount: 12.99,
  currency: 'GBP',
  interval: 'month' as const,
  intervalCount: 1,
  page: 'pricing',
  quote: 'Standard: £12.99 a month',
  ...changes,
});

describe('regionalPrompt', () => {
  it('asks for the region’s regular prices of the provider’s plans, with the pages', () => {
    const prompt = regionalPrompt(context);
    expect(prompt).toContain('only its prices in the United Kingdom are wanted, in GBP');
    expect(prompt).toContain(
      '- example.standard: Standard (the catalog has 18.99 CAD monthly in CA)',
    );
    expect(prompt).toContain('## Page pricing (pricing, https://help.example.com/node/1/gb)');
  });
});

describe('regionalPrices', () => {
  it('keeps a price quoted with its amount on the region’s page, renewing as the plan’s others do', () => {
    const { prices, issues } = regionalPrices(
      {
        prices: [
          price({ taxIncluded: { page: 'pricing', quote: 'Prices include VAT.' } }),
          price({ plan: 'example.premium', amount: 18.99, quote: 'Premium: £18.99 a month' }),
        ],
      },
      context,
      '2026-10-29',
    );
    expect(issues).toEqual([]);
    expect(prices).toEqual([
      {
        plan: 'example.standard',
        quote: 'Standard: £12.99 a month',
        price: {
          region: 'GB',
          currency: 'GBP',
          amount: 12.99,
          interval: 'month',
          intervalCount: 1,
          autoRenew: true,
          taxIncluded: { quote: 'Prices include VAT.' },
          lastVerified: '2026-10-29',
          sourceUrl: 'https://help.example.com/node/1/gb',
        },
      },
      expect.objectContaining({ plan: 'example.premium' }),
    ]);
  });

  it('drops what the page doesn’t show, or isn’t the region’s, saying why', () => {
    const { prices, issues } = regionalPrices(
      {
        prices: [
          price({ plan: 'example.ultra' }),
          price({ currency: 'EUR' }),
          price({ quote: 'Standard: £11.99 a month' }),
          price({ amount: 13.99 }),
          price({}),
          price({}),
        ],
      },
      context,
      '2026-10-29',
    );
    expect(prices.map(({ plan }) => plan)).toEqual(['example.standard']);
    expect(issues.map(({ reason }) => reason)).toEqual([
      "It isn't one of Example's plans.",
      "It's in EUR, not GBP.",
      "Its quote isn't on the page.",
      "Its quote doesn't show 13.99 GBP.",
      'example.standard already has a price for that period: 12.99 GBP monthly.',
    ]);
  });

  it('takes the euro countries’ one price in euros', () => {
    const euro: RegionalContext = {
      ...context,
      region: 'EU',
      pages: [{ ...context.pages[0], text: 'Standard: 12,99 € a month.' }],
    };
    const { prices } = regionalPrices(
      { prices: [price({ currency: 'EUR', quote: 'Standard: 12,99 € a month' })] },
      euro,
      '2026-10-29',
    );
    expect(prices[0]?.price).toMatchObject({ region: 'EU', currency: 'EUR', amount: 12.99 });
  });
});
