import { defaultCurrency, displayCurrencies } from '../catalog/region-currency';
import { isoRegions } from '../catalog/regions';

// The first-run dialog's starting values (PROJECT-PLAN P1), from the browser's languages. This file imports no Zod,
// so the app can use it at startup without loading the record schemas (BLUEPRINT §11.1).

/** Where the user probably is, and the currency to show prices in. */
export interface LocaleDefaults {
  country: string;
  currency: string;
}

/**
 * Defaults from `languages`, the browser's preferred languages in order (`navigator.languages`). The country is the
 * first one a language names (en-CA → CA), else the one its language implies (fr → FR), else the US. The currency is
 * the country's own when prices can be converted into it (displayCurrencies), else US dollars, as GET /providers
 * does. There's no province or state: a language can't tell, and neither can a time zone (Ontario and Quebec share
 * America/Toronto).
 */
export function settingsDefaults(languages: readonly string[]): LocaleDefaults {
  const country = countryOf(languages) ?? 'US';
  return { country, currency: defaultCurrency(country, displayCurrencies) };
}

function countryOf(languages: readonly string[]): string | undefined {
  const locales = languages.flatMap((tag) => {
    try {
      return [new Intl.Locale(tag)];
    } catch {
      return [];
    }
  });
  // A region in the tag wins over one implied by a language alone. Some regions aren't countries (es-419 is Latin
  // America), so they're passed over.
  return [...locales, ...locales.map((locale) => locale.maximize())]
    .map((locale) => locale.region)
    .find((region) => region !== undefined && isoRegions.has(region));
}
