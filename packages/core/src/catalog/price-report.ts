import * as z from 'zod';
import { currencySchema, isoDateSchema, planIdSchema } from './formats';
import { intervalSchema, type Price } from './price';
import { globalRegion, groupsOf, isoRegions } from './regions';

// "Report a wrong price" (PROJECT-PLAN M10.10, M10.11; BLUEPRINT §5.2, §14): what a visitor says is wrong with a plan's
// price in their country, in choices only. There's no free text, so nothing a visitor types reaches a person or a
// model. POST /reports takes one; the user database counts them, a row per plan, country, problem and price, with
// nothing about the sender; the nightly clean-up hands each reported plan's counts to the bot's KV, and the bot checks
// the plan's pages that night and puts what it found in the weekly digest.

/** What's wrong: the page charges another price, the plan isn't sold any more, or it isn't sold in that country. */
export const reportProblemSchema = z.enum(['price', 'discontinued', 'not-in-country']);
export type ReportProblem = z.infer<typeof reportProblemSchema>;

/** Where a report comes from: a country's ISO 3166-1 alpha-2 code, not a group or GLOBAL. */
export const reportCountrySchema = z
  .string()
  .refine(
    (code) => isoRegions.has(code),
    'Use a two-letter ISO 3166-1 country code in capitals (CA, GB)',
  );

/** The price a visitor sees for one billing period, as the catalog writes a price. */
export const reportedPriceSchema = z.strictObject({
  amount: z
    .number()
    .positive('Must be more than 0')
    .max(100_000, 'Must be at most 100,000')
    .refine(
      (amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6,
      'Use at most 2 decimals',
    ),
  currency: currencySchema,
  interval: intervalSchema,
  intervalCount: z.int().min(1, 'Must be at least 1').max(60, 'Must be at most 60'),
});
export type ReportedPrice = z.infer<typeof reportedPriceSchema>;

const reportOf = { plan: planIdSchema, country: reportCountrySchema };

/** POST /reports' body: a plan, the visitor's country and what's wrong, with the price they see for a price. */
export const priceReportSchema = z.discriminatedUnion('problem', [
  z.strictObject({ ...reportOf, problem: z.literal('price'), price: reportedPriceSchema }),
  z.strictObject({ ...reportOf, problem: z.literal('discontinued') }),
  z.strictObject({ ...reportOf, problem: z.literal('not-in-country') }),
]);
export type PriceReport = z.infer<typeof priceReportSchema>;

/** A plan's reports for one country, problem and price, as counted: how many, and the first and last day. */
export const reportCountSchema = z.strictObject({
  country: reportCountrySchema,
  problem: reportProblemSchema,
  price: reportedPriceSchema.optional(),
  count: z.int().positive(),
  first: isoDateSchema,
  last: isoDateSchema,
});
export type ReportCount = z.infer<typeof reportCountSchema>;

/** A reported plan's counts, as the bot's KV keeps them until the weekly digest has them. */
export const reportedPlanSchema = z.strictObject({
  plan: planIdSchema,
  reports: z.array(reportCountSchema).min(1),
});
export type ReportedPlan = z.infer<typeof reportedPlanSchema>;

/** The start of the KV keys reported plans are kept under, one each, in the bot's part of the namespace. */
export const reportKeyPrefix = 'bot:report:';

/** The KV key a plan's reports are kept under. */
export function reportKey(plan: string): string {
  return `${reportKeyPrefix}${plan}`;
}

/** What a report's price is counted under: its fields in one order, or '' for a report without a price. */
export function reportPriceKey(price: ReportedPrice | undefined): string {
  if (price === undefined) return '';
  const { amount, currency, interval, intervalCount } = price;
  return JSON.stringify({ amount, currency, interval, intervalCount });
}

/**
 * `counts` added to the plan's reports kept so far: the same country, problem and price add up, keeping the first day
 * and the last. A plan's list stays in the order its reports first came.
 */
export function addReports(
  kept: ReportedPlan | undefined,
  plan: string,
  counts: readonly ReportCount[],
): ReportedPlan {
  const reports = (kept?.reports ?? []).map((report) => ({ ...report }));
  for (const count of counts) {
    const same = reports.find(
      (report) =>
        report.country === count.country &&
        report.problem === count.problem &&
        reportPriceKey(report.price) === reportPriceKey(count.price),
    );
    if (same === undefined) {
      reports.push({ ...count });
    } else {
      same.count += count.count;
      if (count.first < same.first) same.first = count.first;
      if (count.last > same.last) same.last = count.last;
    }
  }
  return { plan, reports };
}

/**
 * The prices a report from `country` is about: the country's own, else its group's (EU for Germany), else the
 * provider's one price everywhere (GLOBAL). None when the catalog doesn't price the plan there yet.
 */
export function reportedPrices<T extends Pick<Price, 'region'>>(
  prices: readonly T[],
  country: string,
): T[] {
  const region = [country, ...groupsOf(country), globalRegion].find((where) =>
    prices.some((price) => price.region === where),
  );
  return region === undefined ? [] : prices.filter((price) => price.region === region);
}
