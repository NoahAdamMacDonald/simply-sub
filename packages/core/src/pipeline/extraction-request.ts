import type { Feature } from '../catalog/feature';
import type { PolicyTopic } from '../catalog/policy-topic';
import {
  extractionAnswerJsonSchema,
  extractionAnswerSchema,
  type ExtractionAnswer,
  type ExtractionContext,
  type ExtractionPage,
} from './extraction';
import { excerpt, nameIndexes } from './page-text';

// What a model is asked for an extraction (BLUEPRINT §6.5 ④, M3.4): the rules of the price-research and
// policy-research skills, the feature registry and the policy topics' rubrics, the answer's JSON Schema, and the
// saved pages. A session's model (Claude, run by the owner) reads it all at once; Workers AI reads it in parts that fit
// its context: the plans from the pricing pages, then the policies from the terms' passages on each topic.

/** The rules every extraction follows, whoever answers. */
export const extractionRules = `You read a subscription provider's own pages and answer in JSON, as the schema says. Only what the pages say:
never what you know or expect, never a guess. Every fact carries "page" (the page's name) and "quote": the page's own
words, copied exactly (a few words to a sentence), which a program checks against the page; a fact whose quote isn't
on its page word for word is thrown away.

Plans and prices
- Personal and family plans only. A business, team or per-seat plan is "business": true. A free plan has one price of 0.
- The regular price: what the plan renews at. "$53.88 for the first year, then $83.88" is 83.88. A sale, introductory or
  first-term price alone is "regular": false. A struck-through price beside a lower one is usually the regular one.
- The billing period as the page states it: monthly is month × 1, yearly is year × 1, quarterly is month × 3,
  "every 30 days" is day × 30, "every 4 weeks" is week × 4. A yearly plan's price is what one payment costs ("Billed
  at $99.99 every 12 months"), not its per-month rate.
- The region a price is for: the country its currency and page are for (CA for Canadian dollars on a Canadian page), EU
  for one price across the European Union, GLOBAL for one price everywhere. A converted figure ("€5 is about CA$7.84")
  is not a price in that currency.
- "taxIncluded": only when the page says the price includes sales tax or VAT for every buyer ("Including VAT."), with its
  exact words. "+ tax", "excl. VAT" or "taxes calculated at checkout" means leave it out.
- "autoRenew": false only for prepaid time that never renews by itself.
- An add-on is bought on top of plans (an extra member, a channel): its name, the plans it goes with, and its prices.
- A renamed plan is the same plan, never a new one: give the name the page uses now, and when the page says what it was
  called ("formerly Max 20x", "Max 20x is now Ultra"), say so in "notOnPages" ("Ultra was called Max 20x"), so the
  catalog keeps the plan's id with its new name.

Features
- Only the features in the list, by id, name or alias, with a value the list allows. A plan that doesn't list a
  boolean feature has it as false, so name what the page says it has.
- A capability buyers compare that no feature covers goes in "proposedFeatures", for the owner to approve; an extra of
  this provider alone goes in a plan's "perks".

Where it's sold and how it's paid
- "availableIn": only when the provider lists the countries it sells in, with the words that list them.
- "acceptedNetworks": for each region a page covers, the card networks its words name ("We accept Visa, Mastercard"),
  quoting the words for each. "All major credit cards" names none: leave the region out.

Official resellers
- Only shops the provider's own page names as selling its own subscription ("Where to buy", its resellers page, a blog
  post on its own site), quoting the words that name each one. A company that uses the provider's service in its own
  product (a VPN app running on its servers) is a partner, not a reseller: leave it out.
- Each shop's regular prices, read from the shop's own page for the plan, never a sale price; "excl. VAT" is
  "taxExcluded" with the shop's words.

Policies
- Grade the terms and privacy policy on the topics in the list, with the rubric's grade the quotes fit: great, good,
  neutral, poor or bad. One to three quotes that show it, word for word; when the pages don't settle a topic, leave it out.
- The reason is a sentence or two in plain words anyone can follow, 240 characters at most, saying only what the quotes say.
- A rating for some plans only ("plans") or a country's own terms ("regions") when the page says so.

Say in "notOnPages" what the pages don't say (no yearly price, no list of cards, no countries), and set "outOfScope"
when it isn't a personal or family subscription at all.`;

