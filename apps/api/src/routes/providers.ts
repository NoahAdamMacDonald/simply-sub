import {
  categoriesBodySchema,
  ecbCurrencies,
  featuresBodySchema,
  providersBody,
  readProvidersQuery,
  rebaseRates,
  searchProviders,
} from '@simply-sub/core';
import { Hono } from 'hono';
import { catalogJson, missingFiles } from '../catalog-files';
import { catalogVersion, loadProviders } from '../db/providers';
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
 * features.json and categories.json, so a request reads only the catalog row and the providers that can match. With
 * a region, prices are picked with the ECB's rates (fx.ts): none at all gets 502.
 *
 * The ETag is D1's catalog version and a hash of everything else the body depends on: the query as read, the rates'
 * date and the static files' version.
 */
export const providers = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const [featuresFile, categoriesFile] = await Promise.all([
    catalogJson(c, '/data/catalog/features.json'),
    catalogJson(c, '/data/catalog/categories.json'),
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

  // 1 row read, so a client that has this answer already costs nothing more.
  const held = await catalogVersion(c.env.DB);
  if (held !== undefined && notModified(c, `"${held}-${inputs}"`)) {
    return c.body(null, 304, { ETag: `"${held}-${inputs}"`, 'Cache-Control': catalogCacheControl });
  }
  // Read in one batch with the providers, so it describes them even if a seed ran in between.
  const { version, providers: candidates } = await loadProviders(c.env.DB, query, features);
  if (version === undefined) {
    return notSeeded(c);
  }
  const matches = searchProviders(candidates, query, {
    features,
    categories: categories.data.data,
    ...(fx && { fx }),
    today: now.toISOString().slice(0, 10),
  });
  const body = providersBody(matches, {
    query,
    offset,
    catalogVersion: version,
    ...(fx && { fxDate: fx.date }),
  });
  return c.json(body, 200, {
    'Content-Type': jsonType,
    'Cache-Control': catalogCacheControl,
    ETag: `"${version}-${inputs}"`,
  });
});
