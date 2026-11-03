import * as z from 'zod';
import { cardNetworkNames, namesNetwork } from './card-networks';
import { namesPaymentMethod, paymentMethodNames } from './payment-methods';
import {
  namesCurrency,
  namesRenewalAnchor,
  renewalAnchorKinds,
  renewalAnchorNames,
} from './provider-facts';
import { addDuplicateIssues, choices } from './checks';
import { featureValueSchema } from './feature';
import {
  aliasesSchema,
  currencySchema,
  domainSchema,
  dottedSlugSchema,
  httpsUrlSchema,
  isoDateSchema,
  planIdSchema,
  rankKeySchema,
  regionSchema,
  slugSchema,
  textSchema,
} from './formats';
import { policiesSchema } from './policy';
import { pricesSchema } from './price';
import { outsideRatingsSchema, ownerSchema } from './rater';
import { resellerListingSchema } from './reseller';

// One provider file, data/providers/<id>.yaml (BLUEPRINT §4.3). The schema checks each file on its own. Feature
// ids and values against the registry, category ids, and add-on and plan references are checked by
// validateCatalog (validate-catalog.ts).

/** BLUEPRINT §9.2. A provider lists the networks it accepts; leaving the list out means unknown. */
export const cardNetworkSchema = z.enum([
  'visa',
  'mastercard',
  'amex',
  'discover',
  'interac',
  'unionpay',
  'jcb',
  'other',
]);
export type CardNetwork = z.infer<typeof cardNetworkSchema>;

/**
 * The card networks a provider takes in one region, and its own page's words that name them (BLUEPRINT §9.3): what the
 * nightly check looks for on that page.
 */
export const acceptedNetworksSchema = z
  .strictObject({
    networks: z
      .array(cardNetworkSchema)
      .min(1, 'List at least one network')
      .describe('The networks it takes there: other for one not listed here'),
    url: httpsUrlSchema.describe(
      "The provider's own page that names them (payment methods, a help article, the checkout), on its website's domain or one of its domains",
    ),
    quotes: z
      .array(textSchema)
      .min(1, 'Quote the words that name them')
      .describe(
        'Where that page names the networks ("Visa", "American Express"), word for word, which the nightly check looks for',
      ),
  })
  .superRefine((entry, ctx) => {
    addDuplicateIssues(ctx, entry.networks, (index) => ['networks', index]);
    const quoted = entry.quotes.join('\n');
    entry.networks.forEach((network, index) => {
      if (entry.quotes.length > 0 && network !== 'other' && !namesNetwork(quoted, network)) {
        ctx.addIssue({
          code: 'custom',
          message: `No quote names ${cardNetworkNames[network]}: quote the page's words for it`,
          path: ['networks', index],
        });
      }
    });
  });
export type AcceptedNetworks = z.infer<typeof acceptedNetworksSchema>;

/** The ways a provider can be paid (M11.5): cards, wallets, app stores, gift cards, a bank, cash and crypto. */
export const paymentMethodSchema = z.enum([
  'card',
  'paypal',
  'apple-pay',
  'google-pay',
  'app-store',
  'gift-card',
  'bank-transfer',
  'cash',
  'crypto',
  'provider-billing',
  'other',
]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** One page's list of the ways to pay, for everywhere or some regions, quoted from the provider's own page. */
export const paymentMethodsEntrySchema = z
  .strictObject({
    methods: z
      .array(paymentMethodSchema)
      .min(1, 'List at least one method')
      .describe(
        'The ways to pay it names: app-store for billing through Apple, Google or another app store, provider-billing for a TV, internet or phone provider’s bill, other for one not listed here',
      ),
    regions: z
      .array(regionSchema)
      .min(1, 'Leave regions out when the page is for every buyer')
      .describe('Only buyers here (a country’s own help page), over the entry for everywhere')
      .optional(),
    page: textSchema.describe('As the card links it (Payment methods)'),
    url: httpsUrlSchema.describe(
      "The provider's own page that lists them (payment methods, a help article, the checkout), on its own sites, its policies' or its owner's",
    ),
    quotes: z
      .array(textSchema)
      .min(1, 'Quote the words that name them')
      .describe('Where that page names each method ("PayPal", "cash"), word for word'),
  })
  .superRefine((entry, ctx) => {
    addDuplicateIssues(ctx, entry.methods, (index) => ['methods', index]);
    addDuplicateIssues(ctx, entry.regions ?? [], (index) => ['regions', index]);
    const quoted = entry.quotes.join(' ');
    entry.methods.forEach((method, index) => {
      if (method !== 'other' && !namesPaymentMethod(quoted, method)) {
        ctx.addIssue({
          code: 'custom',
          message: `No quote names ${paymentMethodNames[method]}: quote the page's words for it`,
          path: ['methods', index],
        });
      }
    });
  });

export const paymentMethodsSchema = z
  .array(paymentMethodsEntrySchema)
  .min(1, 'Say how it can be paid')
  .superRefine((entries, ctx) => {
    // One entry for everywhere, and a region in one entry at most.
    const everywhere = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !entry.regions);
    everywhere.slice(1).forEach(({ index }) =>
      ctx.addIssue({
        code: 'custom',
        message: 'Only one entry is for everywhere: give this one its regions',
        path: [index, 'regions'],
      }),
    );
    const regions = entries.flatMap((entry, index) =>
      (entry.regions ?? []).map((region, item) => ({ region, path: [index, 'regions', item] })),
    );
    addDuplicateIssues(
      ctx,
      regions.map(({ region }) => region),
      (index) => regions[index].path,
    );
  });
