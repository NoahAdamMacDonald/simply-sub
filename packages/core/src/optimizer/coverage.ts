import { addDays, addMonths, type IsoDate } from '../dates/iso-date';
import type { Billing } from '../user/list-item';

// The optimizer's month-by-month coverage map (BLUEPRINT §10.1): the next 12 months as 12 slots, each a month long
// from today (Oct 28 to Nov 28, …), and for an item a bit per slot it's active in. A limited-timeframe item counts
// only in the months it's active, so a Needed feature it gives in Sep–Oct is checked in those slots alone.

/** How many slots the map has: the next 12 months (PROJECT-PLAN §3.1). */
export const coverageSlots = 12;

/** Every slot's bit. */
export const allSlots = (1 << coverageSlots) - 1;

/** The 13 dates that bound the slots: today, then a month later each, up to the same day next year. */
export function slotBounds(today: IsoDate): IsoDate[] {
  return Array.from({ length: coverageSlots + 1 }, (_, slot) => addMonths(today, slot));
}

/** The slot `date` falls in: 0 for today's, up to 11; 12 for a date from a year from today on. */
export function slotOf(date: IsoDate, bounds: readonly IsoDate[]): number {
  let slot = 0;
  while (slot < coverageSlots && date >= bounds[slot + 1]) slot++;
  return slot;
}

/** The bits of the slots from `slot` on. */
export function slotsFrom(slot: number): number {
  return slot >= coverageSlots ? 0 : allSlots & ~((1 << slot) - 1);
}

/** The bits of the slots before `slot`. */
export function slotsBefore(slot: number): number {
  return allSlots & ~slotsFrom(slot);
}

/**
 * The slots `billing` is active in (PROJECT-PLAN §3.3): an Ongoing item from its start date, if any, until its end
 * date; Specific dates from each window's start through its end, a window that repeats yearly copied into each year.
 */
export function activeSlots(billing: Billing, bounds: readonly IsoDate[]): number {
  if (billing.mode === 'recurring') {
    return rangeSlots(billing.startDate, billing.endDate, bounds);
  }
  const first = Number(bounds[0].slice(0, 4));
  const last = Number(bounds[coverageSlots].slice(0, 4));
  let mask = 0;
  for (const window of billing.windows) {
    const year = Number(window.start.slice(0, 4));
    const copies = window.repeatYearly
      ? range(Math.max(0, first - year - 1), last - year + 1)
      : [0];
    for (const years of copies) {
      const start = addMonths(window.start, 12 * years);
      // Active through the end, so up to the day after it.
      const end = addDays(addMonths(window.end, 12 * years), 1);
      mask |= rangeSlots(start, end, bounds);
    }
  }
  return mask;
}

/** The slots that `from` (included) up to `to` (not) overlaps; either end left out is open. */
function rangeSlots(
  from: IsoDate | undefined,
  to: IsoDate | undefined,
  bounds: readonly IsoDate[],
): number {
  let mask = 0;
  for (let slot = 0; slot < coverageSlots; slot++) {
    const starts = from === undefined || from < bounds[slot + 1];
    const ends = to === undefined || to > bounds[slot];
    if (starts && ends) mask |= 1 << slot;
  }
  return mask;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}
