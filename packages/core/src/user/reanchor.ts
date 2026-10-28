import { isoDateSchema } from '../catalog/formats';
import type { IsoDate } from '../dates/iso-date';
import { keptBillingDay } from './item-form';
import type { Billing } from './list-item';

// "Wrong date?" (P4, P10, PROJECT-PLAN §3.1): an item's next charge moved for good (a payment that went through late,
// a plan change, app-store billing), so the date the user gives becomes its anchor and every later charge follows it.
// It's saved straight to the item, like pinning.

type Recurring = Extract<Billing, { mode: 'recurring' }>;

/**
 * `billing` with `date` as its anchor. Its billing day stays while the new date still allows it (Nov 30 for a plan
 * billed on the 31st), and goes otherwise (Nov 29).
 */
export function reanchored(billing: Recurring, date: IsoDate): Recurring {
  const billingDay = keptBillingDay(date, billing, billing.billingDay);
  const changed: Recurring = { ...billing, anchorDate: date };
  delete changed.billingDay;
  return billingDay === undefined ? changed : { ...changed, billingDay };
}

/**
 * What's wrong with `date` as the item's next charge, or undefined when nothing is: it's a date, today or later, on or
 * after the day it started and before the day it ends, so the charge it moves is one the item has.
 */
export function reanchorIssue(
  billing: Recurring,
  date: string | null,
  today: IsoDate,
): string | undefined {
  if (date === null || !isoDateSchema.safeParse(date).success) return 'Enter a date, as YYYY-MM-DD';
  if (date < today) return 'Pick today or a later date';
  if (billing.startDate !== undefined && date < billing.startDate) {
    return 'Pick a date from the day it started';
  }
  if (billing.endDate !== undefined && date >= billing.endDate) return 'Pick a date before it ends';
  return undefined;
}
