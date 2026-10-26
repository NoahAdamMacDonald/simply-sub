import { describe, expect, it } from 'vitest';
import { pickPrice, type FxRates, type Interval, type PickedPrice, type Price } from '../../src';

// The GET /fx example in docs/api-output-examples.json: 1 CAD = 0.7243 USD = 0.664 EUR.
const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { CHF: 0.581, EUR: 0.664, GBP: 0.5571, JPY: 108.42, USD: 0.7243 },
};
const canada = { region: 'CA', currency: 'CAD', fx };

function price(
  region: string,
  currency: string,
  amount: number,
  interval: Interval = 'month',
  intervalCount = 1,
): Price {
  return {
    region,
    currency,
    amount,
    interval,
    intervalCount,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

/** Each picked price as `region currency → amount currency per interval`, for reading the rules at a glance. */
function summary(picked: PickedPrice[]): string[] {
  return picked.map(
    (p) =>
      `${p.source.region} ${p.source.currency} → ${p.amount.toFixed(2)} ${p.currency} per ${p.intervalCount} ${p.interval}${p.native ? '' : ' (converted)'}`,
  );
}

describe('pickPrice', () => {
  describe('1. the user’s region', () => {
    it('shows its price as native', () => {
      // Netflix Standard.
      const prices = [price('CA', 'CAD', 18.99), price('US', 'USD', 19.99)];
      expect(pickPrice(prices, canada)).toEqual([
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
    });

    it('converts it when it is not in the user’s currency, rather than taking another region’s', () => {
      // A Canadian who shows prices in USD is still charged Netflix's Canadian price.
      const prices = [price('CA', 'CAD', 18.99), price('US', 'USD', 19.99)];
      const [picked] = pickPrice(prices, { ...canada, currency: 'USD' });
      expect(summary([picked])).toEqual(['CA CAD → 13.75 USD per 1 month (converted)']);
      expect(picked.fx).toEqual({
        rate: 0.7243,
        date: '2026-10-21',
        source: 'European Central Bank via Frankfurter',
      });
    });

    it('takes every interval from it, and never mixes in another region’s', () => {
      const prices = [
        price('US', 'USD', 214.99, 'year'),
        price('CA', 'CAD', 16.99),
        price('US', 'USD', 21.49),
      ];
      expect(summary(pickPrice(prices, canada))).toEqual(['CA CAD → 16.99 CAD per 1 month']);
    });

    it('then takes the price of a group the region belongs to', () => {
      // A Swede is charged the EU price, not the US one, even though it's in another currency.
      const prices = [price('US', 'USD', 9.99), price('EU', 'EUR', 8.99)];
      expect(summary(pickPrice(prices, { region: 'SE', currency: 'SEK', fx: undefined }))).toEqual([
        'EU EUR → 8.99 EUR per 1 month (converted)',
      ]);
      // The country's own price still comes first.
      const withGermany = [...prices, price('DE', 'EUR', 7.99)];
      expect(summary(pickPrice(withGermany, { region: 'DE', currency: 'EUR' }))).toEqual([
        'DE EUR → 7.99 EUR per 1 month',
      ]);
    });

    it('prefers the user’s currency in a region with several, then the one billingCurrency names', () => {
      const prices = [price('CA', 'USD', 13.99), price('CA', 'CAD', 18.99)];
      expect(summary(pickPrice(prices, canada))).toEqual(['CA CAD → 18.99 CAD per 1 month']);
      expect(
        summary(pickPrice(prices, { ...canada, currency: 'EUR', billingCurrency: { CA: 'CAD' } })),
      ).toEqual(['CA CAD → 12.61 EUR per 1 month (converted)']);
    });
  });

  describe('2. the user’s currency from another region', () => {
    it('takes a GLOBAL price in the user’s currency as native', () => {
      // Proton: GLOBAL prices in four currencies.
      const prices = ['USD', 'CAD', 'EUR', 'CHF'].flatMap((currency) => [
        price('GLOBAL', currency, currency === 'CAD' ? 12.49 : 9.99),
        price('GLOBAL', currency, currency === 'CAD' ? 104.88 : 83.88, 'year'),
      ]);
      expect(summary(pickPrice(prices, canada))).toEqual([
        'GLOBAL CAD → 12.49 CAD per 1 month',
        'GLOBAL CAD → 104.88 CAD per 1 year',
      ]);
    });

    it('prefers GLOBAL to another country’s price in the same currency', () => {
      const prices = [
        price('DE', 'EUR', 9.99),
        price('GLOBAL', 'EUR', 8.99),
        price('US', 'USD', 9.99),
      ];
      expect(summary(pickPrice(prices, { region: 'FR', currency: 'EUR', fx }))).toEqual([
        'GLOBAL EUR → 8.99 EUR per 1 month',
      ]);
    });
  });

  describe('3. a GLOBAL price in another currency', () => {
    it('converts it', () => {
      // Mullvad: one worldwide price in EUR.
      const prices = [price('GLOBAL', 'EUR', 5), price('GLOBAL', 'EUR', 60, 'year')];
      const picked = pickPrice(prices, canada);
      expect(summary(picked)).toEqual([
        'GLOBAL EUR → 7.53 CAD per 1 month (converted)',
        'GLOBAL EUR → 90.36 CAD per 1 year (converted)',
      ]);
      expect(picked[1].monthlyEquivalent).toBeCloseTo(60 / 0.664 / 12, 10);
      expect(picked[0].fx?.rate).toBeCloseTo(1.506, 4);
    });

    it('takes the currency billingCurrency names when there are several', () => {
      const prices = [price('GLOBAL', 'EUR', 9.99), price('GLOBAL', 'USD', 9.99)];
      const britain = { region: 'GB', currency: 'GBP', fx };
      expect(summary(pickPrice(prices, britain))[0]).toMatch(/^GLOBAL EUR /);
      expect(
        summary(pickPrice(prices, { ...britain, billingCurrency: { GLOBAL: 'USD' } }))[0],
      ).toMatch(/^GLOBAL USD /);
    });
  });

  describe('4. a fallback region', () => {
    it('converts a US price when nothing else fits', () => {
      // Disney+ With Ads is sold in the US only.
      expect(summary(pickPrice([price('US', 'USD', 12.49)], canada))).toEqual([
        'US USD → 17.24 CAD per 1 month (converted)',
      ]);
    });

    it('tries US, GB and EU before the first region listed', () => {
      const prices = [price('DE', 'EUR', 9.99), price('GB', 'GBP', 8.99)];
      expect(summary(pickPrice(prices, { region: 'JP', currency: 'JPY', fx }))[0]).toMatch(
        /^GB GBP /,
      );
      const elsewhere = [price('AU', 'AUD', 14.99), price('NZ', 'NZD', 15.99)];
      expect(summary(pickPrice(elsewhere, { ...canada, fx: undefined }))[0]).toMatch(/^AU AUD /);
    });
  });

  it('lists the intervals shortest first', () => {
    const prices = [
      price('CA', 'CAD', 199.99, 'year'),
      price('CA', 'CAD', 54.99, 'month', 3),
      price('CA', 'CAD', 19.99),
      price('CA', 'CAD', 4.99, 'week'),
    ];
    expect(pickPrice(prices, canada).map((p) => `${p.intervalCount} ${p.interval}`)).toEqual([
      '1 week',
      '1 month',
      '3 month',
      '1 year',
    ]);
  });

  it('keeps a price in its own currency when there is no rate for it', () => {
    const prices = [price('GLOBAL', 'EUR', 5)];
    for (const context of [
      { ...canada, fx: undefined },
      { ...canada, fx: { ...fx, rates: {} } },
    ]) {
      expect(pickPrice(prices, context)).toEqual([
        {
          interval: 'month',
          intervalCount: 1,
          amount: 5,
          currency: 'EUR',
          monthlyEquivalent: 5,
          autoRenew: true,
          native: false,
          source: { region: 'GLOBAL', amount: 5, currency: 'EUR' },
        },
      ]);
    }
  });

  it('shows a free plan as a native 0 in the user’s currency, with or without rates', () => {
    // So the app shows Free, never ≈ (PROJECT-PLAN §3.1).
    for (const context of [canada, { ...canada, fx: undefined }]) {
      expect(pickPrice([price('GLOBAL', 'USD', 0)], context)).toEqual([
        {
          interval: 'month',
          intervalCount: 1,
          amount: 0,
          currency: 'CAD',
          monthlyEquivalent: 0,
          autoRenew: true,
          native: true,
          source: { region: 'GLOBAL', amount: 0, currency: 'USD' },
        },
      ]);
    }
  });

  it('says when the source price includes tax, and only then', () => {
    const included: Price = {
      ...price('GLOBAL', 'EUR', 5),
      taxIncluded: { quote: 'Including VAT.' },
    };
    const [picked] = pickPrice([included], canada);
    expect(picked.taxIncluded).toBe(true);
    // Between native and source, as the API's pricing entries show it.
    expect(Object.keys(picked)).toEqual([
      'interval',
      'intervalCount',
      'amount',
      'currency',
      'monthlyEquivalent',
      'autoRenew',
      'native',
      'taxIncluded',
      'source',
      'fx',
    ]);
    expect(pickPrice([price('GLOBAL', 'EUR', 5)], canada)[0]).not.toHaveProperty('taxIncluded');
  });

  it('gives nothing for no prices', () => {
    expect(pickPrice([], canada)).toEqual([]);
  });
});
