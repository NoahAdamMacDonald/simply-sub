import type { Feature } from '../catalog/feature';
import { silentMeaning, type PolicyTopic } from '../catalog/policy-topic';
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

/**
 * How every policy rating is graded (M11.1, docs/catalog-expansion-guide.md §1.3): the policy-research skill's Rules
 * state it word for word, which a test checks, so a rating by hand and one by the pipeline follow the same steps.
 */
export const policyProcedure = `1. Find the clauses for the topic in every document a user agrees to: the terms (or subscriber agreement), the
   privacy policy, its apps' licence (EULA), what the sign-up form's checkbox names, and what any of them includes by
   reference (an acceptable-use policy, community rules, another company's terms); then the help centre's billing and
   privacy pages. Quote up to three, word for word. A grade read from a form or a sign-up flow quotes the page that
   hosts it, and the reason says so. Read each of those documents whole, not only the clauses a topic names: step 12
   is for what no topic covers.
2. The default: what happens if you do nothing? Protective is Great or Good. Not protective is Neutral or worse.
3. The control, when the default isn't protective. Self-serve (a setting in the account or app, a one-click link, a
   form that takes effect at once, for the account on every device) is Neutral. Partial (some data, apps, products or
   devices; one use of the data while collecting it goes on; set per device or browser, or reset, like cookie choices)
   is Poor. On request (an email, a letter, a ticket, a form that promises a reply or a review) is Poor for an
   opt-out; deletion and export have their own rubrics. None is Bad. A topic's own rubric beats this step where both
   name the same thing.
4. Necessary exceptions never count against a grade, and the list is closed: a legal duty, preventing fraud and abuse
   (enforcing its terms, protecting its rights), a safety review, security, and processing a payment. Anything else
   is a business purpose and counts: analytics, "improving our services", marketing, training, personalisation,
   "legitimate interests". An exception is judged by what the data is used for, not by what selects it: chats flagged
   for a safety review and then used to improve models count. De-identified or aggregated data doesn't count, unless
   the policy says it may re-identify it, or de-identifying is the only opt-out offered.
5. Scope: the rating for the whole provider covers every region and plan without a rating of its own, at the worst
   clause that applies to any of them. A clause for only some countries or plans is a rating with "regions" or
   "plans", better or worse. A right only some countries have (California's "Do Not Sell") is a rating for them, and
   the provider-wide rating is graded as if it didn't exist. A province's law never changes a grade: a CA rating is
   graded for the rest of Canada, and its reason mentions Quebec.
6. Broad wording is read broadly: "may", "such as" and "including but not limited to" reserve the right, so grade as
   if it's used. Service providers and processors acting for it run the service; affiliates are its own group;
   partners with no stated purpose are other companies using the data for their own ends. A denial that names the act
   ("we do not sell your data") beats a generic reservation; otherwise the reservation wins.
7. One fact, one topic: a fact lowers the grade of the one topic whose question it answers (the routing below). It may
   be quoted under another topic only when that grade is the same without it. What data is used for is graded under
   that use's topic.
8. Silence: when nothing read addresses the topic, the topic's "silent" rule says whether it gets a grade or the
   status not-stated, with the pages read. A topic that can't apply (no free trial) has the status not-applicable.
   Every topic that applies gets a rating or a status, never nothing.
9. A topic and a feature on the same fact both stay, and must agree: activity logging is Great only when the plans'
   vpn.independent-audits includes no-logs. A topic grades only what the feature doesn't say: device limits grade
   registration caps and download expiry, never the number of devices.
10. A rating that depends on the user acting (an opt-out, a deletion request, an export: the grades its topic's
    "actionFor" lists, which validation checks) has an "action": the provider's own page for it, so the user gets
    there in one click. When the change is the browser's or the device's own setting, link the provider's page that
    explains it.
11. Calibrate: grade the same fact the same way for every provider. Before grading one, read the same topics for two
    providers already graded in its category.
12. Notable: a term that stands out and that no topic covers (a VPN that takes cash, a VPN built on another company's
    network) is an other.notable rating with a short "title", graded on the scale, up to three. Never leave a notable
    term out because no topic fits.
13. Security: a provider that sees your traffic, messages, files or passwords, or runs with deep access to your
    device (VPN, DNS, antivirus, email, password managers, browsers), is read for its audits page (Mullvad's
    "External audits" posts), its bug bounty or vulnerability disclosure policy and its security advisories. They
    grade security.practices, and an audit that tested a no-logs claim is vpn.independent-audits' no-logs.
14. The reason explains it like you would to a five-year-old: short sentences, everyday words, what it means for you,
    and only what the quotes say.`;

