import type { IsoDate, IsoMonth } from '@simply-sub/core';

// How the app writes calendar dates, in English like the rest of its text (as core/catalog/catalog-dates.ts does).
// An IsoDate is a day rather than a moment, so it's formatted in UTC, where the device's time zone can't move it.

const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const date = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const spokenDay = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});
const month = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Nov 3": a date within the next few weeks. */
export function dayText(iso: IsoDate): string {
  return day.format(utc(iso));
}

/** "Sep 10, 2026". */
export function dateText(iso: IsoDate): string {
  return date.format(utc(iso));
}

/** "Saturday, October 3": a calendar day's name for screen readers. */
export function spokenDayText(iso: IsoDate): string {
  return spokenDay.format(utc(iso));
}

/** "October 2026". */
export function monthText(iso: IsoMonth): string {
  return month.format(utc(`${iso}-01`));
}

function utc(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** ", joins Nov 20" for an add-on that joins on a later day (an extra member Optimizations added, M8.5); else ''. */
export function joinsText(addOn: { since?: IsoDate }, today: IsoDate): string {
  return addOn.since !== undefined && addOn.since > today ? `, joins ${dayText(addOn.since)}` : '';
}
