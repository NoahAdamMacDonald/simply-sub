import type { Billing, Charge, Interval, IsoDate, ResolvedAddOn } from '@simply-sub/core';
import { nearDateText } from './charge-text';
import { dateText } from './date-text';

// How an item is billed, in words: the list editor's rows (P5), the item dialog's periods (P6) and List view's cards
// (P4), with its renewal date from its next charge (M7.1).

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

/**
 * When an item renews, from its next charge (P5's rows): "Renews Nov 12 · auto", "Renews Nov 3 · manual · ends Mar 1,
 * 2027", or "Specific dates · next charge Sep 2". With no charge to come: "Ended Oct 1, 2026", or "Specific dates ·
 * none to come".
 */
export function renewalText(billing: Billing, next: Charge | undefined, today: IsoDate): string {
  if (billing.mode === 'limited') {
    return next
      ? `Specific dates · next charge ${nearDateText(next.date, today)}`
      : 'Specific dates · none to come';
  }
  if (!next) {
    return billing.endDate !== undefined && billing.endDate <= today
      ? `Ended ${dateText(billing.endDate)}`
      : billingText(billing);
  }
  return [
    `Renews ${nearDateText(next.date, today)}`,
    next.manual ? 'manual' : 'auto',
    ...(billing.endDate === undefined ? [] : [`ends ${dateText(billing.endDate)}`]),
  ].join(' · ');
}

/** "Extra member", or "Extra member × 2". */
export function addOnText({ name, quantity }: ResolvedAddOn): string {
  return quantity === 1 ? name : `${name} × ${quantity}`;
}
