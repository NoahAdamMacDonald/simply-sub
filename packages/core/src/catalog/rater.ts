import * as z from 'zod';
import { addDays, type IsoDate } from '../dates/iso-date';
import { addDuplicateIssues } from './checks';
import { domainSchema, httpsUrlSchema, isoDateSchema, slugSchema, textSchema } from './formats';
import { namesCountry } from './provider-facts';

// Outside ratings and owners (BLUEPRINT §4.10, M11.2). Some facts a buyer needs can't come from the provider's own
// pages: a news outlet's bias and reliability, an antivirus's lab results. data/raters.yaml lists the raters whose
// terms allow showing their label with a link, and a provider's `ratings` gives each one's label, its date and a link
// to the rater's page for it: never the rater's text, and never our own judgement. A provider's `owner` is the company
// behind it, quoted from the provider's own pages like a policy source.

/** What raters rate. The card shows them in this order, under these names. */
export const ratingSubjectSchema = z.enum([
  'news-bias',
  'news-reliability',
  'antivirus-protection',
  'antivirus-performance',
  'antivirus-usability',
]);
export type RatingSubject = z.infer<typeof ratingSubjectSchema>;

export const ratingSubjects: Record<
  RatingSubject,
  {
    /** As the card names it. */
    name: string;
    /** The fewest raters a provider rated on it needs, so no single rater's view stands alone. */
    minRaters: number;
  }
> = {
  'news-bias': { name: 'Bias', minRaters: 2 },
  'news-reliability': { name: 'Reliability', minRaters: 2 },
  'antivirus-protection': { name: 'Protection', minRaters: 1 },
  'antivirus-performance': { name: 'Performance', minRaters: 1 },
  'antivirus-usability': { name: 'Usability', minRaters: 1 },
};

/** A rater's labels for one subject, in its own order (best first for a grade, left to right for bias). */
export const raterScaleSchema = z
  .strictObject({
    subject: ratingSubjectSchema.describe('What it rates'),
    labels: z
      .array(textSchema)
      .min(2, 'List its labels in order: a scale has two at least')
      .describe("The rater's own labels, word for word, in its own order"),
  })
  .superRefine((scale, ctx) => addDuplicateIssues(ctx, scale.labels, (index) => ['labels', index]));
export type RaterScale = z.infer<typeof raterScaleSchema>;

export const raterSchema = z.strictObject({
  id: slugSchema.describe('Stable rater id (av-test)'),
  name: textSchema.describe('As the card credits it (AV-TEST)'),
  website: httpsUrlSchema.describe('Its home page'),
  domains: z
    .array(domainSchema)
    .min(1, 'Leave domains out instead of listing none')
    .describe("Other domains its rating pages are on, besides its website's")
    .optional(),
  scales: z
    .array(raterScaleSchema)
    .min(1, 'List what it rates')
    .describe('What it rates, each with its label scale'),
  terms: z
    .strictObject({
      url: httpsUrlSchema.describe('Its own page on reusing its ratings: terms of use, a FAQ'),
      quotes: z
        .array(textSchema)
        .min(1, 'Quote the words that allow it')
        .max(3, 'Quote at most three passages')
        .describe('Where that page allows showing its label with a link, word for word'),
      note: textSchema
        .describe('What it asks for, and how the card meets it: credit, a link, the test date')
        .optional(),
      checked: isoDateSchema.describe('When the terms were read'),
    })
    .describe(
      'Its terms of reuse, checked before it was added: only a rater whose terms plainly allow a label with a link is listed',
    ),
});
export type Rater = z.infer<typeof raterSchema>;

export const ratersFileSchema = z
  .array(raterSchema)
  .superRefine((raters, ctx) => {
    addDuplicateIssues(
      ctx,
      raters.map((rater) => rater.id),
      (index) => [index, 'id'],
    );
    raters.forEach((rater, index) =>
      addDuplicateIssues(
        ctx,
        rater.scales.map((scale) => scale.subject),
        (scaleIndex) => [index, 'scales', scaleIndex, 'subject'],
      ),
    );
  })
  .meta({
    title: 'Simply Sub raters',
    description:
      'data/raters.yaml: the outside raters whose labels providers show, each with its terms of reuse (BLUEPRINT §4.10)',
  });

/** A rater's date for a rating: the day it was published, or the month of a lab's test. */
export const ratingDateSchema = z.union([
  isoDateSchema,
  z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Use a real date written YYYY-MM-DD, or a month YYYY-MM'),
]);

/** The day a rating's date starts: a month's first. */
export function ratingDay(date: string): IsoDate {
  return date.length === 7 ? `${date}-01` : date;
}

/** Whether a rating's date is over a year before `today`, so the rater may have a newer one. */
export function ratingIsOld(date: string, today: IsoDate): boolean {
  return addDays(ratingDay(date), 365) < today;
}

