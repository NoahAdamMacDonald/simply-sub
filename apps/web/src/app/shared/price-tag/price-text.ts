import type { Interval, PickedPrice } from '@simply-sub/core';

// How a price tag writes money (BLUEPRINT §4.7). The app's text is English, and amounts follow English as written in
// the user's country, as Settings' budgets do: a Canadian sees $7.53, US$9.99 and €5.00.

/** `amount` with its currency's usual decimals: $7.53, US$9.99, ¥2,290. */
export function amountText(amount: number, currency: string, country: string | undefined): string {
  return amount.toLocaleString(country === undefined ? 'en' : `en-${country}`, {
    style: 'currency',
    currency,
  });
}

/** `amount` without its decimals when it's whole, as the price filter shows a step: $5, $9.99, ¥2,300. */
export function wholeAmountText(
  amount: number,
  currency: string,
  country: string | undefined,
): string {
  return amount.toLocaleString(country === undefined ? 'en' : `en-${country}`, {
    style: 'currency',
    currency,
    ...(Number.isInteger(amount) && { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  });
}

/** The billing period as the tag shows it: "/ mo", "/ 3 mo", "/ year", "/ 30 days". */
export function intervalText(interval: Interval, count: number): string {
  const [one, many] = shortUnits[interval];
  return count === 1 ? `/ ${one}` : `/ ${count} ${many}`;
}

/** The billing period as a screen reader says it: "a month", "every 3 months". */
export function intervalSpoken(interval: Interval, count: number): string {
  const [one, many] = spokenUnits[interval];
  return count === 1 ? one : `every ${count} ${many}`;
}

/**
 * The tooltip of a price in another currency: how it was converted, or that there was no rate to convert it with.
 * None for a native price.
 */
export function priceTooltip({ native, fx, source, currency }: PickedPrice): string | undefined {
  if (native) return undefined;
  if (!fx) return `There's no exchange rate yet, so this is the price in ${currency}.`;
  return (
    `Converted from ${codeAmountText(source.amount, source.currency)} at ${rateText(fx.rate)} on ` +
    `${fx.date}. You'll be charged in ${source.currency}.`
  );
}

const shortUnits: Record<Interval, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['mo', 'mo'],
  year: ['year', 'years'],
};

const spokenUnits: Record<Interval, [string, string]> = {
  day: ['a day', 'days'],
  week: ['a week', 'weeks'],
  month: ['a month', 'months'],
  year: ['a year', 'years'],
};

/** "5.00 EUR", "2,290 JPY": the currency's usual decimals, and its code, which is never ambiguous. */
function codeAmountText(amount: number, currency: string): string {
  const { maximumFractionDigits: digits } = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions();
  return `${amount.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`;
}

/** An exchange rate to at most 4 decimals, as the API rounds them: 1.506, 0.0092, 108.42. */
function rateText(rate: number): string {
  return rate.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
