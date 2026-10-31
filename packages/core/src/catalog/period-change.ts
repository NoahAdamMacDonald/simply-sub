import type { IsoDate } from '../dates/iso-date';
import type { Period } from '../dates/period';
import { pickPrice, type PickedPrice, type PriceContext } from './pick-price';
import type { Interval, Price } from './price';

// A billing period no longer sold (BLUEPRINT §4.3, M10.28): an item billed that way switches, at its next renewal on or
// after the price's `retired` (or `endsOn`), to the closest period still sold in the same price list.

/** About how many days a period lasts, to compare periods by length. */
const days: Record<Interval, number> = { day: 1, week: 7, month: 30.44, year: 365.25 };

function length({ interval, intervalCount }: Period): number {
  return days[interval] * intervalCount;
}

/** The stored price `picked` comes from, for `period`. */
export function storedPrice(
  prices: readonly Price[],
  picked: PickedPrice,
  period: Period,
): Price | undefined {
  return prices.find(
    (price) =>
      price.region === picked.source.region &&
      price.currency === picked.source.currency &&
      price.interval === period.interval &&
      price.intervalCount === period.intervalCount,
  );
}

/**
 * The period still sold that's closest in length to `period`, in `retired`'s own price list (its region and currency),
 * picked for the user; the shorter of two as close. Undefined when that list sells nothing any more.
 */
export function closestPeriod(
  prices: readonly Price[],
  retired: Price,
  period: Period,
  context: PriceContext,
): PickedPrice | undefined {
  const sold = prices.filter(
    (price) =>
      price.retired === undefined &&
      price.region === retired.region &&
      price.currency === retired.currency,
  );
  const distance = (price: PickedPrice) => Math.abs(Math.log(length(price) / length(period)));
  return pickPrice(sold, context).reduce<PickedPrice | undefined>(
    (best, price) => (best === undefined || distance(price) < distance(best) ? price : best),
    undefined,
  );
}

/** The day an item billed on `retired` loses it: its `endsOn`, else the day it was retired. */
export function periodLostOn(retired: Price): IsoDate | undefined {
  return retired.endsOn ?? retired.retired;
}
