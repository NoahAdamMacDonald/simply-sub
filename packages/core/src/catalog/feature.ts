import { z } from 'zod';
import { addDuplicateIssues } from './checks';
import { aliasesSchema, dottedSlugSchema, slugSchema, textSchema, tierIdSchema } from './formats';

// The feature registry, data/features.yaml (BLUEPRINT §4.2). Whether ids are unique across the file, a parent
// exists and plan values match the registry is checked by scripts/validate-data.ts (M1.4).

const headlineSchema = z.boolean().describe('Show it in feature summaries ("VPN 2 / 3")');

export const featureValueDefSchema = z.strictObject({
  id: slugSchema.describe(
    'The canonical value id, used in plan files and rank keys (video.quality=4k)',
  ),
  name: textSchema.describe('Display name'),
  aliases: aliasesSchema.optional(),
  headline: headlineSchema.optional(),
});
export type FeatureValueDef = z.infer<typeof featureValueDefSchema>;

export const featureTierSchema = z
  .strictObject({
    id: tierIdSchema.describe('Used in rank keys (streaming.concurrent-streams=2-4)'),
    name: textSchema.describe('Display name'),
    min: z
      .number()
      .nonnegative('Must be 0 or more')
      .describe('A plan provides the tier when its value is at least min, or unlimited'),
    max: z
      .number()
      .nonnegative('Must be 0 or more')
      .describe("The tier's upper end, for its label. Plans above it still provide the tier")
      .optional(),
    headline: headlineSchema.optional(),
  })
  .refine((tier) => tier.max === undefined || tier.max >= tier.min, {
    message: 'max must be at least min',
    path: ['max'],
  });
export type FeatureTier = z.infer<typeof featureTierSchema>;

// Every feature type starts with these fields and ends with the flags, so the editor lists keys in that order.
const identity = {
  id: dottedSlugSchema.describe('Stable feature id (video.quality)'),
  parent: dottedSlugSchema
    .describe('The group feature this one belongs to (password-manager)')
    .optional(),
  name: textSchema.describe('Display name'),
  category: slugSchema.describe('A feature category id from categories.yaml'),
};
const flags = {
  aliases: aliasesSchema.optional(),
  headline: headlineSchema.optional(),
  rankable: z
    .boolean()
    .describe('false hides a helper feature from ranking UIs (default true)')
    .optional(),
};
const valueDefsSchema = z.array(featureValueDefSchema).min(1, 'List at least one value');

function addDuplicateValueIssues(
  ctx: z.RefinementCtx,
  key: 'values' | 'tiers',
  items: readonly { id: string }[] | undefined,
): void {
  addDuplicateIssues(
    ctx,
    (items ?? []).map((item) => item.id),
    (index) => [key, index, 'id'],
  );
}

const booleanFeatureSchema = z.strictObject({
  ...identity,
  type: z.literal('boolean'),
  ...flags,
});

const numberFeatureSchema = z
  .strictObject({
    ...identity,
    type: z.literal('number'),
    unit: textSchema.describe('Shown after the value (devices, GB)').optional(),
    tiers: z
      .array(featureTierSchema)
      .min(1, 'Leave tiers out instead of listing none')
      .describe('Rankable buckets: the rows the Features page shows for this feature')
      .optional(),
    ...flags,
  })
  .superRefine((feature, ctx) => addDuplicateValueIssues(ctx, 'tiers', feature.tiers));

const enumFeatureSchema = z
  .strictObject({
    ...identity,
    type: z.literal('enum'),
    values: valueDefsSchema.describe('Ordered low to high, so "at least 1080p" works'),
    ...flags,
  })
  .superRefine((feature, ctx) => addDuplicateValueIssues(ctx, 'values', feature.values));

const setFeatureSchema = z
  .strictObject({
    ...identity,
    type: z.literal('set'),
    values: valueDefsSchema.describe('The canonical options a plan can list').optional(),
    valuesFrom: z
      .literal('providers')
      .describe('The values are provider or plan ids instead of listed options')
      .optional(),
    ...flags,
  })
  .superRefine((feature, ctx) => {
    if (feature.values && feature.valuesFrom) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use values or valuesFrom, not both',
        path: ['valuesFrom'],
      });
    } else if (!feature.values && !feature.valuesFrom) {
      ctx.addIssue({
        code: 'custom',
        message: 'List values, or set valuesFrom: providers',
        path: [],
      });
    }
    addDuplicateValueIssues(ctx, 'values', feature.values);
  });

export const featureSchema = z.discriminatedUnion('type', [
  booleanFeatureSchema,
  numberFeatureSchema,
  enumFeatureSchema,
  setFeatureSchema,
]);
export type Feature = z.infer<typeof featureSchema>;
export type FeatureType = Feature['type'];

export const featuresFileSchema = z.array(featureSchema).meta({
  title: 'Simply Sub feature registry',
  description:
    'data/features.yaml: every feature plans can list and users can rank (BLUEPRINT §4.2)',
});

/**
 * A plan's value for one feature: a boolean, a number or `unlimited` (number), an enum value id, or a list of
 * set value ids (plan or provider ids for `valuesFrom: providers`). A value of a matching type reports that
 * type's own message ('4K' gets the kebab-case one); `error` covers values that match no type.
 */
export const featureValueSchema = z.union(
  [
    z.boolean(),
    z.number().nonnegative('Must be 0 or more'),
    z.literal('unlimited'),
    slugSchema,
    z.array(dottedSlugSchema),
  ],
  { error: 'Use true or false, a number, unlimited, a value id, or a list of value ids' },
);
export type FeatureValue = z.infer<typeof featureValueSchema>;
