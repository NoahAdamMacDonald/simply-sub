import type { Plan, Provider } from './provider';

// A plan's service categories (BLUEPRINT §4.3, M1.10). A provider has one category, its main one, which names what it
// is, and a plan can list its own when it's something else too: Proton is a privacy suite, and Proton VPN Plus is a
// VPN. Search's Category filter and a category the text names keep the plans in it, and GET /providers finds a
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
