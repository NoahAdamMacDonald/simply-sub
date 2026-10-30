import { regionCurrency } from '../catalog/region-currency';
import { isoRegions } from '../catalog/regions';
import { sameCurrency } from './amounts';
import { httpsAddress, parseWebAddress } from './web-address';

// Regional pricing pages (BLUEPRINT §6.5, PROJECT-PLAN M10.12): a provider's pages for other countries, from the
// hreflang links a page lists and the locale paths of its links (/en-gb/, /uk/), mapped to ISO countries; how the
// browser reads a region's pages; and a page read for a region that isn't its page there. One that went to another
// country's page, or shows prices only in another country's currency, is recorded as unread and never extracted.

/** Two-letter path segments that name a country on their own (uk is the United Kingdom, GB), not a language. */
const countrySegments: Readonly<Record<string, string>> = {
  ca: 'CA',
  us: 'US',
  uk: 'GB',
  gb: 'GB',
  au: 'AU',
  nz: 'NZ',
  ie: 'IE',
};

/** A two-letter subtag as an ISO country: uk is GB, as sites write it; undefined for anything else. */
function countryCode(subtag: string): string | undefined {
  const code = subtag === 'uk' ? 'GB' : subtag.toUpperCase();
  return /^[A-Z]{2}$/.test(code) && isoRegions.has(code) ? code : undefined;
}

/**
 * The country an hreflang value names (BCP 47, language first): en-GB and en-UK are GB, zh-Hant-TW is TW. Undefined for
 * a language alone (en, de), a part of the world (es-419) and x-default. uk alone is Ukrainian, not the UK.
 */
export function hreflangCountry(value: string): string | undefined {
  const parts = value.trim().toLowerCase().split(/[-_]/);
  return parts.length > 1 ? countryCode(parts.at(-1) ?? '') : undefined;
}

/**
 * The country a path segment names as a locale: en-gb, en_GB, fr-ca and de-de, a country alone (uk, au), or a country
 * first (ca-en, Spotify's way round). Undefined for a language alone (de, fr) or anything else.
 */
export function segmentCountry(segment: string): string | undefined {
  const match = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/.exec(segment.toLowerCase());
  if (!match) return undefined;
  const [, first, second] = match;
  if (second === undefined) return countrySegments[first];
  if (countrySegments[first] !== undefined && countryCode(second) === undefined) {
    return countrySegments[first];
  }
  return countryCode(second);
}

/** The country a URL's locale names in its first two path segments (/en-gb/pricing is GB), if any. */
export function pathCountry(url: string): string | undefined {
  const address = parseWebAddress(url);
  if (!address) return undefined;
  for (const segment of address.path.split('/').filter(Boolean).slice(0, 2)) {
    const country = segmentCountry(segment);
    if (country !== undefined) return country;
  }
  return undefined;
}

/** Each attribute of an HTML start tag, by lower-case name. */
function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    found.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

/** Resolves a link on a page: the caller's runtime has the URL parser core doesn't (web-address.ts). */
export type ResolveLink = (href: string, base: string) => string | undefined;

/** `href` as an absolute https:// address, without its fragment; undefined when it isn't one. */
function absolute(href: string, base: string, resolve: ResolveLink): string | undefined {
  const resolved = resolve(href.replace(/&amp;/g, '&'), base);
  const address = resolved === undefined ? undefined : parseWebAddress(resolved);
  return address?.protocol === 'https' ? httpsAddress(address) : undefined;
}

/**
 * A page's own pages for other countries, a URL each, the first found: its hreflang links (<link rel="alternate"
 * hreflang="en-gb">), then links to the same path under another country's locale (/en-gb/pricing beside the page's
 * /en-ca/pricing or /pricing). The page's own country isn't left out: a region asked for may be it.
 */
export function regionalPages(
  html: string,
  pageUrl: string,
  resolve: ResolveLink,
): Map<string, string> {
  const pages = new Map<string, string>();
  const page = parseWebAddress(pageUrl);
  if (!page) return pages;
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const found = attributes(tag);
    if (!/(?:^|\s)alternate(?:\s|$)/i.test(found.get('rel') ?? '')) continue;
    const country = hreflangCountry(found.get('hreflang') ?? '');
    const url = absolute(found.get('href') ?? '', pageUrl, resolve);
    if (country !== undefined && url !== undefined && !pages.has(country)) pages.set(country, url);
  }
  // The page's path without its locale: what a link to another country's version of it ends with.
  const segments = page.path.split('/').filter(Boolean);
  const localeAt = segments.findIndex((segment, index) => index < 2 && segmentCountry(segment));
  const rest = (
    localeAt === -1 ? segments : segments.filter((_, index) => index !== localeAt)
  ).join('/');
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const url = absolute(attributes(tag).get('href') ?? '', pageUrl, resolve);
    const address = url && parseWebAddress(url);
    if (!url || !address || address.host !== page.host) continue;
    const theirs = address.path.split('/').filter(Boolean);
    const at = theirs.findIndex((segment, index) => index < 2 && segmentCountry(segment));
    if (at === -1) continue;
    const country = segmentCountry(theirs[at]);
    const same = theirs.filter((_, index) => index !== at).join('/') === rest;
    if (country !== undefined && same && !pages.has(country)) pages.set(country, url);
  }
  return pages;
}