/** Which topic a fact belongs to (the guide's §1.5): the skill's Rules state it word for word too. */
export const policyRouting = `- Trains AI on your chats, files or photos: privacy.ai-training.
- Recommends from what you watch or listen to; analytics, telemetry, crash reports; a spam filter or recommendations
  trained on your content: privacy.data-collection.
- Shows you ads chosen from your activity, in its apps or anywhere else, and data collected only for ads:
  privacy.ads-tracking (privacy.data-collection grades what's left).
- Data that reaches another company (a Meta or Google pixel, ad networks), even to show its own ads; selling to data
  brokers: privacy.data-sharing.
- A licence over your content that includes training AI: privacy.ai-training (legal.content-rights grades the rest).
- Staff reading your messages for support or quality: privacy.content-access.
- How you ask for deletion, and whether it happens: privacy.data-deletion.
- How long anything stays, deleted data included ("chats are kept 30 days"): privacy.data-retention.
- An inactive account closed and its data deleted: legal.inactivity.
- An account closed for a breach, with no refund: legal.account-closure.
- A free trial or an introductory price ending: billing.free-trials.
- A renewal into a dearer plan, with no trial before it: billing.renewal-notice.
- A fee to cancel: billing.cancellation (Bad), and the provider's cancelFee.
- A currency markup at checkout: billing.fees.
- A game removed from your purchased library: legal.service-changes.
- What its apps' licence lets you do (personal or non-commercial use only, one person per copy, no reviews or
  benchmarks): legal.licence.
- Apps that update themselves, change your settings or remove other software: service.software-control.
- Throttling or network management: a plan feature, not a policy.`;

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
- "paymentMethods": every way to pay a page names (cards, PayPal, Apple Pay, Google Pay, Klarna, Satispay, Cash App,
  app stores and platforms that bill for it, gift cards or vouchers, a bank transfer or direct debit (iDEAL | Wero,
  Swish), cash, crypto, a TV, internet or phone bill), quoting the words for each: an entry per page, for every buyer,
  and others for a country whose own pages differ. Look for the alternatives: a provider that takes cash or crypto
  says so.
- "currencies": currencies it takes beyond its prices' (cash by post in nine currencies, a checkout that charges in
  the buyer's own), with the words naming each, and the ways to pay that take them.
- "renewalAnchor": which day a paid plan renews on, from its terms or billing help: the date you signed up
  ("same-date", with a shorter month's last day when it has no such date), "every-30-days", the 1st of each month
  ("first-of-month") or its last day ("end-of-month"), quoting the words that say so; "not-stated" when they don't.
- "sourceRepo": when a page says its code is open source and shows the repository's address in its words.

Official resellers
- Only shops the provider's own page names as selling its own subscription ("Where to buy", its resellers page, a blog
  post on its own site), quoting the words that name each one. A company that uses the provider's service in its own
  product (a VPN app running on its servers) is a partner, not a reseller: leave it out.
- Each shop's regular prices, read from the shop's own page for the plan, never a sale price; "excl. VAT" is
  "taxExcluded" with the shop's words.

Policies
- Grade the terms and privacy policy on the topics in the list, with the rubric's grade the quotes fit: great, good,
  neutral, poor or bad, following the procedure below. One to three quotes that show it, word for word.
- When the pages don't address a topic, give it "status": "not-stated" and no tier or quotes, with a reason ("Its terms
  and privacy policy don't say"); the topic's silent rule decides what that means. When it can't apply (no free
  trial), "status": "not-applicable".
- The reason is a sentence or two in plain words anyone can follow, 240 characters at most, saying only what the quotes say.
- A rating for some plans only ("plans") or a country's own terms ("regions") when the page says so.
- other.notable is for something that stands out and no topic covers: up to three, each with a short "title".

