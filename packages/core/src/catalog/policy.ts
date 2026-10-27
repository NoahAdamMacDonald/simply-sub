import * as z from 'zod';
import { addDuplicateIssues } from './checks';
import {
  dottedSlugSchema,
  httpsUrlSchema,
  isoDateSchema,
  planIdSchema,
  regionSchema,
  textSchema,
} from './formats';
import { policyTierSchema } from './policy-topic';

// A provider's Terms and policies (BLUEPRINT §4.10): its ratings on the topics of policy-topics.yaml, each with why
// and its own words, and the pages they quote, which the card links. Topic ids and the plans a rating names are
// checked against the catalog by validateCatalog and the provider schema.

/** Shown beside the grade's dot: a sentence or two in plain words (M1.14; M1.13 kept it to one line). */
export const policyReasonMax = 240;

export const policySourceSchema = z.strictObject({
  url: httpsUrlSchema.describe('The page the quote is on: one of the links'),
  quote: textSchema.describe("The provider's own words there, word for word"),
});
export type PolicySource = z.infer<typeof policySourceSchema>;

export const policyRatingSchema = z.strictObject({
  topic: dottedSlugSchema.describe('A topic id from policy-topics.yaml'),
  tier: policyTierSchema.describe("The rubric's grade its quotes fit"),
  reason: textSchema
    .max(policyReasonMax, `Keep it to a sentence or two (${policyReasonMax} characters at most)`)
    .describe('Why, in plain words anyone can follow, shown beside the grade'),
  sources: z
    .array(policySourceSchema)
    .min(1, 'Quote where it says so')
    .max(3, 'Quote at most three pages')
    .describe('Where it says so'),
  plans: z
    .array(planIdSchema)
    .min(1, 'Leave plans out when it applies to every plan')
    .describe("Only these plans (an ad tier's tracking), over a rating for every plan")
    .optional(),
  regions: z
    .array(regionSchema)
    .min(1, 'Leave regions out when it applies everywhere')
    .describe("Only buyers here (a country's own terms), over a rating for everywhere")
    .optional(),
  lastVerified: isoDateSchema.describe('When the quotes were read'),
});
export type PolicyRating = z.infer<typeof policyRatingSchema>;

export const policyLinkSchema = z.strictObject({
  name: textSchema.describe('As the card links it (Terms of use)'),
  url: httpsUrlSchema,
});
export type PolicyLink = z.infer<typeof policyLinkSchema>;

export const policiesSchema = z
  .strictObject({
    links: z
      .array(policyLinkSchema)
      .min(1, 'List the pages the ratings quote')
      .describe(
        'The terms, privacy policy and other pages the ratings quote, as the card links them',
      ),
    ratings: z.array(policyRatingSchema).min(1, 'Leave policies out instead of listing no ratings'),
  })
  .superRefine((policies, ctx) => {
    const urls = policies.links.map((link) => link.url);
    addDuplicateIssues(ctx, urls, (index) => ['links', index, 'url']);
    const quoted = new Set<string>();
    policies.ratings.forEach((rating, index) => {
      rating.sources.forEach((source, sourceIndex) => {
        quoted.add(source.url);
        if (!urls.includes(source.url)) {
          ctx.addIssue({
            code: 'custom',
            message: 'List this page in links, so the card links it',
            path: ['ratings', index, 'sources', sourceIndex, 'url'],
          });
        }
      });
      addDuplicateIssues(ctx, rating.plans ?? [], (item) => ['ratings', index, 'plans', item]);
      addDuplicateIssues(ctx, rating.regions ?? [], (item) => ['ratings', index, 'regions', item]);
      const clash = policies.ratings.slice(0, index).find((other) => clashes(other, rating));
      if (clash) {
        ctx.addIssue({
          code: 'custom',
          message: `${rating.topic} is rated already for these plans and regions`,
          path: ['ratings', index, 'topic'],
        });
      }
    });
    policies.links.forEach((link, index) => {
      if (!quoted.has(link.url)) {
        ctx.addIssue({
          code: 'custom',
          message: 'No rating quotes this page: leave it out',
          path: ['links', index, 'url'],
        });
      }
    });
  });
export type Policies = z.infer<typeof policiesSchema>;

/**
 * Whether two ratings of one topic would both apply somewhere with neither more specific: a rating for some plans
 * overrides one for every plan, and one for some regions one for everywhere, so only ratings of the same scope clash.
 */
function clashes(a: PolicyRating, b: PolicyRating): boolean {
  return (
    a.topic === b.topic &&
    (a.plans === undefined) === (b.plans === undefined) &&
    (a.regions === undefined) === (b.regions === undefined) &&
    overlap(a.plans, b.plans) &&
    overlap(a.regions, b.regions)
  );
}

/** Whether two lists share an item; a missing list is everything. */
function overlap(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return a === undefined || b === undefined || a.some((item) => b.includes(item));
}
