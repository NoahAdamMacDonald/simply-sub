import * as z from 'zod';
import { currencySchema, planIdSchema } from '../catalog/formats';
import { intervalSchema, type Price } from '../catalog/price';
import { regionCurrency } from '../catalog/region-currency';
import type { IsoDate } from '../dates/iso-date';
import { moneyIn, sameAmount, sameCurrency } from './amounts';
import type { ExtractionIssue, ExtractionPage } from './extraction';
import { findQuote } from './quotes';

// A region's prices for a provider the catalog has (BLUEPRINT §6.5, PROJECT-PLAN M10.12): its pricing page for that
// region, read in the browser as a visitor there, answers what the provider's plans cost there. Only those prices are
// added, each quoted word for word from its page with its amount, in the region's currency; the provider's other facts
// stay as they are. A model answers (a session's, or Workers AI), and this checks the answer against the pages.

const quoted = {
  page: z.string().describe('The page the quote is on, by its name: pricing, pricing-2'),
  quote: z.string().describe("The page's own words, copied exactly: the amount must be in them"),
};

/** What a model answers for a region: each price it found for one of the provider's plans, with the page's words. */
export const regionalAnswerSchema = z.strictObject({
  prices: z.array(
    z.strictObject({
      plan: planIdSchema.describe("One of the provider's plan ids, as the request lists them"),
      amount: z
        .number()
        .positive()
        .describe('The regular (renewal) price of one billing period, in the major unit: 12.99'),
      currency: currencySchema,
      interval: intervalSchema,
      intervalCount: z.int().positive(),
      ...quoted,
      taxIncluded: z
        .strictObject(quoted)
        .optional()
        .describe('The page’s words saying the price includes tax (VAT), only when it says so'),
    }),
  ),
});
export type RegionalAnswer = z.infer<typeof regionalAnswerSchema>;

/** What the request and the check go by: the provider's plans, the region, and the pages read for it. */
export interface RegionalContext {
  provider: {
    id: string;
    name: string;
    plans: readonly {
      id: string;
      name: string;
      /** Its earlier names (M10.27): a page may still use one, or say what it's called now. */
      formerNames?: readonly { name: string }[];
      prices: readonly Price[];
    }[];
  };
  /** A country, or the EU group when a provider charges every euro country the same. */
  region: string;
  pages: readonly ExtractionPage[];
}

