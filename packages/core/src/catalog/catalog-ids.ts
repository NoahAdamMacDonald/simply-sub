import * as z from 'zod';
import { closestMatch } from './checks';
import { planIdSchema, slugSchema } from './formats';
import { redirectSchema, type Redirect } from './redirects';
import { catalogMetaSchema, type CatalogSnapshot } from './snapshot';

// data/catalog/ids.json (BLUEPRINT §6.3): every provider id with its plan ids, and the provider and plan redirects,
// which scripts/build-catalog.ts writes next to the region files. The Worker reads it only when a request names an id
// the catalog doesn't have: to send an old id on to its new one (M10.27), else to suggest one (M2.4). Neither costs D1
// rows: the suggestion would otherwise need every provider's row.

export const catalogIdsSchema = z.strictObject({
  data: z
    .record(slugSchema, z.array(planIdSchema))
    .describe('Provider id → its plan ids, providers sorted by id and plans in file order'),
  redirects: z
    .array(redirectSchema)
    .min(1)
    .describe("data/redirects.yaml's provider and plan entries. Left out when there are none")
    .optional(),
  meta: z.strictObject({ catalogVersion: catalogMetaSchema.shape.catalogVersion }),
});
export type CatalogIds = z.infer<typeof catalogIdsSchema>;

/** The ids file of the snapshot. */
export function catalogIds({ data, meta }: CatalogSnapshot): CatalogIds {
  const redirects = (data.redirects ?? []).filter(
    (redirect) => redirect.kind === 'provider' || redirect.kind === 'plan',
  );
  return {
    data: Object.fromEntries(
      data.providers.map((provider) => [provider.id, provider.plans.map((plan) => plan.id)]),
    ),
    ...(redirects.length > 0 && { redirects }),
    meta: { catalogVersion: meta.catalogVersion },
  };
}

/**
 * Where an old provider or plan id points now (M10.27): an entry whose `from` is gone from the catalog. A retired
 * plan's dated move isn't followed here: the plan is still in the catalog, and the API still answers for it.
 */
export function redirectedCatalogId(
  id: string,
  kind: Extract<Redirect['kind'], 'provider' | 'plan'>,
  ids: CatalogIds,
): string | undefined {
  return ids.redirects?.find((redirect) => redirect.kind === kind && redirect.from === id)?.to;
}

/** The provider id that `id` looks like a typo of, or undefined. */
export function suggestedProviderId(id: string, ids: CatalogIds): string | undefined {
  return closestMatch(id, Object.keys(ids.data));
}

/** The plan id that `id` looks like a typo of, or undefined. */
export function suggestedPlanId(id: string, ids: CatalogIds): string | undefined {
  return closestMatch(id, Object.values(ids.data).flat());
}
