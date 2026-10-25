import type { KeptEcbRates } from '@simply-sub/core';
import type { Context } from 'hono';
import { catalogVersion } from './db/providers';
import { ecbRates } from './fx';
import { catalogCacheControl, jsonType, notModified, utcTimestamp } from './http';

// What GET /providers/:id, GET /plans/:id and GET /bundles share (M2.4). Prices follow GET /providers' rules: a
// region needs the ECB's rates (fx.ts), and having none at all gets 502. So does the ETag: D1's catalog version, then
// a hash (shortHash) of the query as read, the rates' date and the version of any static file the body uses.

type LookupContext = Context<{ Bindings: Env }>;

/**
 * The ECB's rates when the query has a region, which prices are picked for; nothing without one. Undefined when
 * the query has a region and there are no rates at all.
 */
export async function regionRates(c: LookupContext): Promise<{ ecb?: KeptEcbRates } | undefined> {
  if (!Object.hasOwn(c.req.queries(), 'region')) {
    return {};
  }
  const rates = await ecbRates(c.env, utcTimestamp(new Date()));
  return rates && { ecb: rates.ecb };
}

/**
 * 304 Not Modified when If-None-Match names the ETag of what D1 holds now. The catalog row is read (1 row) only when
 * the request sends the header, so a client that has the answer already costs nothing more.
 */
export async function unchanged(c: LookupContext, inputs: string): Promise<Response | undefined> {
  if (c.req.header('If-None-Match') === undefined) {
    return undefined;
  }
  const held = await catalogVersion(c.env.DB);
  const etag = `"${held}-${inputs}"`;
  return held !== undefined && notModified(c, etag)
    ? c.body(null, 304, { ETag: etag, 'Cache-Control': catalogCacheControl })
    : undefined;
}

/** The body, with the catalog's caching and the ETag of the catalog version it was read with. */
export function lookupJson(
  c: LookupContext,
  body: object,
  version: string,
  inputs: string,
): Response {
  return c.json(body, 200, {
    'Content-Type': jsonType,
    'Cache-Control': catalogCacheControl,
    ETag: `"${version}-${inputs}"`,
  });
}
