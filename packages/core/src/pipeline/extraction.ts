import * as z from 'zod';
import { cardNetworkNames, networksNamedIn } from '../catalog/card-networks';
import type { Feature, FeatureValue } from '../catalog/feature';
import { monthlyEquivalent } from '../catalog/monthly-equivalent';
import { namesPaymentMethod, paymentMethods as paymentMethodIds } from '../catalog/payment-methods';
import { policyReasonMax, type PolicyRating } from '../catalog/policy';
import { policyStatuses, policyTiers, type PolicyTopic } from '../catalog/policy-topic';
import type { Price } from '../catalog/price';
import type {
  AcceptedNetworks,
  AddOn,
  CardNetwork,
  ChargedBefore,
  CurrenciesEntry,
  FreeUse,
  PaymentMethod,
  PaymentMethods,
  Perk,
  Plan,
  Provider,
  RenewalAnchor,
  SourceRepo,
} from '../catalog/provider';
import {
  maxChargedBeforeDays,
  namesChargedBefore,
  namesCurrency,
  namesRenewalAnchor,
  renewalAnchorKinds,
} from '../catalog/provider-facts';
import { isCatalogRegion } from '../catalog/regions';
import type { Reseller, ResellerListing, ResellerOffer, ResellerPrice } from '../catalog/reseller';
import type { IsoDate } from '../dates/iso-date';
import { moneyIn, sameAmount, sameCurrency } from './amounts';
import type { PageKind } from './find-pages';
import { onProviderSite } from './find-pages';
import { idFromName } from './queue';
import { findQuote } from './quotes';
import { saysTaxExcluded, saysTaxIncluded } from './tax-wording';
import { httpsAddress, parseWebAddress } from './web-address';

// Extraction (BLUEPRINT §6.5 ④, M3.4): a model reads a provider's saved pages and answers in the shape below, every
// fact with the page's own words; then the pipeline checks the answer against the pages and the catalog's rules and
// drafts the provider file. Whoever answers (Claude in a session, Workers AI, a person), the same checks apply:
// - every quote must be on its page word for word, or what rests on it is dropped (`findQuote`);
// - features only from features.yaml, by id, name or alias, with a value the registry allows; anything else becomes a
//   proposed feature for the owner's approval;
// - regular prices only, the billing period as stated, plausible amounts, a currency the region can use;
// - availableIn only from the provider's own country list, taxIncluded only with its words, card networks, ways to pay
//   and currencies only those their quotes name, a renewal day only when its quotes say it (M11.5), a repository
//   only when a page shows its address, policy ratings only on the registry's topics and grades;
// - personal and family plans only: business and per-seat plans are left out.

/** A saved page the model reads: its name in the answer (pricing, terms, pricing-2), its kind, URL and words. */
export interface ExtractionPage {
  name: string;
  kind: PageKind;
  url: string;
  /** Its text as shown, with each Monthly/Yearly toggle's text after it. */
  text: string;
  /** The browser that read it (M11.7), when it's known: the pipeline's is Edge. */
  browser?: string;
}

const pageQuote = {
  page: z.string().describe('The page the quote is on, by its name: pricing, terms, pricing-2'),
  quote: z.string().describe("The page's own words, copied exactly: a few words to a sentence"),
};

const extractedPriceSchema = z.object({
  region: z
    .string()
    .describe(
      'Where this price applies: an ISO 3166-1 code (CA, US), EU, or GLOBAL for one price everywhere',
    ),
  currency: z.string().describe('ISO 4217 code (CAD)'),
  amount: z.number().describe('In the major unit (18.99); 0 for a free plan'),
  interval: z.enum(['day', 'week', 'month', 'year']),
  intervalCount: z
    .number()
    .int()
    .default(1)
    .describe('3 with month is quarterly; "every 30 days" is day × 30'),
  autoRenew: z
    .boolean()
    .default(true)
    .describe('false for prepaid time that never renews by itself'),
  regular: z
    .boolean()
    .default(true)
    .describe(
      'false for a sale, introductory or first-term price: only the price it renews at is stored',
    ),
  ...pageQuote,
  taxIncluded: z
    .string()
    .optional()
    .describe(
      'The page’s own words that say this price includes tax for every buyer ("Including VAT.")',
    ),
});

const extractedPlanSchema = z.object({
  name: z.string().describe("The plan's name, without the provider's"),
  business: z
    .boolean()
    .default(false)
    .describe('A business, team or per-seat plan: left out of the catalog'),
  link: z
    .string()
    .optional()
    .describe("Where to sign up for it, on the provider's site, if the page links it"),
  prices: z.array(extractedPriceSchema).default([]),
  features: z
    .array(
      z.object({
        feature: z.string().describe('A feature id from the list, or its name or alias'),
        value: z
          .unknown()
          .describe('true/false, a number or "unlimited", a value id, or a list of value ids'),
        ...pageQuote,
      }),
    )
    .default([]),
  perks: z
    .array(z.object({ text: z.string().describe('In a few plain words'), ...pageQuote }))
    .default([])
    .describe(
      'Extras of this provider only, which no feature in the list covers: shown, never compared',
    ),
});

