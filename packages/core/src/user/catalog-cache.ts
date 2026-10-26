import * as z from 'zod';
import { fullCatalogKey } from '../catalog/catalog-sync';
import { regionSchema } from '../catalog/formats';
import { catalogSnapshotSchema } from '../catalog/snapshot';
import { timestampSchema } from './record';

/**
 * A downloaded catalog file, kept so the app starts with it and works when the network drops (BLUEPRINT §4.6, §6.3).
 * One record per file, keyed by the region it serves (CA for data/catalog/CA.json, EU) or `catalog` for the full
 * data/catalog.json. The files aren't merged: an item's prices come from its own region's file. It's a cache, not
 * the user's data, so backups leave it out, the app lock leaves it plain, and one that fails this schema is
 * downloaded again.
 */
export const catalogCacheSchema = z
  .strictObject({
    key: z.union([regionSchema, z.literal(fullCatalogKey)]),
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
  });
export type CatalogCache = z.infer<typeof catalogCacheSchema>;
