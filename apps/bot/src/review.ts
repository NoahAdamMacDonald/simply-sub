import {
  reviewOutcome,
  reviewRequest,
  sameAmount,
  type PolicyTopic,
  type ReviewItem,
} from '@simply-sub/core';
import { readPrice } from './check-pages';
import { urlOf } from './digest';
import { priceText } from './targets';
import type { Finding, PriceTarget } from './types';

// The digest's review by Workers AI (BLUEPRINT §6.4, M3.10: `reviewer: workers-ai`): for the week's unclear items, the
// free model reads each page's new text (its pending baseline) and proposes, with quotes core checks word for word. A
// price it reads for one the check couldn't confirm becomes an edit; on a suspicious change, it agrees or not; a policy
// grade stays a suggestion; anything unsure is labelled for the owner. A person still merges.

/** Its Neurons per million tokens (Workers AI's pricing page, 2026-10-28), as the extraction counts them. */
const neuronsPerMillion = { input: 26_668, output: 204_805 };
const answerTokens = 600;

export interface Reviewed {
  /** Prices it read, with their quotes checked: edits (or confirmations) for the digest. */
  added: Finding[];
  /** What it made of each item, a line each, for the review list. */
  notes: Map<Finding, string[]>;
  neurons: number;
}

/** Reviews up to `limit` items of `findings` within `neurons`. */
export async function reviewWithModel(
  findings: readonly Finding[],
  topics: readonly PolicyTopic[],
  ask: (system: string, user: string) => Promise<unknown>,
  limit: number,
  neurons: number,
): Promise<Reviewed> {
  const added: Finding[] = [];
  const notes = new Map<Finding, string[]>();
  let left = neurons;
  let done = 0;
  const textOf = (url: string | undefined) => {
    const page = findings.find(
      (finding): finding is Extract<Finding, { kind: 'page' }> =>
        finding.kind === 'page' && finding.url === url,
    );
    return page?.lines.join('\n');
  };
  const quoted = (quotes: readonly string[]) =>
    quotes.map((quote) => `“${quote.slice(0, 120)}”`).join(', ');
  for (const finding of findings) {
    const text = textOf(urlOf(finding));
    if (!text) continue;
    const items = itemsOf(finding, topics, text);
    if (items.length === 0) continue;
    const said: string[] = [];
    /** Why items weren't reviewed → what they were about. */
    const skipped = new Map<string, string[]>();
    for (const item of items) {
      const request = reviewRequest(item);
      const cost = Math.ceil(
        (((request.system.length + request.user.length) / 4) * neuronsPerMillion.input +
          answerTokens * neuronsPerMillion.output) /
          1_000_000,
      );
      const why =
        done >= limit
          ? 'this week’s review items are used up'
          : cost > left
            ? 'no Workers AI left tonight'
            : undefined;
      if (why) {
        const about = item.kind === 'policy' ? item.topic.name : 'its price';
        skipped.set(why, [...(skipped.get(why) ?? []), about]);
        continue;
      }
      left -= cost;
      done++;
      // A policy's notes name the topic they're about.
      const prefix = item.kind === 'policy' ? `${item.topic.name}: ` : '';
      let output: unknown;
      try {
        output = await ask(request.system, request.user);
      } catch {
        said.push(`${prefix}Workers AI failed: for you`);
        continue;
      }
      const outcome = reviewOutcome(item, output);
      switch (outcome.kind) {
        case 'price': {
          const shown = `${outcome.amount} ${item.kind === 'price' ? item.currency : ''}`.trim();
          if (finding.kind === 'manual' && finding.target) {
            const read = readPrice(finding.target, outcome.amount);
            added.push(read);
            said.push(
              read.kind === 'confirmed'
                ? `Workers AI read ${shown}, as the catalog has it (${quoted(outcome.quotes)})`
                : `Workers AI read ${shown} (${quoted(outcome.quotes)}): the edit is in this pull request; check it`,
            );
          } else if (finding.kind === 'changed') {
            said.push(
              sameAmount(outcome.amount, finding.amount)
                ? `Workers AI read ${shown} too (${quoted(outcome.quotes)})`
                : `Workers AI read ${shown} instead (${quoted(outcome.quotes)}): for you`,
            );
          }
          break;
        }
        case 'kept':
          said.push(
            finding.kind === 'changed'
              ? `Workers AI reads the old price (${quoted(outcome.quotes)}): for you`
              : `${prefix}Workers AI finds it unchanged (${quoted(outcome.quotes)})`,
          );
          break;
        case 'grade':
          said.push(
            `${prefix}Workers AI suggests ${outcome.tier}: ${outcome.reason} (${quoted(outcome.quotes)}); grade it yourself`,
          );
          break;
        case 'unsure':
          said.push(`${prefix}Workers AI is unsure (${outcome.why}): for you`);
          break;
      }
    }
    for (const [why, about] of skipped) said.push(`Not reviewed (${why}): ${about.join(', ')}`);
    notes.set(finding, said);
  }
  return { added, notes, neurons: neurons - left };
}

/** What a finding has to review: a price the check couldn't confirm or that moved a lot, or a policy page's ratings. */
function itemsOf(finding: Finding, topics: readonly PolicyTopic[], text: string): ReviewItem[] {
  const priced = (target: PriceTarget): ReviewItem => ({
    kind: 'price',
    label: `${target.label} (${priceText(target.price)})`,
    amount: target.price.amount,
    currency: target.price.currency,
    text,
  });
  if (finding.kind === 'manual' && finding.target) return [priced(finding.target)];
  if (finding.kind === 'changed' && finding.suspicious) return [priced(finding.target)];
  if (finding.kind !== 'policy') return [];
  return finding.target.ratings.flatMap((rating) => {
    const topic = topics.find((candidate) => candidate.id === rating.topic);
    return topic
      ? [
          {
            kind: 'policy' as const,
            label: `${finding.target.provider}'s policies`,
            topic,
            tier: rating.tier,
            quotes: rating.quotes,
            text,
          },
        ]
      : [];
  });
}