const extractedAnswerSchema = z.object({
  outOfScope: z
    .string()
    .optional()
    .describe(
      'Why it isn’t a personal or family subscription at all (business only, free with no plans, closed)',
    ),
  availableIn: z
    .object({ regions: z.array(z.string()), ...pageQuote })
    .optional()
    .describe('Only when the provider lists the countries it sells in'),
  plans: z.array(extractedPlanSchema).default([]),
  addOns: z
    .array(
      z.object({
        name: z.string(),
        plans: z.array(z.string()).default([]).describe('The plans it can be added to, by name'),
        grantsPlan: z.string().optional().describe('The plan an extra member gets, by name'),
        prices: z.array(extractedPriceSchema).default([]),
      }),
    )
    .default([]),
  acceptedNetworks: z
    .array(
      z.object({
        region: z.string().describe('Where these cards are taken: a country, EU or GLOBAL'),
        networks: z
          .array(z.string())
          .describe('visa, mastercard, amex, discover, interac, unionpay, jcb, other'),
        page: pageQuote.page,
        quotes: z.array(z.string()).describe("The page's words that name each network, exactly"),
      }),
    )
    .default([]),
  paymentMethods: z
    .array(
      z.object({
        methods: z
          .array(z.string())
          .describe(
            'card, paypal, apple-pay, google-pay, app-store, gift-card, bank-transfer, cash, crypto, provider-billing (a TV, internet or phone bill), other',
          ),
        regions: z
          .array(z.string())
          .optional()
          .describe("Only buyers here: a country's own page. Left out for every buyer"),
        page: pageQuote.page,
        quotes: z.array(z.string()).describe("The page's words that name each way to pay, exactly"),
      }),
    )
    .default([]),
  currencies: z
    .array(
      z.object({
        codes: z
          .array(z.string())
          .describe(
            "ISO 4217 codes of currencies it takes beyond its prices' (cash by post in EUR, USD, CAD)",
          ),
        methods: z
          .array(z.string())
          .optional()
          .describe('Only these ways to pay take them (cash). Left out when every way does'),
        page: pageQuote.page,
        quotes: z.array(z.string()).describe("The page's words that name each currency, exactly"),
      }),
    )
    .default([]),
  renewalAnchor: z
    .object({
      kind: z
        .enum(['same-date', 'every-30-days', 'first-of-month', 'end-of-month', 'not-stated'])
        .describe(
          'same-date: the date you signed up; every-30-days; first-of-month; end-of-month; not-stated when its terms and billing help don’t say',
        ),
      page: z
        .string()
        .optional()
        .describe('The page that says so, by its name. None with not-stated'),
      quotes: z
        .array(z.string())
        .default([])
        .describe('Its words saying which day it renews on, exactly. None with not-stated'),
      chargedBefore: z
        .object({
          days: z.number().describe('How many days before the renewal date'),
          upTo: z.boolean().optional().describe('The page says "up to" that many days'),
        })
        .optional()
        .describe(
          'A yearly renewal charged before its date ("15 days before your subscription ends"), quoted too. Left out when it is charged on the day',
        ),
    })
    .optional()
    .describe('Which day a paid plan renews on, from its terms or billing help'),
  freeUse: z
    .enum(['none'])
    .optional()
    .describe(
      'none when its pages offer only paid plans, or a trial that turns into one. Free use is a plan with a price of 0',
    ),
  sourceRepo: z
    .object({
      url: z
        .string()
        .describe("The repository's address as the page shows it (https://github.com/…)"),
      ...pageQuote,
    })
    .optional()
    .describe('Where its source code is, when a page says its code is open and shows the address'),
  policies: z
    .array(
      z.object({
        topic: z.string().describe('A topic id from the list'),
        title: z
          .string()
          .optional()
          .describe('other.notable only: what stands out, in a few words'),
        tier: z
          .enum(policyTiers)
          .optional()
          .describe("The rubric's grade the quotes fit; none with a status"),
        status: z
          .enum(policyStatuses)
          .optional()
          .describe(
            "Instead of a tier: not-stated when the pages don't address the topic, not-applicable when it can't apply",
          ),
        reason: z
          .string()
          .describe('Why, in plain words anyone can follow: 240 characters at most'),
        sources: z
          .array(z.object(pageQuote))
          .default([])
          .describe('One to three quotes that show the tier; none with a status'),
        plans: z.array(z.string()).optional().describe('Only these plans, by name'),
        regions: z.array(z.string()).optional().describe("Only buyers here: a country's own terms"),
      }),
    )
    .default([]),
  resellers: z
    .array(
      z.object({
        shop: z.string().describe('The shop’s name, as the provider’s page writes it'),
        website: z.string().describe('The shop’s home page'),
        approval: z
          .object({ page: pageQuote.page, quotes: z.array(z.string()) })
          .describe(
            'Where the provider’s own page names the shop as an official reseller, word for word',
          ),
        offers: z
          .array(
            z.object({
              plan: z.string().describe('The provider’s plan it sells, by name'),
              notes: z
                .string()
                .optional()
                .describe('What the buyer gets: a code by email, a card in the post'),
              prices: z
                .array(
                  extractedPriceSchema.extend({
                    taxExcluded: z
                      .string()
                      .optional()
                      .describe('The shop page’s words that say VAT or tax is added ("excl. VAT")'),
                  }),
                )
                .default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([])
    .describe(
      'Shops the provider’s own site names as official resellers of its own subscription, with their regular prices from their own pages: never partners that use its service in their own product',
    ),
  proposedFeatures: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().describe('What it records, and its values'),
        plans: z.array(z.string()).default([]),
        ...pageQuote,
      }),
    )
    .default([])
    .describe(
      'Capabilities buyers compare that no feature in the list covers: for the owner to approve',
    ),
  notOnPages: z
    .array(z.string())
    .default([])
    .describe('What the pages don’t say: no yearly price, no card list, no country list …'),
});

/** What a model answers: every fact with the page it's on and its words. */
export const extractionAnswerSchema = extractedAnswerSchema;
export type ExtractionAnswer = z.output<typeof extractedAnswerSchema>;
type ExtractedPrice = z.output<typeof extractedPriceSchema>;

/** The answer's JSON Schema, which the request gives the model. */
export function extractionAnswerJsonSchema(): object {
  return z.toJSONSchema(extractedAnswerSchema, { io: 'input' });
}

/** The provider the pages are for, as the queue has it. */
export interface ExtractionProvider {
  id: string;
  name: string;
  website: string;
  domains?: string[];
  category: string;
}

export interface ExtractionContext {
  provider: ExtractionProvider;
  pages: readonly ExtractionPage[];
  /** data/features.yaml. */
  features: readonly Feature[];
  /** data/policy-topics.yaml. */
  topics: readonly PolicyTopic[];
  /** data/resellers.yaml: a shop already listed keeps its id. */
  resellers?: readonly Reseller[];
  today: IsoDate;
}

/** Something the checks dropped or want a person to look at. */
export interface ExtractionIssue {
  kind: 'dropped' | 'warning';
  subject: string;
  reason: string;
  page?: string;
  quote?: string;
}

/** A capability the registry doesn't have, for the owner's approval (the feature-discovery skill). */
export interface ProposedFeature {
  name: string;
  description: string;
  plans: string[];
  url: string;
  quote: string;
}

/** A provider file drafted from an answer: complete when it has a cancel page. */
export type DraftProvider = Omit<Provider, 'cancelUrl'> & { cancelUrl?: string };

export interface ExtractionDraft {
  /** Undefined when nothing is left to draft (out of scope, or no plan with a checked price). */
  provider?: DraftProvider;
  /** The provider file's header comment: what each page was, what wasn't found. */
  comments: string[];
  issues: ExtractionIssue[];
  proposedFeatures: ProposedFeature[];
  /** What each kept price and feature rests on, for the pull request's evidence links. */
  evidence: Evidence[];
  /** Shops of the draft's resellers that data/resellers.yaml doesn't list yet. */
  newResellers: Reseller[];
  outOfScope?: string;
}

/** A kept fact and the page's words it rests on. */
export interface Evidence {
  subject: string;
  url: string;
  quote: string;
}

/** A provider's spend category (card rewards), from its service category: software and online services if no other. */
export function spendCategoryOf(category: string): string {
  const spend: Record<string, string> = {
    streaming: 'streaming',
    music: 'streaming',
    gaming: 'gaming',
    news: 'news',
    fitness: 'health',
    education: 'education',
    telecom: 'telecom',
    shopping: 'shopping',
    delivery: 'delivery',
    finance: 'finance',
  };
  return spend[category] ?? 'software';
}

/** How a policy page is linked on the card, by its kind. */
const linkNames: Readonly<Partial<Record<PageKind, string>>> = {
  terms: 'Terms of service',
  privacy: 'Privacy policy',
  cancel: 'Cancelling',
  pricing: 'Plans and pricing',
  payment: 'Payment methods',
};

/** Checks an answer against the pages and the catalog's rules, and drafts the provider file from what holds. */
export function draftFromAnswer(
  answer: ExtractionAnswer,
  context: ExtractionContext,
): ExtractionDraft {
  const issues: ExtractionIssue[] = [];
  const evidence: Evidence[] = [];
  const pages = new Map(context.pages.map((page) => [page.name, page]));
  const currencies = new Set(Intl.supportedValuesOf('currency'));
  const comments = sourceComments(context, answer);
  if (answer.outOfScope) {
    return {
      comments,
      issues,
      proposedFeatures: [],
      evidence: [],
      newResellers: [],
      outOfScope: answer.outOfScope,
    };
  }

  /** The page's own words for a quote, or undefined (and an issue) when it isn't there. */
  const verified = (
    subject: string,
    page: string,
    quote: string,
  ): { url: string; quote: string } | undefined => {
    const source = pages.get(page);
    if (!source) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: `"${page}" isn't one of the pages read`,
        page,
        quote,
      });
      return undefined;
    }
    const words = findQuote(quote, source.text);
    if (words === undefined) {
      issues.push({ kind: 'dropped', subject, reason: 'Its quote isn’t on the page', page, quote });
      return undefined;
    }
    return { url: source.url, quote: words };
  };

  const prices = (subject: string, extracted: readonly ExtractedPrice[]): Price[] => {
    const kept: Price[] = [];
    for (const price of extracted) {
      const label = `${subject}, ${price.region} ${price.amount} ${price.currency} every ${price.intervalCount} ${price.interval}`;
      const problem = priceProblem(price, currencies);
      if (problem) {
        issues.push({
          kind: 'dropped',
          subject: label,
          reason: problem,
          page: price.page,
          quote: price.quote,
        });
        continue;
      }
      const source = verified(label, price.page, price.quote);
      if (!source) continue;
      if (!quoteShows(source.quote, price.amount, price.currency)) {
        issues.push({
          kind: 'dropped',
          subject: label,
          reason: 'Its quote doesn’t show that amount',
          page: price.page,
          quote: source.quote,
        });
        continue;
      }
      if (
        kept.some(
          (other) =>
            other.region === price.region &&
            other.currency === price.currency &&
            other.interval === price.interval &&
            other.intervalCount === price.intervalCount,
        )
      ) {
        issues.push({
          kind: 'dropped',
          subject: label,
          reason: 'The same price twice: the first is kept',
        });
        continue;
      }
      let taxIncluded: { quote: string } | undefined;
      if (price.taxIncluded) {
        const words = findQuote(price.taxIncluded, pages.get(price.page)?.text ?? '');
        if (words && saysTaxIncluded(words)) taxIncluded = { quote: words };
        else
          issues.push({
            kind: 'warning',
            subject: label,
            reason: words
              ? 'Its "tax included" words don’t say the price includes tax, so tax is added in Canada and the US'
              : 'Its "tax included" words aren’t on the page, so tax is added in Canada and the US',
            page: price.page,
            quote: price.taxIncluded,
          });
      }
      evidence.push({ subject: label, ...source });
      kept.push({
        region: price.region,
        currency: price.currency,
        amount: price.amount,
        interval: price.interval,
        intervalCount: price.intervalCount,
        autoRenew: price.autoRenew,
        ...(taxIncluded && { taxIncluded }),
        lastVerified: context.today,
        sourceUrl: source.url,
      });
      const monthly = monthlyEquivalent(kept[kept.length - 1]);
      if (monthly > 200) {
        issues.push({
          kind: 'warning',
          subject: label,
          reason: `About ${monthly.toFixed(2)} a month: check it`,
        });
      }
    }
    for (const yearly of kept.filter(
      (price) => price.interval === 'year' && price.intervalCount === 1,
    )) {
      const monthly = kept.find(
        (price) =>
          price.interval === 'month' &&
          price.intervalCount === 1 &&
          price.region === yearly.region &&
          price.currency === yearly.currency,
      );
      if (monthly && yearly.amount > monthly.amount * 12 * 1.05) {
        issues.push({
          kind: 'warning',
          subject: `${subject} in ${yearly.region}`,
          reason: `A year (${yearly.amount}) costs more than 12 months (${monthly.amount} × 12): check the periods`,
        });
      }
    }
    return kept;
  };

  // Plans: personal and family only, each with at least one checked price.
  const planIds = new Map<string, string>();
  const plans: Plan[] = [];
  const proposedFeatures: ProposedFeature[] = [];
  // Perks (M11.6): each one once at the provider, its id from its words, and the plans that have it listing the id.
  const providerPerks: Perk[] = [];
  const perkIdFor = (text: string): string => {
    const known = providerPerks.find((perk) => normalize(perk.name) === normalize(text));
    if (known) return known.id;
    const base = perkIdFromText(text);
    let id = base;
    for (let n = 2; providerPerks.some((perk) => perk.id === id); n++) id = `${base}-${n}`;
    providerPerks.push({ id, name: text });
    return id;
  };
  for (const extracted of answer.plans) {
    if (extracted.business) {
      issues.push({
        kind: 'warning',
        subject: extracted.name,
        reason: 'A business or per-seat plan: left out',
      });
      continue;
    }
    const planPrices = prices(extracted.name, extracted.prices);
    if (planPrices.length === 0) {
      issues.push({
        kind: 'dropped',
        subject: extracted.name,
        reason: 'No price that holds: the plan is left out',
      });
      continue;
    }
    const id = uniqueId(context.provider.id, extracted.name, new Set(planIds.values()));
    planIds.set(normalize(extracted.name), id);
    const features: Record<string, FeatureValue> = {};
    for (const claim of extracted.features) {
      const subject = `${extracted.name}: ${claim.feature}`;
      const source = verified(subject, claim.page, claim.quote);
      if (!source) continue;
      const resolved = resolveFeature(claim.feature, claim.value, context.features);
      if (resolved === undefined) {
        proposedFeatures.push({
          name: claim.feature,
          description: `${JSON.stringify(claim.value)} on ${extracted.name}`,
          plans: [extracted.name],
          ...source,
        });
      } else if ('problem' in resolved) {
        issues.push({
          kind: 'dropped',
          subject,
          reason: resolved.problem,
          page: claim.page,
          quote: source.quote,
        });
      } else {
        features[resolved.id] = resolved.value;
        evidence.push({ subject, ...source });
        const parent = context.features.find((feature) => feature.id === resolved.parent);
        if (parent?.type === 'boolean' && features[parent.id] === undefined)
          features[parent.id] = true;
      }
    }
    const perks = [
      ...new Set(
        extracted.perks.flatMap((perk) =>
          verified(`${extracted.name}: ${perk.text}`, perk.page, perk.quote)
            ? [perkIdFor(perk.text.trim())]
            : [],
        ),
      ),
    ];
    const link =
      extracted.link &&
      /^https:\/\//.test(extracted.link) &&
      onProviderSite(extracted.link, context.provider)
        ? extracted.link
        : (planPrices[0].sourceUrl ?? context.provider.website);
    plans.push({
      id,
      name: extracted.name.trim(),
      link,
      features: ordered(features, context.features),
      ...(perks.length > 0 && { perks }),
      prices: planPrices,
    });
  }

  const addOns: AddOn[] = [];
  for (const extracted of answer.addOns) {
    const addOnPrices = prices(extracted.name, extracted.prices);
    const allowed = extracted.plans.flatMap((name) => planIds.get(normalize(name)) ?? []);
    if (addOnPrices.length === 0 || allowed.length === 0) {
      issues.push({
        kind: 'dropped',
        subject: extracted.name,
        reason:
          addOnPrices.length === 0 ? 'No price that holds' : 'None of its plans is in the draft',
      });
      continue;
    }
    const id = uniqueId(
      context.provider.id,
      extracted.name,
      new Set([...planIds.values(), ...addOns.map((a) => a.id)]),
    );
    const grants = extracted.grantsPlan && planIds.get(normalize(extracted.grantsPlan));
    addOns.push({
      id,
      name: extracted.name.trim(),
      ...(grants && { grantsPlan: grants }),
      prices: addOnPrices,
    });
    for (const planId of allowed) {
      const plan = plans.find((candidate) => candidate.id === planId);
      if (plan) plan.addOnIds = [...(plan.addOnIds ?? []), id];
    }
  }

  // Each region's cards: only the networks its checked quotes name.
  const acceptedNetworks: Record<string, AcceptedNetworks> = {};
  for (const claim of answer.acceptedNetworks) {
    const subject = `Cards in ${claim.region}`;
    if (!isCatalogRegion(claim.region)) {
      issues.push({ kind: 'dropped', subject, reason: `"${claim.region}" isn't a region code` });
      continue;
    }
    const quotes = claim.quotes.flatMap((quote) => {
      const source = verified(subject, claim.page, quote);
      return source ? [source.quote] : [];
    });
    const named = networksNamedIn(quotes.join('\n'));
    const networks = claim.networks
      .map((network) => toNetwork(network))
      .filter(
        (network): network is CardNetwork =>
          network !== undefined && (network === 'other' || named.includes(network)),
      );
    const url = pages.get(claim.page)?.url;
    if (networks.length === 0 || !url) {
      issues.push({ kind: 'dropped', subject, reason: 'No network named in its checked quotes' });
      continue;
    }
    if (!onProviderSite(url, context.provider)) {
      issues.push({
        kind: 'warning',
        subject,
        reason: 'Its page isn’t on the provider’s own sites',
      });
    }
    acceptedNetworks[claim.region] = {
      networks: [...new Set(networks)],
      url,
      quotes: [...new Set(quotes)],
    };
  }

  const facts = providerFacts(answer, context, pages, verified, issues);

  let availableIn: string[] | undefined;
  if (answer.availableIn) {
    const regions = answer.availableIn.regions.filter(
      (region) => isCatalogRegion(region) && region !== 'GLOBAL',
    );
    if (
      verified('Where it sells', answer.availableIn.page, answer.availableIn.quote) &&
      regions.length > 0
    ) {
      availableIn = [...new Set(regions)];
    }
  }

  const policies = policyDrafts(answer, context, planIds, verified, issues);

  // Official resellers (BLUEPRINT §4.9): named on the provider's own page, priced on the shop's own pages.
  const listings: ResellerListing[] = [];
  const newResellers: Reseller[] = [];
  for (const claim of answer.resellers) {
    const subject = `Reseller ${claim.shop}`;
    const page = pages.get(claim.approval.page);
    if (!page || !onProviderSite(page.url, context.provider)) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: 'Its approval isn’t on the provider’s own site',
      });
      continue;
    }
    const quotes = claim.approval.quotes.flatMap(
      (quote) => verified(subject, claim.approval.page, quote)?.quote ?? [],
    );
    if (quotes.length === 0) continue;
    const shopSite = parseWebAddress(claim.website);
    if (!shopSite) {
      issues.push({ kind: 'dropped', subject, reason: `"${claim.website}" isn't a web address` });
      continue;
    }
    const known = (context.resellers ?? []).find((reseller) =>
      onProviderSite(claim.website, {
        name: reseller.name,
        website: reseller.website,
        domains: reseller.domains,
      }),
    );
    const shop: Reseller = known ?? {
      id: uniqueReseller(claim.shop, context, newResellers),
      name: claim.shop.trim(),
      website: `https://${shopSite.host}`,
    };
    const offers: ResellerOffer[] = [];
    for (const offer of claim.offers) {
      const plan = planIds.get(normalize(offer.plan));
      if (!plan) {
        issues.push({
          kind: 'dropped',
          subject: `${subject}: ${offer.plan}`,
          reason: 'Not a plan in the draft',
        });
        continue;
      }
      const offerPrices: ResellerPrice[] = offer.prices.flatMap((claimed) => {
        const [price] = prices(`${subject}: ${offer.plan}`, [claimed]);
        if (!price) return [];
        if (
          !price.sourceUrl ||
          !onProviderSite(price.sourceUrl, {
            name: shop.name,
            website: shop.website,
            domains: shop.domains,
          })
        ) {
          issues.push({
            kind: 'dropped',
            subject: `${subject}: ${offer.plan}`,
            reason: 'Its price isn’t on the shop’s own page',
          });
          return [];
        }
        const found =
          claimed.taxExcluded &&
          findQuote(claimed.taxExcluded, pages.get(claimed.page)?.text ?? '');
        const words = found && saysTaxExcluded(found) ? found : undefined;
        return [
          { ...price, sourceUrl: price.sourceUrl, ...(words && { taxExcluded: { quote: words } }) },
        ];
      });
      if (offerPrices.length > 0) {
        offers.push({
          plan,
          ...(offer.notes && { notes: offer.notes.trim() }),
          prices: offerPrices,
        });
      }
    }
    if (offers.length === 0) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: 'No offer with a checked price on the shop’s own page',
      });
      continue;
    }
    listings.push({ reseller: shop.id, approvedBy: { url: page.url, quotes }, offers });
    if (!known) newResellers.push(shop);
  }

  for (const proposal of answer.proposedFeatures) {
    const source = verified(`Proposed: ${proposal.name}`, proposal.page, proposal.quote);
    if (source) {
      proposedFeatures.push({
        name: proposal.name,
        description: proposal.description,
        plans: proposal.plans,
        ...source,
      });
    }
  }

  if (plans.length === 0) {
    issues.push({
      kind: 'dropped',
      subject: context.provider.name,
      reason: 'No plan with a checked price: no draft',
    });
    return { comments, issues, proposedFeatures, evidence, newResellers: [] };
  }
  // Free use (2026-11-09): a free plan, or none on the plans pages read.
  const free = plans.some((plan) => plan.prices.some((price) => price.amount === 0));
  const plansRead = context.pages.filter((page) => page.kind === 'pricing').map((page) => page.url);
  let freeUse: FreeUse | undefined;
  if (!free && answer.freeUse === 'none' && plansRead.length > 0) {
    freeUse = { kind: 'none', pages: [...new Set(plansRead)], lastVerified: context.today };
  } else if (!free) {
    issues.push({
      kind: 'warning',
      subject: 'Free use',
      reason:
        'No free plan, and no word that its pages offer none: look for free use (its help centre’s “Is it free?”) and add a free plan or freeUse by hand',
    });
  }
  const cancelUrl = mainPage(context.pages, 'cancel')?.url;
  if (!cancelUrl) {
    issues.push({
      kind: 'warning',
      subject: context.provider.name,
      reason: 'No cancel page was found: add cancelUrl (its cancel page or help article) by hand',
    });
  }
  const pricing = mainPage(context.pages, 'pricing')?.url;
  const provider: DraftProvider = {
    id: context.provider.id,
    name: context.provider.name,
    website: context.provider.website,
    ...(context.provider.domains &&
      context.provider.domains.length > 0 && { domains: context.provider.domains }),
    category: context.provider.category,
    spendCategory: spendCategoryOf(context.provider.category),
    ...(Object.keys(acceptedNetworks).length > 0 && { acceptedNetworks }),
    ...(facts.paymentMethods.length > 0 && { paymentMethods: facts.paymentMethods }),
    ...(facts.currencies.length > 0 && { currencies: facts.currencies }),
    ...(facts.renewalAnchor && { renewalAnchor: facts.renewalAnchor }),
    ...(freeUse && { freeUse }),
    ...billingCurrencyOf([...plans, ...addOns]),
    ...(availableIn && { availableIn }),
    ...(cancelUrl && { cancelUrl }),
    ...(pricing && { sources: { pricing } }),
    ...(providerPerks.length > 0 && { perks: providerPerks }),
    ...(facts.sourceRepo && { sourceRepo: facts.sourceRepo }),
    plans,
    ...(addOns.length > 0 && { addOns }),
    ...(listings.length > 0 && { resellers: listings }),
    ...(policies && { policies }),
  };
  return { provider, comments, issues, proposedFeatures, evidence, newResellers };
}

