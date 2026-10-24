import { describe, expect, it } from 'vitest';
import {
  ecbCurrencies,
  fxFreshFor,
  fxFreshSeconds,
  fxRatesSchema,
  fxSource,
  readEcbRates,
  rebaseRates,
  type EcbRates,
} from '../../src';
import { issues } from './helpers';

// Frankfurter's answers for 2026-10-23: the ECB's rates in euros (ecbRatesUrl), and the same rates with base=CAD,
// which Frankfurter rebases itself.
const perEuro: Record<string, number> = {
  AUD: 1.5939,
  BRL: 5.6485,
  CAD: 1.5665,
  CHF: 0.9227,
  CNY: 7.466,
  CZK: 24.327,
  DKK: 7.4748,
  GBP: 0.83728,
  HKD: 8.7793,
  HUF: 366.73,
  IDR: 20268.06,
  ILS: 3.4939,
  INR: 106.272,
  ISK: 136.2,
  JPY: 175.51,
  KRW: 1482.46,
  MXN: 21.0226,
  MYR: 4.5729,
  NOK: 10.4665,
  NZD: 1.9682,
  PHP: 71.235,
  PLN: 4.3945,
  RON: 5.3492,
  SEK: 11.131,
  SGD: 1.431,
  THB: 37.771,
  TRY: 55.6715,
  USD: 1.1193,
  ZAR: 18.5777,
};
const perCanadianDollar: Record<string, number> = {
  AUD: 1.0175,
  BRL: 3.6058,
  CHF: 0.58902,
  CNY: 4.766,
  CZK: 15.5295,
  DKK: 4.7717,
  EUR: 0.63837,
  GBP: 0.53449,
  HKD: 5.6044,
  HUF: 234.11,
  IDR: 12938,
  ILS: 2.2304,
  INR: 67.84,
  ISK: 86.95,
  JPY: 112.04,
  KRW: 946.35,
  MXN: 13.4201,
  MYR: 2.9192,
  NOK: 6.6815,
  NZD: 1.2564,
  PHP: 45.474,
  PLN: 2.8053,
  RON: 3.4147,
  SEK: 7.1056,
  SGD: 0.9135,
  THB: 24.112,
  TRY: 35.539,
  USD: 0.71452,
  ZAR: 11.8594,
};

/** Frankfurter's rows, as ecbRatesUrl gives them: the euro's own row included. */
function rows(date = '2026-10-23', rates = perEuro) {
  return [
    { date, base: 'EUR', quote: 'EUR', rate: 1 },
    ...Object.entries(rates).map(([quote, rate]) => ({ date, base: 'EUR', quote, rate })),
  ];
}

const ecb: EcbRates = { date: '2026-10-23', rates: perEuro };

describe('readEcbRates', () => {
  it("reads Frankfurter's rows as one day's rates per euro, sorted, without the euro's own", () => {
    const shuffled = rows().reverse();

    expect(readEcbRates(shuffled)).toEqual(ecb);
    expect(Object.keys(readEcbRates(shuffled)?.rates ?? {})).toEqual(Object.keys(perEuro));
  });

  it('ignores fields Frankfurter adds to a row', () => {
    const withProviders = rows().map((row) => ({ ...row, providers: ['ECB'] }));

    expect(readEcbRates(withProviders)).toEqual(ecb);
  });

  it.each([
    ['an error', { status: 422, message: 'invalid currency: XYZ' }],
    ['no rows', []],
    ['only the euro', rows('2026-10-23', {})],
    ['rows of two days', [...rows(), { date: '2026-10-22', base: 'EUR', quote: 'SEK', rate: 11 }]],
    ['another base', rows().map((row) => ({ ...row, base: 'USD' }))],
    ['a rate of zero', rows('2026-10-23', { USD: 0 })],
    ['a rate that is not a number', rows('2026-10-23', { USD: '1.1' as unknown as number })],
    ['a lowercase currency', rows('2026-10-23', { usd: 1.1 })],
  ])('treats %s as no rates', (_name, json) => {
    expect(readEcbRates(json)).toBeUndefined();
  });
});

describe('ecbCurrencies', () => {
  it('is the euro and every currency with a rate, sorted', () => {
    expect(ecbCurrencies({ date: '2026-10-23', rates: { USD: 1.1, CAD: 1.5 } })).toEqual([
      'CAD',
      'EUR',
      'USD',
    ]);
  });
});

describe('rebaseRates', () => {
  it("gives the ECB's own rates in euros", () => {
    expect(rebaseRates(ecb, 'EUR')).toEqual({
      base: 'EUR',
      date: '2026-10-23',
      source: fxSource,
      rates: perEuro,
    });
  });

  it("gives Frankfurter's own rates in another base, the euro included", () => {
    const rates = rebaseRates(ecb, 'CAD');

    expect(rates).toMatchObject({ base: 'CAD', date: '2026-10-23', source: fxSource });
    expect(Object.keys(rates?.rates ?? {})).toEqual(Object.keys(perCanadianDollar));
    for (const [currency, rate] of Object.entries(perCanadianDollar)) {
      expect(Math.abs((rates?.rates[currency] ?? 0) / rate - 1)).toBeLessThan(1e-4);
    }
  });

  it('rounds a rebased rate to 6 significant digits', () => {
    expect(rebaseRates(ecb, 'CAD')?.rates).toMatchObject({ EUR: 0.638366, CZK: 15.5295 });
  });

  it('matches the GET /fx data schema', () => {
    expect(issues(fxRatesSchema, rebaseRates(ecb, 'CAD'))).toEqual([]);
  });

  it("has nothing for a currency the ECB doesn't publish", () => {
    expect(rebaseRates(ecb, 'AED')).toBeUndefined();
  });
});

describe('fxFreshFor', () => {
  it('counts down from 12 hours', () => {
    expect(fxFreshFor('2026-10-24T06:00:00Z', '2026-10-24T06:00:00Z')).toBe(fxFreshSeconds);
    expect(fxFreshFor('2026-10-24T06:00:00Z', '2026-10-24T17:59:30Z')).toBe(30);
  });

  it('is 0 once the rates are due again', () => {
    expect(fxFreshFor('2026-10-24T06:00:00Z', '2026-10-24T18:00:00Z')).toBe(0);
    expect(fxFreshFor('2026-10-24T06:00:00Z', '2026-10-26T06:00:00Z')).toBe(0);
  });

  it('never gives more than 12 hours, even for a fetch dated in the future', () => {
    expect(fxFreshFor('2026-10-24T07:00:00Z', '2026-10-24T06:00:00Z')).toBe(fxFreshSeconds);
  });
});
