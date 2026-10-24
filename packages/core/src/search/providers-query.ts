import type { Categories } from '../catalog/category';
import { choices, didYouMean } from '../catalog/checks';
import type { Feature } from '../catalog/feature';
import { currencySchema } from '../catalog/formats';
import { intervalSchema, type Interval } from '../catalog/price';
import { regionCurrency } from '../catalog/region-currency';
import { isCatalogRegion, regionProblem } from '../catalog/regions';
import { rankKeyOptions, type RankKey } from '../ranking/rank-keys';

// GET /providers' query string (docs/api-output-examples.json): each parameter checked, and the defaults filled
// in. Anything unknown or invalid is a problem, which the API answers with 400 bad_request (BLUEPRINT §5.4).

export const providerSorts = ['relevance', 'price_asc', 'price_desc', 'name', 'features'] as const;
export type ProviderSort = (typeof providerSorts)[number];

/** The query as searchProviders reads it, and meta.query shows it: given values plus the defaults used. */
export interface ProvidersQuery {
  q?: string;
  category?: string;
  feature?: RankKey[];
  minPrice?: number;
  maxPrice?: number;
  interval?: Interval;
  region?: string;
  currency?: string;
  nativeOnly?: boolean;
  sort: ProviderSort;
  limit: number;
}

export interface QueryProblem {
  param: string;
  issue: string;
}

export interface QueryContext {
  features: readonly Feature[];
  categories: Categories;
  /** The currencies there are exchange rates for (ecbCurrencies), when the query has a region. */
  currencies?: readonly string[];
}

const params = [
  'q',
  'category',
  'feature',
  'minPrice',
  'maxPrice',
  'interval',
  'region',
  'currency',
  'nativeOnly',
  'sort',
  'cursor',
  'limit',
];
/** What only means something once prices are picked for a region. */
const pricedParams = ['minPrice', 'maxPrice', 'currency', 'nativeOnly'];
const maxTextLength = 100;
const maxKeys = 10;
const defaultLimit = 20;
const maxLimit = 50;

/**
 * The query, with the offset its cursor points at, or each problem with it, in the order the parameters came.
 * Defaults: `sort` is relevance with `q`, else price_asc with a region, else name; `currency` is the region's own
 * when there are rates for it, else US dollars; `limit` is 20.
 */