export const outsideRatingSchema = z.strictObject({
  rater: slugSchema.describe('A rater id from data/raters.yaml'),
  subject: ratingSubjectSchema.describe('What it rates, one of the rater’s scales'),
  label: textSchema.describe("The rater's label, word for word from its scale"),
  date: ratingDateSchema.describe(
    "The rater's date for it: the day it published the rating, or the month of a lab's test (2026-08)",
  ),
  url: httpsUrlSchema.describe("The rater's own page for it, on its website"),
  tested: textSchema
    .describe(
      "What the rater tested, as its page names it, when that isn't simply the provider: a lab's product and system (Total Security 27.0, Windows 11)",
    )
    .optional(),
});
export type OutsideRating = z.infer<typeof outsideRatingSchema>;

export const outsideRatingsSchema = z
  .array(outsideRatingSchema)
  .min(1, 'Leave ratings out instead of listing none')
  .superRefine((ratings, ctx) =>
    addDuplicateIssues(
      ctx,
      ratings.map((rating) => `${rating.rater} ${rating.subject}`),
      (index) => [index, 'subject'],
    ),
  );

/**
 * Where the company behind a provider is from (the owner's choice, 2026-11-03): an ISO 3166-1 code, and the words that
 * say so. Its own page and quotes when the owner's page doesn't say it (an address in the terms, the parent's about
 * page); without them, the owner's quotes must.
 */
export const ownerCountrySchema = z
  .strictObject({
    code: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Use a two-letter ISO 3166-1 country code in capitals (US, CA, CH)')
      .describe('The country, as an ISO 3166-1 alpha-2 code (GB, not UK)'),
    page: z
      .strictObject({
        name: textSchema.describe('As the card links it (Corporate information)'),
        url: httpsUrlSchema.describe(
          "The provider's own page, its owner's or its policies' that says where the company is",
        ),
      })
      .describe('Its page, when the owner’s page doesn’t say where the company is')
      .optional(),
    quotes: z
      .array(textSchema)
      .min(1, 'Quote where it says so')
      .max(3, 'Quote at most three passages')
      .describe(
        'Its words there that name the country, its people (Swiss) or, in an address, a state or province (Ontario)',
      )
      .optional(),
    lastVerified: isoDateSchema.describe('When its page was read').optional(),
  })
  .superRefine((country, ctx) => {
    const given = [country.page, country.quotes, country.lastVerified].filter(Boolean).length;
    if (given !== 0 && given !== 3) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Give its page, quotes and lastVerified together, or none when the owner’s quotes say it',
        path: [!country.page ? 'page' : !country.quotes ? 'quotes' : 'lastVerified'],
      });
    }
  });
export type OwnerCountry = z.infer<typeof ownerCountrySchema>;

/** A share listing: the exchange as the page names it, and the company's symbol there. */
export const stockListingSchema = z.strictObject({
  exchange: textSchema.describe('The exchange, as the page names it (TSX, NYSE, Nasdaq)'),
  symbol: z
    .string()
    .regex(
      /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/,
      'Use the ticker symbol in capitals, as the exchange lists it (BCE, RCI.B)',
    )
    .describe('Its ticker symbol there (NFLX, RCI.B)'),
});
export type StockListing = z.infer<typeof stockListingSchema>;

/** Who holds most of a public company's shares or votes, as its own pages name them. */
export const majorityHolderSchema = z.strictObject({
  name: textSchema.describe('As the page names them (OSN Group, the Rogers Control Trust)'),
  percent: z
    .number()
    .gt(50, 'A majority is more than 50%')
    .max(100, 'Must be a percentage, 100 at most')
    .describe('Their part, in percent, when the page gives it: 55.45 means 55.45%')
    .optional(),
  of: z
    .enum(['shares', 'votes'])
    .describe(
      'Whether the page counts their part of the shares or of the votes (a dual-class company’s founders often hold most votes with few shares)',
    ),
});
export type MajorityHolder = z.infer<typeof majorityHolderSchema>;

/**
 * A public company's shares (the owner's item of 2026-11-10): where they trade, and who holds most of them or most of
 * the votes when someone does. Its own page and quotes when the owner's don't say it all (an investor page, an annual
 * report); either one's words may name each fact.
 */
export const ownerStockSchema = z
  .strictObject({
    company: textSchema
      .describe(
        'The listed company, when it isn’t the owner itself but its parent (Alphabet Inc., for Google LLC)',
      )
      .optional(),
    listings: z
      .array(stockListingSchema)
      .min(1, 'Leave listings out instead of listing none')
      .describe('Where its shares trade, each with its ticker symbol')
      .optional(),
    majorityHolder: majorityHolderSchema
      .describe('Who holds more than half of its shares or votes, when its pages name someone')
      .optional(),
    page: z
      .strictObject({
        name: textSchema.describe('As the card links it (Investor relations)'),
        url: httpsUrlSchema.describe(
          "Its investor page or annual report, on the provider's sites or its owner's",
        ),
      })
      .describe('Its page, when the owner’s page doesn’t say it')
      .optional(),
    quotes: z
      .array(textSchema)
      .min(1, 'Quote where it says so')
      .max(3, 'Quote at most three passages')
      .describe('Its words there that name each exchange and symbol, and the majority holder')
      .optional(),
    lastVerified: isoDateSchema.describe('When its page was read').optional(),
  })
  .superRefine((stock, ctx) => {
    if (!stock.listings && !stock.majorityHolder) {
      ctx.addIssue({
        code: 'custom',
        message: 'Give its listings, its majority holder, or both',
        path: [],
      });
    }
    const given = [stock.page, stock.quotes, stock.lastVerified].filter(Boolean).length;
    if (given !== 0 && given !== 3) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Give its page, quotes and lastVerified together, or none when the owner’s quotes say it',
        path: [!stock.page ? 'page' : !stock.quotes ? 'quotes' : 'lastVerified'],
      });
    }
    addDuplicateIssues(
      ctx,
      (stock.listings ?? []).map((listing) => `${listing.exchange} ${listing.symbol}`),
      (index) => ['listings', index, 'symbol'],
    );
  });
