import { describe, expect, it } from 'vitest';
import { isoRegions, regionCurrency, regionGroups } from '../../src';

const currencies = new Set(Intl.supportedValuesOf('currency'));

describe('regionCurrency', () => {
  it('gives every ISO 3166-1 region a real currency', () => {
    const missing = [...isoRegions].filter((region) => regionCurrency(region) === undefined);
    const unknown = [...isoRegions].filter(
      (region) => !currencies.has(regionCurrency(region) ?? ''),
    );

    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it('gives every group a currency, and GLOBAL US dollars', () => {
    expect(Object.keys(regionGroups).map(regionCurrency)).toEqual(['EUR']);
    expect(regionCurrency('GLOBAL')).toBe('USD');
  });

  it.each([
    ['CA', 'CAD'],
    ['US', 'USD'],
    ['GB', 'GBP'],
    ['DE', 'EUR'],
    // In the euro since 2026.
    ['BG', 'EUR'],
    ['CH', 'CHF'],
    ['LI', 'CHF'],
    ['JP', 'JPY'],
    ['PA', 'USD'],
    ['CW', 'XCG'],
  ])('gives %s %s', (region, currency) => {
    expect(regionCurrency(region)).toBe(currency);
  });

  it('has nothing for a code that is not a region', () => {
    expect(regionCurrency('UK')).toBeUndefined();
    expect(regionCurrency('ca')).toBeUndefined();
  });
});
