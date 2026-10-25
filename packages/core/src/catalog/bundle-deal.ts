import type { Feature, FeatureValue } from './feature';
import type { PickedPrice } from './pick-price';
import type { Interval } from './price';
import type { Plan } from './provider';

// What a bundle gives and saves (BLUEPRINT §4.4): computed from its plans, never stored. GET /bundles adds both per
// request (M2.4), and the app will compute them the same way for the user's region. A bundle file is only for a deal
// that is exactly its plans, so its features are their union; a suite plan states its own (§4.4).

/**
 * The union of the plans' features, each in the order it first appears: booleans OR'd, numbers and enums take the
 * highest value (unlimited above any number, an enum's in registry order), sets merged.
 */
export function bundleFeatures(
  plans: readonly Pick<Plan, 'features'>[],
  registry: readonly Feature[],
): Plan['features'] {
  const union: Plan['features'] = {};
  for (const plan of plans) {
    for (const [id, value] of Object.entries(plan.features)) {
      union[id] = Object.hasOwn(union, id)
        ? higher(
            registry.find((feature) => feature.id === id),
            union[id],
            value,
          )
        : value;
    }
  }
  return union;
}

function higher(feature: Feature | undefined, a: FeatureValue, b: FeatureValue): FeatureValue {
  if (feature?.type === 'enum') {
    const position = (value: FeatureValue) =>
      feature.values.findIndex((candidate) => candidate.id === value);
    return position(b) > position(a) ? b : a;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return [...new Set([...a, ...b])];
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a || b;
  }
  if (a === 'unlimited' || b === 'unlimited') {
    return 'unlimited';
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.max(a, b);
  }
  return a;
}

/** One way of buying the bundle or one of its plans, priced for the user's region. */
export interface PricedPart {
  /** Its picked prices (pickPrice). */
  pricing: readonly PickedPrice[];
  /** Whether availability says it's offered in the region: a fallback price from elsewhere can't be compared. */
  offered: boolean;
}

/** What the bundle saves on one interval, at full precision in `currency`. */
export interface BundleSaving {
  interval: Interval;
  intervalCount: number;
  /** The plans' prices added up. */
  standaloneTotal: number;
  bundlePrice: number;
  /** standaloneTotal − bundlePrice: always above 0. */
  amount: number;
  currency: string;
  /** amount as a percentage of standaloneTotal. */
  percent: number;
}

/**
 * What the bundle saves against buying its plans separately, for each interval of its picked prices. An interval
 * counts only when the bundle and every plan are offered in the region, and every plan has a picked price for the
 * same interval and intervalCount in the bundle's currency. A bundle that costs as much or more, to the cent, saves
 * nothing, and like a suite's (BLUEPRINT §4.4) that interval is left out.
 */
export function bundleSavings(bundle: PricedPart, plans: readonly PricedPart[]): BundleSaving[] {
  if (!bundle.offered || !plans.every((plan) => plan.offered)) {
    return [];
  }
  return bundle.pricing.flatMap((price): BundleSaving[] => {
    const standalone = plans.map((plan) =>
      plan.pricing.find(
        (candidate) =>
          candidate.interval === price.interval &&
          candidate.intervalCount === price.intervalCount &&
          candidate.currency === price.currency,
      ),
    );
    if (standalone.some((candidate) => candidate === undefined)) {
      return [];
    }
    const standaloneTotal = standalone.reduce(
      (sum, candidate) => sum + (candidate?.amount ?? 0),
      0,
    );
    const amount = standaloneTotal - price.amount;
    if (Math.round(amount * 100) <= 0) {
      return [];
    }
    return [
      {
        interval: price.interval,
        intervalCount: price.intervalCount,
        standaloneTotal,
        bundlePrice: price.amount,
        amount,
        currency: price.currency,
        percent: (amount / standaloneTotal) * 100,
      },
    ];
  });
}
