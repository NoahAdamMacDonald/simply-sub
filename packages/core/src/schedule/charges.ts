import type { PickedPrice } from '../catalog/pick-price';
import { addDays, type IsoDate } from '../dates/iso-date';
import { salesTaxOn } from '../tax/charge-tax';
import { buyerTaxPlace, type TaxPlace } from '../tax/sales-tax-rate';
import { samePeriod, type Period } from '../dates/period';
import type { ResolvedItem } from '../user/resolved';
import { chargeDates, lastChargeDate, nextChargeDate, type DateRange } from './charge-dates';

// An item's charges (PROJECT-PLAN §3.1): its charge dates (charge-dates.ts) priced, with sales tax. The calendar, every
// total, the budget checks and the exports are built from them.

/** One scheduled payment. */
export interface Charge {
  date: IsoDate;
  /** What leaves the account, sales tax included, in `currency`, at full precision. */
  amount: number;
  /** The sales tax part of `amount`. */
  tax: number;
  /** The user's currency, or a price's own when there was no rate to convert it. */
  currency: string;
  itemId: string;
  listId: string;
  /** It includes a price converted from another currency, so it's shown with ≈. */
  converted: boolean;
  /** Renewed by hand: the calendar says "Renew manually" (`autoRenew: false`, or a prepaid plan's dates). */
  manual: boolean;
  /** The last charge before the item's end date: the calendar marks it "Ends" (P10). */
  ends?: true;
}

/** What an item's charges need: its record, its prices for its period, and its price override's. */
export type Chargeable = Pick<
  ResolvedItem,
  'item' | 'listId' | 'price' | 'addOns' | 'overridePrice'
>;

/** A price in a charge, `count` times. */
interface Part {
  price: PickedPrice;
  count: number;
}

/**
 * The item's charges dated within `range`, in date order, for a buyer at `place` (Settings' country, province and
 * rate; an item bought in another region follows that region's rule, buyerTaxPlace). On each charge date the item
 * costs its price override, while the date is before the override's `until`, else its price plus each add-on ×
 * its quantity. An add-on sold only for another period is charged on that period's dates, from the same anchor or
 * window (Disney+'s monthly extra member on a yearly plan). A charge that comes to 0 (a free plan) isn't one.
 */
export function itemCharges(resolved: Chargeable, range: DateRange, place: TaxPlace): Charge[] {
  const { item } = resolved;
  const { billing } = item;
  const overridden = overrideTest(resolved);
  const together = resolved.addOns.filter((addOn) => samePeriod(addOn.price, billing));
  const separate = resolved.addOns.filter((addOn) => !samePeriod(addOn.price, billing));
  const byDate = new Map<IsoDate, Part[]>();
  const add = (date: IsoDate, part: Part) => byDate.set(date, [...(byDate.get(date) ?? []), part]);
  for (const date of chargeDates(billing, range)) {
    if (overridden(date) && resolved.overridePrice) {
      add(date, { price: resolved.overridePrice, count: 1 });
      continue;
    }
    add(date, { price: resolved.price, count: 1 });
    for (const addOn of together) add(date, { price: addOn.price, count: addOn.quantity });
  }
  for (const addOn of separate) {
    for (const date of chargeDates(billing, range, addOn.price)) {
      if (!overridden(date)) add(date, { price: addOn.price, count: addOn.quantity });
    }
  }

  const taxPlace = buyerTaxPlace(place, item.region);
  const manual = billing.mode === 'recurring' ? !billing.autoRenew : !resolved.price.autoRenew;
  const last = [
    lastChargeDate(billing),
    ...separate.map((addOn) => lastChargeDate(billing, addOn.price)),
  ]
    .filter((date) => date !== undefined)
    .sort()
    .at(-1);
  const charges: Charge[] = [];
  for (const date of [...byDate.keys()].sort()) {
    // A price with no rate to convert it stays in its own currency, so a date can have a charge in each.
    const byCurrency = new Map<string, { amount: number; tax: number; converted: boolean }>();
    for (const { price, count } of byDate.get(date) ?? []) {
      const amount = price.amount * count;
      if (amount === 0) continue;
      const sum = byCurrency.get(price.currency) ?? { amount: 0, tax: 0, converted: false };
      const tax = salesTaxOn(amount, price, taxPlace);
      byCurrency.set(price.currency, {
        amount: sum.amount + amount + tax,
        tax: sum.tax + tax,
        converted: sum.converted || price.fx !== undefined,
      });
    }
    for (const [currency, { amount, tax, converted }] of byCurrency) {
      charges.push({
        date,
        amount,
        tax,
        currency,
        itemId: item.id,
        listId: resolved.listId,
        converted,
        manual,
        ...(date === last && { ends: true as const }),
      });
    }
  }
  return charges;
}

/**
 * The item's next charge: its first on or after `today`. Undefined when it has none to come: a free plan, an end date
 * passed, or no window left.
 *
 * An Ongoing item's anchor that's still to come is its next renewal, as the item dialog asks for it, so its own next
 * charge is on or after it: one counted back from it onto today is the payment just made (a plan subscribed to today,
 * renewing in a month), which totals count and the calendar shows, but which isn't "next". An add-on billed on a
 * period of its own still charges before it.
 */
export function nextCharge(
  resolved: Chargeable,
  today: IsoDate,
  place: TaxPlace,
): Charge | undefined {
  const { billing } = resolved.item;
  const prices = [resolved.price, ...resolved.addOns.map((addOn) => addOn.price)];
  if (resolved.overridePrice === undefined && prices.every((price) => price.amount === 0)) {
    return undefined;
  }
  const renewal =
    billing.mode === 'recurring' && billing.anchorDate > today ? billing.anchorDate : today;
  const periods: { period: Period; from: IsoDate }[] = [
    { period: billing, from: renewal },
    ...resolved.addOns
      .filter((addOn) => !samePeriod(addOn.price, billing))
      .map((addOn) => ({ period: addOn.price, from: today })),
  ];
  let from = today;
  // A date can come to 0, a free plan's once its price override has ended: look on to the next. 24 dates is ample.
  for (let tries = 0; tries < 24; tries++) {
    const dates = periods
      .map((own) => nextChargeDate(billing, own.from > from ? own.from : from, own.period))
      .filter(isDate);
    if (dates.length === 0) return undefined;
    const date = dates.sort()[0];
    const [charge] = itemCharges(resolved, { from: date, to: addDays(date, 1) }, place);
    if (charge) return charge;
    from = addDays(date, 1);
  }
  return undefined;
}

/** Whether a charge on a date costs the item's price override: it has one, and the date is before its `until`. */
function overrideTest({ item, overridePrice }: Chargeable): (date: IsoDate) => boolean {
  const until = item.priceOverride?.until;
  return (date) => overridePrice !== undefined && (until === undefined || date < until);
}

function isDate(date: IsoDate | undefined): date is IsoDate {
  return date !== undefined;
}
