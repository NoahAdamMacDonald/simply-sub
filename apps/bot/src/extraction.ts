import * as z from 'zod';
import type { PriceTarget } from './types';

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
          "page's currency, with its ISO 4217 code.",
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
        },
        required: ['plan', 'found', 'regularAmount', 'currency', 'onlySalePrice'],
      },
    },
  },
  required: ['prices'],
};

/** One plan's answer, as the check uses it. */
export interface ExtractedPrice {
  found: boolean;
  regularAmount?: number;
  currency?: string;
  onlySalePrice: boolean;
}

const answerShape = z.object({
  prices: z.array(
    z.object({
      plan: z.number().int(),
      found: z.boolean(),
      regularAmount: z.number().nonnegative().nullable().optional(),
      currency: z.string().nullable().optional(),
      onlySalePrice: z.boolean().optional(),
    }),
  ),
});

/**
 * Each target's answer, in the targets' order: undefined for one the model didn't answer. Workers AI gives the JSON
 * as an object, or as text when it couldn't keep to the schema; anything else reads as no answers.
 */
export function readExtraction(output: unknown, count: number): (ExtractedPrice | undefined)[] {
  const response =
    typeof output === 'object' && output !== null
      ? (output as { response?: unknown }).response
      : undefined;
  let value: unknown = response;
  if (typeof response === 'string') {
    try {
      value = JSON.parse(response);
    } catch {
      value = undefined;
    }
  }
  const parsed = answerShape.safeParse(value);
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
