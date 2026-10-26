import { describe, expect, it } from 'vitest';
import { displayCurrencies, settingsDefaults } from '../../src';

describe('settingsDefaults', () => {
  it.each([
    [['en-CA'], 'CA', 'CAD'],
    [['fr-CA', 'fr'], 'CA', 'CAD'],
    [['en-US', 'en'], 'US', 'USD'],
    [['en-GB'], 'GB', 'GBP'],
    [['de-AT'], 'AT', 'EUR'],
    [['pt-BR'], 'BR', 'BRL'],
  ])('takes the country %j names, and its currency', (languages, country, currency) => {
    expect(settingsDefaults(languages)).toEqual({ country, currency });
  });

  it('prefers a country a later language names over one a language implies', () => {
    expect(settingsDefaults(['fr', 'en-CA'])).toEqual({ country: 'CA', currency: 'CAD' });
  });

  it('falls back on the country a language implies', () => {
    expect(settingsDefaults(['fr'])).toEqual({ country: 'FR', currency: 'EUR' });
    expect(settingsDefaults(['ja'])).toEqual({ country: 'JP', currency: 'JPY' });
    // es-419 is Latin America, not a country, so the plain language decides.
    expect(settingsDefaults(['es-419', 'es'])).toEqual({ country: 'ES', currency: 'EUR' });
  });

  it('shows US dollars where prices can’t be converted into the country’s currency', () => {
    expect(settingsDefaults(['es-AR'])).toEqual({ country: 'AR', currency: 'USD' });
  });

  it('uses the US when the languages give nothing', () => {
    expect(settingsDefaults([])).toEqual({ country: 'US', currency: 'USD' });
    expect(settingsDefaults(['not a tag!'])).toEqual({ country: 'US', currency: 'USD' });
  });
});

describe('displayCurrencies', () => {
  it('lists real ISO 4217 codes once each, sorted, with the euro and the dollars', () => {
    const known = new Set(Intl.supportedValuesOf('currency'));
    expect(displayCurrencies.filter((currency) => !known.has(currency))).toEqual([]);
    expect([...displayCurrencies].sort()).toEqual(displayCurrencies);
    expect(new Set(displayCurrencies).size).toBe(displayCurrencies.length);
    expect(displayCurrencies).toEqual(expect.arrayContaining(['EUR', 'USD', 'CAD']));
  });
});
