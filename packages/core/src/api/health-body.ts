import { z } from 'zod';
import { catalogMetaSchema } from '../catalog/snapshot';

// GET /health's body (docs/api-output-examples.json): liveness, the API's version, and the catalog D1 holds, from the
// catalog row the seed writes (BLUEPRINT §5.3). Before the first seed there is no row, and only the status and the
// version are there.

export const healthBodySchema = z.strictObject({
  data: z.strictObject({
    status: z.literal('ok'),
    apiVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'Use a version such as 1.0.0'),
    catalogVersion: catalogMetaSchema.shape.catalogVersion.optional(),
    catalogUpdatedAt: z.iso.datetime().describe('The catalog build time, in UTC').optional(),
    counts: catalogMetaSchema.shape.counts.optional(),
  }),
  meta: z.strictObject({ generatedAt: z.iso.datetime() }),
});
export type HealthBody = z.infer<typeof healthBodySchema>;