export type PaymentMethods = z.infer<typeof paymentMethodsSchema>;

/**
 * Currencies a provider takes beyond its price lists (M11.5): cash in nine currencies by post, a checkout that charges
 * in the buyer's own at its rate. One page's list, for every way to pay or some, quoted from the provider's own page.
 */
export const currenciesEntrySchema = z
  .strictObject({
    codes: z
      .array(currencySchema)
      .min(1, 'List at least one currency')
      .describe('The ISO 4217 codes of the currencies it takes this way (EUR, USD)'),
    methods: z
      .array(paymentMethodSchema)
      .min(1, 'Leave methods out when every way to pay takes them')
      .describe('Only these ways to pay take them (cash by post): each one its paymentMethods list')
      .optional(),
    regions: z
      .array(regionSchema)
      .min(1, 'Leave regions out when the page is for every buyer')
      .describe('Only buyers here (a country’s own help page)')
      .optional(),
    page: textSchema.describe('As the card links it (Terms of service)'),
    url: httpsUrlSchema.describe(
      "The provider's own page that names them, on its own sites, its policies' or its owner's",
    ),
    quotes: z
      .array(textSchema)
      .min(1, 'Quote the words that name them')
      .describe(
        'Where that page names each currency (its code, name or sign: €, CA$), word for word',
      ),
  })
  .superRefine((entry, ctx) => {
    addDuplicateIssues(ctx, entry.codes, (index) => ['codes', index]);
    addDuplicateIssues(ctx, entry.methods ?? [], (index) => ['methods', index]);
    addDuplicateIssues(ctx, entry.regions ?? [], (index) => ['regions', index]);
    const quoted = entry.quotes.join(' ');
    entry.codes.forEach((code, index) => {
      if (!namesCurrency(quoted, code)) {
        ctx.addIssue({
          code: 'custom',
          message: `No quote names ${code}: quote the page's words for it (its code, name or sign)`,
          path: ['codes', index],
        });
      }
    });
  });
export type CurrenciesEntry = z.infer<typeof currenciesEntrySchema>;

export const currenciesSchema = z
  .array(currenciesEntrySchema)
  .min(1, 'Leave currencies out when it takes only its prices’ currencies');

export const renewalAnchorKindSchema = z.enum(renewalAnchorKinds);
export type RenewalAnchorKind = z.infer<typeof renewalAnchorKindSchema>;

/**
 * The day a provider renews on (M11.5, the guide's §3.1): the date you signed up (a shorter month's last day when it
 * has no such date), every 30 days, the 1st or the last day of each month, quoted from its terms or billing help; or
 * not-stated, with the pages read that don't say. A new item's next renewal follows it, and the item dialog asks
 * which day it's billed on only when it doesn't settle that (PROJECT-PLAN P6).
 */