/** A kind's page that find-urls found (named after the kind), else the first one added by hand. */
function mainPage(pages: readonly ExtractionPage[], kind: PageKind): ExtractionPage | undefined {
  return pages.find((page) => page.name === kind) ?? pages.find((page) => page.kind === kind);
}

/** A price that can't be stored as it is, or undefined. */
function priceProblem(price: ExtractedPrice, currencies: ReadonlySet<string>): string | undefined {
  if (!price.regular) return 'A sale or first-term price: only the price it renews at is stored';
  if (!isCatalogRegion(price.region)) return `"${price.region}" isn't a region code`;
  if (!currencies.has(price.currency)) return `"${price.currency}" isn't a currency code`;
  if (!(price.amount >= 0) || !Number.isFinite(price.amount)) return 'Not an amount';
  if (!Number.isInteger(price.intervalCount) || price.intervalCount < 1)
    return 'Not a billing period';
  const most = { day: 366, week: 104, month: 36, year: 5 }[price.interval];
  if (price.intervalCount > most)
    return `Every ${price.intervalCount} ${price.interval}s isn't a plausible period`;
  const monthly = monthlyEquivalent(price);
  if (monthly > 2000) return `About ${monthly.toFixed(0)} a month isn't a plausible personal plan`;
  return undefined;
}