export type OwnerStock = z.infer<typeof ownerStockSchema>;

/**
 * Whether `text` has `word` with no letter or digit on either side: "NYSE: SPOT" has SPOT, "SPOTIFY" doesn't. A number
 * doesn't end inside a longer one either: "61.2%" doesn't have 61.
 */
function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?<![\\p{L}\\p{N}]|\\p{N}[.,])${escaped}(?![\\p{L}\\p{N}]|[.,]\\p{N})`,
    'u',
  ).test(text);
}

/**
 * What the words leave unsaid: each listing's exchange and symbol, the majority holder and its percent. Its own page's
 * quotes and the owner's both count, since an investor page can give the symbol and the owner's page the holder.
 */
function stockProblems(
  stock: OwnerStock,
  ownerQuotes: readonly string[],
): { path: (string | number)[]; message: string }[] {
  const text = [...(stock.quotes ?? []), ...ownerQuotes].join('\n');
  const lower = text.toLowerCase();
  const where = stock.quotes ? 'No quote names' : "The owner's quotes don't name";
  const fix = stock.quotes ? '' : ': give the stock a page and quotes of its own';
  const problems = (stock.listings ?? []).flatMap((listing, index) => [
    ...(lower.includes(listing.exchange.toLowerCase())
      ? []
      : [{ path: ['listings', index, 'exchange'], message: `${where} ${listing.exchange}${fix}` }]),
    ...(hasWord(text, listing.symbol)
      ? []
      : [{ path: ['listings', index, 'symbol'], message: `${where} ${listing.symbol}${fix}` }]),
  ]);
  const holder = stock.majorityHolder;
  if (holder && !lower.includes(holder.name.toLowerCase())) {
    problems.push({ path: ['majorityHolder', 'name'], message: `${where} ${holder.name}${fix}` });
  }
  // A percent of 50 or less has its own issue (a majority is more than half).
  if (
    holder?.percent !== undefined &&
    holder.percent > 50 &&
    !hasWord(text, String(holder.percent))
  ) {
    problems.push({
      path: ['majorityHolder', 'percent'],
      message: `${where} ${holder.percent}%${fix}`,
    });
  }
  return problems;
}

export const ownerSchema = z
  .strictObject({
    name: textSchema.describe(
      'The company behind it, as the page names it, with the shares when the page gives them (The Walt Disney Company (72%), Hearst (18%) and the NFL (10%))',
    ),
    website: httpsUrlSchema
      .describe(
        "The owner's own website, when a page quoted is there: the parent's about page or annual report (Microsoft's for Xbox Game Pass)",
      )
      .optional(),
    page: z
      .strictObject({
        name: textSchema.describe('As the card links it (About us)'),
        url: httpsUrlSchema.describe(
          "The provider's about page, else its owner's own page about it, else its terms when that's where it says so",
        ),
      })
      .describe('The provider’s or its owner’s own page that names the company'),
    quotes: z
      .array(textSchema)
      .min(1, 'Quote where it says so')
      .max(3, 'Quote at most three passages')
      .describe('Its words there that name the company, word for word'),
    country: ownerCountrySchema
      .describe('Where the company is from (the owner’s choice, 2026-11-03): every provider says')
      .optional(),
    stock: ownerStockSchema
      .describe(
        'A public company’s ticker symbols and majority holder (the owner’s item of 2026-11-10), quoted like its name',
      )
      .optional(),
    lastVerified: isoDateSchema.describe('When the pages were read'),
  })
  .superRefine((owner, ctx) => {
    const { country, stock } = owner;
    if (stock) {
      for (const { path, message } of stockProblems(stock, owner.quotes)) {
        ctx.addIssue({ code: 'custom', message, path: ['stock', ...path] });
      }
    }
    if (!country || !/^[A-Z]{2}$/.test(country.code)) return;
    const quotes = country.quotes ?? owner.quotes;
    if (!namesCountry(quotes.join('\n'), country.code)) {
      ctx.addIssue({
        code: 'custom',
        message: country.quotes
          ? `No quote names ${country.code}: quote the words that name the country, its people or, in an address, a state or province`
          : `The owner's quotes don't name ${country.code}: give the country a page and quotes of its own`,
        path: ['country', country.quotes ? 'quotes' : 'code'],
      });
    }
  });
export type Owner = z.infer<typeof ownerSchema>;
