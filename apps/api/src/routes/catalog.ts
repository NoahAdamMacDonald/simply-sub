import {
  catalogIndexSchema,
  isCatalogRegion,
  regionFileFor,
  regionProblem,
} from '@simply-sub/core';
import { Hono, type Context } from 'hono';

/** The contract's caching for catalog responses (BLUEPRINT §5.1). */
const cacheControl = 'public, max-age=3600, stale-while-revalidate=86400';
// Hono's default is plain application/json; M2.8 sets the contract's type for every route.
const jsonType = 'application/json; charset=utf-8';

interface ParamProblem {
  param: string;
  issue: string;
}

/**
 * GET /catalog and GET /catalog?region=CA (docs/api-output-examples.json): the snapshot files that
 * `npm run data:build` writes (BLUEPRINT §6.3), streamed from the static assets without being parsed,
 * since the Worker has 10 ms of CPU per request. The ETag is the catalog version from
 * data/catalog/index.json, which is deployed with the files, so it always describes the body it's
 * sent with. A missing static file is answered with index.html (the SPA fallback), so the index,
 * not a fetch, says which region files exist.
 */
export const catalog = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const problems = queryProblems(c.req.queries());
  if (problems.length > 0) {
    const message =
      problems.length === 1
        ? `Invalid query parameter '${problems[0].param}'.`
        : `${problems.length} query parameters are invalid.`;
    return c.json({ error: { code: 'bad_request', message, details: problems } }, 400, {
      'Content-Type': jsonType,
    });
  }

  const indexFile = await staticJson(c.env.ASSETS, c.req.url, '/data/catalog/index.json');
  if (!indexFile) {
    return missingFiles(c);
  }
  const index = catalogIndexSchema.parse(await new Response(indexFile).json());
  const etag = `"${index.catalogVersion}"`;
  if (matches(c.req.header('If-None-Match'), etag)) {
    return c.body(null, 304, { ETag: etag, 'Cache-Control': cacheControl });
  }

  const region = c.req.query('region');
  const code = region === undefined ? undefined : regionFileFor(region, index);
  const file = await staticJson(
    c.env.ASSETS,
    c.req.url,
    code === undefined ? '/data/catalog.json' : `/data/catalog/${code}.json`,
  );
  if (!file) {
    return missingFiles(c);
  }
  return c.body(file, 200, {
    'Content-Type': jsonType,
    'Cache-Control': cacheControl,
    ETag: etag,
  });
});

/** Each problem with the query: GET /catalog takes one optional `region`, a catalog region code. */
function queryProblems(queries: Record<string, string[]>): ParamProblem[] {
  return Object.entries(queries).flatMap(([param, values]): ParamProblem[] => {
    if (param !== 'region') {
      return [{ param, issue: 'Unknown parameter. GET /catalog takes only region.' }];
    }
    if (values.length > 1) {
      return [{ param, issue: 'Give one region.' }];
    }
    return isCatalogRegion(values[0]) ? [] : [{ param, issue: `${regionProblem(values[0])}.` }];
  });
}

/** A static JSON file's body, or undefined when it's missing and the assets answer with the app instead. */
async function staticJson(
  assets: Fetcher,
  requestUrl: string,
  path: string,
): Promise<ReadableStream | undefined> {
  const response = await assets.fetch(new URL(path, requestUrl));
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

function missingFiles(c: Context) {
  return c.json(
    { error: { code: 'internal', message: 'The catalog files are missing from this deploy.' } },
    500,
    { 'Content-Type': jsonType },
  );
}
