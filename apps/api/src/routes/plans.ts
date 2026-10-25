import {
  ecbCurrencies,
  featuresBodySchema,
  planBody,
  planIdSchema,
  readPricingQuery,
  rebaseRates,
  suggestedPlanId,
} from '@simply-sub/core';
import { Hono, type Context } from 'hono';
import { catalogIdsFile, catalogJson, missingFiles } from '../catalog-files';
import { loadPlan } from '../db/lookups';
import { badQuery, noExchangeRates, notFound, notSeeded, shortHash } from '../http';
import { lookupJson, regionRates, unchanged } from '../lookup';

/**
 * GET /plans/:id (docs/api-output-examples.json): one plan as written, with its provider in short, its add-ons, the
 * rank keys it provides (from the static features.json) and the bundles that include it, and with a region, picked
 * prices. Plan ids start with their provider's id, and the provider's JSON holds the plan and its add-ons, so it
 * reads the catalog row, the provider's and one bundle_plans index entry per bundle (2 rows plus the bundles). An
 * unknown id gets 404 with the id it looks like a typo of, from the static ids.json.
 *
 * The ETag is D1's catalog version and a hash of the id, the query as read, the rates' date and the registry's
 * version.
 */
export const plans = new Hono<{ Bindings: Env }>().get('/:id', async (c) => {
  const id = c.req.param('id');
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
  const read = readPricingQuery(c.req.queries(), {
    route: 'GET /plans/:id',
    ...(rates.ecb && { currencies: ecbCurrencies(rates.ecb) }),
  });
  if ('problems' in read) {
    return badQuery(c, read.problems);
  }
  if (!planIdSchema.safeParse(id).success) {
    return unknownPlan(c, id);
  }
  const { query } = read;
  const fx =
    rates.ecb && query.currency !== undefined ? rebaseRates(rates.ecb, query.currency) : undefined;
  const inputs = await shortHash(
    JSON.stringify([id, query, fx?.date ?? null, registry.data.meta.catalogVersion]),
  );
  const cached = await unchanged(c, inputs);
  if (cached) {
    return cached;
  }

  const { version, provider, bundleIds } = await loadPlan(c.env.DB, id);
  if (version === undefined) {
    return notSeeded(c);
  }
  const plan = provider?.plans.find((candidate) => candidate.id === id);
  if (!provider || !plan) {
    return unknownPlan(c, id);
  }
  return lookupJson(
    c,
    planBody(provider, plan, {
      query,
      ...(fx && { fx }),
      catalogVersion: version,
      registry: registry.data.data,
      bundleIds,
    }),
    version,
    inputs,
  );
});

async function unknownPlan(c: Context<{ Bindings: Env }>, id: string): Promise<Response> {
  const ids = await catalogIdsFile(c);
  return notFound(c, `No plan with id '${id}'.`, ids && suggestedPlanId(id, ids));
}
