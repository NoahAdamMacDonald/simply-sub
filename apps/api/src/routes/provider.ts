import {
  ecbCurrencies,
  providerBody,
  readPricingQuery,
  rebaseRates,
  slugSchema,
  suggestedProviderId,
} from '@simply-sub/core';
import { Hono, type Context } from 'hono';
import { catalogIdsFile } from '../catalog-files';
import { loadProvider } from '../db/lookups';
import { badQuery, noExchangeRates, notFound, notSeeded, shortHash } from '../http';
import { lookupJson, regionRates, unchanged } from '../lookup';

/**
 * GET /providers/:id (docs/api-output-examples.json): one provider as written, with every plan and add-on, and with
 * a region, the picked prices of each one sold there. It reads the catalog row and the provider's (2 rows). An
 * unknown id gets 404 with the id it looks like a typo of, from the static ids.json, so a typo costs no more rows.
 *
 * The ETag is D1's catalog version and a hash of the id, the query as read and the rates' date.
 */
export const provider = new Hono<{ Bindings: Env }>().get('/:id', async (c) => {
  const id = c.req.param('id');
  const rates = await regionRates(c);
  if (!rates) {
    return noExchangeRates(c);
  }
  const read = readPricingQuery(c.req.queries(), {
    route: 'GET /providers/:id',
    ...(rates.ecb && { currencies: ecbCurrencies(rates.ecb) }),
  });
  if ('problems' in read) {
    return badQuery(c, read.problems);
  }
  // An id that isn't a slug can't be in the catalog.
  if (!slugSchema.safeParse(id).success) {
    return unknownProvider(c, id);
  }
  const { query } = read;
  const fx =
    rates.ecb && query.currency !== undefined ? rebaseRates(rates.ecb, query.currency) : undefined;
  const inputs = await shortHash(JSON.stringify([id, query, fx?.date ?? null]));
  const cached = await unchanged(c, inputs);
  if (cached) {
    return cached;
  }

  const { version, provider: found } = await loadProvider(c.env.DB, id);
  if (version === undefined) {
    return notSeeded(c);
  }
  if (!found) {
    return unknownProvider(c, id);
  }
  return lookupJson(
    c,
    providerBody(found, { query, ...(fx && { fx }), catalogVersion: version }),
    version,
    inputs,
  );
});

async function unknownProvider(c: Context<{ Bindings: Env }>, id: string): Promise<Response> {
  const ids = await catalogIdsFile(c);
  return notFound(c, `No provider with id '${id}'.`, ids && suggestedProviderId(id, ids));
}