/** The registry as a list a model reads: each feature's id, what it takes, its name and aliases. */
export function registryDigest(features: readonly Feature[]): string {
  return features
    .flatMap((feature) => {
      let takes: string;
      switch (feature.type) {
        case 'boolean':
          takes = 'true or false';
          break;
        case 'number':
          takes = `a number${feature.unit ? ` of ${feature.unit}` : ''}, or "unlimited"`;
          break;
        case 'enum':
          takes = `one of ${feature.values.map((value) => value.id).join(', ')}`;
          break;
        case 'set':
          // Values from the catalog's own ids (a suite's included plans) are for people to set.
          if (!('values' in feature) || !feature.values) return [];
          takes = `a list of ${feature.values.map((value) => value.id).join(', ')}`;
          break;
      }
      const aliases =
        feature.aliases && feature.aliases.length > 0
          ? `; also "${feature.aliases.join('", "')}"`
          : '';
      const parent = feature.parent ? ` (with ${feature.parent}: true)` : '';
      return [`- ${feature.id}: ${takes}. ${feature.name}${aliases}${parent}`];
    })
    .join('\n');
}

/** The policy topics as a list a model reads: each topic's question and its five grades. */
export function topicsDigest(topics: readonly PolicyTopic[], category: string): string {
  return topics
    .filter((topic) => !topic.categories || topic.categories.includes(category))
    .map(
      (topic) =>
        `- ${topic.id} (${topic.name}): ${topic.question}\n${Object.entries(topic.tiers)
          .map(([tier, meaning]) => `  - ${tier}: ${meaning}`)
          .join('\n')}`,
    )
    .join('\n');
}

/** The pages, each under its name and address. */
function pagesText(pages: readonly ExtractionPage[]): string {
  return pages
    .map((page) => `=== page "${page.name}" (${page.kind}): ${page.url} ===\n${page.text}`)
    .join('\n\n');
}

/** The whole request, for a model that reads it all at once (Claude in a session): Markdown. */
export function extractionPrompt(context: ExtractionContext): string {
  const { provider } = context;
  return [
    `# Extraction: ${provider.name} (${provider.id})`,
    '',
    `Website ${provider.website}; service category ${provider.category}. Read on ${context.today}. Answer with one JSON object that matches the schema below, and save it as the answer file.`,
    '',
    '## Rules',
    '',
    extractionRules,
    '',
    '## Features (data/features.yaml)',
    '',
    registryDigest(context.features),
    '',
    '## Policy topics (data/policy-topics.yaml)',
    '',
    topicsDigest(context.topics, provider.category),
    '',
    '## Answer schema',
    '',
    '```json',
    JSON.stringify(extractionAnswerJsonSchema(), null, 2),
    '```',
    '',
    '## Pages',
    '',
    '```text',
    pagesText(context.pages),
    '```',
    '',
  ].join('\n');
}

/** One request for a model with a small context: its messages. */
export interface ExtractionPart {
  part: 'plans' | 'policies';
  system: string;
  user: string;
}

/** The words each policy topic's passages are found by, in English and French. */
const topicWords: Readonly<Record<string, readonly string[]>> = {
  'privacy.data-collection': [
    'collect',
    'personal information',
    'personal data',
    'renseignements personnels',
  ],
  'privacy.data-sharing': ['sell', 'share', 'third part', 'partenaires', 'vend'],
  'privacy.ads-tracking': ['advertis', 'cookie', 'tracking', 'publicit'],
  'privacy.data-deletion': ['delete', 'deletion', 'erase', 'retain', 'retention', 'supprim'],
  'billing.cancel-refunds': ['cancel', 'refund', 'annul', 'rembours'],
  'billing.price-changes': [
    'price change',
    'change the price',
    'change our price',
    'increase',
    'notify you',
    'prix',
  ],
  'billing.free-trials': ['free trial', 'trial', 'essai'],
  'legal.disputes': ['arbitrat', 'class action', 'dispute', 'court', 'litige'],
  'legal.terms-changes': [
    'change these terms',
    'modify',
    'update these terms',
    'amend',
    'modifier',
  ],
  'legal.account-closure': ['terminat', 'suspend', 'close your account', 'résili'],
  'service.vpn-logging': ['log', 'logging', 'journal'],
  'service.account-sharing': ['household', 'share your account', 'sharing', 'foyer'],
  'service.device-limits': ['device', 'screens', 'streams', 'download', 'appareil'],
};

