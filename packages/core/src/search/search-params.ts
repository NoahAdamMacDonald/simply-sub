import type { CatalogData } from '../catalog/snapshot';
import { rankKeyOptions } from '../ranking/rank-keys';
import type { SubscriptionList } from '../user/subscription-list';
import { providerSorts } from './providers-query';
import type { ActivityFilter, CatalogQuery } from './search-catalog';

// Search's URL (PROJECT-PLAN P8, §3.5, M5.3): ?q=&sort=&min=&max=&cat=&f=&act=&native=1&sold=1, read into
// searchCatalog's query and written back from it. Reading keeps only what's valid in the catalog file on screen, and
// the page rewrites a URL that had anything else: an unknown parameter, sort, category, rank key or activity, an
// amount that isn't one, a minimum above the maximum, Best match without text. Writing leaves out what's empty or the
// default and lists Activity in a fixed order, so the query a URL reads to writes that URL again. Sold in starts as
// the user's setting says (M5.6), so the URL has `sold` only when it differs: sold=1 turns it on, sold=0 off. Pick
// mode's addTo=<list id> (P7, flow F2, M5.5) comes last and isn't a filter: it's kept while it names one of the
// user's lists.

export const searchParamNames = [
  'q',
  'sort',
  'min',
  'max',
  'cat',
  'f',
  'act',
  'native',
  'sold',
  'addTo',
] as const;
export type SearchParamName = (typeof searchParamNames)[number];
/** The URL's query parameters, in P8's order. */
export type SearchParams = Partial<Record<SearchParamName, string>>;

/** A query string's parameters as a router gives them: a repeated one as a list. */
export type QueryParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Search's state in its URL: the catalog query, and in pick mode the list a price adds to. */
export interface SearchQuery extends CatalogQuery {
  /** Pick mode (P7, flow F2, M5.5): the id of the list a price click adds to, with no menu. Not a filter. */
  addTo?: string;
}

/** What a filter is when the URL doesn't say: Settings' choice for Sold in (searchSoldOnly). */
export interface SearchDefaults {
  soldOnly?: boolean;
}

/** P8's Activity values, in the order the panel lists them: act=none is Not listed. */
const activityParams: readonly (readonly [ActivityFilter, string])[] = [
  ['active', 'active'],
  ['inactive', 'inactive'],
  ['not-listed', 'none'],
];

/** The search box's text as it's searched and kept: trimmed, with single spaces. */
export function searchText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * The query in `params`, keeping what's valid in `catalog`: its service categories and rank keys. A repeated list
 * (f, act) keeps every value, and any other repeated parameter its first. A minimum of 0 is no minimum, and a minimum
 * above the maximum drops both. Sold in is on with sold=1, off with sold=0, and else as `defaults` say. An addTo is
 * kept only when it names one of `lists`, the user's lists that aren't deleted.
 */
export function readSearchParams(
  params: QueryParams,
  catalog: Pick<CatalogData, 'features' | 'categories'>,
  defaults: SearchDefaults = {},
  lists: readonly Pick<SubscriptionList, 'id'>[] = [],
): SearchQuery {
  const one = (name: SearchParamName) => {
    const value = params[name];
    return typeof value === 'string' ? value : value?.[0];
  };
  const list = (name: SearchParamName) => {
    const value = params[name];
    const values = typeof value === 'string' ? [value] : (value ?? []);
    return values.flatMap((joined) => joined.split(',')).map((entry) => entry.trim());
  };

  const q = searchText(one('q') ?? '') || undefined;
  const sort = providerSorts.find((candidate) => candidate === one('sort'));
  const categories = catalog.categories.service.map((category) => category.id);
  const category = categories.find((id) => id === one('cat'));
  const keys = new Set(catalog.features.flatMap(rankKeyOptions).map((option) => option.key));
  const features = [...new Set(list('f'))].filter((key) => keys.has(key));
  const activity = activityParams
    .filter(([, param]) => list('act').includes(param))
    .map(([filter]) => filter);
  let minPrice = amount(one('min'));
  let maxPrice = amount(one('max'));
  if (minPrice === 0) {
    minPrice = undefined;
  }
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [undefined, undefined];
  }
  const sold = one('sold');
  const soldOnly = sold === '1' || (sold !== '0' && defaults.soldOnly === true);
  const addTo = lists.find((list) => list.id === one('addTo'))?.id;

  return {
    ...(q !== undefined && { q }),
    ...(sort !== undefined && (sort !== 'relevance' || q !== undefined) && { sort }),
    ...(category !== undefined && { category }),
    ...(features.length > 0 && { features }),
    ...(minPrice !== undefined && { minPrice }),
    ...(maxPrice !== undefined && { maxPrice }),
    ...(activity.length > 0 && { activity }),
    ...(one('native') === '1' && { nativeOnly: true }),
    ...(soldOnly && { soldOnly: true }),
    ...(addTo !== undefined && { addTo }),
  };
}

/**
 * The URL's parameters for `query`, leaving out empty text and lists, Native pricing only when it's off, Sold in
 * when it's as `defaults` say, a minimum of 0 and Best match without text. Amounts are written to the cent, and pick
 * mode's list comes last.
 */
export function writeSearchParams(query: SearchQuery, defaults: SearchDefaults = {}): SearchParams {
  const q = searchText(query.q ?? '');
  const { sort, category, features = [], activity = [], minPrice, maxPrice } = query;
  const params: SearchParams = {
    ...(q !== '' && { q }),
    ...(sort !== undefined && (sort !== 'relevance' || q !== '') && { sort }),
    ...(minPrice !== undefined && minPrice > 0 && { min: amountParam(minPrice) }),
    ...(maxPrice !== undefined && { max: amountParam(maxPrice) }),
    ...(category !== undefined && { cat: category }),
    ...(features.length > 0 && { f: [...new Set(features)].join(',') }),
  };
  const act = activityParams.filter(([filter]) => activity.includes(filter));
  if (act.length > 0) {
    params.act = act.map(([, param]) => param).join(',');
  }
  if (query.nativeOnly) {
    params.native = '1';
  }
  if ((query.soldOnly === true) !== (defaults.soldOnly === true)) {
    params.sold = query.soldOnly ? '1' : '0';
  }
  if (query.addTo !== undefined) {
    params.addTo = query.addTo;
  }
  return params;
}

/** Whether a URL's parameters are exactly `written`: nothing more, nothing repeated, nothing different. */
export function sameSearchParams(params: QueryParams, written: SearchParams): boolean {
  const given = Object.entries(params).filter(([, value]) => value !== undefined);
  return (
    given.length === Object.keys(written).length &&
    given.every(
      ([name, value]) => typeof value === 'string' && written[name as SearchParamName] === value,
    )
  );
}

/** An amount of 0 or more, such as 9.99, or undefined for anything else. */
function amount(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : undefined;
}

/** 9.99, 10 or 0.5: to the cent, with no trailing zeros. */
function amountParam(value: number): string {
  return String(Math.round(value * 100) / 100);
}
