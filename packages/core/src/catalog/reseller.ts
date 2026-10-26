import * as z from 'zod';
import { addDuplicateIssues } from './checks';
import { httpsUrlSchema, planIdSchema, slugSchema, textSchema } from './formats';
import { priceSchema } from './price';

// Resellers (BLUEPRINT §4.9): shops that sell a provider's own subscription, such as Amazon's and retailers'
// vouchers for Mullvad VPN. data/resellers.yaml lists each one once; a provider file says which of them sell its
// plans, quoting the provider's own page that names them as official resellers. Partners that only use a provider's
// service in their own (Mozilla VPN runs on Mullvad's servers but sells Mozilla VPN) are never resellers.

/** A domain name in lower case: amazon.ca. */
const domainSchema = z
  .string()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'Use a domain name in lower case (amazon.ca)',
  );

export const resellerSchema = z.strictObject({
  id: slugSchema.describe(
    'Stable reseller id (serialcart), also the name of its logo: data/logos/<id>.png',
  ),
  name: textSchema.describe('Display name'),
  website: httpsUrlSchema.describe('Its home page, where its logo comes from'),
  domains: z
    .array(domainSchema)
    .min(1, 'Leave domains out instead of listing none')
    .describe(
      "Other domains its prices' pages are on, besides its website's (Amazon's stores: amazon.ca)",
    )
    .optional(),
});
export type Reseller = z.infer<typeof resellerSchema>;

export const resellersFileSchema = z
  .array(resellerSchema)
  .superRefine((resellers, ctx) =>
    addDuplicateIssues(
      ctx,
      resellers.map((reseller) => reseller.id),
      (index) => [index, 'id'],
    ),
  )
  .meta({
    title: 'Simply Sub resellers',
    description:
      "data/resellers.yaml: shops that sell providers' subscriptions, each named as official on a provider's own site (BLUEPRINT §4.9)",
  });

/** The quote that says a price leaves tax to be added, or that it includes it: the source page's own words. */
const taxQuoteSchema = z.strictObject({
  quote: textSchema.describe(
    "The source page's own words that say so, which the nightly check looks for",
  ),
});

/** A reseller's price: a regular price like any other, read from the reseller's page for it, which the app links to. */
export const resellerPriceSchema = priceSchema
  .safeExtend({
    sourceUrl: httpsUrlSchema.describe(
      "The reseller's page for it, which the app links to: on its website or one of its domains",
    ),
    taxExcluded: taxQuoteSchema
      .describe(
        'The amount leaves VAT or sales tax to be added wherever the buyer is ("excl. VAT"). The app then compares it only where it knows the tax: Canada and the US (BLUEPRINT §4.8)',
      )
      .optional(),
  })
  .refine((price) => !(price.taxIncluded && price.taxExcluded), {
    message: 'A price includes tax or excludes it: keep taxIncluded or taxExcluded',
    path: ['taxExcluded'],
  });
export type ResellerPrice = z.infer<typeof resellerPriceSchema>;

export const resellerOfferSchema = z.strictObject({
  plan: planIdSchema.describe('The plan it sells, from this file'),
  prices: z
    .array(resellerPriceSchema)
    .min(1, 'List at least one price')
    .describe('What it normally charges where it sells, for each period: never a sale price'),
  notes: textSchema
    .describe('What the buyer gets: a scratch card in the post, a code by email')
    .optional(),
});
export type ResellerOffer = z.infer<typeof resellerOfferSchema>;

/** One reseller of a provider's plans, and the provider's own words that name it as an official one. */
export const resellerListingSchema = z.strictObject({
  reseller: slugSchema.describe('A reseller id from data/resellers.yaml'),
  approvedBy: z
    .strictObject({
      url: httpsUrlSchema.describe(
        "The provider's own page that names it as an official reseller, on the provider's domain",
      ),
      quotes: z
        .array(textSchema)
        .min(1, 'Quote the words that name it')
        .describe(
          'Where that page names it ("Amazon - CA"), word for word, which the nightly check looks for',
        ),
    })
    .describe('Partners that only use the service in their own are never resellers'),
  offers: z.array(resellerOfferSchema).min(1, 'List at least one offer'),
});
export type ResellerListing = z.infer<typeof resellerListingSchema>;

/** The host of an https URL, which httpsUrlSchema checked has a domain name: www.amazon.ca. */
export function urlHost(url: string): string {
  return (/^https:\/\/(?:[^@/?#]*@)?([^/:?#]+)/i.exec(url)?.[1] ?? '').toLowerCase();
}

/** The domain a website is on, without its www: amazon.com. */
export function siteDomain(website: string): string {
  return urlHost(website).replace(/^www\./, '');
}

/** Whether `url` is on one of `domains` or a subdomain of one: digitalgoods.proxystore.de is on proxystore.de. */
export function isOnDomain(url: string, domains: readonly string[]): boolean {
  const host = urlHost(url);
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** The domains a reseller's price pages may be on: its website's and the ones it lists. */
export function resellerDomains(reseller: Pick<Reseller, 'website' | 'domains'>): string[] {
  return [siteDomain(reseller.website), ...(reseller.domains ?? [])];
}
