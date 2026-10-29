import {
  periodText,
  type Billing,
  type Charge,
  type IsoDate,
  type PriceOverride,
} from '@simply-sub/core';
import { nearDateText } from './charge-text';
import { dateText } from './date-text';
import { amountText, intervalSpoken } from './price-tag/price-text';

// How an item is billed, in words: the list editor's rows (P5) and List view's cards (P4), with its renewal date from
// its next charge (M7.1). The period's words are core's periodText, as the exports write them.

/**
 * "Monthly · auto-renews", "Yearly · renews manually until Nov 3, 2027" (an end date is when it stops renewing, M6.19),
 * "Specific dates, billed monthly".
 */
export function billingText(billing: Billing): string {
  const period = periodText(billing.interval, billing.intervalCount);
  if (billing.mode === 'limited') return `Specific dates, billed ${period}`;
  const renews = billing.autoRenew ? 'auto-renews' : 'renews manually';
  return [
    period[0].toUpperCase() + period.slice(1),
    billing.endDate === undefined ? renews : `${renews} until ${dateText(billing.endDate)}`,
  ].join(' · ');
}

/**
 * When an item renews, from its next charge (P5's rows): "Renews Nov 12 · auto", "Renews Nov 3 · manual, then ends Mar
 * 1, 2027", or "Specific dates · next charge Sep 2". With no charge to come: "Ends Mar 1, 2027", "Ended Oct 1, 2026",
 * or "Specific dates · none to come".
 */
export function renewalText(billing: Billing, next: Charge | undefined, today: IsoDate): string {
  if (billing.mode === 'limited') {
    return next
      ? `Specific dates · next charge ${nearDateText(next.date, today)}`
      : 'Specific dates · none to come';
  }
  if (!next) {
    if (billing.endDate === undefined) return billingText(billing);
    return billing.endDate <= today
      ? `Ended ${dateText(billing.endDate)}`
      : `Ends ${dateText(billing.endDate)}`;
  }
  const how = next.manual ? 'manual' : 'auto';
  return [
    `Renews ${nearDateText(next.date, today)}`,
    billing.endDate === undefined ? how : `${how}, then ends ${dateText(billing.endDate)}`,
  ].join(' · ');
}

/**
 * The user's own price, while it applies or while it's still to come (M9.6), when the price shown is the catalog's:
 * "Your own price", "Your own price until Feb 12, 2027", "Your own price from Nov 12: US$9.99 a month + tax". Nothing
 * once it has ended.
 */
export function ownPriceText(
  own: PriceOverride | undefined,
  billing: Billing,
  today: IsoDate,
  country: string | undefined,
): string | undefined {
  if (!own || (own.until !== undefined && own.until <= today)) return undefined;
  const until = own.until === undefined ? '' : ` until ${dateText(own.until)}`;
  if (own.since === undefined || own.since <= today) return `Your own price${until}`;
  const amount = `${amountText(own.amount, own.currency, country)} ${intervalSpoken(billing.interval, billing.intervalCount)}`;
  return `Your own price from ${dateText(own.since)}${until}: ${amount}${own.plusTax ? ' + tax' : ''}`;
}
