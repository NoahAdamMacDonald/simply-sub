import * as z from 'zod';
import { closestMatch } from './checks';
import { planIdSchema, slugSchema } from './formats';
import { catalogMetaSchema, type CatalogSnapshot } from './snapshot';

// data/catalog/ids.json (BLUEPRINT §6.3): every provider id with its plan ids, which scripts/build-catalog.ts writes
// next to the region files. The Worker reads it only to suggest an id when a request names one the catalog doesn't
// have (M2.4), so a typo costs no D1 rows: the suggestion would otherwise need every provider's row.

export const catalogIdsSchema = z.strictObject({
  data: z
    .record(slugSchema, z.array(planIdSchema))
    .describe('Provider id → its plan ids, providers sorted by id and plans in file order'),
  meta: z.strictObject({ catalogVersion: catalogMetaSchema.shape.catalogVersion }),
});
export type CatalogIds = z.infer<typeof catalogIdsSchema>;

/** The ids file of the snapshot. */
export function catalogIds({ data, meta }: CatalogSnapshot): CatalogIds {
  return {
    data: Object.fromEntries(
      data.providers.map((provider) => [provider.id, provider.plans.map((plan) => plan.id)]),
    ),
    meta: { catalogVersion: meta.catalogVersion },
  };
}

/** The provider id that `id` looks like a typo of, or undefined. */
export function suggestedProviderId(id: string, ids: CatalogIds): string | undefined {
  return closestMatch(id, Object.keys(ids.data));
}

/** The plan id that `id` looks like a typo of, or undefined. */
export function suggestedPlanId(id: string, ids: CatalogIds): string | undefined {
  return closestMatch(id, Object.values(ids.data).flat());
}
