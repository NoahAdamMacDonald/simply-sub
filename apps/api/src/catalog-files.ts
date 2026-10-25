import {
  catalogIdsSchema,
  catalogIndexSchema,
  type CatalogIds,
  type CatalogIndex,
  type ErrorBody,
} from '@simply-sub/core';
import type { Context } from 'hono';
import { catalogCacheControl, jsonType, notModified } from './http';

// The routes that answer with a static file `npm run data:build` writes (BLUEPRINT §6.3): GET /catalog, GET /features
// and GET /categories. The files are streamed without being parsed, since the Worker has 10 ms of CPU per request,
// and they never touch D1. The ETag is the catalog version from data/catalog/index.json, which is deployed with the
// files, so it always describes the body it's sent with: D1's catalog row can't, since the seed runs before the new
// files go live.

type CatalogContext = Context<{ Bindings: Env }>;

/**
 * The static file `pathFor` names, once it has read the index: 304 Not Modified when If-None-Match already has the
 * catalog version, else the file with the version as its ETag. A missing static file is answered with index.html
 * (the SPA fallback), so the index, not a fetch, says which region files exist.
 */
export async function catalogFile(
  c: CatalogContext,
  pathFor: (index: CatalogIndex) => string,
): Promise<Response> {
  const indexFile = await staticJson(c, '/data/catalog/index.json');
  if (!indexFile) {
    return missingFiles(c);
  }
  const index = catalogIndexSchema.parse(await new Response(indexFile).json());
  const etag = `"${index.catalogVersion}"`;
  if (notModified(c, etag)) {
    return c.body(null, 304, { ETag: etag, 'Cache-Control': catalogCacheControl });
  }
  const file = await staticJson(c, pathFor(index));
  if (!file) {
    return missingFiles(c);
  }
  return c.body(file, 200, {
    'Content-Type': jsonType,
    'Cache-Control': catalogCacheControl,
    ETag: etag,
  });
}

/** A small static JSON file (features.json, categories.json), parsed, or undefined when it's missing. */
export async function catalogJson(c: CatalogContext, path: string): Promise<unknown> {
  const body = await staticJson(c, path);
  return body ? new Response(body).json() : undefined;
}

/**
 * data/catalog/ids.json, every provider id with its plan ids, or undefined when it's missing or isn't one. It only
 * suggests an id when a request names an unknown one, so a 404 or 400 can do without it.
 */
export async function catalogIdsFile(c: CatalogContext): Promise<CatalogIds | undefined> {
  return catalogIdsSchema.safeParse(await catalogJson(c, '/data/catalog/ids.json')).data;
}

/** A static JSON file's body, or undefined when it's missing and the assets answer with the app instead. */
async function staticJson(c: CatalogContext, path: string): Promise<ReadableStream | undefined> {
  const response = await c.env.ASSETS.fetch(new URL(path, c.req.url));
  const type = response.headers.get('Content-Type') ?? '';
  if (response.ok && type.startsWith('application/json') && response.body) {
    return response.body;
  }
  await response.body?.cancel();
  return undefined;
}

export function missingFiles(c: CatalogContext): Response {
  return c.json(
    {
      error: { code: 'internal', message: 'The catalog files are missing from this deploy.' },
    } satisfies ErrorBody,
    500,
    { 'Content-Type': jsonType },
  );
}
