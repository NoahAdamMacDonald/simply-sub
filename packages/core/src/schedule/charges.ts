import type { PickedPrice } from '../catalog/pick-price';
import { addDays, type IsoDate } from '../dates/iso-date';
import { salesTaxOn } from '../tax/charge-tax';
import { buyerTaxPlace, type TaxPlace } from '../tax/sales-tax-rate';
import { samePeriod, type Period } from '../dates/period';
import type { ListItem, PriceOverride } from '../user/list-item';
import { switchedBilling } from '../user/reanchor';
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
  /**
   * What the provider charges, sales tax included, in the currency it charges: its prices' own (pickPrice's, or a
   * price override's), before any conversion. A payment card's FX fee and cash back are worked on it (BLUEPRINT §9.3).
   */
  charged: Charged;
}

/** An amount in the currency the provider charges it in. */
export interface Charged {
  amount: number;
  currency: string;
}

/** What one charge costs: an item's (periodCost), or a part of a date's charges in one currency. */
export type ChargeCost = Pick<Charge, 'amount' | 'tax' | 'currency' | 'converted' | 'charged'>;

/**
 * What an item's charges need: its record, its prices for its period, its price override's, and the day its plan ends
 * for its subscribers, if it does.
 */
export type Chargeable = Pick<
  ResolvedItem,
  'item' | 'listId' | 'price' | 'addOns' | 'overridePrice' | 'planEnds' | 'periodChange'
>;

/**
 * An item whose billing period isn't sold any more (M10.28), as two: on its period until the renewal it switches on,
 * and on the period it switches to from then, at that price (its own price was for the old period). Undefined when
 * there's no switch: none, or no period left to switch to.
 */
function switchParts(resolved: Chargeable): { before: Chargeable; after: Chargeable } | undefined {
  const change = resolved.periodChange;
  if (!change?.to) return undefined;
  const rest: Chargeable = { ...resolved };
  delete rest.periodChange;
  return {
    before: { ...rest, planEnds: change.on },
    after: {
      ...rest,
      price: change.to,
      overridePrice: undefined,
      item: { ...rest.item, billing: switchedBilling(rest.item.billing, change.to, change.on) },
    },
  };
}

/** `charges` without "Ends": the item goes on, on another period. */
function goingOn(charges: readonly Charge[]): Charge[] {
  return charges.map((charge) => {
    const going = { ...charge };
    delete going.ends;
    return going;
  });
}

/**
 * The item as its charges and status see it: a plan that ends for its subscribers (its `endsOn`, M10.27) ends a
 * recurring item that day, as an end date would, unless it ends sooner. A limited item's charges stop then too
 * (itemCharges).
 */
export function chargedItem({ item, planEnds }: Pick<Chargeable, 'item' | 'planEnds'>): ListItem {
  const { billing } = item;
  if (planEnds === undefined || billing.mode !== 'recurring') return item;
  if (billing.endDate !== undefined && billing.endDate <= planEnds) return item;
  return { ...item, billing: { ...billing, endDate: planEnds } };
}

/** A price in a charge, `count` times. */
interface Part {
  price: PickedPrice;
  count: number;
}

/**
 * The item's charges dated within `range`, in date order, for a buyer at `place` (Settings' country, province and
 * rate; an item bought in another region follows that region's rule, buyerTaxPlace). On each charge date the item
 * costs its price override, while the date is from the override's `since` and before its `until`, else its price plus
 * each add-on × its quantity. An add-on sold only for another period is charged on that period's dates, from the same anchor or
 * window (Disney+'s monthly extra member on a yearly plan). A charge that comes to 0 (a free plan) isn't one.
 */
export function itemCharges(resolved: Chargeable, range: DateRange, place: TaxPlace): Charge[] {
  const parts = switchParts(resolved);
  if (parts) {
    return [
      ...goingOn(itemCharges(parts.before, range, place)),
      ...itemCharges(parts.after, range, place),
    ];
  }
  const item = chargedItem(resolved);
  const { billing } = item;
  const { planEnds } = resolved;
  const overridden = overrideTest(resolved);
  const separate = resolved.addOns.filter((addOn) => !samePeriod(addOn.price, billing));
  const byDate = new Map<IsoDate, Part[]>();
  const add = (date: IsoDate, part: Part) => byDate.set(date, [...(byDate.get(date) ?? []), part]);
  for (const date of chargeDates(billing, range)) {
    for (const part of ownParts(resolved, date)) add(date, part);
  }
  for (const addOn of separate) {
    for (const date of chargeDates(billing, range, addOn.price)) {
      if (!overridden(date) && joined(addOn, date)) {
        add(date, { price: addOn.price, count: addOn.quantity });
      }
    }
  }

  const taxPlace = buyerTaxPlace(place, item.region);
  const manual = manualRenewal(resolved);
  const last = [
    lastChargeDate(billing),
    ...separate.map((addOn) => lastChargeDate(billing, addOn.price)),
  ]
    .filter((date) => date !== undefined)
    .sort()
    .at(-1);
  const charges: Charge[] = [];
  for (const date of [...byDate.keys()].sort()) {
    if (planEnds !== undefined && date >= planEnds) continue;
    for (const cost of costsOf(byDate.get(date) ?? [], taxPlace)) {
      charges.push({
        date,
        ...cost,
        itemId: item.id,
        listId: resolved.listId,
        manual,
        ...(date === last && { ends: true as const }),
      });
    }
  }
  return charges;
}

