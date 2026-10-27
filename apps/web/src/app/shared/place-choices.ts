import { displayCurrencies, isoRegions } from '@simply-sub/core';
import { countryName } from './country-name';

// The country and currency menus: Settings' (P13) and the item dialog's bought in region and own price (P6). In
// English, like the rest of the app's text.

const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency', fallback: 'code' });

export interface Choice {
  value: string;
  label: string;
}

/** Every country, by name. */
export const countryChoices: readonly Choice[] = [...isoRegions]
  .map((code) => ({ value: code, label: countryName(code) }))
  .sort((a, b) => a.label.localeCompare(b.label, 'en'));

/** The currencies prices can be shown in, as "CAD — Canadian Dollar". */
export const currencyChoices: readonly Choice[] = displayCurrencies.map((code) => ({
  value: code,
  label: `${code} — ${currencyNames.of(code) ?? code}`,
}));
