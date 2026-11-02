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
import { policyStatusSchema, policyTierSchema } from './policy-topic';

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

/** What a rating's link to the user's own way out says: a few words. */
export const policyActionNameMax = 60;

/**
 * Where the user acts on what a rating says they can change (M5.12): a setting to turn off, a request to make. The
 * provider's own page for it, which its own policy or help pages link, never guessed.
 */
export const policyActionSchema = z.strictObject({
  name: textSchema
    .max(policyActionNameMax, `Keep it to a few words (${policyActionNameMax} characters at most)`)
    .describe('What the link does, as the card shows it: How to turn off Behavioral Advertising'),
  url: httpsUrlSchema.describe(
    "The page, on the provider's own sites or its policies' site, that its policy or help pages link for it",
  ),
});
export type PolicyAction = z.infer<typeof policyActionSchema>;

/** A notable rating's title: a few words. */
export const policyTitleMax = 60;

export const policyRatingSchema = z
  .strictObject({
    topic: dottedSlugSchema.describe('A topic id from policy-topics.yaml'),
    title: textSchema
      .max(policyTitleMax, `Keep it to a few words (${policyTitleMax} characters at most)`)
      .describe('What stands out, in a few words: only on a titled topic (other.notable)')
      .optional(),
    tier: policyTierSchema.describe("The rubric's grade its quotes fit").optional(),
    status: policyStatusSchema
      .describe(
        "Instead of a tier: not-stated when the pages read don't address it, not-applicable when it can't apply (no free trial)",
      )
      .optional(),
    reason: textSchema
      .max(policyReasonMax, `Keep it to a sentence or two (${policyReasonMax} characters at most)`)
      .describe('Why, in plain words anyone can follow, shown beside the grade'),
    sources: z
      .array(policySourceSchema)
      .min(1, 'Quote where it says so')
      .max(3, 'Quote at most three pages')
      .describe('Where it says so: a graded rating quotes one to three')
      .optional(),
    pages: z
      .array(httpsUrlSchema)
      .min(1, 'List the pages read, or leave pages out')
      .describe(
        "With a status: the pages read that don't address it (not-stated) or show it can't apply, each one in links",
      )
      .optional(),
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
    action: policyActionSchema
      .describe('Where to change what the reason says the user has to change themselves (M5.12)')
      .optional(),
    lastVerified: isoDateSchema.describe('When the quotes were read'),
  })
  .superRefine((rating, ctx) => {
    const issue = (message: string, key: string) =>
      ctx.addIssue({ code: 'custom', message, path: [key] });
    if (rating.tier === undefined && rating.status === undefined) {
      issue('Give a tier, or a status when the pages give no grade', 'tier');
    } else if (rating.tier !== undefined && rating.status !== undefined) {
      issue('Give a tier or a status, not both', 'status');
    } else if (rating.tier !== undefined) {
      if (!rating.sources) issue('Quote where it says so', 'sources');
      if (rating.pages)
        issue('A graded rating quotes its pages in sources: leave pages out', 'pages');
    } else {
      if (rating.sources) {
        issue('A status quotes nothing: list the pages read in pages instead', 'sources');
      }
      if (rating.status === 'not-stated' && !rating.pages) {
        issue("Say which pages don't address it: list them in pages", 'pages');
      }
      if (rating.action)
        issue('There is nothing to change without a grade: leave action out', 'action');
    }
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
      const cited = [
        ...(rating.sources ?? []).map((source, item) => ({
          url: source.url,
          path: ['sources', item, 'url'],
        })),
        ...(rating.pages ?? []).map((url, item) => ({ url, path: ['pages', item] })),
      ];
      for (const { url, path } of cited) {
        quoted.add(url);
        if (!urls.includes(url)) {
          ctx.addIssue({
            code: 'custom',
            message: 'List this page in links, so the card links it',
            path: ['ratings', index, ...path],
          });
        }
      }
      addDuplicateIssues(ctx, rating.pages ?? [], (item) => ['ratings', index, 'pages', item]);
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
          message: 'No rating quotes this page or lists it in pages: leave it out',
          path: ['links', index, 'url'],
        });
      }
    });
  });
export type Policies = z.infer<typeof policiesSchema>;

/**
 * Whether two ratings of one topic would both apply somewhere with neither more specific: a rating for some plans
 * overrides one for every plan, and one for some regions one for everywhere, so only ratings of the same scope clash.
 * A titled topic's ratings (other.notable) are each about something else, so only the same title clashes.
 */
function clashes(a: PolicyRating, b: PolicyRating): boolean {
  return (
    a.topic === b.topic &&
    a.title === b.title &&
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