/** Whether a price's quote shows its amount (0 as "free"), in its currency or none. */
function quoteShows(quote: string, amount: number, currency: string): boolean {
  if (amount === 0 && /\bfree\b|\bgratuit\b/i.test(quote)) return true;
  return moneyIn(quote).some(
    (mention) => sameAmount(mention.amount, amount) && sameCurrency(mention.currency, currency),
  );
}

/** Lower case, accents and punctuation dropped, single spaces: how names and aliases are compared. */
function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

/** A new shop's id from its name: one no reseller, new one or provider has (they share data/logos/). */
function uniqueReseller(
  name: string,
  context: ExtractionContext,
  added: readonly Reseller[],
): string {
  const taken = new Set([
    context.provider.id,
    ...(context.resellers ?? []).map((reseller) => reseller.id),
    ...added.map((reseller) => reseller.id),
  ]);
  const slug = idFromName(name) || 'shop';
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
  return id;
}

function uniqueId(providerId: string, name: string, taken: ReadonlySet<string>): string {
  const slug = idFromName(name) || 'plan';
  let id = `${providerId}.${slug}`;
  for (let n = 2; taken.has(id); n++) id = `${providerId}.${slug}-${n}`;
  return id;
}

/** A feature by id, name or alias, with its value as the registry takes it; undefined when it isn't in the registry. */
export function resolveFeature(
  name: string,
  value: unknown,
  features: readonly Feature[],
): { id: string; value: FeatureValue; parent?: string } | { problem: string } | undefined {
  const wanted = normalize(name);
  const feature = features.find(
    (candidate) =>
      candidate.id === name ||
      normalize(candidate.name) === wanted ||
      (candidate.aliases ?? []).some((alias) => normalize(alias) === wanted),
  );
  if (!feature) return undefined;
  const at = (resolved: FeatureValue) => ({
    id: feature.id,
    value: resolved,
    ...(feature.parent !== undefined && { parent: feature.parent }),
  });
  switch (feature.type) {
    case 'boolean': {
      if (typeof value === 'boolean') return at(value);
      if (typeof value === 'string' && /^(?:yes|true|included)$/i.test(value.trim()))
        return at(true);
      if (typeof value === 'string' && /^(?:no|false|not included)$/i.test(value.trim()))
        return at(false);
      return { problem: `${feature.id} is true or false` };
    }
    case 'number': {
      if (typeof value === 'number' && value >= 0) return at(value);
      if (typeof value === 'string' && /^unlimited$/i.test(value.trim())) return at('unlimited');
      if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))
        return at(Number(value));
      return {
        problem: `${feature.id} is a number${feature.unit ? ` of ${feature.unit}` : ''}, or unlimited`,
      };
    }
    case 'enum': {
      const match = valueId(value, feature.values);
      return match
        ? at(match)
        : { problem: `${feature.id} is one of ${feature.values.map((v) => v.id).join(', ')}` };
    }
    case 'set': {
      if (!('values' in feature) || !feature.values)
        return { problem: `${feature.id} is set by people only` };
      const items = Array.isArray(value) ? value : [value];
      const ids = items.map((item) => valueId(item, feature.values ?? []));
      if (ids.some((id) => id === undefined)) {
        return { problem: `${feature.id} takes ${feature.values.map((v) => v.id).join(', ')}` };
      }
      return at([...new Set(ids as string[])]);
    }
  }
}

