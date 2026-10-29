import { networksNamedIn } from '../catalog/card-networks';
import { moneyIn } from './amounts';
import { pageText } from './page-text';
import type { SearchResult } from './search';
import { bareHost, hostOnDomain, parseWebAddress } from './web-address';

// Finding a provider's pages without picking URLs by hand (BLUEPRINT §6.5 ②, M3.2): its pricing page, its cancel page
// or help article, its terms of service and privacy policy, its payment methods (accepted card networks), and its
// bundle and official reseller pages. For each kind it tries these in order, and stops at the first page that is one:
// 1. the website itself, when it's a product's own page (youtube.com/premium), then common paths on its host
//    (/pricing, /plans, /terms, /abonnement …),
// 2. its sitemaps (robots.txt's Sitemap lines, else /sitemap.xml) and its help centre's (help. and support.),
// 3. the links in its home page's navigation and footer, then the rest of the home page, then its help centre's,
// 4. a web search, when one is left this month.
// A page counts when its own words fit the kind (prices for a pricing page, "personal information" for a privacy
// policy); one whose words can't be read without a browser counts only as probable. On a site that answers every path
// (a single-page app's soft 404), a guessed path counts only when its words fit. English and French: many Canadian
// services are Quebec's. The scripts and the bot give it their own ways to fetch (polite: robots.txt, one request per
// URL) and to search.

export const pageKinds = [
  'pricing',
  'cancel',
  'terms',
  'privacy',
  'payment',
  'bundles',
  'resellers',
] as const;
export type PageKind = (typeof pageKinds)[number];

/** A link on a page: where it goes (resolved), its words, and the part of the page it's in. */
export interface PageLink {
  url: string;
  words: string;
  area: 'nav' | 'footer' | 'body';
}

/** A link as written, before it's resolved against its page. */
export interface RawLink {
  href: string;
  words: string;
  area: PageLink['area'];
}

/** The paths tried first, in order, on the website's own host. */
export const commonPaths: Readonly<Record<PageKind, readonly string[]>> = {
  pricing: [
    '/pricing',
    '/plans',
    '/premium',
    '/subscribe',
    '/compare',
    '/en-ca/pricing',
    '/ca/plans',
    '/membership',
    '/abonnement',
  ],
  cancel: ['/cancel', '/cancelplan', '/account/cancel', '/help/cancel', '/cancel-subscription'],
  terms: [
    '/terms',
    '/terms-of-service',
    '/terms-of-use',
    '/legal/terms',
    '/tos',
    '/legal',
    '/conditions',
  ],
  privacy: ['/privacy', '/privacy-policy', '/legal/privacy', '/privacy-notice', '/confidentialite'],
  payment: ['/payment-methods', '/help/payment-methods', '/billing'],
  bundles: ['/bundles', '/bundle'],
  resellers: ['/resellers', '/where-to-buy', '/retailers', '/partners/resellers', '/partners'],
};

/** A path no site has, which a site that answers every path still answers (a single-page app's soft 404). */
export const missingPath = '/simply-sub-page-that-isnt-here';

/**
 * What web searches ask, in order, for a provider's page of a kind. Resellers are also looked for in its own posts on
 * each of its sites (BLUEPRINT §6.5): Proton names its resellers only in a Proton VPN blog post.
 */
export function searchQueries(kind: PageKind, site: ProviderSite): string[] {
  const { name } = site;
  switch (kind) {
    case 'pricing':
      return [`${name} plans pricing Canada`];
    case 'cancel':
      return [`how to cancel ${name} subscription`];
    case 'terms':
      return [`${name} terms of service`];
    case 'privacy':
      return [`${name} privacy policy`];
    case 'payment':
      return [`${name} accepted payment methods credit cards`];
    case 'bundles':
      return [`${name} bundle`];
    case 'resellers': {
      const host = parseWebAddress(site.website)?.host;
      const domains = [...(host ? [registeredDomain(host)] : []), ...(site.domains ?? [])];
      return [
        `${name} official resellers where to buy`,
        ...domains.map((domain) => `site:${domain} reseller OR partnered OR voucher`),
      ];
    }
  }
}

type Weights = readonly (readonly [RegExp, number])[];

/**
 * Words in a URL's path (split at / - _ .), without accents, and their weight for each kind; the words of a whole
 * path segment run together count too (/termsofuse).
 */