How to grade (the policy-research skill's procedure)
${policyProcedure}

Which topic a fact belongs to
${policyRouting}

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

/**
 * The policy topics as a list a model reads: each topic's question, how to read it, its five grades, and what silence
 * means for a provider in `category`.
 */
export function topicsDigest(topics: readonly PolicyTopic[], category: string): string {
  return topics
    .filter((topic) => !topic.categories || topic.categories.includes(category))
    .map((topic) => {
      const silent = topic.titled ? undefined : silentMeaning(topic, [category]);
      return [
        `- ${topic.id} (${topic.name}): ${topic.question}`,
        ...(topic.note ? [`  ${topic.note}`] : []),
        ...Object.entries(topic.tiers).map(([tier, meaning]) => `  - ${tier}: ${meaning}`),
        ...(silent ? [`  - if the pages are silent: ${silent}`] : []),
      ].join('\n');
    })
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

/** The words a renewal day's passage is found by (M11.5), in English and French. */
const renewalWords: readonly string[] = [
  'billing date',
  'billing cycle',
  'billed on',
  'same day',
  '30 days',
  'of each month',
  'date de facturation',
];

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
  'privacy.ai-training': [
    'train',
    'machine learning',
    'artificial intelligence',
    'model',
    'entraîn',
  ],
  'privacy.content-access': [
    'encrypt',
    'end-to-end',
    'zero-access',
    'access your content',
    'chiffr',
  ],
  'privacy.data-retention': ['retain', 'retention', 'keep', 'as long as', 'conserv'],
  'privacy.data-deletion': ['delete', 'deletion', 'erase', 'supprim'],
  'privacy.data-portability': ['export', 'download your data', 'portab', 'copy of your'],
  'privacy.government-requests': [
    'law enforcement',
    'government',
    'subpoena',
    'court order',
    'transparency report',
    'autorités',
  ],
  'privacy.data-location': ['transfer', 'stored in', 'located', 'countr', 'standard contractual'],
  'privacy.sign-up-data': ['sign up', 'create an account', 'phone number', 'email address'],
  'privacy.children': ['child', 'minor', 'under the age', 'parental', 'enfant'],
  'billing.cancellation': ['cancel', 'annul', 'résili'],
  'billing.refunds': ['refund', 'money back', 'rembours'],
  'billing.price-changes': [
    'price change',
    'change the price',
    'change our price',
    'increase',
    'notify you',
    'prix',
  ],
  'billing.free-trials': ['free trial', 'trial', 'essai'],
  'billing.renewal-notice': ['renew', 'reminder', 'automatic', 'renouvel'],
  'billing.fees': ['fee', 'charge', 'frais'],
  'billing.plan-changes': ['upgrade', 'downgrade', 'switch', 'prorat', 'change your plan'],
  'legal.disputes': ['arbitrat', 'class action', 'dispute', 'court', 'litige'],
  'legal.terms-changes': [
    'change these terms',
    'modify',
    'update these terms',
    'amend',
    'modifier',
  ],
  'legal.account-closure': ['terminat', 'suspend', 'close your account', 'résili'],
  'legal.content-rights': ['licen', 'your content', 'royalty', 'sublicens'],
  'legal.service-changes': ['discontinu', 'modify the service', 'remove', 'purchase'],
  'legal.inactivity': ['inactiv', 'dormant', 'not used', 'inutilis'],
  'legal.output-rights': ['output', 'generated', 'ownership', 'you own'],
  'legal.licence': [
    'licen',
    'personal use',
    'non-commercial',
    'reverse engineer',
    'benchmark',
    'open source',
  ],
  'security.practices': ['audit', 'bug bounty', 'vulnerabilit', 'SOC 2', 'ISO 27001', 'security'],
  'service.activity-logging': ['log', 'logging', 'journal'],
  'service.account-sharing': ['household', 'share your account', 'sharing', 'foyer'],
  'service.device-limits': ['device', 'screens', 'streams', 'download', 'appareil'],
  'service.software-control': ['update', 'uninstall', 'disable', 'remove', 'mise à jour'],
  'finance.money-protection': ['CDIC', 'deposit insurance', 'insured', 'in trust', 'CIPF'],
  'finance.holds': ['hold', 'freeze', 'frozen', 'restrict'],
  'other.notable': [],
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
      user: `${header} Fill in plans, addOns, acceptedNetworks, paymentMethods, currencies, sourceRepo, availableIn, resellers, proposedFeatures and notOnPages; leave policies empty.\n\nFeatures:\n${registryDigest(context.features)}\n\n${pagesText(planPages.map((page) => ({ ...page, text: page.text.slice(0, share) })))}`,
    });
  }
  const topics = context.topics.filter(
    (topic) => !topic.categories || topic.categories.includes(provider.category),
  );
  if (policyPages.length > 0 && topics.length > 0) {
    const share = Math.floor(maxChars / policyPages.length);
    const passages = policyPages.map((page) => {
      const words = [
        ...topics.flatMap((topic) => topicWords[topic.id] ?? topic.name.toLowerCase().split(' ')),
        ...renewalWords,
      ];
      return { ...page, text: excerpt(page.text, nameIndexes(page.text, words), 500, share) };
    });
    parts.push({
      part: 'policies',
      system,
      user: `${header} Fill in policies and renewalAnchor only; leave plans empty. Quote the passages exactly.\n\nPolicy topics:\n${topicsDigest(context.topics, provider.category)}\n\n${pagesText(passages)}`,
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
    paymentMethods: [],
    currencies: [],
    policies: [],
    resellers: [],
    proposedFeatures: [],
    notOnPages: [],
  };
  for (const answer of answers) {
    merged.plans.push(...answer.plans);
    merged.addOns.push(...answer.addOns);
    merged.acceptedNetworks.push(...answer.acceptedNetworks);
    merged.paymentMethods.push(...answer.paymentMethods);
    merged.currencies.push(...answer.currencies);
    merged.policies.push(...answer.policies);
    merged.resellers.push(...answer.resellers);
    merged.proposedFeatures.push(...answer.proposedFeatures);
    merged.notOnPages.push(...answer.notOnPages);
    merged.availableIn ??= answer.availableIn;
    merged.renewalAnchor ??= answer.renewalAnchor;
    merged.sourceRepo ??= answer.sourceRepo;
    merged.outOfScope ??= answer.outOfScope;
  }
  return merged;
}