function valueId(
  value: unknown,
  values: readonly { id: string; name: string; aliases?: string[] }[],
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const wanted = normalize(value);
  return values.find(
    (candidate) =>
      candidate.id === value ||
      normalize(candidate.id) === wanted ||
      normalize(candidate.name) === wanted ||
      (candidate.aliases ?? []).some((alias) => normalize(alias) === wanted),
  )?.id;
}

/** A plan's features in the registry's order, as the catalog's files list them. */
function ordered(
  features: Record<string, FeatureValue>,
  registry: readonly Feature[],
): Record<string, FeatureValue> {
  const out: Record<string, FeatureValue> = {};
  for (const feature of registry)
    if (features[feature.id] !== undefined) out[feature.id] = features[feature.id];
  return out;
}

/** A drafted provider's facts beside its ways to pay (M11.5), each only as far as its checked quotes go. */
interface ProviderFacts {
  paymentMethods: PaymentMethods;
  currencies: CurrenciesEntry[];
  renewalAnchor?: RenewalAnchor;
  sourceRepo?: SourceRepo;
}

/** A quote checked on its page: the page's own words, or undefined (and an issue). */
type Verify = (
  subject: string,
  page: string,
  quote: string,
) => { url: string; quote: string } | undefined;

/**
 * How it can be paid, in which currencies beyond its prices, on which day it renews and where its source code is
 * (M11.5): ways to pay and currencies only as their checked quotes name them, one entry for everywhere and one per
 * region; a renewal day only when its quotes say it, or not-stated with the billing pages read; a repository only
 * when a page shows its address in its words, since the model sees no links.
 */
