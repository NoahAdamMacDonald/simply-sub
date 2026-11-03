import * as z from 'zod';
import { fullCatalogKey } from '../catalog/catalog-sync';
import { regionSchema } from '../catalog/formats';
import { withProviderFeatures } from '../catalog/provider-features';
import { policyFileSchema, sharedPolicyFileSchema } from '../catalog/policy-files';
import { catalogMetaSchema, catalogSnapshotSchema } from '../catalog/snapshot';
import { timestampSchema } from './record';

/**
 * A downloaded catalog file, kept so the app starts with it and works when the network drops (BLUEPRINT §4.6, §6.3).
 * One record per file, keyed by the region it serves (CA for data/catalog/CA.json, EU) or `catalog` for the full
 * data/catalog.json. The files aren't merged: an item's prices come from its own region's file. It's a cache, not
 * the user's data, so backups leave it out, the app lock leaves it plain, and one that fails this schema is
 * downloaded again. Each plan's features come out with its provider's provider-wide ones added (M11.4), so the app
 * reads them as one: here, in the chunk the checks load in, rather than in CatalogStore, which is in the initial bundle.
 */
export const catalogFileKeySchema = z.union([regionSchema, z.literal(fullCatalogKey)]);

/**
 * A Terms and policies file's key (M11.8): `policies/<provider id>`, or `policies/shared/<id>` for a shared document,
 * as its path under /data/ has it.
 */
export const policyCacheKeySchema = z
  .string()
  .regex(
    /^policies\/(?:shared\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use policies/<id> or policies/shared/<id>',
  );

/** Every record's key: a catalog file's, or a Terms and policies file's. */
export const catalogCacheKeySchema = z.union([catalogFileKeySchema, policyCacheKeySchema]);

export const catalogFileCacheSchema = z
  .strictObject({
    key: catalogFileKeySchema,
    /** The file as downloaded. Its meta has the catalogVersion, generatedAt and region. */
    snapshot: catalogSnapshotSchema,
    fetchedAt: timestampSchema,
  })
  .superRefine(({ key, snapshot }, ctx) => {
    if (key !== (snapshot.meta.region ?? fullCatalogKey)) {
      ctx.addIssue({
        code: 'custom',
        message: "Use the file's meta.region, or catalog for the full catalog",
        path: ['key'],
      });
    }
  })
  .transform((file) => ({
    ...file,
    snapshot: { ...file.snapshot, data: withProviderFeatures(file.snapshot.data) },
  }));
export type CatalogCache = z.infer<typeof catalogFileCacheSchema>;

/**
 * A provider's Terms and policies file, or a shared document's, as the card downloaded it when they were opened (M11.8),
 * with the catalog version it was read under: a new version reads it again the next time they're opened online, and
 * offline the card shows what it has.
 */
export const policyCacheSchema = z.strictObject({
  key: policyCacheKeySchema,
  file: z.union([policyFileSchema, sharedPolicyFileSchema]),
  catalogVersion: catalogMetaSchema.shape.catalogVersion,
  fetchedAt: timestampSchema,
});
export type PolicyCache = z.infer<typeof policyCacheSchema>;

/**
 * One record of the catalogCache table: a catalog file, or a Terms and policies file, told apart by their shapes (a
 * `file` is a Terms and policies one), so each is checked by its own schema and its issues keep their paths and codes.
 */
export const catalogCacheSchema = z
  .looseObject({})
  .transform((record, ctx): CatalogCache | PolicyCache => {
    const result = ('file' in record ? policyCacheSchema : catalogFileCacheSchema).safeParse(
      record,
    );
    if (result.success) return result.data;
    for (const issue of result.error.issues)
      ctx.addIssue(issue as Parameters<typeof ctx.addIssue>[0]);
    return z.NEVER;
  });
export type CatalogCacheRecord = z.infer<typeof catalogCacheSchema>;

/** Whether a record is a catalog file (a snapshot) rather than a Terms and policies file. */
export function isCatalogFile(record: CatalogCacheRecord): record is CatalogCache {
  return 'snapshot' in record;
}
