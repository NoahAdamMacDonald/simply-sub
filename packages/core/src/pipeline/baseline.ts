import type { Bundle } from '../catalog/bundle';
import type { Provider } from '../catalog/provider';
import { isoDateSchema } from '../catalog/formats';
import type { IsoDate } from '../dates/iso-date';
import { comparable } from './page-text';
import { bareHost, parseWebAddress } from './web-address';

// Baselines (BLUEPRINT §6.4, §6.5, M3.6): each page the catalog cites, as its text when its facts were read, in
// data/baselines/, so the nightly bot can tell a page that changed from one that didn't without asking a model. A
// baseline says how the bot reads the page: a plain fetch, when the HTML as served has what the page shows, or a
// browser, when its scripts fill it in. A change is reviewed in a pull request that also updates the baseline, so
// the baseline is always the text the catalog's facts were last checked against.

export type BaselineMethod = 'fetch' | 'browser';

/** What a page's facts are: prices and what they rest on (checked daily), or its policies (checked weekly). */
export type CitedType = 'pricing' | 'policies';

export interface Baseline {
  url: string;
  method: BaselineMethod;
  saved: IsoDate;
  /** The page's text: its lines, each with its white space collapsed, without empty ones. */
  lines: string[];
}

/** A page's text as a baseline's lines. */
export function baselineLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

/** Where a page's baseline is: data/baselines/<host>/<its path as words>-<a hash of its URL>.txt. */
export function baselinePath(url: string): string {
  const address = parseWebAddress(url);
  if (!address) throw new Error(`Not a web address: ${url}`);
  const words = `${address.path}${address.query}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `data/baselines/${bareHost(address.host)}/${words || 'index'}-${fnv(url)}.txt`;
}

/** An 8-digit hex FNV-1a hash: two URLs never share a baseline's file. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** A baseline's file: its URL, method and date, a blank line, then the page's lines. */
export function writeBaseline(baseline: Baseline): string {
  return `url: ${baseline.url}\nmethod: ${baseline.method}\nsaved: ${baseline.saved}\n\n${baseline.lines.join('\n')}\n`;
}

/** A baseline's file read back, or undefined when it isn't one. */
export function readBaseline(text: string): Baseline | undefined {
  const [head, ...rest] = text.replace(/\r\n/g, '\n').split('\n\n');
  const fields = Object.fromEntries(
    head.split('\n').flatMap((line) => {
      const match = /^(\w+): (.+)$/.exec(line);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
  const method = fields['method'];
  if (
    !fields['url'] ||
    (method !== 'fetch' && method !== 'browser') ||
    !isoDateSchema.safeParse(fields['saved']).success
  )
    return undefined;
  return {
    url: fields['url'],
    method,
    saved: fields['saved'],
    lines: baselineLines(rest.join('\n\n')),
  };
}

/** The lines a page gained and lost, as lists that keep repeats (a reordered page changes nothing). */
export function baselineDiff(
  before: readonly string[],
  after: readonly string[],
): { added: string[]; removed: string[] } {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added.push(line);
  }
  const removed = [...counts].flatMap(([line, count]) => Array.from({ length: count }, () => line));
  return { added, removed };
}

/**
 * Whether the HTML as served (a plain fetch's text) has what the page shows (its rendered text): most of the shown
 * lines of 20 characters or more are in it. Then the bot reads it without a browser.
 */
export function servedCovers(served: string, rendered: string): boolean {
  const shown = baselineLines(rendered).filter((line) => line.length >= 20);
  if (shown.length === 0) return comparable(served).length > 0;
  const page = comparable(served);
  const found = shown.filter((line) => page.includes(comparable(line))).length;
  return found / shown.length >= 0.8;
}

/** A page the catalog cites, what its facts are, and who cites it. */
export interface CitedPage {
  url: string;
  type: CitedType;
  /** The provider or bundle ids that cite it. */
  owners: string[];
}

/**
 * Every page the catalog cites: its prices' sources, its pricing page, the pages naming its resellers and its accepted
 * cards (pricing), and the pages its policy ratings quote (policies). A page cited both ways is a pricing page.
 */
export function citedPages(
  providers: readonly Provider[],
  bundles: readonly Bundle[],
): CitedPage[] {
  const pages = new Map<string, CitedPage>();
  const cite = (url: string | undefined, type: CitedType, owner: string) => {
    if (!url) return;
    const page = pages.get(url) ?? { url, type, owners: [] };
    if (type === 'pricing') page.type = 'pricing';
    if (!page.owners.includes(owner)) page.owners.push(owner);
    pages.set(url, page);
  };
  for (const provider of providers) {
    const { id } = provider;
    cite(provider.sources?.pricing, 'pricing', id);
    for (const item of [...provider.plans, ...(provider.addOns ?? [])]) {
      for (const price of item.prices) cite(price.sourceUrl, 'pricing', id);
    }
    for (const listing of provider.resellers ?? []) {
      cite(listing.approvedBy.url, 'pricing', id);
      for (const offer of listing.offers)
        for (const price of offer.prices) cite(price.sourceUrl, 'pricing', id);
    }
    for (const accepted of Object.values(provider.acceptedNetworks ?? {}))
      cite(accepted.url, 'pricing', id);
    for (const link of provider.policies?.links ?? []) cite(link.url, 'policies', id);
  }
  for (const bundle of bundles)
    for (const price of bundle.prices) cite(price.sourceUrl, 'pricing', bundle.id);
  return [...pages.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** What the catalog says a page shows: the quotes it takes from it, and the prices read from it. */
export interface CitedFacts {
  quotes: string[];
  prices: { amount: number; currency: string; intervalCount: number; names: string[] }[];
}

/** The quotes and prices the catalog rests on `url`, so a new baseline can be checked against them. */
export function citedFacts(
  providers: readonly Provider[],
  bundles: readonly Bundle[],
  url: string,
): CitedFacts {
  const facts: CitedFacts = { quotes: [], prices: [] };
  const price = (
    item: {
      amount: number;
      currency: string;
      intervalCount: number;
      sourceUrl?: string;
      taxIncluded?: { quote: string };
    },
    names: string[],
  ) => {
    if (item.sourceUrl !== url) return;
    facts.prices.push({
      amount: item.amount,
      currency: item.currency,
      intervalCount: item.intervalCount,
      names,
    });
    if (item.taxIncluded) facts.quotes.push(item.taxIncluded.quote);
  };
  for (const provider of providers) {
    for (const plan of provider.plans)
      for (const item of plan.prices) price(item, [plan.name, `${provider.name} ${plan.name}`]);
    for (const addOn of provider.addOns ?? [])
      for (const item of addOn.prices) price(item, [addOn.name]);
    for (const listing of provider.resellers ?? []) {
      if (listing.approvedBy.url === url) facts.quotes.push(...listing.approvedBy.quotes);
      for (const offer of listing.offers)
        for (const item of offer.prices) price(item, [provider.name]);
    }
    for (const accepted of Object.values(provider.acceptedNetworks ?? {})) {
      if (accepted.url === url) facts.quotes.push(...accepted.quotes);
    }
    for (const rating of provider.policies?.ratings ?? []) {
      for (const source of rating.sources) if (source.url === url) facts.quotes.push(source.quote);
    }
  }
  for (const bundle of bundles) for (const item of bundle.prices) price(item, [bundle.name]);
  return facts;
}
