import type { FeatureValue } from './feature';
import type { Plan, Provider } from './provider';

// A plan's service categories (BLUEPRINT §4.3, §4.5, M1.10, M11.3). A provider has one category, its main one, where a
// buyer would look first, and a plan lists every category it fits: Proton is a privacy suite, Proton VPN Plus is a
// VPN, and Proton Unlimited is a privacy suite, a VPN, storage, email, a password manager, a calendar and an AI
// assistant. Search's Category filter and a category the text names keep the plans in it, and GET /providers finds a
// provider by any of its plans' categories.

/** The categories a plan is in: its own list, else its provider's category. */
export function planCategories(
  plan: Pick<Plan, 'categories'>,
  provider: Pick<Provider, 'category'>,
): readonly string[] {
  return plan.categories ?? [provider.category];
}

/** Every category a provider's plans are in, each once, in the order its plans name them. */
export function providerCategories(
  provider: Pick<Provider, 'category'> & { plans: readonly Pick<Plan, 'categories'>[] },
): string[] {
  return [...new Set(provider.plans.flatMap((plan) => planCategories(plan, provider)))];
}

/**
 * The features that name a service category (M11.3): a plan with one is in that category, or says in `notIn` that
 * it comes with the plan but isn't what it's sold as (every Proton plan has Proton VPN Free). Validation warns about
 * the rest. A rule whose feature isn't in the registry, or whose category isn't in categories.yaml, is inactive.
 */
export const featureCategories: readonly { feature: string; category: string }[] = [
  { feature: 'vpn.included', category: 'vpn' },
  { feature: 'antivirus.included', category: 'security' },
  { feature: 'password-manager', category: 'passwords' },
  { feature: 'email.addresses', category: 'email' },
  { feature: 'calendar.included', category: 'calendar' },
  { feature: 'storage.cloud', category: 'storage' },
  { feature: 'ai.assistant', category: 'ai' },
];

/** The categories a plan's features name, each with the first feature that names it, in featureCategories' order. */
export function featureNamedCategories(
  plan: Pick<Plan, 'features'>,
  hasFeature: (id: string) => boolean = () => true,
): { category: string; feature: string }[] {
  const named = new Map<string, string>();
  for (const { feature, category } of featureCategories) {
    if (hasFeature(feature) && provides(plan.features[feature]) && !named.has(category)) {
      named.set(category, feature);
    }
  }
  return [...named].map(([category, feature]) => ({ category, feature }));
}

/** A value that gives the feature: true, unlimited or more than 0. */
function provides(value: FeatureValue | undefined): boolean {
  return value === true || value === 'unlimited' || (typeof value === 'number' && value > 0);
}
