import * as z from 'zod';
import { addDuplicateIssues } from './checks';
import { bundleIdSchema, httpsUrlSchema, planIdSchema, slugSchema, textSchema } from './formats';
import { pricesSchema } from './price';

// One bundle file, data/bundles/<slug>.yaml (BLUEPRINT §4.4). Whether soldBy and the included plans exist is
// checked by validateCatalog (validate-catalog.ts). Features and savings are computed, never stored.

export const bundleSchema = z
  .strictObject({
    id: bundleIdSchema.describe('bundle.<slug> (bundle.disney-crave-premium)'),
    name: textSchema.describe('Display name'),
    soldBy: slugSchema.describe('The id of the provider that sells the bundle'),
    includes: z
      .array(planIdSchema)
      .min(2, 'A bundle includes at least two plans')
      .describe('Ids of the plans sold together'),
    link: httpsUrlSchema.describe("Where to sign up for the bundle, on the seller's own site"),
    cancelUrl: httpsUrlSchema
      .describe("Where to cancel the bundle, when it isn't the seller's cancelUrl")
      .optional(),
    prices: pricesSchema,
  })
  .superRefine((bundle, ctx) =>
    addDuplicateIssues(ctx, bundle.includes, (index) => ['includes', index]),
  )
  .meta({
    title: 'Simply Sub bundle',
    description:
      'data/bundles/<slug>.yaml: several plans sold together for one price (BLUEPRINT §4.4)',
  });
export type Bundle = z.infer<typeof bundleSchema>;