/**
 * The extraction in parts that each fit `maxChars` of page text (Workers AI's Llama 3.3 70B reads about 24,000 tokens
 * in all): the plans from the pricing, payment, cancel and bundle pages, and the policies from the passages of the
 * terms and privacy pages around each topic's words.
 */
export function extractionParts(context: ExtractionContext, maxChars = 30_000): ExtractionPart[] {
  const { provider } = context;
  const header = `Provider: ${provider.name} (${provider.website}), service category ${provider.category}. Read on ${context.today}.`;
  const schema = JSON.stringify(extractionAnswerJsonSchema());
  const system = `${extractionRules}\n\nAnswer with JSON that matches this schema:\n${schema}`;
  const planPages = context.pages.filter(
    (page) => page.kind !== 'terms' && page.kind !== 'privacy',
  );
  const policyPages = context.pages.filter(
    (page) => page.kind === 'terms' || page.kind === 'privacy',
  );
  const parts: ExtractionPart[] = [];
  if (planPages.length > 0) {
    const share = Math.floor(maxChars / planPages.length);
    parts.push({
      part: 'plans',
      system,
      user: `${header} Fill in plans, addOns, acceptedNetworks, availableIn, resellers, proposedFeatures and notOnPages; leave policies empty.\n\nFeatures:\n${registryDigest(context.features)}\n\n${pagesText(planPages.map((page) => ({ ...page, text: page.text.slice(0, share) })))}`,
    });
  }
  const topics = context.topics.filter(
    (topic) => !topic.categories || topic.categories.includes(provider.category),
  );
  if (policyPages.length > 0 && topics.length > 0) {
    const share = Math.floor(maxChars / policyPages.length);
    const passages = policyPages.map((page) => {
      const words = topics.flatMap(
        (topic) => topicWords[topic.id] ?? topic.name.toLowerCase().split(' '),
      );
      return { ...page, text: excerpt(page.text, nameIndexes(page.text, words), 500, share) };
    });
    parts.push({
      part: 'policies',
      system,
      user: `${header} Fill in policies only; leave plans empty. Quote the passages exactly.\n\nPolicy topics:\n${topicsDigest(context.topics, provider.category)}\n\n${pagesText(passages)}`,
    });
  }
  return parts;
}

/** Workers AI's model for extraction: Llama 3.3 70B, good at reading tables of prices (BLUEPRINT §7.1). */
export const workersAiModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * The answer in a model's output, or undefined: Workers AI gives JSON as an object or as text in `response` (text with
 * words around the JSON is cut to its braces); anything that doesn't match the schema is no answer.
 */
export function readModelAnswer(output: unknown): ExtractionAnswer | undefined {
  const response =
    typeof output === 'object' && output !== null && 'response' in output
      ? output.response
      : output;
  let value: unknown = response;
  if (typeof response === 'string') {
    try {
      value = JSON.parse(response.slice(response.indexOf('{'), response.lastIndexOf('}') + 1));
    } catch {
      return undefined;
    }
  }
  const parsed = extractionAnswerSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The parts' answers as one. */
export function mergeAnswers(answers: readonly ExtractionAnswer[]): ExtractionAnswer {
  const merged: ExtractionAnswer = {
    plans: [],
    addOns: [],
    acceptedNetworks: [],
    policies: [],
    resellers: [],
    proposedFeatures: [],
    notOnPages: [],
  };
  for (const answer of answers) {
    merged.plans.push(...answer.plans);
    merged.addOns.push(...answer.addOns);
    merged.acceptedNetworks.push(...answer.acceptedNetworks);
    merged.policies.push(...answer.policies);
    merged.resellers.push(...answer.resellers);
    merged.proposedFeatures.push(...answer.proposedFeatures);
    merged.notOnPages.push(...answer.notOnPages);
    merged.availableIn ??= answer.availableIn;
    merged.outOfScope ??= answer.outOfScope;
  }
  return merged;
}
