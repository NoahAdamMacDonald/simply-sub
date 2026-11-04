import * as z from 'zod';
import { tiersText } from './targets';
import type { PriceTarget, RateTarget } from './types';

// Reading prices off a page with Workers AI (BLUEPRINT §6.4), for the prices whose stored amount isn't on it any more.
// Llama 3.3 70B in JSON mode reads an excerpt of the page around the plans' names, and says each plan's regular price,
// or that the page shows only a sale or first-term one, which is never taken.

/** The model: one of the few with JSON mode on Workers AI, and good at reading tables of prices. */
export const extractionModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Its Neurons per million tokens (Workers AI's pricing page, 2026-10-28), for the night's budget. */
const neuronsPerMillion = { input: 26_668, output: 204_805 };

/** The most tokens its answer takes: a few numbers per plan. */
const answerTokens = 400;

export interface ExtractionRequest {
  messages: { role: 'system' | 'user'; content: string }[];
  response_format: { type: 'json_schema'; json_schema: object };
  max_tokens: number;
}

/** The request for `targets`, all on one page, given the part of its text that names them. */
export function extractionRequest(
  text: string,
  targets: readonly PriceTarget[],
): ExtractionRequest {
  const wanted = targets
    .map(
      (target, index) =>
        `${index + 1}. ${target.label}: billed every ${target.price.intervalCount} ${target.price.interval}${target.price.intervalCount === 1 ? '' : 's'}, last seen at ${target.price.amount} ${target.price.currency}`,
    )
    .join('\n');
  return {
    messages: [
      {
        role: 'system',
        content:
          'You read subscription prices from the text of a web page. Report only what the text states. The regular ' +
          'price is what the plan renews at. A sale, discount, promotional, introductory or first-term price is not ' +
          'regular: when the text shows only such a price for a plan, say so. Give amounts as numbers in the ' +
          "page's currency, with its ISO 4217 code, and quote the page's own words that show each price, copied " +
          'exactly: a quote that is not on the page word for word is thrown away.',
      },
      { role: 'user', content: `Plans to find:\n${wanted}\n\nPage text:\n${text}` },
    ],
    response_format: { type: 'json_schema', json_schema: answerSchema },
    max_tokens: answerTokens,
  };
}

const answerSchema = {
  type: 'object',
  properties: {
    prices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          plan: { type: 'integer', description: 'The number of the plan in the list' },
          found: {
            type: 'boolean',
            description: 'Whether the text gives a price for this plan and period',
          },
          regularAmount: { type: ['number', 'null'] },
          currency: { type: ['string', 'null'] },
          onlySalePrice: { type: 'boolean' },
          quote: {
            type: ['string', 'null'],
            description: "The page's own words that show the price, copied exactly",
          },
        },
        required: ['plan', 'found', 'regularAmount', 'currency', 'onlySalePrice', 'quote'],
      },
    },
  },
  required: ['prices'],
};

/**
 * The request for `targets`' posted rates, all on one page (M11.14): each tier from the balance it starts at, with the
 * page's words for its rate. A promotional, bonus or boosted rate is never taken, as a sale price never is.
 */
export function rateExtractionRequest(
  text: string,
  targets: readonly RateTarget[],
): ExtractionRequest {
  const wanted = targets
    .map(
      (target, index) =>
        `${index + 1}. ${target.label}: last seen at ${tiersText(target.rates.tiers)}`,
    )
    .join('\n');
  return {
    messages: [
      {
        role: 'system',
        content:
          'You read the posted interest rates of bank accounts from the text of a web page. Report only what the ' +
          'text states. The posted rate is the regular rate an account pays: a promotional, bonus, boosted or ' +
          'introductory rate is not, so never report one. An account can pay different rates by balance: give each ' +
          'tier, from the balance it starts at (0 for the first), with its rate in percent a year (2.25 for 2.25%). ' +
          "Quote the page's own words that show each rate, copied exactly: a quote that is not on the page word for " +
          'word is thrown away.',
      },
      { role: 'user', content: `Accounts to find:\n${wanted}\n\nPage text:\n${text}` },
    ],
    response_format: { type: 'json_schema', json_schema: rateAnswerSchema },
    max_tokens: answerTokens,
  };
}