export const renewalAnchorSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: renewalAnchorKindSchema.describe(
        'same-date: the date you signed up, each month or year; every-30-days (its prices are then day × 30); first-of-month; end-of-month',
      ),
      page: textSchema.describe('As the card links it (Help Center)'),
      url: httpsUrlSchema.describe(
        "The provider's own page that says so (its terms, a billing help article), on its own sites, its policies' or its owner's",
      ),
      quotes: z
        .array(textSchema)
        .min(1, 'Quote where it says so')
        .max(3, 'Quote at most three passages')
        .describe('Its words there that say which day it renews on, word for word'),
      lastVerified: isoDateSchema.describe('When the page was read'),
    }),
    z.strictObject({
      kind: z
        .literal('not-stated')
        .describe("Its terms and billing help don't say which day it renews on"),
      pages: z
        .array(httpsUrlSchema)
        .min(1, 'List the pages read')
        .describe("The pages read that don't say: its terms, its billing help"),
      lastVerified: isoDateSchema.describe('When the pages were read'),
    }),
  ])
  .superRefine((anchor, ctx) => {
    if (anchor.kind === 'not-stated') {
      addDuplicateIssues(ctx, anchor.pages, (index) => ['pages', index]);
      return;
    }
    if (!namesRenewalAnchor(anchor.quotes.join(' '), anchor.kind)) {
      ctx.addIssue({
        code: 'custom',
        message: `No quote says it renews on ${renewalAnchorNames[anchor.kind].toLowerCase()}: quote the words that do`,
        path: ['quotes'],
      });
    }
  });
export type RenewalAnchor = z.infer<typeof renewalAnchorSchema>;

/**
 * Where a provider's source code is (M11.5, with software.open-source): the repository, or the account holding its
 * repositories, as the provider's own page links it, with that page's words saying the code is open.
 */
export const sourceRepoSchema = z.strictObject({
  url: httpsUrlSchema.describe(
    'The repository, or the account that holds its repositories (https://github.com/mullvad)',
  ),
  page: z
    .strictObject({
      name: textSchema.describe('As the card links it (Open source)'),
      url: httpsUrlSchema.describe(
        "The provider's own page that links the repository, on its own sites, its policies' or its owner's",
      ),
    })
    .describe("The provider's own page that links it"),
  quotes: z
    .array(textSchema)
    .min(1, 'Quote where it says so')
    .max(3, 'Quote at most three passages')
    .describe('Its words there that say its code is open, word for word'),
  lastVerified: isoDateSchema.describe('When the page was read'),
});
export type SourceRepo = z.infer<typeof sourceRepoSchema>;

