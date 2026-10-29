import type { IsoDate } from '../dates/iso-date';
import type { IsoMonth } from '../dates/iso-month';
import type { Charge } from './charges';
import { chargeTotal, type ChargeTotal } from './list-metrics';

// The Calendar's year view (PROJECT-PLAN P10, M10.4): a year's payments by month, and its bar, what's been paid so far
// of the year's total (§3.1's This year, for this year).

/** A month of the year view. */
export interface MonthSummary {
  month: IsoMonth;
  total: ChargeTotal;
  /** How many payments it has. */
  count: number;
  /** The days with a payment, in order. */
  days: IsoDate[];
}

export interface YearSummary {
  /** Every payment of the year, in the user's currency. */
  total: ChargeTotal;
  /** What's been paid so far: all of a past year, none of a future one, up to `today` in this one. */
  spent: number;
  /** January to December. */
  months: MonthSummary[];
}

/** `year`'s (YYYY) summary of `charges`, the charges of the year, in `currency` (chargeTotal's), as of `today`. */
export function yearSummary(
  charges: readonly Charge[],
  year: string,
  today: IsoDate,
  currency: string,
): YearSummary {
  const ofYear = charges.filter((charge) => charge.date.startsWith(`${year}-`));
  const total = chargeTotal(ofYear, currency);
  const thisYear = today.slice(0, 4);
  const spent =
    year < thisYear
      ? total.amount
      : year > thisYear
        ? 0
        : chargeTotal(
            ofYear.filter((charge) => charge.date <= today),
            currency,
          ).amount;
  return {
    total,
    spent,
    months: Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      const inMonth = ofYear.filter((charge) => charge.date.startsWith(`${month}-`));
      return {
        month,
        total: chargeTotal(inMonth, currency),
        count: inMonth.length,
        days: [...new Set(inMonth.map((charge) => charge.date))].sort(),
      };
    }),
  };
}
