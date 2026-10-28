import type { PickedPrice } from '../catalog/pick-price';
import type { Charged } from '../schedule/charges';
import { salesTaxOn } from '../tax/charge-tax';
import { buyerTaxPlace, type TaxPlace } from '../tax/sales-tax-rate';
import type { ResolvedItem } from './resolved';

/** What a list costs per month on average: P5's footer and P4's header ("≈ $62 / mo average"). */
export interface MonthlyAverage {
  /** In `currency`, before sales tax, as monthly equivalents are (PROJECT-PLAN §3.1). */
  amount: number;
  currency: string;
  /** It includes a converted price, so it's shown with ≈. */
  approx: boolean;
  /** The items left out: priced in another currency, for want of an exchange rate. */
  leftOut: number;
}

/**
 * The sum of `items`' monthly equivalents in `currency`, the user's. An item counts what it costs today: its price
 * override while that applies, else its price and add-ons. One with any of them in another currency is left out and
 * counted, since there was no rate to convert it.
 */
export function monthlyAverage(items: readonly ResolvedItem[], currency: string): MonthlyAverage {
  let amount = 0;
  let approx = false;
  let leftOut = 0;
  for (const item of items) {
    const monthly = monthlyIn(item, currency);
    if (monthly === undefined) {
      leftOut++;
      continue;
    }
    amount += monthly;
    approx ||= pricesToday(item).some((price) => !price.native);
  }
  return { amount, currency, approx, leftOut };
}

/**
 * What the item costs per month today in `currency` (its monthly equivalent), or undefined when its override, price or
 * an add-on is in another currency, for want of an exchange rate.
 */
export function monthlyIn(item: ResolvedItem, currency: string): number | undefined {
  return pricesToday(item).every((price) => price.currency === currency)
    ? item.monthlyEquivalent
    : undefined;
}

/** What an item costs a month with sales tax. */
export interface MonthlyWithTax {
  /** In the user's currency, sales tax included. */
  amount: number;
  /** It includes a converted price, so it's shown with ≈. */
  converted: boolean;
}

/**
 * What the item costs per month today with sales tax (P4's and P11's payment card figures, M9): its monthly equivalent
 * and the tax its charges add, at the rate where it's bought (buyerTaxPlace), none on a price that includes it. Undefined
 * when a price is in another currency, for want of an exchange rate.
 */
export function monthlyWithTax(
  item: ResolvedItem,
  currency: string,
  place: TaxPlace,
): MonthlyWithTax | undefined {
  const parts = monthlyParts(item, currency, place);
  return (
    parts && {
      amount: parts.reduce((total, part) => total + part.amount, 0),
      converted: parts.some((part) => part.converted),
    }
  );
}

/** A part of what an item costs a month today with tax: its price, or an add-on's, or its price override. */
export interface MonthlyPart {
  /** In the user's currency, sales tax included. */
  amount: number;
  /** The same in the currency the provider charges it in, before any conversion: what a card works on (§9.3). */
  charged: Charged;
  converted: boolean;
}

/**
 * The parts of monthlyWithTax, a price at a time (an add-on × its quantity), or undefined when one is in another
 * currency for want of a rate. A free part is in it, at 0.
 */
export function monthlyParts(
  item: ResolvedItem,
  currency: string,
  place: TaxPlace,
): MonthlyPart[] | undefined {
  if (monthlyIn(item, currency) === undefined) return undefined;
  const taxPlace = buyerTaxPlace(place, item.region);
  return partsToday(item).map(({ price, count }) => {
    const monthly = price.monthlyEquivalent * count;
    // The source price's share of the converted one: its amount over the picked amount, 1 when nothing was converted.
    const charged = price.amount === 0 ? 0 : (monthly * price.source.amount) / price.amount;
    return {
      amount: monthly + salesTaxOn(monthly, price, taxPlace),
      charged: {
        amount: charged + salesTaxOn(charged, price, taxPlace),
        currency: price.source.currency,
      },
      converted: !price.native,
    };
  });
}

/** The prices that make up its monthly equivalent: the override while it applies, else its price and add-ons. */
function pricesToday(item: ResolvedItem) {
  return partsToday(item).map(({ price }) => price);
}

/** The same, each with how many of it the item has. */
function partsToday(item: ResolvedItem): { price: PickedPrice; count: number }[] {
  return item.override
    ? [{ price: item.override, count: 1 }]
    : [
        { price: item.price, count: 1 },
        ...item.addOns.map((addOn) => ({ price: addOn.price, count: addOn.quantity })),
      ];
}
