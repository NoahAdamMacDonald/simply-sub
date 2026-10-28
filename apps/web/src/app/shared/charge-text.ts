import type { Charge, IsoDate } from '@simply-sub/core';
import { dateText, dayText } from './date-text';
import { amountText } from './price-tag/price-text';

// How the app writes a charge (PROJECT-PLAN §3.1): what leaves the account, sales tax included, as List view's cards,
// the list editor, the item dialog and the Calendar say it.

/** A text as it shows ("≈ $26.84 / mo average") and as it's read ("about $26.84 a month on average"). */
export interface ShownAndSpoken {
  shown: string;
  spoken: string;
}

/**
 * What a charge costs, as charged: "$21.46, with $2.47 tax", and "≈ $7.85" for a converted one, read "about $7.85".
 */
export function chargeAmountText(
  charge: Pick<Charge, 'amount' | 'tax' | 'currency' | 'converted'>,
  country: string | undefined,
): ShownAndSpoken {
  const money = amountText(charge.amount, charge.currency, country);
  const tax =
    charge.tax > 0 ? `, with ${amountText(charge.tax, charge.currency, country)} tax` : '';
  return {
    shown: `${charge.converted ? '≈ ' : ''}${money}${tax}`,
    spoken: `${charge.converted ? 'about ' : ''}${money}${tax}`,
  };
}

/** A date near today: "Nov 12" in this year, "Feb 3, 2027" in another. */
export function nearDateText(date: IsoDate, today: IsoDate): string {
  return date.slice(0, 4) === today.slice(0, 4) ? dayText(date) : dateText(date);
}
