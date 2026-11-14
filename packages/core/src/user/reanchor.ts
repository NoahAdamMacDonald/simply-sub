import { isoDateSchema } from '../catalog/formats';
import { addDays, type IsoDate } from '../dates/iso-date';
import type { Period } from '../dates/period';
import { keptBillingDay } from './item-form';
import type { Billing } from './list-item';

// "Wrong date?" (P4, P10, PROJECT-PLAN §3.1): an item's next charge moved for good (a payment that went through late,
// a plan change, app-store billing), so the date the user gives becomes its anchor and every later charge follows it.
// It's saved straight to the item, like pinning. A charge that comes days before its renewal (M11.21) anchors the
// renewal it pays for, as many days after it.

type Recurring = Extract<Billing, { mode: 'recurring' }>;

/**
 * `billing` charged on `date`, which becomes its anchor, or the renewal it pays for when it's charged `chargeDaysBefore`
 * days early (M11.21). Its billing day stays while the new date still allows it (Nov 30 for a plan billed on the
 * 31st), and goes otherwise (Nov 29).
 */
export function reanchored(billing: Recurring, date: IsoDate): Recurring {
  const renewal = addDays(date, billing.chargeDaysBefore ?? 0);
  const billingDay = keptBillingDay(renewal, billing, billing.billingDay);
  const changed: Recurring = { ...billing, anchorDate: renewal };
  delete changed.billingDay;
  return billingDay === undefined ? changed : { ...changed, billingDay };
}

/**
 * Ongoing `billing` on another period from its charge `on` (M10.28, M8.5), which it's anchored on: charged early only
 * while it's still yearly (M11.21).
 */
export function reperiodedBilling(billing: Recurring, period: Period, on: IsoDate): Recurring {
  const { interval, intervalCount } = period;
  const changed: Recurring = { ...billing, interval, intervalCount };
  if (interval !== 'year') delete changed.chargeDaysBefore;
  return reanchored(changed, on);
}

/**
 * `billing` on another period from the renewal charged `on` (M10.28: a period the provider no longer sells,
 * switched): a recurring item is billed every `period` from `on`, which becomes its anchor; a limited one keeps its
 * windows.
 */
export function switchedBilling(billing: Billing, period: Period, on: IsoDate): Billing {
  const { interval, intervalCount } = period;
  return billing.mode === 'recurring'
    ? reperiodedBilling(billing, period, on)
    : { ...billing, interval, intervalCount };
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
  // The renewal it pays for must come before it ends.
  const renewal = addDays(date, billing.chargeDaysBefore ?? 0);
  if (billing.endDate !== undefined && renewal >= billing.endDate)
    return 'Pick a date before it ends';
  return undefined;
}
