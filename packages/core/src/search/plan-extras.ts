import { availability, type Availability } from '../catalog/availability';
import type { Bundle } from '../catalog/bundle';
import { bundleSavings, type BundleSaving } from '../catalog/bundle-deal';
import { pickPrice, type PickedPrice, type PriceContext } from '../catalog/pick-price';
import type { Price } from '../catalog/price';
import type { AddOn, Plan } from '../catalog/provider';
import type { CatalogData, SnapshotProvider } from '../catalog/snapshot';

// What a Search card shows when it's expanded (PROJECT-PLAN P8, M5.2), for the plan it shows: the add-ons sold with
// it, the bundles that include it with what they save, and for a suite plan (BLUEPRINT §4.4) the plans it includes
// and what it saves against them. Everything is priced for the user like the plan, and nothing that availability
// says isn't sold in the user's country is listed.

/** Where the user is, their currency and the rates: pickPrice's context without a provider's billing currency. */
export type ExtrasContext = Omit<PriceContext, 'billingCurrency'>;

/** Something sold in the user's country (or maybe sold: unknown), with its picked prices. */
interface Priced {
  pricing: PickedPrice[];
  availability: Exclude<Availability, 'not-offered'>;
}

export interface PricedAddOn extends Priced {
  addOn: AddOn;
}

/** A bundle that includes the plan. */
export interface BundleOffer extends Priced {
  bundle: Bundle;
  /** Who sells it. */
  seller: SnapshotProvider;
  /** Its plans, in its order, with their providers. */
  plans: { provider: SnapshotProvider; plan: Plan }[];
  /** What it saves against buying its plans separately, per interval (bundleSavings). None when it saves nothing. */
  savings: BundleSaving[];
}

/** What a suite plan includes (`includes-subscription`): plans, or a whole provider's service. */
export interface SuiteContents {
  includes: { provider: SnapshotProvider; plan?: Plan }[];
  /**
   * What it saves against the plans it includes directly, per interval, when they're all plans and it costs less
   * (BLUEPRINT §4.4).
   */
  savings: BundleSaving[];
}

export interface PlanExtras {
  /** The add-ons sold with the plan, in its addOnIds order. */
  addOns: PricedAddOn[];
  /** The bundles that include it, cheapest per month first. */
  bundles: BundleOffer[];
  /** When it's a suite: what it includes. */
  suite?: SuiteContents;
}

/**
 * The expanded card's extras for `provider`'s `plan`, from the catalog file for the user's country. A bundle whose
 * seller or plans the catalog doesn't have is left out, as is an entry of `includes-subscription` it doesn't know.
 */
export function planExtras(
  provider: SnapshotProvider,
  plan: Plan,
  catalog: Pick<CatalogData, 'providers' | 'bundles'>,
  context: ExtrasContext,
): PlanExtras {
  const providerOf = (id: string) => catalog.providers.find((candidate) => candidate.id === id);
  const planOf = (planId: string) => {
    // Plan ids are <provider id>.<slug>, which validateCatalog checks.
    const owner = providerOf(planId.slice(0, planId.indexOf('.')));
    const found = owner?.plans.find((candidate) => candidate.id === planId);
    return owner && found && { provider: owner, plan: found };
  };

  const addOns = (plan.addOnIds ?? []).flatMap((id): PricedAddOn[] => {
    const addOn = provider.addOns?.find((candidate) => candidate.id === id);
    const sold = addOn && priced(addOn.prices, provider, context);
    return addOn && sold ? [{ addOn, ...sold }] : [];
  });

  const bundles = catalog.bundles
    .filter((bundle) => bundle.includes.includes(plan.id))
    .flatMap((bundle): BundleOffer[] => {
      const seller = providerOf(bundle.soldBy);
      const sold = seller && priced(bundle.prices, seller, context);
      const plans = bundle.includes.flatMap((id) => planOf(id) ?? []);
      if (!seller || !sold || plans.length < bundle.includes.length) {
        return [];
      }
      return [
        {
          bundle,
          seller,
          ...sold,
          plans,
          savings: savingsAgainst(sold, plans, context),
        },
      ];
    })
    .sort((a, b) => cheapest(a.pricing) - cheapest(b.pricing));

  const listed = plan.features['includes-subscription'];
  const includes = (Array.isArray(listed) ? listed : []).flatMap(
    (id): SuiteContents['includes'] => {
      if (!id.includes('.')) {
        const whole = providerOf(id);
        return whole ? [{ provider: whole }] : [];
      }
      const found = planOf(id);
      return found ? [found] : [];
    },
  );
  const suitePrice = priced(plan.prices, provider, context);
  const plansOnly = includes.flatMap(({ provider: owner, plan: included }) =>
    included ? [{ provider: owner, plan: included }] : [],
  );
  const suite: SuiteContents | undefined =
    includes.length === 0
      ? undefined
      : {
          includes,
          savings:
            suitePrice && plansOnly.length === includes.length
              ? savingsAgainst(suitePrice, plansOnly, context)
              : [],
        };

  return { addOns, bundles, ...(suite && { suite }) };
}

/** Prices picked for the user, or undefined when availability says it isn't sold there or nothing could be picked. */
function priced(
  prices: readonly Price[],
  seller: SnapshotProvider,
  context: ExtrasContext,
): Priced | undefined {
  const sold = availability(prices, seller, context.region);
  if (sold === 'not-offered') {
    return undefined;
  }
  const pricing = pickPrice(prices, {
    ...context,
    ...(seller.billingCurrency && { billingCurrency: seller.billingCurrency }),
  });
  return pricing.length > 0 ? { pricing, availability: sold } : undefined;
}

/** What `deal` saves against buying `plans` separately: bundleSavings, with each plan priced like it. */
function savingsAgainst(
  deal: Priced,
  plans: readonly { provider: SnapshotProvider; plan: Plan }[],
  context: ExtrasContext,
): BundleSaving[] {
  return bundleSavings(
    { pricing: deal.pricing, offered: deal.availability === 'offered' },
    plans.map(({ provider, plan }) => {
      const part = priced(plan.prices, provider, context);
      return { pricing: part?.pricing ?? [], offered: part?.availability === 'offered' };
    }),
  );
}

function cheapest(pricing: readonly PickedPrice[]): number {
  return Math.min(...pricing.map((price) => price.monthlyEquivalent));
}
