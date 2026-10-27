import { subdivisionName } from '@simply-sub/core';
import { countryName } from '../../shared/country-name';

// English names for the Settings menus and the 📍 summary. The app's text is English, so the names are too.

export { countryName };
export { countryChoices, currencyChoices, type Choice } from '../../shared/place-choices';

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