export function readProvidersQuery(
  queries: Readonly<Record<string, readonly string[]>>,
  { features, categories, currencies }: QueryContext,
): { query: ProvidersQuery; offset: number } | { problems: QueryProblem[] } {
  const problems: QueryProblem[] = [];
  const read: Partial<ProvidersQuery> = {};
  let offset = 0;
  for (const [param, values] of Object.entries(queries)) {
    if (!params.includes(param)) {
      problems.push({
        param,
        issue: `Unknown parameter. GET /providers takes ${params.slice(0, -1).join(', ')} and limit.`,
      });
      continue;
    }
    if (values.length > 1) {
      problems.push({
        param,
        issue:
          param === 'feature'
            ? 'Give one feature parameter, with the rank keys separated by commas.'
            : 'Give one value.',
      });
      continue;
    }
    const value = values[0];
    const issue = (() => {
      switch (param) {
        case 'q': {
          const text = value.trim().replace(/\s+/g, ' ');
          read.q = text;
          return text === ''
            ? 'Must not be empty: leave q out to list every provider.'
            : text.length > maxTextLength
              ? `Use at most ${maxTextLength} characters.`
              : undefined;
        }
        case 'category': {
          const ids = categories.service.map((category) => category.id);
          read.category = value;
          return ids.includes(value)
            ? undefined
            : `"${value}" isn't a service category${choices(value, ids)}.`;
        }
        case 'feature': {
          const keys = [...new Set(value.split(',').map((key) => key.trim()))].filter(Boolean);
          read.feature = keys;
          if (keys.length === 0) {
            return 'List at least one rank key, such as video.quality=4k.';
          }
          if (keys.length > maxKeys) {
            return `List at most ${maxKeys} rank keys.`;
          }
          const keyProblems = keys.flatMap((key) => rankKeyProblem(key, features) ?? []);
          return keyProblems.length > 0 ? `${keyProblems.join('; ')}.` : undefined;
        }
        case 'minPrice':
        case 'maxPrice':
          read[param] = Number(value);
          return /^\d+(?:\.\d+)?$/.test(value)
            ? undefined
            : 'Use an amount of 0 or more, such as 9.99.';
        case 'interval': {
          const checked = intervalSchema.safeParse(value);
          read.interval = checked.data;
          return checked.success
            ? undefined
            : `Expected one of: ${intervalSchema.options.join(', ')}.`;
        }
        case 'region':
          read.region = value;
          return isCatalogRegion(value) ? undefined : `${regionProblem(value)}.`;
        case 'currency': {
          const checked = currencySchema.safeParse(value);
          read.currency = value;
          if (!checked.success) {
            return `${checked.error.issues[0].message}.`;
          }
          return currencies && !currencies.includes(value)
            ? `The ECB has no rate for ${value}: use one of ${currencies.join(', ')}.`
            : undefined;
        }
        case 'nativeOnly':
          read.nativeOnly = value === 'true';
          return value === 'true' || value === 'false' ? undefined : 'Use true or false.';
        case 'sort': {
          const sort = providerSorts.find((candidate) => candidate === value);
          read.sort = sort;
          return sort ? undefined : `Expected one of: ${providerSorts.join(', ')}.`;
        }
        case 'cursor': {
          const at = cursorOffset(value);
          offset = at ?? 0;
          return at === undefined
            ? 'Not a cursor from meta.nextCursor: leave it out to start at the first page.'
            : undefined;
        }
        case 'limit':
          read.limit = Number(value);
          return /^\d+$/.test(value) && read.limit >= 1 && read.limit <= maxLimit
            ? undefined
            : `Must be between 1 and ${maxLimit}.`;
        default:
          return undefined;
      }
    })();
    if (issue) {
      problems.push({ param, issue });
    }
  }

  if (read.region === undefined) {
    for (const param of pricedParams.filter((name) => Object.hasOwn(queries, name))) {
      problems.push({ param, issue: 'Needs region: prices are picked for a region, such as CA.' });
    }
    if (read.sort === 'price_asc' || read.sort === 'price_desc') {
      problems.push({
        param: 'sort',
        issue: `${read.sort} needs region: prices are picked for a region, such as CA.`,
      });
    }
  }
  if (read.sort === 'relevance' && read.q === undefined) {
    problems.push({ param: 'sort', issue: 'relevance needs q, the text to match.' });
  }
  if (read.minPrice !== undefined && read.maxPrice !== undefined && read.minPrice > read.maxPrice) {
    problems.push({ param: 'minPrice', issue: 'Must not be more than maxPrice.' });
  }
  if (problems.length > 0) {
    return { problems };
  }

  const { q, category, feature, minPrice, maxPrice, interval, region, nativeOnly } = read;
  const own = region === undefined ? undefined : regionCurrency(region);
  const currency =
    region === undefined
      ? undefined
      : (read.currency ??
        (own !== undefined && (!currencies || currencies.includes(own)) ? own : 'USD'));
  const sort =
    read.sort ?? (q !== undefined ? 'relevance' : region !== undefined ? 'price_asc' : 'name');
  // In the contract's order, leaving out what wasn't given.
  const query: ProvidersQuery = {
    ...(q !== undefined && { q }),
    ...(category !== undefined && { category }),
    ...(feature !== undefined && { feature }),
    ...(minPrice !== undefined && { minPrice }),
    ...(maxPrice !== undefined && { maxPrice }),
    ...(interval !== undefined && { interval }),
    ...(region !== undefined && { region }),
    ...(currency !== undefined && { currency }),
    ...(nativeOnly !== undefined && { nativeOnly }),
    sort,
    limit: read.limit ?? defaultLimit,
  };
  return { query, offset };
}

/** Why `key` isn't a rank key of the registry, with the fix, or undefined when it is one. */
function rankKeyProblem(key: string, features: readonly Feature[]): string | undefined {
  const at = key.indexOf('=');
  const id = at < 0 ? key : key.slice(0, at);
  const option = at < 0 ? undefined : key.slice(at + 1);
  const feature = features.find((candidate) => candidate.id === id);
  if (!feature) {
    return `"${id}" isn't a feature${didYouMean(
      id,
      features.map((candidate) => candidate.id),
    )}`;
  }
  const options = rankKeyOptions(feature);
  if (options.some((candidate) => candidate.key === key)) {
    return undefined;
  }
  if (options.length === 0) {
    return `${id} has no rank keys`;
  }
  if (feature.type === 'boolean') {
    return `${id} is a boolean feature, which has no values: use ${id} alone`;
  }
  const kind = feature.type === 'number' ? 'tier' : 'value';
  const ids = options.map((candidate) => candidate.option ?? '');
  return option === undefined
    ? `${id} needs a ${kind}: ${options[0].key}${choices('', ids)}`
    : `"${option}" isn't a ${id} ${kind}${choices(option, ids)}`;
}

/** meta.nextCursor for the page that starts at `offset`. It's opaque: clients only send it back. */
export function providersCursor(offset: number): string {
  return `p${offset.toString(36)}`;
}

/** The offset a cursor from providersCursor points at, or undefined for anything else. */
function cursorOffset(cursor: string): number | undefined {
  return /^p[0-9a-z]{1,6}$/.test(cursor) ? parseInt(cursor.slice(1), 36) : undefined;
}
