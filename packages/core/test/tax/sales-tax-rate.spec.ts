import { describe, expect, it } from 'vitest';
import {
  addedSalesTax,
  buyerTaxPlace,
  canadianSalesTax,
  priceTaxNote,
  salesTaxRate,
  subdivisionsOf,
} from '../../src';

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

describe('addedSalesTax', () => {
  const ontario = { country: 'CA', subdivision: 'CA-ON' };

  it('adds the buyer’s rate to a price listed before tax', () => {
    expect(addedSalesTax({}, ontario)).toEqual({ percent: 13, source: 'built-in' });
    expect(addedSalesTax({ taxIncluded: undefined }, ontario)).toEqual({
      percent: 13,
      source: 'built-in',
    });
  });

  it('adds nothing to a price that includes tax, a catalog price’s or a picked one’s', () => {
    expect(addedSalesTax({ taxIncluded: { quote: 'Including VAT.' } }, ontario)).toBeUndefined();
    expect(addedSalesTax({ taxIncluded: true }, ontario)).toBeUndefined();
    expect(
      addedSalesTax({ taxIncluded: true }, { country: 'US', salesTaxPercent: 8 }),
    ).toBeUndefined();
  });

  it('adds nothing where prices include tax anyway', () => {
    expect(addedSalesTax({}, { country: 'GB' })).toBeUndefined();
  });
});

describe('buyerTaxPlace', () => {
  const ontario = { country: 'CA', subdivision: 'CA-ON', salesTaxPercent: 12 };

  it("is the user's own place for an item bought in their country", () => {
    expect(buyerTaxPlace(ontario)).toBe(ontario);
    expect(buyerTaxPlace(ontario, 'CA')).toBe(ontario);
  });

  it("follows another region's rule, without the user's rate", () => {
    expect(buyerTaxPlace(ontario, 'US')).toEqual({ country: 'US' });
    expect(buyerTaxPlace(ontario, 'GB')).toEqual({ country: 'GB' });
  });
});

describe('priceTaxNote', () => {
  const listed = {};
  const included = { taxIncluded: true };

  it('says "+ tax" where a rate is added, and "incl. tax" for a price that includes it', () => {
    const ontario = { country: 'CA', subdivision: 'CA-ON' };
    expect(priceTaxNote(listed, ontario)).toBe('plus-tax');
    expect(priceTaxNote(included, ontario)).toBe('incl-tax');
  });

  it('says nothing about a listed price where no rate is known, as totals add none', () => {
    expect(priceTaxNote(listed, { country: 'US', subdivision: 'US-NY' })).toBeUndefined();
    expect(priceTaxNote(listed, { country: 'US', salesTaxPercent: 8.875 })).toBe('plus-tax');
    expect(priceTaxNote(included, { country: 'US' })).toBe('incl-tax');
  });

  it('says nothing outside the tax-added countries, where every price includes tax', () => {
    expect(priceTaxNote(listed, { country: 'GB' })).toBeUndefined();
    expect(priceTaxNote(included, { country: 'GB' })).toBeUndefined();
  });
});