function providerFacts(
  answer: ExtractionAnswer,
  context: ExtractionContext,
  pages: ReadonlyMap<string, ExtractionPage>,
  verified: Verify,
  issues: ExtractionIssue[],
): ProviderFacts {
  const quoted = (subject: string, page: string, quotes: readonly string[]) => [
    ...new Set(quotes.flatMap((quote) => verified(subject, page, quote)?.quote ?? [])),
  ];
  const offSite = (subject: string, url: string) => {
    if (!onProviderSite(url, context.provider)) {
      issues.push({
        kind: 'warning',
        subject,
        reason: 'Its page isn’t on the provider’s own sites',
      });
    }
  };

  const paymentMethods: PaymentMethods = [];
  for (const claim of answer.paymentMethods) {
    const regions = claim.regions?.filter((region) => region !== 'GLOBAL');
    const subject = `Ways to pay${regions?.length ? ` in ${regions.join(', ')}` : ''}`;
    const page = pages.get(claim.page);
    const quotes = quoted(subject, claim.page, claim.quotes);
    const named = quotes.join(' ');
    const methods = [
      ...new Set(
        claim.methods
          .map((name) => toPaymentMethod(name))
          .filter(
            (method): method is PaymentMethod =>
              method !== undefined && (method === 'other' || namesPaymentMethod(named, method)),
          ),
      ),
    ];
    if (!page || methods.length === 0) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: 'No way to pay named in its checked quotes',
      });
      continue;
    }
    // Entries for the same place add up (a page for cards, another for gift cards).
    const badRegion = regions?.find((region) => !isCatalogRegion(region));
    if (badRegion) {
      issues.push({ kind: 'dropped', subject, reason: `"${badRegion}" isn't a region code` });
      continue;
    }
    offSite(subject, page.url);
    paymentMethods.push({
      methods,
      ...(regions?.length && { regions }),
      page: pageName(page),
      url: page.url,
      quotes,
    });
  }

  const known = new Set(Intl.supportedValuesOf('currency'));
  const ways = new Set(paymentMethods.flatMap((entry) => entry.methods));
  const currencies: CurrenciesEntry[] = [];
  for (const claim of answer.currencies) {
    const subject = `Currencies ${claim.codes.join(', ')}`;
    const page = pages.get(claim.page);
    const quotes = quoted(subject, claim.page, claim.quotes);
    const named = quotes.join(' ');
    const codes = [...new Set(claim.codes.map((code) => code.trim().toUpperCase()))].filter(
      (code) => known.has(code) && namesCurrency(named, code),
    );
    const methods = claim.methods
      ?.map((name) => toPaymentMethod(name))
      .filter((method): method is PaymentMethod => method !== undefined && ways.has(method));
    if (!page || codes.length === 0) {
      issues.push({ kind: 'dropped', subject, reason: 'No currency named in its checked quotes' });
      continue;
    }
    if (claim.methods && !methods?.length) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: 'Its ways to pay aren’t among those drafted',
      });
      continue;
    }
    offSite(subject, page.url);
    currencies.push({
      codes,
      ...(methods?.length && { methods: [...new Set(methods)] }),
      page: pageName(page),
      url: page.url,
      quotes,
    });
  }

  let renewalAnchor: RenewalAnchor | undefined;
  const anchor = answer.renewalAnchor;
  if (anchor?.kind === 'not-stated') {
    // The pages a billing day would be on, read and silent.
    const read = context.pages
      .filter((page) => ['terms', 'cancel', 'payment', 'pricing'].includes(page.kind))
      .map((page) => page.url);
    if (read.length > 0) {
      renewalAnchor = {
        kind: 'not-stated',
        pages: [...new Set(read)],
        lastVerified: context.today,
      };
    }
  } else if (anchor) {
    const subject = 'Billing day';
    const page = anchor.page === undefined ? undefined : pages.get(anchor.page);
    const quotes = page ? quoted(subject, page.name, anchor.quotes).slice(0, 3) : [];
    const kind = renewalAnchorKinds.find((known) => known === anchor.kind);
    const text = quotes.join(' ');
    // A charge before the renewal (M11.21), kept only as far as the quotes say it.
    const asked = anchor.chargedBefore;
    const early: ChargedBefore | undefined =
      asked && Number.isInteger(asked.days) && asked.days >= 1 && asked.days <= maxChargedBeforeDays
        ? { days: asked.days, ...(asked.upTo && { upTo: true as const }) }
        : undefined;
    const chargedBefore = early && namesChargedBefore(text, early) ? early : undefined;
    if (page && kind && quotes.length > 0 && namesRenewalAnchor(text, kind, chargedBefore)) {
      offSite(subject, page.url);
      renewalAnchor = {
        kind,
        page: pageName(page),
        url: page.url,
        quotes,
        ...(chargedBefore && { chargedBefore }),
        lastVerified: context.today,
      };
    } else {
      issues.push({
        kind: 'dropped',
        subject,
        reason: 'Its checked quotes don’t say which day it renews on',
      });
    }
  }

  let sourceRepo: SourceRepo | undefined;
  if (answer.sourceRepo) {
    const subject = 'Source code';
    const claim = answer.sourceRepo;
    const source = verified(subject, claim.page, claim.quote);
    const address = parseWebAddress(claim.url);
    const shown =
      address &&
      context.pages.some((page) =>
        page.text.includes(`${address.host}${address.path === '/' ? '' : address.path}`),
      );
    const page = pages.get(claim.page);
    if (source && page && address && shown) {
      offSite(subject, page.url);
      sourceRepo = {
        url: httpsAddress(address),
        page: { name: pageName(page), url: page.url },
        quotes: [source.quote],
        lastVerified: context.today,
      };
    } else if (source) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: 'No page shows its address in its words: add sourceRepo by hand from its link',
      });
    }
  }

  return {
    paymentMethods,
    currencies,
    ...(renewalAnchor && { renewalAnchor }),
    ...(sourceRepo && { sourceRepo }),
  };
}

