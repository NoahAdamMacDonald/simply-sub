import { addMonths, type IsoDate } from '../dates/iso-date';
import type { ListItem } from './list-item';
import type { ItemStatus } from './resolved';

// Whether a list item is active today (PROJECT-PLAN §3.3), from its billing dates alone. Search's status line and
// activity filter use it (M5.1); M7.1's schedule engine adds what needs charges (ending soon, a manual renewal) to
// make ItemStatus.

/** Active or inactive today, and when an inactive item starts again. */
export type ItemActivity = Pick<ItemStatus, 'kind' | 'activeFrom'>;

type BillingWindow = Extract<ListItem['billing'], { mode: 'limited' }>['windows'][number];

/**
 * Ongoing billing is active from its start date, if any, until its end date, the first day without it. Specific
 * dates are active from a window's start through its end, both included, and a window that repeats yearly is copied
 * into each later year (on Feb 28 for Feb 29, like addMonths). An inactive item's activeFrom is its start date or
 * its next window, when there's one.
 */
export function itemActivity({ billing }: ListItem, today: IsoDate): ItemActivity {
  if (billing.mode === 'recurring') {
    const { startDate, endDate } = billing;
    if (startDate !== undefined && today < startDate) {
      return { kind: 'inactive', activeFrom: startDate };
    }
    return endDate === undefined || today < endDate ? { kind: 'active' } : { kind: 'inactive' };
  }
  let activeFrom: IsoDate | undefined;
  for (const { start, end } of billing.windows.flatMap((window) => copies(window, today))) {
    if (start <= today && today <= end) {
      return { kind: 'active' };
    }
    if (start > today && (activeFrom === undefined || start < activeFrom)) {
      activeFrom = start;
    }
  }
  return { kind: 'inactive', ...(activeFrom !== undefined && { activeFrom }) };
}

/**
 * The window, or for one that repeats yearly, the copies that can hold today or come next: last year's (a window
 * across New Year), this year's and next year's, never one before the window itself.
 */
function copies(window: BillingWindow, today: IsoDate): Pick<BillingWindow, 'start' | 'end'>[] {
  if (!window.repeatYearly) {
    return [window];
  }
  const first = Math.max(0, Number(today.slice(0, 4)) - Number(window.start.slice(0, 4)) - 1);
  return [first, first + 1, first + 2].map((years) => ({
    start: addMonths(window.start, 12 * years),
    end: addMonths(window.end, 12 * years),
  }));
}
