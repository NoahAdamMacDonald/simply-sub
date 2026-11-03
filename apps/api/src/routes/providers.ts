import {
  categoriesBodySchema,
  ecbCurrencies,
  featuresBodySchema,
  providersBody,
  providerTextQuery,
  readProvidersQuery,
  rebaseRates,
  searchProviders,
  type Categories,
  type Feature,
  type ProviderMatch,
  type ProvidersQuery,
  type SnapshotProvider,
} from '@simply-sub/core';
import { Hono } from 'hono';
import { catalogIdsFile, catalogJson, missingFiles } from '../catalog-files';
import { loadPricePage } from '../db/price-pages';
import { catalogRow, loadProviders } from '../db/providers';
import { ecbRates } from '../fx';
import {
  badQuery,
  catalogCacheControl,
  jsonType,
  noExchangeRates,
  notModified,
  notSeeded,
  shortHash,
  utcTimestamp,
} from '../http';

/**
 * GET /providers (docs/api-output-examples.json): search, filters, sort and pages, from core's searchProviders on the
 * providers D1 narrows down to (db/providers.ts). The feature registry and the categories come from the static
 * features.json and categories.json, and renamed rank keys (feature=streaming.ad-free is ad-free, M11.4) from ids.json,
 * so a request reads only the catalog row and the providers that can match. With
 * a region, prices are picked with the ECB's rates (fx.ts): none at all gets 502. A page sorted from the cheapest with
 * no text, category or feature reads only the providers it needs, through provider_prices (db/price-pages.ts, M11.8),
 * so it has no total.
 *
 * The ETag is D1's catalog version and a hash of everything else the body depends on: the query as read, the rates'
 * date and the static files' version.
 */
export const providers = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const [featuresFile, categoriesFile, ids] = await Promise.all([
    catalogJson(c, '/data/catalog/features.json'),
    catalogJson(c, '/data/catalog/categories.json'),
    catalogIdsFile(c),
  ]);
  const registry = featuresBodySchema.safeParse(featuresFile);
  const categories = categoriesBodySchema.safeParse(categoriesFile);
  if (!registry.success || !categories.success) {
    return missingFiles(c);
  }
  const features = registry.data.data;

  const queries = c.req.queries();
  const now = new Date();
  const priced = Object.hasOwn(queries, 'region');
  const rates = priced ? await ecbRates(c.env, utcTimestamp(now)) : undefined;
  if (priced && !rates) {
    return noExchangeRates(c);
  }
  const read = readProvidersQuery(queries, {
    features,
    categories: categories.data.data,
    ...(rates && { currencies: ecbCurrencies(rates.ecb) }),
    ...(ids?.redirects && { redirects: ids.redirects }),
  });
  if ('problems' in read) {
    return badQuery(c, read.problems);
  }
  const { query, offset } = read;
  const fx =
    rates && query.currency !== undefined ? rebaseRates(rates.ecb, query.currency) : undefined;
  const inputs = await shortHash(
    JSON.stringify([
      query,
      fx?.date ?? null,
      registry.data.meta.catalogVersion,
      categories.data.meta.catalogVersion,
    ]),
  );

  // 1 row read, so a client that has this answer already costs nothing more. It says how to read the providers too.
  const held = await catalogRow(c.env.DB);
  if (held !== undefined && notModified(c, `"${held.version}-${inputs}"`)) {
    return c.body(null, 304, {
      ETag: `"${held.version}-${inputs}"`,
      'Cache-Control': catalogCacheControl,
    });
  }
  const shape = held?.shape ?? 3;
  const search = (providers: SnapshotProvider[]) =>
    searchProviders(providers, query, {
      features,
      categories: categories.data.data,
      ...(fx && { fx }),
      today: now.toISOString().slice(0, 10),
    });
  const pricePage =
    query.sort === 'price_asc' &&
    query.q === undefined &&
    query.category === undefined &&
    query.feature === undefined;
  const { version, matches } =
    pricePage && fx && held && shape >= 5
      ? await loadPricePage(c.env.DB, query, {
          currencies: held.currencies,
          providers: held.providers,
          fx,
          window: offset + query.limit + 1,
          search,
        })
      : await loadMatches(c.env.DB, query, features, shape, categories.data.data, search);
  if (version === undefined) {
    return notSeeded(c);
  }
  const body = providersBody(matches, {
    query,
    offset,
    catalogVersion: version,
    ...(fx && { fxDate: fx.date }),
    ...(pricePage && { partial: true }),
  });
  return c.json(body, 200, {
    'Content-Type': jsonType,
    'Cache-Control': catalogCacheControl,
    ETag: `"${version}-${inputs}"`,
  });
});

/** The catalog version and every match, from the providers D1 narrows `query` down to, read in one batch. */
async function loadMatches(
  db: D1Database,
  query: ProvidersQuery,
  features: readonly Feature[],
  shape: number,
  categories: Categories,
  search: (providers: SnapshotProvider[]) => ProviderMatch[],
): Promise<{ version?: string; matches: ProviderMatch[] }> {
  const text =
    query.q === undefined ? undefined : providerTextQuery(query.q, { features, categories });
  // Read in one batch with the providers, so it describes them even if a seed ran in between.
  const { version, providers } = await loadProviders(db, query, features, {
    shape,
    ...(text !== undefined && { text }),
  });
  return { ...(version !== undefined && { version }), matches: search(providers) };
}