/** A perk's id from its words: their slug, cut at a word to 40 characters ("cloud-playtime-5-hours-a-month"). */
function perkIdFromText(text: string): string {
  const slug = idFromName(text) || 'perk';
  if (slug.length <= 40) return slug;
  const cut = slug.slice(0, 41);
  return cut.slice(0, cut.lastIndexOf('-')) || slug.slice(0, 40);
}

/** A page as the card links it, by its kind. */
function pageName(page: ExtractionPage): string {
  return linkNames[page.kind] ?? 'Its website';
}

/** A way to pay as a model may name it rather than by its id. */
const paymentMethodAliases: Readonly<Record<string, PaymentMethod>> = {
  'credit-card': 'card',
  'debit-card': 'card',
  cards: 'card',
  bitcoin: 'crypto',
  cryptocurrency: 'crypto',
  voucher: 'gift-card',
  vouchers: 'gift-card',
  'gift-cards': 'gift-card',
  'bank-wire': 'bank-transfer',
  'wire-transfer': 'bank-transfer',
  'direct-debit': 'bank-transfer',
  ideal: 'bank-transfer',
  swish: 'bank-transfer',
  'cash-app-pay': 'cash-app',
  'ali-pay': 'alipay',
};

function toPaymentMethod(name: string): PaymentMethod | undefined {
  const wanted = normalize(name).replace(/\s+/g, '-');
  return paymentMethodIds.find((method) => method === wanted) ?? paymentMethodAliases[wanted];
}