export const planSchema = z
  .strictObject({
    id: planIdSchema.describe('<provider id>.<slug> (netflix.standard)'),
    name: textSchema.describe('The plan name, without the provider name (Standard)'),
    formerNames: z
      .array(
        z.strictObject({
          name: textSchema.describe('A name the plan had before (Max 20x)'),
          until: isoDateSchema.describe('The last day it had that name'),
        }),
      )
      .min(1, 'Leave formerNames out instead of listing none')
      .describe(
        'Names the plan had before, newest first (M10.27): a renamed plan keeps its id. Search matches them, and its cards say "formerly" for six months after until',
      )
      .optional(),
    link: httpsUrlSchema.describe("Where to sign up for this plan, on the provider's own site"),
    categories: z
      .array(slugSchema)
      .min(1, "Leave categories out when the plan is in its provider's category only")
      .describe(
        "Every service category the plan fits, from categories.yaml, when they aren't just the provider's: Proton VPN Plus is [vpn], and Proton Unlimited is [privacy-suite, vpn, storage, email, passwords, calendar, ai]",
      )
      .optional(),
    notIn: z
      .array(slugSchema)
      .min(1, 'Leave notIn out instead of listing none')
      .describe(
        "Service categories its features name that it isn't sold as (M11.3): Proton Mail Plus comes with Proton VPN Free, but it isn't a VPN plan. Validation warns about any other category its features name and it isn't in",
      )
      .optional(),
    features: z
      .record(dottedSlugSchema, featureValueSchema)
      .describe(
        'Feature id → value, using ids from features.yaml. Unlisted booleans count as false and unlisted sets as empty',
      ),
    featureLabels: z
      .record(rankKeySchema, textSchema)
      .describe(
        "Feature id or rank key → the provider's own wording, shown instead of the registry name",
      )
      .optional(),
    perks: z
      .array(slugSchema)
      .min(1, 'Leave perks out instead of listing none')
      .describe(
        "The ids of its provider's perks this plan has (M11.6): each one a rank key, perk:<provider>/<perk>, which users rank on the plan and the optimizer counts",
      )
      .optional(),
    notes: textSchema.describe('Shown on the plan').optional(),
    retired: isoDateSchema
      .describe(
        'The day it stopped being sold to new subscribers (M10.27): never delete a plan. Its last prices stay, and items on it still count',
      )
      .optional(),
    endsOn: isoDateSchema
      .describe(
        'The day it ends for its current subscribers too, when the provider says so: needs retired. Items on it count until then',
      )
      .optional(),
    prices: pricesSchema,
    addOnIds: z
      .array(planIdSchema)
      .min(1, 'Leave addOnIds out instead of listing none')
      .describe("Ids of this provider's add-ons that can be bought with this plan")
      .optional(),
    addOnLimit: z
      .int()
      .positive('Must be a whole number of at least 1')
      .describe('The most add-ons this plan allows in total (extra members)')
      .optional(),
  })
  .superRefine((plan, ctx) => {
    addDuplicateIssues(ctx, plan.categories ?? [], (index) => ['categories', index]);
    addDuplicateIssues(ctx, plan.notIn ?? [], (index) => ['notIn', index]);
    addDuplicateIssues(ctx, plan.perks ?? [], (index) => ['perks', index]);
    const formerNames = (plan.formerNames ?? []).map(({ name }) => name);
    addDuplicateIssues(ctx, formerNames, (index) => ['formerNames', index, 'name']);
    formerNames.forEach((name, index) => {
      if (name === plan.name) {
        ctx.addIssue({
          code: 'custom',
          message: "That's its name now: list only the names it had before",
          path: ['formerNames', index, 'name'],
        });
      }
    });
    plan.formerNames?.forEach((former, index) => {
      const newer = plan.formerNames?.[index - 1];
      if (newer && newer.until < former.until) {
        ctx.addIssue({
          code: 'custom',
          message: 'List former names newest first',
          path: ['formerNames', index, 'until'],
        });
      }
    });
    addDuplicateIssues(ctx, plan.addOnIds ?? [], (index) => ['addOnIds', index]);
    if (plan.addOnLimit !== undefined && plan.addOnIds === undefined) {
      ctx.addIssue({ code: 'custom', message: 'addOnLimit needs addOnIds', path: ['addOnLimit'] });
    }
    addRetirementIssues(plan, ctx);
  });

/** `endsOn` needs `retired`, on or before it (M10.27). */
function addRetirementIssues(
  { retired, endsOn }: { retired?: string; endsOn?: string },
  ctx: z.RefinementCtx,
): void {
  if (endsOn === undefined) return;
  if (retired === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: 'endsOn needs retired: the day it stopped being sold',
      path: ['endsOn'],
    });
  } else if (endsOn < retired) {
    ctx.addIssue({
      code: 'custom',
      message: `Must be on or after retired (${retired})`,
      path: ['endsOn'],
    });
  }
}
export type Plan = z.infer<typeof planSchema>;

/**
 * A provider's perk (M11.6, BLUEPRINT §4.2): something of its own that no feature describes, listed once with an id
 * and its plans naming the ids they have. Its rank key, perk:<provider>/<perk>, is ranked on the plan in the item
 * dialog and counted like a feature's; the id is as permanent as a feature's.
 */
export const perkSchema = z.strictObject({
  id: slugSchema.describe(
    'Its id, permanent once published (fortnite-crew): its rank key is perk:<provider id>/<id>',
  ),
  name: textSchema.describe('As the card and the item dialog show it (Fortnite Crew passes)'),
});
export type Perk = z.infer<typeof perkSchema>;

export const addOnSchema = z.strictObject({
  id: planIdSchema.describe('<provider id>.<slug> (netflix.extra-member)'),
  name: textSchema.describe('Display name'),
  grantsPlan: planIdSchema
    .describe("The plan whose features the add-on gives (an extra member's plan)")
    .optional(),
  prices: pricesSchema,
});
export type AddOn = z.infer<typeof addOnSchema>;