/**
 * What one charge of the item's own billing period costs on `date`, sales tax included (the exports' Cost, M7.5): its
 * price override while it applies, else its price plus each add-on billed with it × its quantity. An add-on billed on a
 * period of its own isn't in it. A free plan costs 0 in its price's currency.
 */
export function periodCost(resolved: Chargeable, date: IsoDate, place: TaxPlace): ChargeCost {
  const [cost] = costsOf(ownParts(resolved, date), buyerTaxPlace(place, resolved.item.region));
  return (
    cost ?? {
      amount: 0,
      tax: 0,
      currency: resolved.price.currency,
      converted: false,
      charged: { amount: 0, currency: resolved.price.source.currency },
    }
  );
}

/** Whether the item is renewed by hand: `autoRenew: false`, or a prepaid plan's dates (the calendar's ↻). */
export function manualRenewal({ item, price }: Pick<Chargeable, 'item' | 'price'>): boolean {
  return item.billing.mode === 'recurring' ? !item.billing.autoRenew : !price.autoRenew;
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
  const parts = switchParts(resolved);
  if (parts) {
    const before = nextCharge(parts.before, today, place);
    return before ? goingOn([before])[0] : nextCharge(parts.after, today, place);
  }
  const { billing } = chargedItem(resolved);
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

/**
 * What the item's own period costs on `date`: its price override while it applies, else its price and the add-ons
 * billed with it.
 */
function ownParts(resolved: Chargeable, date: IsoDate): Part[] {
  if (overrideTest(resolved)(date) && resolved.overridePrice) {
    return [{ price: resolved.overridePrice, count: 1 }];
  }
  return [
    { price: resolved.price, count: 1 },
    ...resolved.addOns
      .filter((addOn) => samePeriod(addOn.price, resolved.item.billing) && joined(addOn, date))
      .map((addOn) => ({ price: addOn.price, count: addOn.quantity })),
  ];
}

/** Whether an add-on is on the item by `date`: one that joined later (an extra member, M8.5) isn't yet. */
function joined(addOn: { since?: IsoDate }, date: IsoDate): boolean {
  return addOn.since === undefined || addOn.since <= date;
}

/**
 * Parts of a charge priced with sales tax and added up by currency, a charge for each: a price with no rate to convert
 * it stays in its own currency, so a date can have a charge in each; and a part the provider charges in another
 * currency is a charge of its own too, since a card's FX fee depends on it. A part that comes to 0 adds nothing.
 */
function costsOf(parts: readonly Part[], taxPlace: TaxPlace): ChargeCost[] {
  const bySource = new Map<string, ChargeCost>();
  for (const { price, count } of parts) {
    const amount = price.amount * count;
    if (amount === 0) continue;
    const source = price.source.currency;
    const key = `${price.currency} ${source}`;
    const sum = bySource.get(key) ?? {
      amount: 0,
      tax: 0,
      currency: price.currency,
      converted: false,
      charged: { amount: 0, currency: source },
    };
    const tax = salesTaxOn(amount, price, taxPlace);
    const charged = price.source.amount * count;
    bySource.set(key, {
      amount: sum.amount + amount + tax,
      tax: sum.tax + tax,
      currency: price.currency,
      converted: sum.converted || price.fx !== undefined,
      charged: {
        amount: sum.charged.amount + charged + salesTaxOn(charged, price, taxPlace),
        currency: source,
      },
    });
  }
  return [...bySource.values()];
}

/**
 * Whether a charge on a date costs the item's price override: it has one, and the date is from its `since` and before
 * its `until`.
 */
function overrideTest({ item, overridePrice }: Chargeable): (date: IsoDate) => boolean {
  return (date) => overridePrice !== undefined && ownPriceOn(item.priceOverride ?? {}, date);
}

/** Whether a price override applies on `date`: from its `since`, before its `until`. */
export function ownPriceOn(own: Pick<PriceOverride, 'since' | 'until'>, date: IsoDate): boolean {
  return (
    (own.since === undefined || own.since <= date) && (own.until === undefined || date < own.until)
  );
}

function isDate(date: IsoDate | undefined): date is IsoDate {
  return date !== undefined;
}