const pathWords: Readonly<Record<PageKind, Weights>> = {
  pricing: [
    [/^(?:pricing|plans|prices|abonnements?|forfaits|tarifs)$/, 6],
    [
      /^(?:plan|price|premium|subscribe|subscriptions?|membership|compare|offers?|forfait|prix|cost)$/,
      4,
    ],
    [/^(?:planform|buy|upgrade|order|get)$/, 2],
  ],
  cancel: [
    [
      /^(?:cancel|cancelplan|cancellation|cancelling|canceling|unsubscribe|annuler|annulation|resilier|resiliation)$/,
      6,
    ],
    [/^(?:end|stop|membership|subscription)$/, 1],
  ],
  terms: [
    [/^(?:terms|tos|termsofuse|termsofservice)$/, 6],
    [/^(?:conditions|agreement|eula|legal|subscriber|modalites)$/, 3],
    [/^(?:use|service|utilisation)$/, 1],
  ],
  privacy: [
    [/^(?:privacy|privacypolicy|confidentialite|privee)$/, 6],
    [/^(?:notice|policy|statement|data|protection|gdpr|renseignements)$/, 1],
  ],
  payment: [
    [/^(?:payment|payments|paymentmethods|paiement)$/, 6],
    [/^(?:billing|methods?|options?|cards?|pay|facturation)$/, 2],
  ],
  bundles: [
    [/^(?:bundles?|bundled|forfaits?)$/, 6],
    [/^(?:combo|package|packages)$/, 2],
  ],
  resellers: [
    [/^(?:resellers?|retailers?|distributors?|revendeurs?)$/, 6],
    [/^(?:where|buy|retail|partners?|partnerships?|giftcards?|gift|vouchers?|stores?)$/, 2],
  ],
};

