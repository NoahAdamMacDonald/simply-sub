import {
  bundlesBody,
  ecbCurrencies,
  featuresBodySchema,
  readBundlesQuery,
  rebaseRates,
  unknownPlans,
} from '@simply-sub/core';
import { Hono } from 'hono';
import { catalogIdsFile, catalogJson, missingFiles } from '../catalog-files';
import { loadBundles } from '../db/lookups';
import { badQuery, noExchangeRates, notSeeded, shortHash } from '../http';
import { lookupJson, regionRates, unchanged } from '../lookup';

/**
 * GET /bundles (docs/api-output-examples.json): the bundles that include any of the given plans, each with its plans
 * expanded and the union of their features (from the static features.json), and with a region, picked prices and
 * savings. One batch reads the catalog row, each plan asked for (by primary key, so an unknown one gets 400 with a
 * suggestion from the static ids.json), the bundles through bundle_plans' (plan_id) index, and the providers of their
 * plans and sellers.
 *
 * The ETag is D1's catalog version and a hash of the query as read, the rates' date and the registry's version.
 */
export const bundles = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const registry = featuresBodySchema.safeParse(
    await catalogJson(c, '/data/catalog/features.json'),
  );
  if (!registry.success) {
    return missingFiles(c);
  }
  const rates = await regionRates(c);
  if (!rates) {
    return noExchangeRates(c);
  }
  const read = readBundlesQuery(c.req.queries(), {
    ...(rates.ecb && { currencies: ecbCurrencies(rates.ecb) }),
  });
  if ('problems' in read) {
    return badQuery(c, read.problems);
  }
  const { query } = read;
  const fx =
    rates.ecb && query.currency !== undefined ? rebaseRates(rates.ecb, query.currency) : undefined;
  const inputs = await shortHash(
    JSON.stringify([query, fx?.date ?? null, registry.data.meta.catalogVersion]),
  );
  const cached = await unchanged(c, inputs);
  if (cached) {
    return cached;
  }

  const rows = await loadBundles(c.env.DB, query.plans);
  if (rows.version === undefined) {
    return notSeeded(c);
  }
  const unknown = query.plans.filter((id) => !rows.plans.includes(id));
  if (unknown.length > 0) {
    return badQuery(c, [unknownPlans(unknown, await catalogIdsFile(c))]);
  }
  return lookupJson(
    c,
    bundlesBody(rows.bundles, rows.providers, {
      query,
      ...(fx && { fx }),
      catalogVersion: rows.version,
      registry: registry.data.data,
    }),
    rows.version,
    inputs,
  );
});