/** How the browser reads a region's pages: English as spoken there first, in its time zone. */
export interface RegionBrowser {
  locale: string;
  acceptLanguage: string;
  timeZone: string;
}

/** The time zones the pipeline reads regions' pages in: each region's most populous one. */
const timeZones: Readonly<Record<string, string>> = {
  CA: 'America/Toronto',
  US: 'America/New_York',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
  AT: 'Europe/Vienna',
  BE: 'Europe/Brussels',
  BG: 'Europe/Sofia',
  CY: 'Asia/Nicosia',
  DE: 'Europe/Berlin',
  EE: 'Europe/Tallinn',
  ES: 'Europe/Madrid',
  FI: 'Europe/Helsinki',
  FR: 'Europe/Paris',
  GR: 'Europe/Athens',
  HR: 'Europe/Zagreb',
  IT: 'Europe/Rome',
  LT: 'Europe/Vilnius',
  LU: 'Europe/Luxembourg',
  LV: 'Europe/Riga',
  MT: 'Europe/Malta',
  NL: 'Europe/Amsterdam',
  PT: 'Europe/Lisbon',
  SI: 'Europe/Ljubljana',
  SK: 'Europe/Bratislava',
};

/** The browser's settings for reading `region`'s pages; undefined for a region the pipeline doesn't read yet. */
export function regionBrowser(region: string): RegionBrowser | undefined {
  const timeZone = timeZones[region];
  if (timeZone === undefined) return undefined;
  const locale = `en-${region}`;
  return { locale, acceptLanguage: `${locale},en;q=0.9`, timeZone };
}

/** What a page read for a region turned out to be: where it was asked for and where it ended, and its currencies. */
export interface RegionalRead {
  requested: string;
  final: string;
  /** The currencies its prices are shown in. */
  currencies: readonly string[];
}

/**
 * Why a page read for `region` isn't its page there, or undefined when it is: its address names another country (it
 * went to another country's page, or was one), or its prices are in other currencies only (a site that prices by
 * where the visitor is shows a visitor here its own: that region's needs a browser there).
 */
export function regionalRefusal(region: string, read: RegionalRead): string | undefined {
  const went = pathCountry(read.final);
  if (went !== undefined && went !== region) {
    return read.final === read.requested
      ? `Its address is ${went}'s page, not ${region}'s.`
      : `It went to ${went}'s page (${read.final}), not ${region}'s.`;
  }
  // A bare $ can be any dollar: the region's, when it pays in one, and never pounds or euros.
  const currency = regionCurrency(region);
  const shown = read.currencies;
  if (
    currency !== undefined &&
    shown.length > 0 &&
    !shown.some((code) => sameCurrency(code, currency))
  ) {
    const named = shown.map((code) => (code === 'dollar' ? 'dollars' : code)).join(', ');
    return `Its prices are in ${named}, not ${currency}: the site may price by where the visitor is.`;
  }
  return undefined;
}

/**
 * The same page's address for `region`, made from a country in its own (M10.12): a locale segment anywhere in the path
 * (/en-US/ to /en-GB/, Netflix's help article's /ca to /gb), or one inside a slug (disneyplus-en-ca-price), in the
 * region's English. The United Kingdom's are tried as gb and uk. A guess, read before it's used.
 */
export function regionalVariants(url: string, region: string): string[] {
  const address = parseWebAddress(url);
  if (!address) return [];
  const codes = region === 'GB' ? ['gb', 'uk'] : [region.toLowerCase()];
  const segments = address.path.split('/');
  const variants: string[] = [];
  const add = (path: string) => {
    const variant = httpsAddress({ ...address, path });
    if (variant !== httpsAddress(address) && !variants.includes(variant)) variants.push(variant);
  };
  segments.forEach((segment, index) => {
    const country = segmentCountry(segment);
    const swap = (made: string) =>
      add([...segments.slice(0, index), made, ...segments.slice(index + 1)].join('/'));
    if (country !== undefined && country !== region) {
      const match = /^([a-z]{2})(?:([-_])([a-z]{2}))?$/i.exec(segment);
      if (!match) return;
      const [, first, separator, second] = match;
      const upper = second !== undefined && second === second.toUpperCase();
      for (const code of codes) {
        if (second === undefined) swap(code);
        // ca-en, Spotify's way round: the country first.
        else if (segmentCountry(first) !== undefined && segmentCountry(second) === undefined)
          swap(`${code}${separator}en`);
        else swap(`en${separator}${upper ? code.toUpperCase() : code}`);
      }
      return;
    }
    const inside = /(^|[-_])(en|fr)([-_])([a-z]{2})(?=[-_]|$)/.exec(segment);
    const named = inside && segmentCountry(`${inside[2]}-${inside[4]}`);
    if (inside && named !== undefined && named !== region) {
      for (const code of codes) {
        swap(
          `${segment.slice(0, inside.index)}${inside[1]}en${inside[3]}${code}${segment.slice(inside.index + inside[0].length)}`,
        );
      }
    }
  });
  return variants;
}

/**
 * Whether a page the nightly check read went to another country's page: its address named a country and where it
 * ended doesn't, or names another (BLUEPRINT §6.4). It's recorded as unread, like a page that didn't answer.
 */
export function wentToAnotherCountry(requested: string, final: string): boolean {
  const asked = pathCountry(requested);
  return asked !== undefined && pathCountry(final) !== asked;
}