/** The same for a link's words (and a search result's title), in lower case. */
const linkWords: Readonly<Record<PageKind, Weights>> = {
  pricing: [
    [
      /\b(?:plans? (?:and|&) pric(?:es|ing)|pricing|see (?:all )?plans|compare plans|view plans|choose (?:a|your) plan|abonnements?|forfaits|tarifs)\b/,
      6,
    ],
    [/\b(?:plans|subscribe|premium|membership|get started|buy now|upgrade|s'abonner|cost)\b/, 3],
  ],
  cancel: [[/\b(?:cancel|annuler|résilier)/, 6]],
  terms: [
    [
      /\b(?:terms(?: of (?:use|service))?|terms (?:and|&) conditions|subscriber agreement|user agreement|eula|conditions d'utilisation|modalités)/,
      6,
    ],
    [/\b(?:legal|juridique)\b/, 2],
  ],
  privacy: [
    [/\b(?:privacy(?: (?:policy|notice|statement|centre|center))?|confidentialité|vie privée)/, 6],
  ],
  payment: [
    [
      /\b(?:payment (?:methods|options)|ways to pay|accepted payments?|how to pay|modes de paiement)/,
      6,
    ],
    [/\b(?:billing|payment|paiement|facturation)/, 2],
  ],
  bundles: [[/\b(?:bundles?|forfaits?)\b/, 6]],
  resellers: [
    [
      /\b(?:resellers?|where to buy|retailers?|authori[sz]ed (?:partners?|dealers?|sellers?)|revendeurs?)\b/,
      6,
    ],
    [/\b(?:partners?|gift cards?|vouchers?)\b/, 2],
  ],
};

/** Words that make a URL another kind of page than any of these: a business plan, a job, a sign-in. */
const offTopic =
  /^(?:business|enterprise|teams?|developers?|api|docs|careers?|jobs|press|newsroom|investors?|affiliates?|contact|login|signin|sign|register|cart|checkout|download|downloads|cookies?|accessibility|sitemap)$/;

/** Words of a streaming service's catalogue: an episode called "Best Laid Plans" is no pricing page. */
const catalogue =
  /^(?:play|watch|videos?|movies?|films?|shows?|series|episodes?|seasons?|titles?|browse|genres?|channels?|artists?|albums?|tracks?|podcasts?|s\d+e\d+)$/;

/** Words of a page that lists others: a help centre's category or section, a tag. */
const listing = /^(?:categories|category|sections?|tags?|topics?|collections?)$/;

/**
 * Locales in a path, as whole segments (/en-ca/, /ca/) or inside a slug (disneyplus-en-ca-price): Canada's English or
 * French first, then English or none (en, en-us: often the default), French without a country neutral; another
 * country's last (en-au, fr-fr, de).
 */
function localeScore(segments: readonly string[]): number {
  let score = 0;
  const judge = (language: string | undefined, country: string | undefined) => {
    // Canada's English before its French: the catalog is written in English.
    if (country === 'ca') score = Math.max(score, language === 'fr' ? 2 : 3);
    else if (language === 'en' && (country === undefined || country === 'us'))
      score = Math.max(score, 1);
    else if (!(language === 'fr' && country === undefined)) score = Math.min(score, -3);
  };
  for (const segment of segments) {
    const whole = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/.exec(segment);
    if (whole && !/^(?:tv|my|go|me|vpn|pc|ai|hc)$/.test(segment)) {
      // ca and us alone are countries; ca-en is Spotify's way round.
      const [first, second] = [whole[1], whole[2]];
      if (second === undefined && (first === 'ca' || first === 'us')) judge('en', first);
      else if (first === 'ca' || second === 'en')
        judge(second ?? first, first === 'ca' ? 'ca' : first);
      else judge(first, second);
      continue;
    }
    const inside = /(?:^|[-_])(en|fr)[-_]([a-z]{2})(?:[-_]|$)/.exec(segment);
    if (inside) judge(inside[1], inside[2]);
  }
  return score;
}

/** How well a URL (and the words of the link to it) fits a kind: above 0 when it might be one. */
export function urlScore(kind: PageKind, url: string, words = ''): number {
  const address = parseWebAddress(url);
  if (!address) return 0;
  const segments = withoutAccents(decodePath(address.path).toLowerCase())
    .split('/')
    .filter(Boolean);
  const tokens = segments.flatMap((segment) => segment.split(/[-_.+]+/)).filter(Boolean);
  const joined = segments.map((segment) => segment.replace(/[-_.+]/g, ''));
  let score = 0;
  // A help article that asks "how much does it cost?".
  if (kind === 'pricing' && /how[-_]much/.test(address.path.toLowerCase())) score += 3;
  for (const [pattern, weight] of pathWords[kind]) {
    if (tokens.some((token) => pattern.test(token)) || joined.some((part) => pattern.test(part)))
      score += weight;
  }
  const said = words.toLowerCase().replace(/\s+/g, ' ');
  for (const [pattern, weight] of linkWords[kind]) if (pattern.test(said)) score += weight;
  if (score === 0) return 0;
  // Business plans are out of the catalog's scope (BLUEPRINT §1.3), and a sign-in or a show is never the page.
  if (tokens.some((token) => offTopic.test(token) || catalogue.test(token))) return 0;
  // Another audience's policies: a school's, a forum's, a business customer's, a job applicant's.
  if (
    (kind === 'terms' || kind === 'privacy') &&
    tokens.some((token) =>
      /^(?:k12|schools?|education|edu|commercial|community|forums?|candidates?|recruiting|employees?|vendors?|suppliers?)$/.test(
        token,
      ),
    )
  )
    return 0;
  // A help-centre article is fine, but not a list of them; a blog post is only a reseller's announcement.
  if (tokens.some((token) => listing.test(token))) score -= 3;
  if (kind !== 'resellers' && tokens.some((token) => /^(?:blog|news)$/.test(token))) score -= 3;
  return Math.max(0, score + localeScore(segments));
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function withoutAccents(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '');
}

/** Whether a page's words fit a kind, or can't be read without a browser (a page its scripts fill in). */
export type PageFit = 'yes' | 'no' | 'unreadable';

/** Words that say a price is for a period: "/mo", "per month", "billed yearly", "every 30 days", "par mois". */
const periodWords =
  /(?:\/\s?(?:mo|month|yr|year|week|wk|mois|an)\b|\bper (?:month|year|week|day)\b|\b(?:monthly|yearly|annually|annual|a month|a year|weekly|par mois|par année|par an|mensuel\w*|annuel\w*)\b|\bevery \d+ (?:days|weeks|months)\b|\b\d+ (?:months|mois)\b)/i;

/** How much text a page that isn't filled in by scripts has, at least. */
const readableChars = 400;

export function pageFits(kind: PageKind, text: string): PageFit {
  const words = text.replace(/\s+/g, ' ');
  if (words.length < readableChars) return 'unreadable';
  const has = (pattern: RegExp) => pattern.test(words);
  const count = (pattern: RegExp) => words.match(new RegExp(pattern.source, 'gi'))?.length ?? 0;
  switch (kind) {
    case 'pricing': {
      const amounts = moneyIn(words).filter((mention) => mention.currency !== undefined);
      const priced = amounts.some((mention) =>
        periodWords.test(words.slice(Math.max(0, mention.index - 60), mention.index + 80)),
      );
      if (
        priced &&
        has(/\b(?:plans?|subscri\w+|premium|membership|pricing|pric\w+|abonnement\w*|forfaits?)\b/i)
      )
        return 'yes';
      // A page with no amount at all may be priced by its scripts.
      return amounts.length === 0 ? 'unreadable' : 'no';
    }
    case 'cancel':
      return count(/\b(?:cancel|annul|résili)\w*/) >= 2 &&
        has(/\b(?:subscription|membership|plan|account|renew\w*|abonnement|compte)\b/i)
        ? 'yes'
        : 'no';
    case 'terms':
      return words.length >= 2000 &&
        has(
          /\b(?:terms of (?:use|service)|terms and conditions|subscriber agreement|user agreement|these terms|conditions d'utilisation|modalités)/i,
        )
        ? 'yes'
        : 'no';
    case 'privacy':
      return words.length >= 1500 &&
        has(/\b(?:privacy|confidentialité|vie privée)/i) &&
        has(
          /\bpersonal (?:data|information)\b|\byour (?:data|information)\b|\b(?:renseignements|données) personnel/i,
        )
        ? 'yes'
        : 'no';
    case 'payment':
      return networksNamedIn(words).length >= 2 && has(/\b(?:pay\w*|card|carte)/i) ? 'yes' : 'no';
    case 'bundles':
      return count(/\bbundle\w*/) >= 2 && moneyIn(words).length > 0 ? 'yes' : 'no';
    case 'resellers':
      return has(
        /\b(?:resellers?|retailers?|where to buy|authori[sz]ed (?:partners?|dealers?|sellers?)|official partners?|revendeurs?)\b/i,
      )
        ? 'yes'
        : 'no';
  }
}

/** Every link in a page's HTML, with its words (its own text, else its aria-label or title) and where it is. */
export function linksIn(html: string): RawLink[] {
  const areas = [
    ...areaRanges(html, 'nav'),
    ...areaRanges(html, 'header'),
    ...areaRanges(html, 'footer'),
  ];
  const links: RawLink[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attributes = match[1];
    const href = attribute(attributes, 'href');
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const own = pageText(match[2]).replace(/\s+/g, ' ').trim();
    const words =
      own ||
      decodeAttribute(attribute(attributes, 'aria-label') ?? attribute(attributes, 'title') ?? '');
    const at = match.index;
    const area = areas.find((range) => at >= range.start && at < range.end)?.area ?? 'body';
    links.push({ href: decodeAttribute(href), words, area });
  }
  return links;
}

function areaRanges(
  html: string,
  tag: 'nav' | 'header' | 'footer',
): { start: number; end: number; area: PageLink['area'] }[] {
  const area: PageLink['area'] = tag === 'footer' ? 'footer' : 'nav';
  const ranges: { start: number; end: number; area: PageLink['area'] }[] = [];
  const opens: number[] = [];
  for (const match of html.matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi'))) {
    if (match[1] === '') opens.push(match.index);
    else {
      const start = opens.pop();
      // Only the outermost of nested ones.
      if (start !== undefined && opens.length === 0) ranges.push({ start, end: match.index, area });
    }
  }
  return ranges;
}

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(
    attributes,
  );
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function decodeAttribute(value: string): string {
  return pageText(value).trim();
}

/** The sitemaps a robots.txt names. */
export function sitemapsIn(robotsTxt: string): string[] {
  return [...robotsTxt.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((match) => match[1]);
}

/** A sitemap's pages, or the sitemaps a sitemap index lists. */
export function readSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const locations = [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((match) =>
    decodeAttribute(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')),
  );
  return /<sitemapindex\b/i.test(xml)
    ? { pages: [], sitemaps: locations }
    : { pages: locations, sitemaps: [] };
}

/** Two-label endings under which a domain has three labels: example.co.uk, example.com.au. */
const secondLevel = /^(?:co|com|net|org|gov|edu|ac|or|ne|go)$/;

/** The domain a host is registered under: help.netflix.com → netflix.com, www.bbc.co.uk → bbc.co.uk. */
export function registeredDomain(host: string): string {
  const labels = bareHost(host).split('.');
  const keep =
    labels.length >= 3 &&
    secondLevel.test(labels.at(-2) ?? '') &&
    (labels.at(-1)?.length ?? 0) === 2
      ? 3
      : 2;
  return labels.slice(-keep).join('.');
}

/** A provider, as the search for its pages knows it. */
export interface ProviderSite {
  name: string;
  website: string;
  /** Its other sites (Proton VPN's protonvpn.com). */
  domains?: readonly string[];
}

/** Whether `url` is on the provider's sites: its website's registered domain or one of its other domains. */
export function onProviderSite(url: string, site: ProviderSite): boolean {
  const host = parseWebAddress(url)?.host;
  if (!host) return false;
  const website = parseWebAddress(site.website)?.host;
  const domains = [...(website ? [registeredDomain(website)] : []), ...(site.domains ?? [])];
  return domains.some((domain) => hostOnDomain(host, domain));
}

/** A page fetched for the search: its final URL after redirects, its HTML and its words. */
export interface FetchedPage {
  url: string;
  html: string;
  text: string;
}

/** How the search reads the web: the caller's polite fetch and search. */
export interface FindIo {
  /** A page, read at most once a run, as robots.txt allows; or why it couldn't be. */
  page(url: string): Promise<FetchedPage | { error: string }>;
  /** A file's text (robots.txt, a sitemap, unzipped), or undefined. */
  file(url: string): Promise<string | undefined>;
  /** A link resolved against the page it's on, as an absolute URL, or undefined. */
  resolve(href: string, base: string): string | undefined;
  /** A web search's results, or undefined when there's no search left this month (or none is set up). */
  search?(query: string): Promise<SearchResult[] | undefined>;
}

/** Where a page was found. */
export type FoundVia = 'website' | 'path' | 'sitemap' | 'link' | 'search';

/** A page of one kind: confirmed by its words (`yes`), or probable by its URL when its words need a browser. */
export interface FoundPage {
  kind: PageKind;
  url: string;
  via: FoundVia;
  fit: 'yes' | 'unreadable';
  score: number;
}

/** What the search did for one kind, for the report. */
export interface KindReport {
  kind: PageKind;
  found?: FoundPage;
  /** Each URL read, with how it fit or why it couldn't be read. */
  tried: { url: string; via: FoundVia; result: string }[];
  /** Whether a web search was used (or wanted and none was left). */
  searched: 'yes' | 'none-left' | 'no';
}

/** How many candidates of each step are read, at most, before the next step. */
const perStep = 3;
/** How many sitemap files are read, at most, per host: an index can list hundreds. */
const maxSitemaps = 4;
/** The lowest URL score a sitemap entry or link needs to be read. */
const minScore = 4;

/**
 * What's known about a provider's sites before the kinds are searched: one read each, shared by every kind. It's plain
 * data, so the bot can keep it between the steps that search one kind each.
 */
export interface SiteSurvey {
  origin: string;
  /** The website itself, when it has a path of its own: a product's page. */
  productPage?: string;
  /** Whether the host answers a path that can't be there with a page (a soft 404). */
  answersAnyPath: boolean;
  links: PageLink[];
  /**
   * The sitemaps' pages that could be one of the kinds (on the provider's sites, with a URL score of at least
   * `minScore` for one), when read with the rest; otherwise they're read when a kind first needs them.
   */
  sitemap?: string[];
}

interface SiteFacts extends SiteSurvey {
  sitemap: undefined;
  pages: () => Promise<string[]>;
}

/** Finds each kind's page for a provider, in the order of the steps above. */
export async function findPages(
  site: ProviderSite,
  kinds: readonly PageKind[],
  io: FindIo,
): Promise<KindReport[]> {
  const facts = factsOf(site, await surveySite(site, io), io);
  const reports: KindReport[] = [];
  for (const kind of kinds) reports.push(await searchKind(kind, site, facts, io));
  return reports;
}

/**
 * The survey of a provider's sites: the website's and its help centre's links, whether the host answers any path, and
 * with `sitemaps`, the sitemaps' pages worth reading.
 */
export async function surveySite(
  site: ProviderSite,
  io: FindIo,
  options: { sitemaps?: boolean } = {},
): Promise<SiteSurvey> {
  const home = parseWebAddress(site.website);
  if (!home) throw new Error(`Not a web address: ${site.website}`);
  const origin = `https://${home.host}`;
  const links: PageLink[] = [];
  for (const start of [site.website, ...helpOrigins(origin)]) {
    const page = await io.page(start);
    if ('error' in page) continue;
    for (const link of linksIn(page.html)) {
      const url = io.resolve(link.href, page.url);
      if (url)
        links.push({ url, words: link.words, area: start === site.website ? link.area : 'body' });
    }
  }
  const missing = await io.page(`${origin}${missingPath}`);
  return {
    origin,
    ...(home.path !== '/' && { productPage: site.website }),
    answersAnyPath: !('error' in missing),
    links,
    ...(options.sitemaps && {
      sitemap: worthReading(await readSitemaps([origin, ...helpOrigins(origin)], io), site),
    }),
  };
}

/** Finds one kind's page from a survey of the provider's sites. */
export async function findKind(
  kind: PageKind,
  site: ProviderSite,
  survey: SiteSurvey,
  io: FindIo,
): Promise<KindReport> {
  return searchKind(kind, site, factsOf(site, survey, io), io);
}

/** The help centre's hosts on the website's domain (help.netflix.com), where policies and prices often are. */
function helpOrigins(origin: string): string[] {
  const host = parseWebAddress(origin)?.host ?? '';
  const domain = registeredDomain(host);
  return ['help', 'support']
    .map((prefix) => `https://${prefix}.${domain}`)
    .filter((url) => url !== origin);
}

/** A survey with its sitemap's pages read once, when a kind first needs them (or as surveyed). */
function factsOf(site: ProviderSite, survey: SiteSurvey, io: FindIo): SiteFacts {
  let read: Promise<string[]> | undefined;
  const { sitemap, ...rest } = survey;
  return {
    ...rest,
    sitemap: undefined,
    pages: () =>
      (read ??= sitemap
        ? Promise.resolve(sitemap)
        : readSitemaps([survey.origin, ...helpOrigins(survey.origin)], io)),
  };
}

/** The sitemap's pages that could be one of the kinds, best first: a sitemap can list tens of thousands. */
function worthReading(pages: readonly string[], site: ProviderSite): string[] {
  const best = new Map<string, number>();
  for (const url of pages) {
    if (best.has(url) || !onProviderSite(url, site)) continue;
    const score = Math.max(...pageKinds.map((kind) => urlScore(kind, url)));
    if (score >= minScore) best.set(url, score);
  }
  return [...best]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSurveyedPages)
    .map(([url]) => url);
}

/** The most sitemap pages a survey keeps. */
const maxSurveyedPages = 400;

async function searchKind(
  kind: PageKind,
  site: ProviderSite,
  facts: SiteFacts,
  io: FindIo,
): Promise<KindReport> {
  const report: KindReport = { kind, tried: [], searched: 'no' };
  let probable: FoundPage | undefined;
  let probableWeight = 0;

  // Reads a candidate: true when it's the page, which ends the search for this kind.
  const read = async (url: string, via: FoundVia, score: number): Promise<boolean> => {
    if (report.tried.some((tried) => tried.url === url)) return false;
    const page = await io.page(url);
    if ('error' in page) {
      report.tried.push({ url, via, result: page.error });
      return false;
    }
    const fit = pageFits(kind, page.text);
    report.tried.push({ url: page.url, via, result: fit });
    // A guessed path counts by its final URL: one that redirects home isn't the page, whatever its words say.
    const finalScore =
      via === 'path' ? urlScore(kind, page.url) : Math.max(score, urlScore(kind, page.url));
    if (fit === 'yes' && (via !== 'path' || finalScore > 0)) {
      report.found = { kind, url: page.url, via, fit, score: finalScore };
      return true;
    }
    if (fit === 'unreadable') {
      // The product's own page is where its plans are; a guessed path proves nothing on a site that answers every path.
      if (via === 'website') {
        report.found = { kind, url: page.url, via, fit, score: Math.max(finalScore, minScore) };
        return true;
      }
      const believable = via !== 'path' || !facts.answersAnyPath;
      // Direct evidence counts for more than a sitemap's or a search's: a path the site answers (on a site that says
      // when a page isn't there), and a link the site itself names.
      const weight = finalScore + (via === 'path' ? 3 : via === 'link' ? 2 : 0);
      if (believable && finalScore >= minScore && (!probable || weight > probableWeight)) {
        probable = { kind, url: page.url, via, fit, score: finalScore };
        probableWeight = weight;
      }
    }
    return false;
  };
  const tryAll = async (candidates: readonly { url: string; score: number }[], via: FoundVia) => {
    for (const candidate of via === 'path' ? candidates : candidates.slice(0, perStep)) {
      if (await read(candidate.url, via, candidate.score)) return true;
    }
    return false;
  };

  const paths = commonPaths[kind].map((path) => {
    const url = `${facts.origin}${path}`;
    return { url, score: urlScore(kind, url) };
  });
  const sitemap = async () =>
    tryAll(
      ranked(
        kind,
        (await facts.pages()).map((url) => ({ url, words: '' })),
        site,
      ),
      'sitemap',
    );
  const links = () => tryAll(ranked(kind, facts.links, site), 'link');
  // The terms and the privacy policy are what the footer links (BLUEPRINT §6.5): a sitemap also lists a forum's
  // policy and the school terms (Claude's K-12 terms), so the links come first for them.
  const policy = kind === 'terms' || kind === 'privacy';
  const done =
    (kind === 'pricing' &&
      facts.productPage !== undefined &&
      (await read(facts.productPage, 'website', minScore))) ||
    (await tryAll(paths, 'path')) ||
    (policy ? (await links()) || (await sitemap()) : (await sitemap()) || (await links()));
  if (!done && io.search) {
    for (const query of searchQueries(kind, site)) {
      const results = await io.search(query);
      report.searched = results === undefined ? 'none-left' : 'yes';
      if (!results) break;
      // In the engine's order, which is what it found most relevant.
      const onSite = results
        .filter((result) => onProviderSite(result.url, site))
        .map((result) => ({ url: result.url, score: urlScore(kind, result.url, result.title) }));
      if (await tryAll(onSite, 'search')) break;
    }
  }
  if (!report.found && probable) report.found = probable;
  return report;
}

/**
 * The candidates worth reading for a kind, best first: on the provider's sites (a footer's terms and privacy links
 * may go to its parent company's, Bell's for Crave), with a URL score of at least `minScore`, the footer's and
 * navigation's links before the page's others.
 */
function ranked(
  kind: PageKind,
  links: readonly { url: string; words: string; area?: PageLink['area'] }[],
  site: ProviderSite,
): { url: string; score: number }[] {
  const scored = new Map<string, number>();
  for (const link of links) {
    const onSite = onProviderSite(link.url, site);
    const footerPolicy = (kind === 'terms' || kind === 'privacy') && link.area === 'footer';
    if (!onSite && !footerPolicy) continue;
    const score =
      urlScore(kind, link.url, link.words) +
      (link.area === 'footer' || link.area === 'nav' ? 1 : 0);
    if (score >= minScore) scored.set(link.url, Math.max(score, scored.get(link.url) ?? 0));
  }
  return [...scored]
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length);
}

/** Every page the hosts' sitemaps list (robots.txt's, else /sitemap.xml), following a few sitemap indexes each. */
async function readSitemaps(origins: readonly string[], io: FindIo): Promise<string[]> {
  const pages: string[] = [];
  for (const origin of origins) {
    const robots = await io.file(`${origin}/robots.txt`);
    const queue = robots ? sitemapsIn(robots) : [];
    if (queue.length === 0) queue.push(`${origin}/sitemap.xml`);
    for (let read = 0; queue.length > 0 && read < maxSitemaps; read++) {
      const next = queue.shift();
      const xml = next && (await io.file(next));
      if (!xml) continue;
      const found = readSitemap(xml);
      pages.push(...found.pages);
      // Sitemaps of pages before sitemaps of products, posts or images.
      queue.push(...found.sitemaps.sort((a, b) => sitemapRank(a) - sitemapRank(b)));
    }
  }
  return pages;
}

function sitemapRank(url: string): number {
  // Canada's first (Disney+'s help centre splits its sitemap by country=CA), then the site's pages.
  if (/(?:^|[-_/=.])(?:en[-_])?ca(?:[-_/.&]|$)|canada/i.test(url)) return -1;
  if (/page|main|static|site/i.test(url)) return 0;
  return /post|blog|product|image|video|news/i.test(url) ? 2 : 1;
}

/** The host a URL is on, without www, for messages. */
export function hostOf(url: string): string {
  const host = parseWebAddress(url)?.host;
  return host ? bareHost(host) : url;
}
