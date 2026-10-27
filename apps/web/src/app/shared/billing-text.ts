import type { Billing, Interval, ResolvedAddOn } from '@simply-sub/core';
import { dateText } from './date-text';

// How an item is billed, in words: the list editor's rows (P5), the item dialog's periods (P6) and List view's cards
// (P4). Its renewal date ("Renews Nov 12") comes with the charges (M7.1).

/** How often a period bills, in words: monthly, every 3 months, every 30 days. */
export function periodText(interval: Interval, count: number): string {
  if (count === 1) {
    return { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[interval];
  }
  return `every ${count} ${interval}s`;
}

/** "Monthly · auto-renews", "Yearly · renews manually · ends Nov 3, 2027", "Specific dates, billed monthly". */
export function billingText(billing: Billing): string {
  const period = periodText(billing.interval, billing.intervalCount);
  if (billing.mode === 'limited') return `Specific dates, billed ${period}`;
  return [
    period[0].toUpperCase() + period.slice(1),
    billing.autoRenew ? 'auto-renews' : 'renews manually',
    ...(billing.endDate === undefined ? [] : [`ends ${dateText(billing.endDate)}`]),
  ].join(' · ');
}

/** "Extra member", or "Extra member × 2". */
export function addOnText({ name, quantity }: ResolvedAddOn): string {
  return quantity === 1 ? name : `${name} × ${quantity}`;
}