export const providerSchema = z
  .strictObject({
    id: slugSchema.describe('Stable provider id, the same as the file name (netflix)'),
    name: textSchema.describe('Display name'),
    aliases: aliasesSchema.optional(),
    website: httpsUrlSchema.describe('The home page'),
    domains: z
      .array(domainSchema)
      .min(1, 'Leave domains out instead of listing none')
      .describe(
        "Its other sites' domains, besides its website's (Proton VPN's protonvpn.com, ESPN's press room): their pages can name its official resellers or its owner",
      )
      .optional(),
    category: slugSchema.describe('A service category id from categories.yaml'),
    spendCategory: slugSchema.describe(
      'A spend category id from categories.yaml, for card rewards',
    ),
    acceptedNetworks: z
      .record(regionSchema, acceptedNetworksSchema)
      .refine(
        (byRegion) => Object.keys(byRegion).length > 0,
        'Leave acceptedNetworks out when they are unknown',
      )
      .describe(
        "Region → the card networks the provider takes there, quoted from its own page (GLOBAL: wherever it sells). A region it doesn't cover is unknown, and every card is allowed there",
      )
      .optional(),
    paymentMethods: paymentMethodsSchema
      .describe(
        'How it can be paid, quoted from its own pages (M11.5): every provider says, cash and crypto included',
      )
      .optional(),
    currencies: currenciesSchema
      .describe(
        "Currencies it takes beyond its price lists' (M11.5): cash by post, a checkout that charges in the buyer's own. Left out when it takes only its prices' currencies",
      )
      .optional(),
    renewalAnchor: renewalAnchorSchema
      .describe(
        'The day it renews on (M11.5), quoted from its terms or billing help, or not-stated: every provider whose paid plans renew by the month or year says',
      )
      .optional(),
    billingCurrency: z
      .record(regionSchema, currencySchema)
      .describe('Region → the currency actually charged there, for FX-fee maths')
      .optional(),
    availableIn: z
      .array(regionSchema)
      .min(1, 'Leave availableIn out when the regions are unknown')
      .describe(
        "Every region the provider sells in, when known (BLUEPRINT §4.7): elsewhere the app shows Not offered. Left out, it's sold where it has prices and unknown elsewhere",
      )
      .optional(),
    cancelUrl: httpsUrlSchema.describe(
      "Where to cancel: the provider's cancel page, or its help article on cancelling (for a prepaid service, on getting unused time back)",
    ),
    cancelFee: textSchema
      .describe('Any cancellation fee. Leave it out when there is none')
      .optional(),
    sources: z
      .strictObject({
        pricing: httpsUrlSchema.describe('The pricing page the prices were read from').optional(),
      })
      .describe('Pages the catalog data was taken from')
      .optional(),
    notes: textSchema.describe('Shown on the provider').optional(),
    retired: isoDateSchema
      .describe(
        "The day it stopped selling (M10.27): never delete a provider. Its plans' last prices stay, and items on them still count",
      )
      .optional(),
    endsOn: isoDateSchema
      .describe(
        'The day it ends for its current subscribers too, when it says so: needs retired. Items on its plans count until then',
      )
      .optional(),
    features: z
      .record(dottedSlugSchema, featureValueSchema)
      .refine(
        (features) => Object.keys(features).length > 0,
        'Leave features out instead of listing none',
      )
      .describe(
        "Provider-wide feature id → value (M11.4): only features.yaml's providerWide ones (platforms, sign-in, languages, support), which every plan has unless it states its own",
      )
      .optional(),
    perks: z
      .array(perkSchema)
      .min(1, 'Leave perks out instead of listing none')
      .describe(
        'Its perks (M11.6): what its plans have that no feature in features.yaml describes, each with an id its plans list. A perk a second provider comes to offer becomes a feature, through data/redirects.yaml',
      )
      .optional(),
    sourceRepo: sourceRepoSchema
      .describe(
        'Where its source code is (M11.5), as its own page links it: needed when software.open-source says its apps or all of it are open',
      )
      .optional(),
    plans: z.array(planSchema).min(1, 'List at least one plan'),
    addOns: z
      .array(addOnSchema)
      .min(1, 'Leave addOns out instead of listing none')
      .describe('Extras bought on top of a plan; plans list the ones they allow in addOnIds')
      .optional(),
    resellers: z
      .array(resellerListingSchema)
      .min(1, 'Leave resellers out instead of listing none')
      .describe(
        "Shops the provider's own site names as official resellers of its plans, with their regular prices (BLUEPRINT §4.9)",
      )
      .optional(),
    policies: policiesSchema
      .describe(
        "Its terms and policies rated on policy-topics.yaml's topics, quoting its own pages (BLUEPRINT §4.10)",
      )
      .optional(),
    ratings: outsideRatingsSchema
      .describe(
        "Outside raters' labels (M11.2): a news outlet's bias and reliability from two raters at least, an antivirus's lab results. Only raters in data/raters.yaml, never their text",
      )
      .optional(),
    owner: ownerSchema
      .describe(
        "The company behind it (M11.2), quoted from its about page, its owner's own page about it, or its terms: every provider says",
      )
      .optional(),
  })
  .superRefine((provider, ctx) => {
    // Plan and add-on ids live under the provider's id, so they're unique across the catalog. A badly formed
    // provider id already has its own issue, so the prefix check skips it.
    const prefix = `${provider.id}.`;
    const ids = [
      ...provider.plans.map((plan, index) => ({ id: plan.id, path: ['plans', index, 'id'] })),
      ...(provider.addOns ?? []).map((addOn, index) => ({
        id: addOn.id,
        path: ['addOns', index, 'id'],
      })),
    ];
    if (slugSchema.safeParse(provider.id).success) {
      for (const { id, path } of ids) {
        if (!id.startsWith(prefix)) {
          ctx.addIssue({ code: 'custom', message: `Must start with "${prefix}"`, path });
        }
      }
    }
    addDuplicateIssues(
      ctx,
      ids.map(({ id }) => id),
      (index) => ids[index].path,
    );
    addDuplicateIssues(ctx, provider.availableIn ?? [], (index) => ['availableIn', index]);
    addRetirementIssues(provider, ctx);
    const resellers = provider.resellers ?? [];
    addDuplicateIssues(
      ctx,
      resellers.map((listing) => listing.reseller),
      (index) => ['resellers', index, 'reseller'],
    );
    const planIds = provider.plans.map((plan) => plan.id);
    resellers.forEach((listing, index) => {
      listing.offers.forEach((offer, offerIndex) => {
        if (!planIds.includes(offer.plan)) {
          ctx.addIssue({
            code: 'custom',
            message: `"${offer.plan}" isn't a plan in this file${choices(offer.plan, planIds)}`,
            path: ['resellers', index, 'offers', offerIndex, 'plan'],
          });
        }
      });
      // One offer per plan: a plan sold in several stores has all their prices, each with its region.
      addDuplicateIssues(
        ctx,
        listing.offers.map((offer) => offer.plan),
        (offerIndex) => ['resellers', index, 'offers', offerIndex, 'plan'],
      );
    });
    // Perks: each listed once, each a plan lists, and each a plan lists one of the provider's.
    const perkIds = (provider.perks ?? []).map((perk) => perk.id);
    addDuplicateIssues(ctx, perkIds, (index) => ['perks', index, 'id']);
    const listed = new Set(provider.plans.flatMap((plan) => plan.perks ?? []));
    perkIds.forEach((id, index) => {
      if (provider.plans.length > 0 && !listed.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `No plan lists "${id}": list it on the plans that have it, or remove it`,
          path: ['perks', index, 'id'],
        });
      }
    });
    provider.plans.forEach((plan, planIndex) => {
      (plan.perks ?? []).forEach((id, index) => {
        if (!perkIds.includes(id)) {
          ctx.addIssue({
            code: 'custom',
            message: `"${id}" isn't one of ${provider.id}'s perks${choices(id, perkIds)}: add it to the provider's perks with its name`,
            path: ['plans', planIndex, 'perks', index],
          });
        }
      });
    });
    provider.policies?.ratings?.forEach((rating, index) => {
      (rating.plans ?? []).forEach((plan, planIndex) => {
        if (!planIds.includes(plan)) {
          ctx.addIssue({
            code: 'custom',
            message: `"${plan}" isn't a plan in this file${choices(plan, planIds)}`,
            path: ['policies', 'ratings', index, 'plans', planIndex],
          });
        }
      });
    });
  })
  .meta({
    title: 'Simply Sub provider',
    description:
      'data/providers/<id>.yaml: one provider with its plans and add-ons (BLUEPRINT §4.3)',
  });
export type Provider = z.infer<typeof providerSchema>;
