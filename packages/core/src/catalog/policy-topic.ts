import * as z from 'zod';
import { addDuplicateIssues } from './checks';
import { dottedSlugSchema, slugSchema, textSchema } from './formats';

// data/policy-topics.yaml (BLUEPRINT §4.10): what a card's Terms and policies rates a provider on, each topic with a
// five-tier rubric, so a rating means the same thing for every provider, and what the provider's silence means.

/** The five grades, best first: Great, Good, Neutral, Poor and Bad (M1.14; M1.13 had good to bad with "leaning"). */
export const policyTiers = ['great', 'good', 'neutral', 'poor', 'bad'] as const;
export const policyTierSchema = z.enum(policyTiers);
export type PolicyTier = z.infer<typeof policyTierSchema>;

/** How the card groups topics, in this order. */
export const policyGroups = [
  'privacy',
  'billing',
  'legal',
  'security',
  'service',
  'finance',
  'other',
] as const;
export const policyGroupSchema = z.enum(policyGroups);
export type PolicyGroup = z.infer<typeof policyGroupSchema>;

/**
 * What a rating records instead of a grade (M11.1): the pages read don't address the topic, or it can't apply (no
 * free trial).
 */
export const policyStatuses = ['not-stated', 'not-applicable'] as const;
export const policyStatusSchema = z.enum(policyStatuses);
export type PolicyStatus = z.infer<typeof policyStatusSchema>;

/** What a topic's silence means: Not stated where it proves nothing, a grade where it's a missing protection. */
export const policySilentSchema = z.union([z.literal('not-stated'), policyTierSchema]);
export type PolicySilent = z.infer<typeof policySilentSchema>;

/** How many ratings a provider may give a titled topic (other.notable). */
export const titledRatingsMax = 3;

export const policyTopicSchema = z
  .strictObject({
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
    note: textSchema
      .describe(
        "How to read the rubric: its terms, what doesn't count, and where to look when the policy is silent",
      )
      .optional(),
    silent: policySilentSchema
      .describe(
        'What it means when the pages say nothing: not-stated where silence proves nothing, or the tier it gets where it means a missing protection',
      )
      .optional(),
    silentIn: z
      .record(slugSchema, policySilentSchema)
      .describe(
        "silent for providers in these service categories instead (ai: poor, where training is the industry's default)",
      )
      .optional(),
    categories: z
      .array(slugSchema)
      .min(1, 'Leave categories out when the topic applies to every provider')
      .describe(
        'Service categories from categories.yaml: the topic applies only to providers with a plan in one',
      )
      .optional(),
    paidPlans: z
      .int()
      .min(1)
      .describe(
        'It applies only to providers with at least this many paid plans (1 for billing, 2 for switching plans)',
      )
      .optional(),
    actionFor: z
      .array(policyTierSchema)
      .min(1, 'Leave actionFor out when no grade needs the user to act')
      .describe(
        "The grades that mean the user has to act (opt out, ask for deletion): a rating with one links the provider's own page for it in its action",
      )
      .optional(),
    titled: z
      .literal(true)
      .describe(
        `Each rating has a title, a provider gives up to ${titledRatingsMax}, and none is required (other.notable)`,
      )
      .optional(),
  })
  .superRefine((topic, ctx) => {
    // Every topic a provider has to rate says what its silence means; a titled one is never required.
    if (topic.titled && (topic.silent !== undefined || topic.silentIn !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A titled topic is never required, so silence means nothing: leave silent out',
        path: ['silent'],
      });
    } else if (!topic.titled && topic.silent === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Say what silence means: not-stated, or the tier it gets',
        path: ['silent'],
      });
    }
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

/** What a provider's silence on `topic` means, for a provider in `categories`. */
export function silentMeaning(topic: PolicyTopic, categories: readonly string[]): PolicySilent {
  const special = categories.find((id) => topic.silentIn?.[id] !== undefined);
  return (special !== undefined && topic.silentIn?.[special]) || topic.silent || 'not-stated';
}
