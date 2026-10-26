import { addDays, weekdayOf, type IsoDate } from './iso-date';

/** A calendar month, 'YYYY-MM': the Calendar's `?month=` and the mini calendar's month. */
export type IsoMonth = string;

/** The month `date` falls in. */
export function monthOf(date: IsoDate): IsoMonth {
  addDays(date, 0); // throws a RangeError for a date that isn't real
  return date.slice(0, 7);
}

/** `month` plus `months`; negative `months` go back. Throws a RangeError if `month` isn't a real month. */
export function addMonthsToMonth(month: IsoMonth, months: number): IsoMonth {
  const { year, index } = parseMonth(month);
  const shifted = new Date(Date.UTC(year, index + months, 1));
  return shifted.toISOString().slice(0, 7);
}

/**
 * The month as weeks from Sunday to Saturday, as calendars in Canada and the US show it: each week has 7 days, and
 * the days before the 1st and after the last day are null.
 */
export function monthWeeks(month: IsoMonth): (IsoDate | null)[][] {
  const { year, index } = parseMonth(month);
  const first = `${month}-01`;
  const lead = weekdayOf(first);
  const length = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  const days: (IsoDate | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length }, (_, day) => addDays(first, day)),
  ];
  days.push(...Array<null>((7 - (days.length % 7)) % 7).fill(null));
  return Array.from({ length: days.length / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7));
}

function parseMonth(month: IsoMonth): { year: number; index: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new RangeError(`Not a month in YYYY-MM form: '${month}'`);
  return { year: Number(match[1]), index: Number(match[2]) - 1 };
}