const rateAnswerSchema = {
  type: 'object',
  properties: {
    accounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          account: { type: 'integer', description: 'The number of the account in the list' },
          found: { type: 'boolean', description: 'Whether the text gives its posted rates' },
          tiers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: {
                  type: 'number',
                  description: 'The balance the rate starts at: 0 for the first',
                },
                rate: { type: 'number', description: 'Percent a year: 2.25 for 2.25%' },
                quote: {
                  type: 'string',
                  description: "The page's own words that show the rate, copied exactly",
                },
              },
              required: ['from', 'rate', 'quote'],
            },
          },
        },
        required: ['account', 'found', 'tiers'],
      },
    },
  },
  required: ['accounts'],
};

/** One account's answer, as the check uses it. */
export interface ExtractedRates {
  found: boolean;
  tiers: { from: number; rate: number; quote: string }[];
}

const rateAnswerShape = z.object({
  accounts: z.array(
    z.object({
      account: z.number().int(),
      found: z.boolean(),
      tiers: z
        .array(
          z.object({
            from: z.number().nonnegative(),
            rate: z.number().nonnegative().max(100),
            quote: z.string(),
          }),
        )
        .optional(),
    }),
  ),
});

/** Each target's answer about its rates, in the targets' order: undefined for one the model didn't answer. */
export function readRateExtraction(output: unknown, count: number): (ExtractedRates | undefined)[] {
  const parsed = rateAnswerShape.safeParse(answerValue(output));
  const answers: (ExtractedRates | undefined)[] = Array.from({ length: count }, () => undefined);
  if (!parsed.success) return answers;
  for (const answer of parsed.data.accounts) {
    const index = answer.account - 1;
    if (index < 0 || index >= count || answers[index] !== undefined) continue;
    const tiers = answer.tiers ?? [];
    answers[index] = { found: answer.found && tiers.length > 0, tiers };
  }
  return answers;
}

/** Workers AI's answer as a value: its JSON object, or its text parsed; anything else reads as nothing. */
function answerValue(output: unknown): unknown {
  const response =
    typeof output === 'object' && output !== null
      ? (output as { response?: unknown }).response
      : undefined;
  if (typeof response !== 'string') return response;
  try {
    return JSON.parse(response);
  } catch {
    return undefined;
  }
}

/** One plan's answer, as the check uses it. */
export interface ExtractedPrice {
  found: boolean;
  regularAmount?: number;
  currency?: string;
  onlySalePrice: boolean;
  /** The page's words that show it, which the check finds on the page before taking the price (M3.9). */
  quote?: string;
}

const answerShape = z.object({
  prices: z.array(
    z.object({
      plan: z.number().int(),
      found: z.boolean(),
      regularAmount: z.number().nonnegative().nullable().optional(),
      currency: z.string().nullable().optional(),
      onlySalePrice: z.boolean().optional(),
      quote: z.string().nullable().optional(),
    }),
  ),
});

/**
 * Each target's answer, in the targets' order: undefined for one the model didn't answer. Workers AI gives the JSON
 * as an object, or as text when it couldn't keep to the schema; anything else reads as no answers.
 */
export function readExtraction(output: unknown, count: number): (ExtractedPrice | undefined)[] {
  const parsed = answerShape.safeParse(answerValue(output));
  const answers: (ExtractedPrice | undefined)[] = Array.from({ length: count }, () => undefined);
  if (!parsed.success) return answers;
  for (const answer of parsed.data.prices) {
    const index = answer.plan - 1;
    if (index < 0 || index >= count || answers[index] !== undefined) continue;
    answers[index] = {
      found: answer.found && answer.regularAmount !== null && answer.regularAmount !== undefined,
      ...(answer.regularAmount !== null &&
        answer.regularAmount !== undefined && { regularAmount: answer.regularAmount }),
      ...(answer.currency && { currency: answer.currency.trim().toUpperCase() }),
      onlySalePrice: answer.onlySalePrice ?? false,
      ...(answer.quote && { quote: answer.quote }),
    };
  }
  return answers;
}

/** About how many Neurons a request takes: four characters a token, and the longest answer. */
export function neuronEstimate(request: ExtractionRequest): number {
  const characters = request.messages.reduce((total, message) => total + message.content.length, 0);
  return Math.ceil(
    ((characters / 4) * neuronsPerMillion.input + answerTokens * neuronsPerMillion.output) /
      1_000_000,
  );
}
