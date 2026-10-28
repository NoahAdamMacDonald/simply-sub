import { addDays, addMonths, daysBetween, type IsoDate } from '../dates/iso-date';
import { addPeriods, type Period } from '../dates/period';
import type { Billing } from '../user/list-item';

// When a list item is charged (PROJECT-PLAN §3.1), dates only: charges.ts prices them. Every date is counted from a
// fixed point, the anchor or a window's start, never from the charge before it, so dates don't drift.

/** From `from`, up to but not including `to`. */
export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

type Recurring = Extract<Billing, { mode: 'recurring' }>;
type Limited = Extract<Billing, { mode: 'limited' }>;
type Window = Limited['windows'][number];

/**
 * The dates `billing` charges on within `range`, in order, billed every `period`: the item's own, or an add-on's when
 * it's billed on a period of its own (Disney+'s monthly extra member on a yearly plan).
 * - Ongoing: the anchor plus or minus whole periods, on or after `startDate` and before `endDate`. Months and years
 *   fall on the anchor's day, or `billingDay` when it has one, and on a shorter month's last day: Jan 31 gives Feb 28,
 *   Mar 31. Days and weeks are plain counts.
 * - Specific dates: each window's start, then every period while the date is before the window's end. A window that
 *   repeats yearly is copied into each later year.
 */
export function chargeDates(
  billing: Billing,
  range: DateRange,
  period: Period = billing,
): IsoDate[] {
  if (range.to <= range.from) return [];
  return billing.mode === 'recurring'
    ? recurringDates(billing, range, period)
    : limitedDates(billing, range, period);
}

/**
 * The first date `billing` charges on, on or after `date`, billed every `period`; undefined when there's none (its end
 * date or its last window has passed).
 */
export function nextChargeDate(
  billing: Billing,
  date: IsoDate,
  period: Period = billing,
): IsoDate | undefined {
  if (billing.mode === 'recurring') {
    return recurringDates(billing, { from: date, to: '9999-12-31' }, period, 1)[0];
  }
  // A window that repeats yearly comes round within a year; one that doesn't can be years away.
  const last = billing.windows.some((window) => window.repeatYearly)
    ? addMonths(date, 24)
    : billing.windows.reduce((latest, window) => (window.end > latest ? window.end : latest), date);
  return limitedDates(billing, { from: date, to: addDays(last, 1) }, period, 1)[0];
}

/**
 * The last date `billing` charges on before its end date (P10's "Ends" marks it); undefined without an end date, or
 * with no charge before it.
 */
export function lastChargeDate(billing: Billing, period: Period = billing): IsoDate | undefined {
  if (billing.mode !== 'recurring' || billing.endDate === undefined) return undefined;
  const dates = recurringDates(
    billing,
    { from: addPeriods(billing.endDate, period, -1), to: billing.endDate },
    period,
  );
  return dates.at(-1);
}

/** The ongoing dates in `range`, at most `limit` of them. */
function recurringDates(
  billing: Recurring,
  range: DateRange,
  period: Period,
  limit = Infinity,
): IsoDate[] {
  const { anchorDate, startDate, endDate } = billing;
  const from = startDate !== undefined && startDate > range.from ? startDate : range.from;
  const to = endDate !== undefined && endDate < range.to ? endDate : range.to;
  const at = (k: number) => anchored(billing, period, k);
  // The first k on or after `from`: estimated, then stepped to the edge, since the dates only go up with k.
  let k = firstPeriod(anchorDate, from, period);
  while (at(k) < from) k++;
  while (at(k - 1) >= from) k--;
  const dates: IsoDate[] = [];
  for (let date = at(k); date < to && dates.length < limit; date = at(++k)) dates.push(date);
  return dates;
}

/** The anchor plus `k` periods, on the billing day for months and years. */
function anchored(billing: Recurring, { interval, intervalCount }: Period, k: number): IsoDate {
  const day = billing.billingDay;
  switch (interval) {
    case 'day':
    case 'week':
      return addPeriods(billing.anchorDate, { interval, intervalCount }, k);
    case 'month':
      return addMonths(billing.anchorDate, k * intervalCount, day);
    case 'year':
      return addMonths(billing.anchorDate, 12 * k * intervalCount, day);
  }
}

/** About how many periods `date` is after `anchor`: within one of the first one on or after it. */
function firstPeriod(anchor: IsoDate, date: IsoDate, { interval, intervalCount }: Period): number {
  if (interval === 'day' || interval === 'week') {
    const step = (interval === 'week' ? 7 : 1) * intervalCount;
    return Math.ceil(daysBetween(anchor, date) / step);
  }
  const months =
    (Number(date.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 +
    Number(date.slice(5, 7)) -
    Number(anchor.slice(5, 7));
  return Math.floor(months / ((interval === 'year' ? 12 : 1) * intervalCount));
}

/** The dates of Specific dates' windows in `range`, in order, at most `limit` of them. */
function limitedDates(
  billing: Limited,
  range: DateRange,
  period: Period,
  limit = Infinity,
): IsoDate[] {
  const dates: IsoDate[] = [];
  for (const window of copiesIn(billing.windows, range)) {
    for (let j = 0; ; j++) {
      const date = addPeriods(window.start, period, j);
      if (date >= window.end || date >= range.to) break;
      if (date >= range.from) dates.push(date);
    }
  }
  return dates.sort().slice(0, limit);
}

/**
 * The windows that can have a date in `range`: each one, and for one that repeats yearly its copies from the year
 * before `range` (a window across New Year) to the year it ends, never one before the window itself. A copy of Feb 29
 * falls on Feb 28, as addMonths has it.
 */
function copiesIn(windows: readonly Window[], range: DateRange): Pick<Window, 'start' | 'end'>[] {
  const fromYear = Number(range.from.slice(0, 4));
  const toYear = Number(range.to.slice(0, 4));
  return windows.flatMap((window) => {
    if (!window.repeatYearly)
      return window.end > range.from && window.start < range.to ? [window] : [];
    const startYear = Number(window.start.slice(0, 4));
    const copies = [];
    for (let years = Math.max(0, fromYear - startYear - 1); startYear + years <= toYear; years++) {
      copies.push({
        start: addMonths(window.start, 12 * years),
        end: addMonths(window.end, 12 * years),
      });
    }
    return copies.filter((copy) => copy.end > range.from && copy.start < range.to);
  });
}
