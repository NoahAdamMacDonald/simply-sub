import { z } from 'zod';
import { categoriesFileSchema } from './category';
import { featuresFileSchema } from './feature';
import { catalogMetaSchema, type CatalogSnapshot } from './snapshot';

// The registry files (BLUEPRINT §6.3): data/catalog/features.json and data/catalog/categories.json, the bodies of
// GET /features and GET /categories. scripts/build-catalog.ts writes them next to the region files, and the Worker
// streams them without parsing them, as it does the snapshots. Their meta.catalogVersion is the one in
// data/catalog/index.json, which the Worker sends as the ETag.

export const featuresBodySchema = z.strictObject({
  data: featuresFileSchema.describe(
    'Every feature in data/features.yaml order, which lists each group before its features',
  ),
  meta: z.strictObject({
    catalogVersion: catalogMetaSchema.shape.catalogVersion,
    count: z.int().nonnegative().describe('How many features data lists'),
  }),
});
export type FeaturesBody = z.infer<typeof featuresBodySchema>;

export const categoriesBodySchema = z.strictObject({
  data: categoriesFileSchema,
  meta: z.strictObject({ catalogVersion: catalogMetaSchema.shape.catalogVersion }),
});
export type CategoriesBody = z.infer<typeof categoriesBodySchema>;

/** GET /features: the snapshot's features, as data/features.yaml lists them. */
export function featuresBody({ data, meta }: CatalogSnapshot): FeaturesBody {
  return {
    data: data.features,
    meta: { catalogVersion: meta.catalogVersion, count: data.features.length },
  };
}

/** GET /categories: the snapshot's service, feature and spend categories, as data/categories.yaml lists them. */
export function categoriesBody({ data, meta }: CatalogSnapshot): CategoriesBody {
  return { data: data.categories, meta: { catalogVersion: meta.catalogVersion } };
}
