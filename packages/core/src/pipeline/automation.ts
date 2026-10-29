import * as z from 'zod';
import { daysBetween, weekdayOf, type IsoDate } from '../dates/iso-date';
import { searchEngineSchema, type SearchBudget } from './search';

// The automation's settings, data/automation.yaml (BLUEPRINT §6.4, §7.7, M3.8): how often the nightly bot checks each
// kind of page and runs discovery, who reviews what it can't settle, how much it does a night and how many web
// searches it and this machine may make a month. The bot reads the file from main every night, so a change takes a
// merge, not a redeploy. No part needs a Claude subscription: scheduled-claude is one reviewer among three.

export const cadenceSchema = z
  .enum(['daily', 'weekly', 'monthly', 'off'])
  .describe('How often: daily, weekly (7 days), monthly (30 days) or off');
export type Cadence = z.infer<typeof cadenceSchema>;

export const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const budgetSchema = z.int().nonnegative('Must be a whole number of 0 or more');

export const automationSchema = z
  .strictObject({
    cadence: z
      .strictObject({
        pricing: cadenceSchema.describe(
          'Price pages, and the pages that name resellers and accepted cards',
        ),
        policies: cadenceSchema.describe('The pages policy ratings quote: terms, privacy policies'),
        logos: cadenceSchema.describe('Each provider’s and reseller’s icon, for a rebrand'),
        discovery: cadenceSchema.describe('A batch of queued services drafted into a pull request'),
      })
      .describe('How often the bot does each thing'),
    digest: z
      .strictObject({
        day: z.enum(weekdays).describe('The day the weekly pull request is built (UTC)'),
      })
      .describe('The weekly pull request of what changed'),
    reviewer: z
      .enum(['scheduled-claude', 'workers-ai', 'manual'])
      .describe(
        'Who reviews what the bot can’t settle: scheduled-claude (a weekly Claude Code task), workers-ai (the free model, labelling anything unsure) or manual (it waits in the pull request)',
      ),
    batch: z
      .strictObject({
        discovery: budgetSchema.describe('Services a discovery run takes from the queue'),
        browserPages: budgetSchema.describe(
          'Pages Browser Rendering may open a night (the free plan has 10 browser-minutes a day)',
        ),
        neurons: budgetSchema.describe(
          'Workers AI Neurons a night may use (the free plan has 10,000 a day)',
        ),
        reviewItems: budgetSchema.describe('Review items Workers AI reviews a week, at most'),
      })
      .describe('How much is done at a time'),
    search: z
      .array(
        z.strictObject({
          engine: searchEngineSchema,
          bot: budgetSchema.describe('Searches the bot may make a month').optional(),
          local: budgetSchema
            .describe('Searches this machine’s scripts may make a month')
            .optional(),
        }),
      )
      .min(1, 'List at least one engine')
      .describe(
        'Web search engines, tried in this order, each until its monthly budget is spent; no budget is no limit (your own SearXNG)',
      ),
  })
  .superRefine((automation, ctx) => {
    const engines = automation.search.map((entry) => entry.engine);
    engines.forEach((engine, index) => {
      if (engines.indexOf(engine) !== index) {
        ctx.addIssue({
          code: 'custom',
          message: `"${engine}" is listed more than once`,
          path: ['search', index, 'engine'],
        });
      }
    });
    // Tavily's free plan stops at its allowance, and Brave bills past its $5 credit: both need a budget.
    automation.search.forEach((entry, index) => {
      if (entry.engine === 'searxng') return;
      for (const place of ['bot', 'local'] as const) {
        if (entry[place] === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: `Give ${entry.engine} a monthly ${place} budget: only your own SearXNG may have none`,
            path: ['search', index, place],
          });
        }
      }
    });
  })
  .meta({
    title: 'Simply Sub automation',
    description:
      'data/automation.yaml: how often the nightly bot checks pages and runs discovery, who reviews, and its budgets (BLUEPRINT §6.4)',
  });
export type Automation = z.infer<typeof automationSchema>;

/** How many days apart a cadence's runs are; undefined for off. */
export function cadenceDays(cadence: Cadence): number | undefined {
  return { daily: 1, weekly: 7, monthly: 30, off: undefined }[cadence];
}

/** Whether something last done on `last` (never, when undefined) is due on `today`. */
export function isDue(cadence: Cadence, last: IsoDate | undefined, today: IsoDate): boolean {
  const days = cadenceDays(cadence);
  if (days === undefined) return false;
  return last === undefined || daysBetween(last, today) >= days;
}

/** Whether `today` is the digest's day, and it hasn't been built today. */
export function digestDue(
  automation: Automation,
  today: IsoDate,
  lastDigest: IsoDate | undefined,
): boolean {
  // weekdayOf counts from 0 for Sunday; the list starts on Monday.
  return weekdays[(weekdayOf(today) + 6) % 7] === automation.digest.day && lastDigest !== today;
}

/** The engines and monthly budgets one place may use: the bot's share or this machine's. */
export function searchBudgets(automation: Automation, place: 'bot' | 'local'): SearchBudget[] {
  return automation.search.map((entry) => ({
    engine: entry.engine,
    ...(entry[place] !== undefined && { monthly: entry[place] }),
  }));
}
