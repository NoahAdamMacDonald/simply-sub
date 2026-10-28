import { describe, expect, it } from 'vitest';
import { canadianSalesTax, salesTaxOn } from '../../src';

// The sales tax on a charge (BLUEPRINT §4.8): the buyer's rate on a price listed before tax, none otherwise.

describe('salesTaxOn', () => {
  it.each(Object.entries(canadianSalesTax))('adds %s’s rate, %s%', (subdivision, percent) => {
    expect(salesTaxOn(100, {}, { country: 'CA', subdivision })).toBeCloseTo(percent, 9);
  });

  it('takes the user’s own rate over the built-in one, and in the US', () => {
    expect(salesTaxOn(100, {}, { country: 'CA', subdivision: 'CA-ON', salesTaxPercent: 5 })).toBe(
      5,
    );
    expect(
      salesTaxOn(50, {}, { country: 'US', subdivision: 'US-WA', salesTaxPercent: 10.25 }),
    ).toBe(5.125);
  });

  it('adds none where prices include it, or where no rate is known', () => {
    expect(salesTaxOn(100, {}, { country: 'GB' })).toBe(0);
    expect(salesTaxOn(100, {}, { country: 'DE', salesTaxPercent: 19 })).toBe(0);
    expect(salesTaxOn(100, {}, { country: 'US' })).toBe(0);
    expect(salesTaxOn(100, {}, { country: 'CA' })).toBe(0);
  });

  it('adds none to a price that includes it: a catalog price’s quote, or a typed amount', () => {
    const place = { country: 'CA', subdivision: 'CA-NS' };
    expect(salesTaxOn(7.85, { taxIncluded: { quote: 'Including VAT.' } }, place)).toBe(0);
    expect(salesTaxOn(7.85, { taxIncluded: true }, place)).toBe(0);
    // A typed amount marked plus tax has no taxIncluded: tax is added like on a catalog price.
    expect(salesTaxOn(100, {}, place)).toBe(14);
  });
});
