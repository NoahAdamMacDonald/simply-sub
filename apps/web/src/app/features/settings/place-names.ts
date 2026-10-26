import { displayCurrencies, isoRegions, subdivisionName } from '@simply-sub/core';
import { countryName } from '../../shared/country-name';

// English names for the Settings menus and the 📍 summary. The app's text is English, so the names are too.

const currencyNames = new Intl.DisplayNames(['en'], { type: 'currency', fallback: 'code' });

export { countryName };

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

/** Where the user is, as the 📍 button shows it: "Ontario, Canada (CAD)". */
export function placeSummary(values: {
  country: string;
  subdivision?: string;
  currency: string;
}): string {
  const subdivision = values.subdivision && subdivisionName(values.subdivision);
  const place = subdivision
    ? `${subdivision}, ${countryName(values.country)}`
    : countryName(values.country);
  return `${place} (${values.currency})`;
}

/**
 * An amount as the user's country writes it: 200 CAD in Canada is "$200", in the US "CA$200". Cents show only when
 * there are some.
 */
export function moneyText(amount: number, currency: string, country: string): string {
  const whole = Number.isInteger(amount)
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : {};
  return amount.toLocaleString(`en-${country}`, { style: 'currency', currency, ...whole });
}

/** A rate as text: 13 → "13%", 14.975 → "14.975%". */
export function percentText(percent: number): string {
  return `${percent.toLocaleString('en', { maximumFractionDigits: 3 })}%`;
}
