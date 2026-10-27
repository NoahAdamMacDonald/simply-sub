import * as z from 'zod';
import { addDuplicateIssues } from './checks';
import { dottedSlugSchema, slugSchema, textSchema } from './formats';

// data/policy-topics.yaml (BLUEPRINT §4.10): what a card's Terms and policies rates a provider on, each topic with a
// five-tier rubric, so a rating means the same thing for every provider.

/** The five grades, best first: Great, Good, Neutral, Poor and Bad (M1.14; M1.13 had good to bad with "leaning"). */
export const policyTiers = ['great', 'good', 'neutral', 'poor', 'bad'] as const;
export const policyTierSchema = z.enum(policyTiers);
export type PolicyTier = z.infer<typeof policyTierSchema>;

/** How the card groups topics, in this order. */
export const policyGroups = ['privacy', 'billing', 'legal', 'service'] as const;
export const policyGroupSchema = z.enum(policyGroups);
export type PolicyGroup = z.infer<typeof policyGroupSchema>;

export const policyTopicSchema = z.strictObject({
  id: dottedSlugSchema.describe('Stable topic id (privacy.data-collection)'),
  name: textSchema.describe('Display name'),
  group: policyGroupSchema.describe('Where the card lists it'),
  question: textSchema.describe('What it rates'),
  tiers: z
    .strictObject({
      great: textSchema,
      good: textSchema,
      neutral: textSchema,
      poor: textSchema,
      bad: textSchema,
    })
    .describe(
      'The rubric: what each tier means for this topic. A rating names the tier its quotes fit',
    ),
  categories: z
    .array(slugSchema)
    .min(1, 'Leave categories out when the topic applies to every provider')
    .describe(
      'Service categories from categories.yaml: the topic applies only to providers with a plan in one',
    )
    .optional(),
});
export type PolicyTopic = z.infer<typeof policyTopicSchema>;

export const policyTopicsFileSchema = z
  .array(policyTopicSchema)
  .min(1, 'List at least one topic')
  .superRefine((topics, ctx) =>
    addDuplicateIssues(
      ctx,
      topics.map((topic) => topic.id),
      (index) => [index, 'id'],
    ),
  )
  .meta({
    title: 'Simply Sub policy topics',
    description:
      'data/policy-topics.yaml: what providers’ terms and policies are rated on (BLUEPRINT §4.10)',
  });
