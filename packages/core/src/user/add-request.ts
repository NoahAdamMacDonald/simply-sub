import { bundleIdSchema, currencySchema, planIdSchema } from '../catalog/formats';
import { intervalSchema, type Interval } from '../catalog/price';
import type { QueryParams } from '../search/search-params';

// What a price click asks the list editor to add (PROJECT-PLAN P7, flows F1 and F4, M5.4): a plan or a bundle, at the
// billing period of the price clicked, which the item dialog preselects. Search writes it into the editor's URL,
// /lists/<id>/edit?add=netflix.standard&interval=month (?addBundle= for a bundle), and the editor reads it back (M6.4).
// A reseller's price adds its plan with what the shop charges as the item's own price (BLUEPRINT §4.9):
// &price=87&currency=CAD&plusTax=1.

/** What a reseller charges, which the item dialog fills in as "I pay a different price". */
export interface RequestedPrice {
  amount: number;
  currency: string;
  /** The amount is before sales tax: the shop's price doesn't include it (BLUEPRINT §4.8). */
  plusTax: boolean;
}

export type AddRequest =
  | {
      kind: 'plan';
      planId: string;
      interval: Interval;
      intervalCount: number;
      price?: RequestedPrice;
    }
  | { kind: 'bundle'; bundleId: string; interval: Interval; intervalCount: number };

/** The most intervals a period can have: ten years of months, far past any period sold. */
export const maxIntervalCount = 120;

/**
 * The editor's query parameters for `request`: count only for a period of more than one (3 months: count=3), and a
 * reseller's price with its currency, and plusTax=1 when tax is added to it.
 */
export function addRequestParams(request: AddRequest): Record<string, string> {
  const price = request.kind === 'plan' ? request.price : undefined;
  return {
    ...(request.kind === 'plan' ? { add: request.planId } : { addBundle: request.bundleId }),
    interval: request.interval,
    ...(request.intervalCount > 1 && { count: String(request.intervalCount) }),
    ...(price && {
      price: String(price.amount),
      currency: price.currency,
      ...(price.plusTax && { plusTax: '1' }),
    }),
  };
}

/**
 * The request in the editor's URL, or undefined when there's none or it isn't one: an id that isn't a plan's or a
 * bundle's, both at once, a period that isn't one, or a price that isn't above 0 with a currency (only a plan takes
 * one). A period left out is a month.
 */
export function readAddRequest(params: QueryParams): AddRequest | undefined {
  const one = (name: string) => {
    const value = params[name];
    return typeof value === 'string' ? value : value?.[0];
  };
  const planId = one('add');
  const bundleId = one('addBundle');
  if ((planId === undefined) === (bundleId === undefined)) {
    return undefined;
  }
  const interval = intervalSchema.safeParse(one('interval') ?? 'month');
  const count = one('count');
  const intervalCount = count === undefined ? 1 : Number(count);
  if (
    !interval.success ||
    !Number.isInteger(intervalCount) ||
    intervalCount < 1 ||
    intervalCount > maxIntervalCount ||
    (count !== undefined && !/^\d+$/.test(count))
  ) {
    return undefined;
  }
  const amount = one('price');
  const currency = one('currency');
  let price: RequestedPrice | undefined;
  if (amount !== undefined || currency !== undefined) {
    if (
      planId === undefined ||
      amount === undefined ||
      currency === undefined ||
      !/^\d+(\.\d+)?$/.test(amount) ||
      !(Number(amount) > 0) ||
      !currencySchema.safeParse(currency).success
    ) {
      return undefined;
    }
    price = { amount: Number(amount), currency, plusTax: one('plusTax') === '1' };
  }
  if (planId !== undefined) {
    return planIdSchema.safeParse(planId).success
      ? { kind: 'plan', planId, interval: interval.data, intervalCount, ...(price && { price }) }
      : undefined;
  }
  return bundleId !== undefined && bundleIdSchema.safeParse(bundleId).success
    ? { kind: 'bundle', bundleId, interval: interval.data, intervalCount }
    : undefined;
}
