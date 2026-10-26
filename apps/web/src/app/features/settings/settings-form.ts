import { max, min, required, schema, validate } from '@angular/forms/signals';
import { defaultCurrency, displayCurrencies, taxAddedRegions } from '@simply-sub/core';
import type { SettingsValues } from '../../core/settings/settings-store';

// The forms behind the first-run dialog (P1) and Settings (P13): the location (country, province or state, currency
// and the sales-tax rate: BLUEPRINT §4.8) and the budgets. Signal Forms models hold no undefined, so "none" is '' or
// null here.

/** The location settings as the form edits them. */
export interface LocationModel {
  country: string;
  /** ISO 3166-2, or '' for none. Only asked for in a tax-added country. */
  subdivision: string;
  currency: string;
  /** Whether the user picked the currency. If not, it follows the country (P13). */
  currencyChosen: boolean;
  /** Whether the user gives their own rate. Always so in the US, which has no built-in rates. */
  ownRate: boolean;
  salesTaxPercent: number | null;
}

/** The settings the location form saves. */
export type LocationValues = Pick<
  SettingsValues,
  'country' | 'subdivision' | 'currency' | 'salesTaxPercent'
>;

/** The form's model for saved (or default) settings. */
export function locationModel(values: LocationValues): LocationModel {
  return {
    country: values.country,
    subdivision: values.subdivision ?? '',
    currency: values.currency,
    currencyChosen: values.currency !== countryCurrency(values.country),
    ownRate: values.country === 'US' || values.salesTaxPercent !== undefined,
    salesTaxPercent: values.salesTaxPercent ?? null,
  };
}

/** The settings to save. A province or a rate is kept only where tax is added, and a rate only when it's the user's. */
export function locationValues(model: LocationModel): LocationValues {
  const taxAdded = taxAddedRegions.has(model.country);
  return {
    country: model.country,
    subdivision: taxAdded && model.subdivision !== '' ? model.subdivision : undefined,
    currency: model.currency,
    salesTaxPercent:
      taxAdded && model.ownRate && model.salesTaxPercent !== null
        ? model.salesTaxPercent
        : undefined,
  };
}

/**
 * The model once the country has changed: the province and the rate belonged to the old country, so they're cleared,
 * and the currency follows the country unless the user picked one.
 */
export function afterCountryChange(model: LocationModel): LocationModel {
  return {
    ...model,
    subdivision: '',
    currency: model.currencyChosen ? model.currency : countryCurrency(model.country),
    ownRate: model.country === 'US',
    salesTaxPercent: null,
  };
}

/** The currency that follows a country: its own, or US dollars where prices can't be converted into it. */
function countryCurrency(country: string): string {
  return defaultCurrency(country, displayCurrencies);
}

export const locationSchema = schema<LocationModel>((path) => {
  required(path.country, { message: 'Choose your country' });
  required(path.currency, { message: 'Choose a currency' });
  // A Canadian province decides the rate. A US state doesn't (the rate is the user's), so it's optional there.
  required(path.subdivision, {
    when: ({ valueOf }) => valueOf(path.country) === 'CA',
    message: 'Choose your province or territory',
  });
  required(path.salesTaxPercent, {
    when: ({ valueOf }) => valueOf(path.country) === 'CA' && valueOf(path.ownRate),
    message: 'Enter your rate, or untick “Use my own rate”',
  });
  min(path.salesTaxPercent, 0, { message: 'Enter a rate from 0 to 100' });
  max(path.salesTaxPercent, 100, { message: 'Enter a rate from 0 to 100' });
});

/** A budget: none (null) or more than 0, as the settings schema requires. */
export const budgetSchema = schema<number | null>((path) => {
  validate(path, ({ value }) => {
    const amount = value();
    return amount !== null && amount <= 0
      ? { kind: 'positive', message: 'Enter an amount above 0, or leave it empty' }
      : undefined;
  });
});
