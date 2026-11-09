import type { CatalogData } from './snapshot';

// Third-party values (M11.16): a feature value a publication gives, which no official page states. Settings' "Use
// third-party claims" is on by default; off, the app reads the catalog without them, so cards show those features as
// not stated, and Search, ranking and the optimizer never count them.

/** The catalog without its third-party values: `data` itself when it has none. */
export function withoutThirdParty(data: CatalogData): CatalogData {
  if (!data.providers.some((provider) => provider.plans.some((plan) => plan.thirdParty))) {
    return data;
  }
  return {
    ...data,
    providers: data.providers.map((provider) => ({
      ...provider,
      plans: provider.plans.map((plan) => {
        if (!plan.thirdParty) return plan;
        const { thirdParty, ...rest } = plan;
        return {
          ...rest,
          features: Object.fromEntries(
            Object.entries(plan.features).filter(([id]) => !Object.hasOwn(thirdParty, id)),
          ),
        };
      }),
    })),
  };
}
