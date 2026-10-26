import { describe, expect, it } from 'vitest';
import { canadianSalesTax, salesTaxRate, subdivisionsOf } from '../../src';

describe('canadianSalesTax', () => {
  it('has a rate for every province and territory, and nothing else', () => {
    expect(Object.keys(canadianSalesTax).sort()).toEqual(
      subdivisionsOf('CA')
        .map((subdivision) => subdivision.code)
        .sort(),
    );
  });

  it.each([
    ['CA-AB', 5],
    ['CA-BC', 12],
    ['CA-MB', 12],
    // HST went from 15% to 14% on 2025-04-01.
    ['CA-NS', 14],
    ['CA-ON', 13],
    ['CA-QC', 14.975],
    ['CA-SK', 11],
    ['CA-YT', 5],
  ])('gives %s %s%', (subdivision, percent) => {
    expect(canadianSalesTax[subdivision]).toBe(percent);
  });
});

describe('salesTaxRate', () => {
  it('uses the province’s rate in Canada', () => {
    expect(salesTaxRate({ country: 'CA', subdivision: 'CA-ON' })).toEqual({
      percent: 13,
      source: 'built-in',
    });
  });

  it('uses the user’s own rate in place of the built-in one', () => {
    expect(salesTaxRate({ country: 'CA', subdivision: 'CA-ON', salesTaxPercent: 5 })).toEqual({
      percent: 5,
      source: 'own',
    });
    expect(salesTaxRate({ country: 'CA', salesTaxPercent: 0 })).toEqual({
      percent: 0,
      source: 'own',
    });
  });

  it('uses only the user’s own rate in the US', () => {
    expect(salesTaxRate({ country: 'US', subdivision: 'US-NY', salesTaxPercent: 8.875 })).toEqual({
      percent: 8.875,
      source: 'own',
    });
    expect(salesTaxRate({ country: 'US', subdivision: 'US-NY' })).toBeUndefined();
  });

  it('adds nothing without a province, or for a code the table doesn’t have', () => {
    expect(salesTaxRate({ country: 'CA' })).toBeUndefined();
    expect(salesTaxRate({ country: 'CA', subdivision: 'CA-XX' })).toBeUndefined();
    expect(salesTaxRate({ country: 'CA', subdivision: 'toString' })).toBeUndefined();
  });

  it('adds nothing where prices include tax, whatever rate is saved', () => {
    expect(salesTaxRate({ country: 'GB' })).toBeUndefined();
    expect(salesTaxRate({ country: 'DE', salesTaxPercent: 19 })).toBeUndefined();
  });
});