function toNetwork(name: string): CardNetwork | undefined {
  const wanted = normalize(name);
  if (wanted === 'other') return 'other';
  return (Object.keys(cardNetworkNames) as CardNetwork[]).find(
    (network) => network === wanted || normalize(cardNetworkNames[network]) === wanted,
  );
}

/** One currency a region is charged in, when all its prices share it. */
function billingCurrencyOf(items: readonly { prices: readonly Price[] }[]): {
  billingCurrency?: Record<string, string>;
} {
  const byRegion = new Map<string, Set<string>>();
  for (const item of items) {
    for (const price of item.prices) {
      byRegion.set(price.region, (byRegion.get(price.region) ?? new Set()).add(price.currency));
    }
  }
  const billing = Object.fromEntries(
    [...byRegion]
      .filter(([, currencies]) => currencies.size === 1)
      .map(([region, [currency]]) => [region, currency]),
  );
  // Where a region is priced in several currencies, the buyer picks: no billingCurrency at all, since every region
  // priced needs one once it's there.
  return byRegion.size > 0 && Object.keys(billing).length === byRegion.size
    ? { billingCurrency: billing }
    : {};
}

function policyDrafts(
  answer: ExtractionAnswer,
  context: ExtractionContext,
  planIds: ReadonlyMap<string, string>,
  verified: (
    subject: string,
    page: string,
    quote: string,
  ) => { url: string; quote: string } | undefined,
  issues: ExtractionIssue[],
): Provider['policies'] {
  const topics = new Set(context.topics.map((topic) => topic.id));
  const policyPageUrls = context.pages
    .filter((page) => page.kind === 'terms' || page.kind === 'privacy')
    .map((page) => page.url);
  const ratings: PolicyRating[] = [];
  for (const claim of answer.policies) {
    const subject = `Policy ${claim.topic}`;
    if (!topics.has(claim.topic)) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: `"${claim.topic}" isn't a topic in policy-topics.yaml`,
      });
      continue;
    }
    const reason = claim.reason.replace(/\s+/g, ' ').trim();
    if (reason.length === 0 || reason.length > policyReasonMax) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: `Its reason must be 1 to ${policyReasonMax} characters`,
      });
      continue;
    }
    if ((claim.tier === undefined) === (claim.status === undefined)) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: 'It needs a tier or a status, not both or neither',
      });
      continue;
    }
    const plans = claim.plans?.flatMap((name) => planIds.get(normalize(name)) ?? []);
    const regions = claim.regions?.filter((region) => isCatalogRegion(region));
    const scope = {
      ...(claim.title?.trim() && { title: claim.title.trim() }),
      ...(plans && plans.length > 0 && { plans }),
      ...(regions && regions.length > 0 && { regions }),
    };
    let rating: PolicyRating;
    if (claim.status) {
      // A status quotes nothing: it names the policy pages read, which said nothing on the topic.
      rating = {
        topic: claim.topic,
        status: claim.status,
        reason,
        ...(claim.status === 'not-stated' && { pages: policyPageUrls }),
        ...scope,
        lastVerified: context.today,
      };
      if (claim.status === 'not-stated' && policyPageUrls.length === 0) continue;
    } else {
      const sources = claim.sources
        .flatMap((source) => {
          const found = verified(subject, source.page, source.quote);
          return found ? [found] : [];
        })
        .slice(0, 3);
      if (sources.length === 0) continue;
      rating = {
        topic: claim.topic,
        tier: claim.tier,
        reason,
        sources,
        ...scope,
        lastVerified: context.today,
      };
    }
    const clash = ratings.find(
      (other) =>
        other.topic === rating.topic &&
        other.title === rating.title &&
        JSON.stringify(other.plans) === JSON.stringify(rating.plans) &&
        JSON.stringify(other.regions) === JSON.stringify(rating.regions),
    );
    if (clash) {
      issues.push({
        kind: 'dropped',
        subject,
        reason: 'Rated twice for the same plans and regions: the first is kept',
      });
      continue;
    }
    ratings.push(rating);
  }
  if (ratings.length === 0) return undefined;
  const quoted = new Set(
    ratings.flatMap((rating) => [
      ...(rating.sources ?? []).map((source) => source.url),
      ...(rating.pages ?? []),
    ]),
  );
  const links = [...quoted].map((url) => {
    const page = context.pages.find((candidate) => candidate.url === url);
    const name = (page && linkNames[page.kind]) ?? 'Policy';
    return { name, url };
  });
  // Two pages of one kind are told apart.
  const counts = new Map<string, number>();
  for (const link of links) {
    const count = (counts.get(link.name) ?? 0) + 1;
    counts.set(link.name, count);
    if (count > 1) link.name = `${link.name} (${count})`;
  }
  return { links, ratings };
}

/** The provider file's header: where each fact came from, and each check that found nothing. */
function sourceComments(context: ExtractionContext, answer: ExtractionAnswer): string[] {
  const kinds: PageKind[] = [
    'pricing',
    'payment',
    'cancel',
    'terms',
    'privacy',
    'bundles',
    'resellers',
  ];
  const label: Record<PageKind, string> = {
    pricing: 'Pricing',
    payment: 'Payment methods',
    cancel: 'Cancelling',
    terms: 'Terms',
    privacy: 'Privacy',
    bundles: 'Bundles',
    resellers: 'Official resellers',
  };
  const browsers = [...new Set(context.pages.flatMap((page) => page.browser ?? []))];
  const lines = [
    `Drafted by the discovery pipeline on ${context.today} (BLUEPRINT §6.5) from these pages, each quoted where it's used${browsers.length > 0 ? `, read with ${browsers.join(' and ')}` : ''}.`,
  ];
  for (const kind of kinds) {
    const read = [
      ...new Set(context.pages.filter((page) => page.kind === kind).map((page) => page.url)),
    ];
    lines.push(`${label[kind]}: ${read.length > 0 ? read.join(', ') : 'none found'}.`);
  }
  if (answer.notOnPages.length > 0)
    lines.push(`Not on the pages: ${answer.notOnPages.join('; ')}.`);
  return lines;
}
