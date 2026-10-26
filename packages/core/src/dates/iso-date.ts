/** A calendar date, 'YYYY-MM-DD': how dates are stored and passed around (BLUEPRINT §13.2). */
export type IsoDate = string;

/**
 * The calendar date that `date` falls on in the device's time zone. Not `date.toISOString()`,
 * which gives the UTC date: on a Canadian evening that's already tomorrow.
 */
export function toIsoDate(date: Date): IsoDate {
  return formatUtc(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** `date` plus `days`; negative `days` go back. Throws a RangeError if `date` isn't a real date. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parse(date);
  // Date.UTC carries an overflowing day into the next month or year, and UTC has no daylight
  // saving, so every day is exactly one day long.
  return formatUtc(Date.UTC(year, month - 1, day + days));
}

/**
 * `date` plus `months`, on the same day of the month, or on the month's last day when it's shorter: Jan 31 plus a
 * month is Feb 28 (29 in a leap year), as Netflix and Stripe bill (PROJECT-PLAN §3.1). Negative `months` go back.
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = parse(date);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return formatUtc(Date.UTC(year, month - 1 + months, Math.min(day, lastDay)));
}

/** The day of the week, from 0 for Sunday to 6 for Saturday. */
export function weekdayOf(date: IsoDate): number {
  const { year, month, day } = parse(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function parse(date: IsoDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number);
    // Date.UTC rolls Feb 30 over into March, so a real date is one that formats back unchanged.
    if (formatUtc(Date.UTC(year, month - 1, day)) === date) return { year, month, day };
  }
  throw new RangeError(`Not a calendar date in YYYY-MM-DD form: '${date}'`);
}

/** The date part of a UTC timestamp. */
function formatUtc(time: number): IsoDate {
  return new Date(time).toISOString().slice(0, 10);
}
