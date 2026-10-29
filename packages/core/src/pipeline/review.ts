import * as z from 'zod';
import type { PolicyTopic } from '../catalog/policy-topic';
import { policyTiers } from '../catalog/policy-topic';
import { moneyIn, sameAmount, sameCurrency } from './amounts';
import { findQuote } from './quotes';

// The free model's review of the digest's unclear items (BLUEPRINT §6.4, M3.10: `reviewer: workers-ai`): the same review a
// person or the scheduled Claude task does, from the page's committed text alone. It proposes only what the page's own
// words show, checked word for word; anything else is labelled for the owner. A price it reads becomes an edit; a
// policy grade it suggests stays a suggestion on the review list, since grading is a person's call.

/** An item to review: a price the check couldn't confirm, or a policy page that changed. */
export type ReviewItem =
  | {
      kind: 'price';
      /** "Netflix Standard (CA in CAD, monthly)". */
      label: string;
      amount: number;
      currency: string;
      /** The page's text now. */
      text: string;
    }
  | {
      kind: 'policy';
      label: string;
      topic: PolicyTopic;
      /** Its grade now, and the quotes it rests on. */
      tier: string;
      quotes: string[];
      text: string;
    };

const reviewAnswerSchema = z.object({
  decision: z.enum(['update', 'keep', 'unsure']),
  amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  tier: z.enum(policyTiers).nullable().optional(),
  reason: z.string().nullable().optional(),
  quotes: z.array(z.string()).default([]),
});
export type ReviewAnswer = z.output<typeof reviewAnswerSchema>;

/** The messages for one item: its fact, the rules, and the page's text (at most `maxChars` of it). */
export function reviewRequest(
  item: ReviewItem,
  maxChars = 20_000,
): { system: string; user: string } {
  const system =
    'You review one fact of a subscription catalog against the text of its page. Report only what the text states, ' +
    'with the page\'s own words copied exactly in "quotes": a quote not on the page word for word is thrown away. ' +
    'Answer "keep" when the fact still holds, "update" when the page shows it changed, and "unsure" when the text ' +
    "doesn't settle it. A sale, introductory or first-term price is never the regular price. Answer in JSON: " +
    '{"decision": "update" | "keep" | "unsure", "amount": number | null, "currency": string | null, ' +
    '"tier": "great" | "good" | "neutral" | "poor" | "bad" | null, "reason": string | null, "quotes": string[]}.';
  const fact =
    item.kind === 'price'
      ? `The catalog says ${item.label} costs ${item.amount} ${item.currency}. What is its regular price on the page?`
      : `The catalog grades ${item.label} "${item.tier}" on "${item.topic.name}": ${item.topic.question} The grades: ${Object.entries(
          item.topic.tiers,
        )
          .map(([tier, meaning]) => `${tier}: ${meaning}`)
          .join(
            ' ',
          )} It rests on: ${item.quotes.map((quote) => `“${quote}”`).join(' ')} Which grade do the page's words fit now? Give a plain-words reason of 240 characters at most.`;
  return { system, user: `${fact}\n\nPage text:\n${item.text.slice(0, maxChars)}` };
}

/** What a review comes to, after its quotes are checked against the page. */
export type ReviewOutcome =
  | { kind: 'price'; amount: number; quotes: string[] }
  | { kind: 'grade'; tier: string; reason: string; quotes: string[] }
  | { kind: 'kept'; quotes: string[] }
  | { kind: 'unsure'; why: string };

/**
 * The model's answer (Workers AI's object, or JSON text) checked against the page: an update stands only with quotes on
 * the page word for word that show it (a price's amount, in its currency); anything else is for the owner.
 */
export function reviewOutcome(item: ReviewItem, output: unknown): ReviewOutcome {
  const response =
    typeof output === 'object' && output !== null && 'response' in output
      ? output.response
      : output;
  let value: unknown = response;
  if (typeof response === 'string') {
    try {
      value = JSON.parse(response.slice(response.indexOf('{'), response.lastIndexOf('}') + 1));
    } catch {
      return { kind: 'unsure', why: 'The model’s answer wasn’t JSON' };
    }
  }
  const parsed = reviewAnswerSchema.safeParse(value);
  if (!parsed.success) return { kind: 'unsure', why: 'The model’s answer didn’t match its shape' };
  const answer = parsed.data;
  const quotes = answer.quotes.flatMap((quote) => findQuote(quote, item.text) ?? []);
  if (answer.decision === 'unsure')
    return { kind: 'unsure', why: answer.reason ?? 'The page doesn’t settle it' };
  if (quotes.length === 0)
    return { kind: 'unsure', why: 'None of its quotes is on the page word for word' };
  /** Whether a quote shows `amount` in the item's currency. */
  const shows = (amount: number) =>
    item.kind === 'price' &&
    quotes.some((quote) =>
      moneyIn(quote).some(
        (mention) =>
          sameAmount(mention.amount, amount) && sameCurrency(mention.currency, item.currency),
      ),
    );
  if (answer.decision === 'keep') {
    // A price kept must be shown, like one read.
    if (item.kind === 'price' && !shows(item.amount)) {
      return { kind: 'unsure', why: 'Its quotes don’t show the catalog’s price' };
    }
    return { kind: 'kept', quotes };
  }
  if (item.kind === 'price') {
    const amount = answer.amount ?? undefined;
    if (amount === undefined || !shows(amount)) {
      return { kind: 'unsure', why: 'Its quotes don’t show the price it read' };
    }
    if (answer.currency && answer.currency.toUpperCase() !== item.currency) {
      return { kind: 'unsure', why: `It read ${answer.currency}, not ${item.currency}` };
    }
    return { kind: 'price', amount, quotes };
  }
  const reason = answer.reason?.replace(/\s+/g, ' ').trim();
  if (!answer.tier || !reason || reason.length > 240) {
    return { kind: 'unsure', why: 'It gave no grade and plain reason of 240 characters at most' };
  }
  return { kind: 'grade', tier: answer.tier, reason, quotes };
}
