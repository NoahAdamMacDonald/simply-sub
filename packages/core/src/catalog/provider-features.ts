import type { Plan, Provider } from './provider';

// Provider-wide features (BLUEPRINT §4.2 rule 9, M11.4): what every plan of a provider has (platforms, sign-in, open
// source, languages, support) is stated once in the provider's own `features`, and a plan states a value only where it
// differs. The catalog files and D1 keep them once; everything that compares plans reads them merged.

/** A plan's features: its provider's, then its own, which win. */
export function planFeatures(
  plan: Pick<Plan, 'features'>,
  provider: Pick<Provider, 'features'>,
): Plan['features'] {
  return provider.features ? { ...provider.features, ...plan.features } : plan.features;
}

/**
 * The provider with each plan's features merged with its own (planFeatures), for code that reads `plan.features`:
 * Search, the optimizer, cards and the API's search. The provider keeps its `features`, so merging twice changes
 * nothing.
 */
export function withPlanFeatures<T extends Pick<Provider, 'features'> & { plans: readonly Plan[] }>(
  provider: T,
): T {
  if (!provider.features) return provider;
  return {
    ...provider,
    plans: provider.plans.map((plan) => ({ ...plan, features: planFeatures(plan, provider) })),
  };
}

const merged = new WeakMap<object, object>();

/** The catalog with every provider's plans merged (withPlanFeatures), kept per catalog object. */
export function withProviderFeatures<
  T extends { providers: readonly (Pick<Provider, 'features'> & { plans: readonly Plan[] })[] },
>(catalog: T): T {
  if (!catalog.providers.some((provider) => provider.features)) return catalog;
  const kept = merged.get(catalog) as T | undefined;
  if (kept) return kept;
  const result = { ...catalog, providers: catalog.providers.map(withPlanFeatures) };
  merged.set(catalog, result);
  merged.set(result, result);
  return result;
}
