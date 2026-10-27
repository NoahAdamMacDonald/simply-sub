import { bundleIdSchema, planIdSchema } from '../catalog/formats';
import { intervalSchema, type Interval } from '../catalog/price';
import type { QueryParams } from '../search/search-params';

// What a price click asks the list editor to add (PROJECT-PLAN P7, flows F1 and F4, M5.4): a plan or a bundle, at the
// billing period of the price clicked, which the item dialog preselects. Search writes it into the editor's URL,
// /lists/<id>/edit?add=netflix.standard&interval=month (?addBundle= for a bundle), and the editor reads it back (M6.4).

export type AddRequest =
  | { kind: 'plan'; planId: string; interval: Interval; intervalCount: number }
  | { kind: 'bundle'; bundleId: string; interval: Interval; intervalCount: number };

/** The most intervals a period can have: ten years of months, far past any period sold. */
export const maxIntervalCount = 120;

/** The editor's query parameters for `request`: count only for a period of more than one (3 months: count=3). */
export function addRequestParams(request: AddRequest): Record<string, string> {
  return {
    ...(request.kind === 'plan' ? { add: request.planId } : { addBundle: request.bundleId }),
    interval: request.interval,
    ...(request.intervalCount > 1 && { count: String(request.intervalCount) }),
  };
}

/**
 * The request in the editor's URL, or undefined when there's none or it isn't one: an id that isn't a plan's or a
 * bundle's, both at once, a period that isn't one. A period left out is a month.
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
  if (planId !== undefined) {
    return planIdSchema.safeParse(planId).success
      ? { kind: 'plan', planId, interval: interval.data, intervalCount }
      : undefined;
  }
  return bundleId !== undefined && bundleIdSchema.safeParse(bundleId).success
    ? { kind: 'bundle', bundleId, interval: interval.data, intervalCount }
    : undefined;
}
