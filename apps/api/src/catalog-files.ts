import { catalogIndexSchema, type CatalogIndex } from '@simply-sub/core';
import type { Context } from 'hono';

// The routes that answer with a static file `npm run data:build` writes (BLUEPRINT §6.3): GET /catalog, GET /features
// and GET /categories. The files are streamed without being parsed, since the Worker has 10 ms of CPU per request,
// and they never touch D1. The ETag is the catalog version from data/catalog/index.json, which is deployed with the
// files, so it always describes the body it's sent with: D1's catalog row can't, since the seed runs before the new
// files go live.

/** The contract's caching for catalog responses (BLUEPRINT §5.1). */
const cacheControl = 'public, max-age=3600, stale-while-revalidate=86400';
// Hono's default is plain application/json; M2.8 sets the contract's type for every route.
const jsonType = 'application/json; charset=utf-8';

export interface ParamProblem {
  param: string;
  issue: string;
}

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
  if (matches(c.req.header('If-None-Match'), etag)) {
    return c.body(null, 304, { ETag: etag, 'Cache-Control': cacheControl });
  }
  const file = await staticJson(c, pathFor(index));
  if (!file) {
    return missingFiles(c);
  }
  return c.body(file, 200, {
    'Content-Type': jsonType,
    'Cache-Control': cacheControl,
    ETag: etag,
  });
}

/** 400 bad_request, listing each problem with the query. */
export function badQuery(c: CatalogContext, problems: readonly ParamProblem[]): Response {
  const message =
    problems.length === 1
      ? `Invalid query parameter '${problems[0].param}'.`
      : `${problems.length} query parameters are invalid.`;
  return c.json({ error: { code: 'bad_request', message, details: problems } }, 400, {
    'Content-Type': jsonType,
  });
}

/** A problem for each query parameter, on a route that takes none. */
export function noParams(c: CatalogContext, route: string): ParamProblem[] {
  return Object.keys(c.req.queries()).map((param) => ({
    param,
    issue: `Unknown parameter. ${route} takes none.`,
  }));
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

/** Whether If-None-Match names `etag`, with the weak comparison RFC 9110 asks for. */
function matches(ifNoneMatch: string | undefined, etag: string): boolean {
  return (ifNoneMatch ?? '')
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*');
}

function missingFiles(c: CatalogContext): Response {
  return c.json(
    { error: { code: 'internal', message: 'The catalog files are missing from this deploy.' } },
    500,
    { 'Content-Type': jsonType },
  );
}