/** The currency a region's prices are in: its own, and the euro for the EU group's one price. */
export function regionalCurrency(region: string): string | undefined {
  return region === 'EU' ? 'EUR' : regionCurrency(region);
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** Where the prices are for, in words: "the United Kingdom", "the euro countries", "Australia". */
export function regionWords(region: string): string {
  if (region === 'EU') return 'the euro countries';
  const name = regionNames.of(region) ?? region;
  return /^(?:United|Netherlands|Czech|Philippines|Bahamas|Gambia)/.test(name)
    ? `the ${name}`
    : name;
}

/** "18.99 CAD monthly", "99 USD every 2 years": a price as the request and the review describe it. */
export function regionalPriceText(
  price: Pick<Price, 'amount' | 'currency' | 'interval' | 'intervalCount'>,
): string {
  const period =
    price.intervalCount === 1
      ? { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[price.interval]
      : `every ${price.intervalCount} ${price.interval}s`;
  return `${price.amount} ${price.currency} ${period}`;
}

/** " (formerly Max 20x)" for a plan's earlier names, else nothing. */
function formerText(formerNames: readonly { name: string }[] | undefined): string {
  return formerNames && formerNames.length > 0
    ? ` (formerly ${formerNames.map(({ name }) => name).join(', ')})`
    : '';
}

/** The request for a session's model or Workers AI: the rules, the provider's plans, and each page's text. */
export function regionalPrompt(context: RegionalContext): string {
  const where = regionWords(context.region);
  const currency = regionalCurrency(context.region) ?? 'its currency';
  const plans = context.provider.plans.map(
    (plan) =>
      `- ${plan.id}: ${plan.name}${formerText(plan.formerNames)}${plan.prices.length > 0 ? ` (the catalog has ${plan.prices.map((price) => `${regionalPriceText(price)} in ${price.region}`).join('; ')})` : ''}`,
  );
  const pages = context.pages.map(
    (page) => `## Page ${page.name} (${page.kind}, ${page.url})\n\n${page.text}`,
  );
  return [
    `You read ${context.provider.name}'s own pricing page as shown in ${where}, and answer in JSON. The catalog already has ${context.provider.name}: only its prices in ${where} are wanted, in ${currency}.`,
    '',
    'Rules:',
    `- For each plan below that the page prices for ${where}, give its regular price: what it renews at, never a sale, introductory or first-term price. A plan billed for several periods (monthly, yearly) has a price for each.`,
    '- amount is in the major unit (12.99), currency an ISO 4217 code, interval day, week, month or year, with intervalCount: 3 months is month and 3; "every 30 days" is day and 30.',
    "- page is the page's name; quote is the page's own words that show the price, copied exactly, with the amount in them.",
    '- taxIncluded only when the page says the price includes tax (VAT), with its words.',
    '- A plan the page calls by a new name is still the plan below with its id: renamed plans keep their ids.',
    '- Leave out a plan the page doesn’t price, and anything else.',
    '',
    'Answer as {"prices": [{"plan": "<plan id>", "amount": 0, "currency": "", "interval": "month", "intervalCount": 1, "page": "", "quote": "", "taxIncluded": {"page": "", "quote": ""}}]}, taxIncluded only when it applies.',
    '',
    'The plans:',
    ...plans,
    '',
    ...pages,
    '',
  ].join('\n');
}

/** A price the check kept: its plan's id, the catalog's price, and the page's words that show it. */
export interface RegionalPrice {
  plan: string;
  price: Price;
  quote: string;
}

/**
 * Checks an answer against the pages, as for a new provider (draftFromAnswer): kept are prices for the provider's
 * plans in the region's currency, each quoted on its page with its amount, one a plan and period; the rest are
 * dropped, each with why. A kept price renews as the plan's other prices for that period do.
 */
export function regionalPrices(
  answer: RegionalAnswer,
  context: RegionalContext,
  today: IsoDate,
): { prices: RegionalPrice[]; issues: ExtractionIssue[] } {
  const prices: RegionalPrice[] = [];
  const issues: ExtractionIssue[] = [];
  const pages = new Map(context.pages.map((page) => [page.name, page]));
  const plans = new Map(context.provider.plans.map((plan) => [plan.id, plan]));
  const currency = regionalCurrency(context.region);
  for (const found of answer.prices) {
    const subject = `${found.plan}: ${regionalPriceText(found)}`;
    const drop = (reason: string) =>
      issues.push({ kind: 'dropped', subject, reason, page: found.page, quote: found.quote });
    const plan = plans.get(found.plan);
    const page = pages.get(found.page);
    if (!plan) {
      drop(`It isn't one of ${context.provider.name}'s plans.`);
      continue;
    }
    if (found.currency !== currency) {
      drop(`It's in ${found.currency}, not ${currency ?? "the region's currency"}.`);
      continue;
    }
    if (Math.abs(found.amount * 100 - Math.round(found.amount * 100)) > 1e-6) {
      drop('Its amount has more than 2 decimals.');
      continue;
    }
    const words = page && findQuote(found.quote, page.text);
    if (!page || !words) {
      drop(`Its quote isn't on the page${page ? '' : ` (there's no page ${found.page})`}.`);
      continue;
    }
    const shown = moneyIn(words).some(
      (mention) =>
        sameAmount(mention.amount, found.amount) && sameCurrency(mention.currency, found.currency),
    );
    if (!shown) {
      drop(`Its quote doesn't show ${found.amount} ${found.currency}.`);
      continue;
    }
    const twin = prices.find(
      (kept) =>
        kept.plan === found.plan &&
        kept.price.interval === found.interval &&
        kept.price.intervalCount === found.intervalCount,
    );
    if (twin) {
      drop(`${found.plan} already has a price for that period: ${regionalPriceText(twin.price)}.`);
      continue;
    }
    const tax = found.taxIncluded && pages.get(found.taxIncluded.page);
    const taxWords = tax && found.taxIncluded && findQuote(found.taxIncluded.quote, tax.text);
    if (found.taxIncluded && !taxWords) {
      issues.push({
        kind: 'warning',
        subject,
        reason: 'Its "tax included" words aren’t on the page, so tax counts as added.',
      });
    }
    const renews =
      plan.prices.find(
        (price) => price.interval === found.interval && price.intervalCount === found.intervalCount,
      ) ?? plan.prices[0];
    prices.push({
      plan: found.plan,
      quote: words,
      price: {
        region: context.region,
        currency: found.currency,
        amount: found.amount,
        interval: found.interval,
        intervalCount: found.intervalCount,
        autoRenew: renews?.autoRenew ?? true,
        ...(taxWords && { taxIncluded: { quote: taxWords } }),
        lastVerified: today,
        sourceUrl: page.url,
      },
    });
  }
  return { prices, issues };
}
