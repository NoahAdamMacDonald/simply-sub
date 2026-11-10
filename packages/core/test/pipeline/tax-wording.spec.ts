import { describe, expect, it } from 'vitest';
import { saysTaxExcluded, saysTaxIncluded } from '../../src';

// A price's taxIncluded quote, and a reseller price's taxExcluded, are the page's own words (BLUEPRINT §4.8, §4.9):
// validation and the pipeline keep one only when its words say so.

describe('saysTaxIncluded', () => {
  it('reads the words that say a price includes tax, in the catalog’s languages', () => {
    for (const quote of [
      'Including VAT.',
      'Sales tax included.',
      'Sales tax included',
      'Taxes included',
      'Prices include VAT.',
      'Inclusive of all taxes',
      'incl. GST',
      'Inklusive MwSt.',
      'Inklusive Mehrwertsteuer.',
      'Preis inklusive Mwst.',
      'TVA incluse.',
      'Prix TTC',
      'y compris la TVA',
      'Inclusief BTW.',
      'IVA incluido.',
      'IVA inclusa',
      'Priset inkl. moms',
      'moms ingår',
    ]) {
      expect(saysTaxIncluded(quote), quote).toBe(true);
    }
  });

  it('refuses words that don’t say so, or that say tax is added', () => {
    for (const quote of [
      // ProxyStore's, on the country it asks for: the price is the same, but the words don't say it includes tax.
      'It does not affect the price or the goods.',
      'One price wherever you are.',
      'Plus applicable sales tax.',
      'Taxes calculated at checkout',
      'excl. VAT',
      'Excluding VAT',
      'VAT not included',
      'non-inclusive of VAT',
      'TVA non incluse',
      'IVA no incluido',
      'zzgl. MwSt.',
      'Prices include VAT, plus applicable sales tax in the US.',
    ]) {
      expect(saysTaxIncluded(quote), quote).toBe(false);
    }
  });
});

describe('saysTaxExcluded', () => {
  it('reads the words that leave tax to be added', () => {
    for (const quote of [
      'Excl. VAT',
      'Plus applicable sales tax.',
      'VAT not included',
      'zzgl. MwSt.',
      'exkl. MwSt.',
      'Prix HT',
      'hors taxes',
      'exclusief btw',
      'IVA esclusa',
      'IVA no incluida',
      'sin IVA',
      '+ IVA',
    ]) {
      expect(saysTaxExcluded(quote), quote).toBe(true);
    }
  });

  it('refuses words that don’t say so', () => {
    for (const quote of [
      'Including VAT.',
      'Sales tax included.',
      'TVA incluse.',
      'It does not affect the price or the goods.',
    ]) {
      expect(saysTaxExcluded(quote), quote).toBe(false);
    }
  });
});
