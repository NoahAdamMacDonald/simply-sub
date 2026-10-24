import { describe, expect, it } from 'vitest';
import { convert, exchangeRate, fxRatesSchema, type FxRates } from '../../src';
import { issues } from './helpers';

// The GET /fx example in docs/api-output-examples.json.
const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-21',
  source: 'European Central Bank via Frankfurter',
  rates: { AUD: 1.098, CHF: 0.581, EUR: 0.664, GBP: 0.5571, JPY: 108.42, USD: 0.7243 },
};

describe('exchangeRate', () => {
  it('turns a rate per unit of base around for prices in another currency', () => {
    expect(exchangeRate('USD', 'CAD', fx)).toBeCloseTo(1.3806, 4);
    expect(exchangeRate('EUR', 'CAD', fx)).toBeCloseTo(1.506, 4);
  });

  it('converts from the base, and between two other currencies through it', () => {
    expect(exchangeRate('CAD', 'USD', fx)).toBe(0.7243);
    expect(exchangeRate('EUR', 'USD', fx)).toBeCloseTo(0.7243 / 0.664, 10);
    expect(exchangeRate('CAD', 'CAD', fx)).toBe(1);
  });

  it('has no rate for a currency the rates leave out', () => {
    expect(exchangeRate('SEK', 'CAD', fx)).toBeUndefined();
    expect(exchangeRate('CAD', 'SEK', fx)).toBeUndefined();
  });
});

describe('convert', () => {
  it('converts at full precision', () => {
    // The /fx example's note: 5.00 EUR ÷ 0.6640 = 7.53 CAD.
    expect(convert(5, 'EUR', 'CAD', fx)).toBe(5 / 0.664);
  });

  it('gives undefined without a rate', () => {
    expect(convert(5, 'SEK', 'CAD', fx)).toBeUndefined();
  });
});

describe('fxRatesSchema', () => {
  it('accepts the GET /fx data', () => {
    expect(issues(fxRatesSchema, fx)).toEqual([]);
  });

  it('rejects a rate that is not positive', () => {
    expect(issues(fxRatesSchema, { ...fx, rates: { USD: 0 } })).toEqual([
      'rates.USD: Too small: expected number to be >0',
    ]);
  });
});
