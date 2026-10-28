import type { Interval } from '../catalog/price';
import { addDays, addMonths, type IsoDate } from './iso-date';

// Billing periods (PROJECT-PLAN §3.1): the item dialog's choices (user/item-form.ts) and the schedule engine's dates
// (schedule/). A file of its own, so the schedule doesn't load the item dialog's rules.

/** A billing period: an interval, and how many of them one payment covers (3 months). */
export interface Period {
  interval: Interval;
  intervalCount: number;
}

/** Whether two periods are the same: monthly isn't every 2 months. */
export function samePeriod(a: Period, b: Period): boolean {
  return a.interval === b.interval && a.intervalCount === b.intervalCount;
}

/** `date` plus `count` periods. Months and years land on the same day, or the month's last day when it's shorter. */
export function addPeriods(date: IsoDate, period: Period, count = 1): IsoDate {
  const n = period.intervalCount * count;
  switch (period.interval) {
    case 'day':
      return addDays(date, n);
    case 'week':
      return addDays(date, 7 * n);
    case 'month':
      return addMonths(date, n);
    case 'year':
      return addMonths(date, 12 * n);
  }
}
