import type { PickedPrice } from '../catalog/pick-price';
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
  if (monthlyIn(item, currency) === undefined) return undefined;
  const taxPlace = buyerTaxPlace(place, item.region);
  let amount = 0;
  for (const { price, count } of partsToday(item)) {
    const monthly = price.monthlyEquivalent * count;
    amount += monthly + salesTaxOn(monthly, price, taxPlace);
  }
  return { amount, converted: pricesToday(item).some((price) => !price.native) };
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
