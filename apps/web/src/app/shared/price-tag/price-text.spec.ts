import type { PickedPrice } from '@simply-sub/core';
import {
  amountText,
  intervalSpoken,
  intervalText,
  priceTooltip,
  wholeAmountText,
} from './price-text';

/** Mullvad's €5 a month for a Canadian, converted at the GET /fx example's rate. */
const converted: PickedPrice = {
  interval: 'month',
  intervalCount: 1,
  amount: 7.53,
  currency: 'CAD',
  monthlyEquivalent: 7.53,
  autoRenew: false,
  native: false,
  source: { region: 'GLOBAL', amount: 5, currency: 'EUR' },
  fx: { rate: 1.506, date: '2026-10-21', source: 'European Central Bank via Frankfurter' },
};

describe('amountText', () => {
  it.each([
    [7.5301, 'CAD', 'CA', '$7.53'],
    [9.99, 'USD', 'CA', 'US$9.99'],
    [5, 'EUR', 'CA', '€5.00'],
    [9.99, 'USD', 'US', '$9.99'],
    [18.99, 'CAD', 'US', 'CA$18.99'],
    [2290, 'JPY', 'CA', 'JP¥2,290'],
    [5, 'EUR', undefined, '€5.00'],
  ])('writes %s %s for a buyer in %s as %s', (amount, currency, country, expected) => {
    expect(amountText(amount, currency, country)).toBe(expected);
  });
});

describe('wholeAmountText', () => {
  it.each([
    [5, 'CAD', 'CA', '$5'],
    [9.99, 'CAD', 'CA', '$9.99'],
    [0.5, 'EUR', 'CA', '€0.50'],
    [30, 'USD', 'CA', 'US$30'],
    [2300, 'JPY', 'CA', 'JP¥2,300'],
  ])('writes %s %s for a buyer in %s as %s', (amount, currency, country, expected) => {
    expect(wholeAmountText(amount, currency, country)).toBe(expected);
  });
});

describe('intervalText and intervalSpoken', () => {
  it.each([
    ['month', 1, '/ mo', 'a month'],
    ['month', 3, '/ 3 mo', 'every 3 months'],
    ['year', 1, '/ year', 'a year'],
    ['year', 2, '/ 2 years', 'every 2 years'],
    ['week', 1, '/ week', 'a week'],
    ['day', 30, '/ 30 days', 'every 30 days'],
  ] as const)('writes %s × %i as "%s" and says "%s"', (interval, count, shown, spoken) => {
    expect(intervalText(interval, count)).toBe(shown);
    expect(intervalSpoken(interval, count)).toBe(spoken);
  });
});

describe('priceTooltip', () => {
  it('says what a converted price was converted from, and what is charged', () => {
    expect(priceTooltip(converted)).toBe(
      "Converted from 5.00 EUR at 1.506 on 2026-10-21. You'll be charged in EUR.",
    );
  });

  it("writes the source in its currency's own decimals, and the rate to 4", () => {
    const yen = {
      ...converted,
      source: { region: 'JP', amount: 2290, currency: 'JPY' },
      fx: { ...converted.fx!, rate: 0.0092233 },
    };
    expect(priceTooltip(yen)).toBe(
      "Converted from 2,290 JPY at 0.0092 on 2026-10-21. You'll be charged in JPY.",
    );
  });

  it('says why a price in another currency was not converted', () => {
    const unconverted = { ...converted, amount: 5, currency: 'EUR', fx: undefined };
    expect(priceTooltip(unconverted)).toBe(
      "There's no exchange rate yet, so this is the price in EUR.",
    );
  });

  it('has nothing to say about a native price', () => {
    expect(priceTooltip({ ...converted, native: true, fx: undefined })).toBeUndefined();
  });
});
