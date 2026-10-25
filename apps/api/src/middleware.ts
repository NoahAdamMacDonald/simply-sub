import type { Context, ErrorHandler, MiddlewareHandler, NotFoundHandler } from 'hono';
import { internalError, notFound, rateLimited } from './http';

// What every /api/* request goes through (BLUEPRINT §5.4, M2.8), outermost first: the API's headers, the per-IP rate
// limit, then, for the routes that read D1 or KV, the edge cache. Unknown paths and unexpected errors get the
// contract's JSON errors.

interface Api {
  Bindings: Env;
}

/** The app's own origin: the only one the CORS header names (BLUEPRINT §5.4). */
export const appOrigin = 'https://sub.simplely.ca';

/**
 * The headers every /api/* response carries, errors and cached answers included. The CORS header names only the
 * app's origin, so other sites' pages can't read the answers (the app itself is on the same origin and needs no
 * CORS). nosniff and a CSP that allows nothing, because an API response is never a page. Cross-Origin-Resource-
 * Policy, so other sites can't embed the answers either: an /icon image included, whose misses cost KV writes.
 */
export const apiHeaders: MiddlewareHandler<Api> = async (c, next) => {
  await next();
  const headers = c.res.headers;
  headers.set('Access-Control-Allow-Origin', appOrigin);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
};

/**
 * 429 rate_limited for a client over its per-IP limits (wrangler.jsonc): 60 requests a minute on /api/*, and 10 a
 * minute on /icon. Cloudflare counts them in each location, roughly. The key is CF-Connecting-IP, which Cloudflare's
 * edge sets on every request; it's never stored or logged. A request without it didn't come through the edge (a
 * test calling the Worker directly), and isn't limited.
 */
export const rateLimit: MiddlewareHandler<Api> = async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP');
  if (ip !== undefined) {
    const limiters = [
      c.env.API_RATE_LIMIT,
      ...(c.req.path === '/api/v1/icon' ? [c.env.ICON_RATE_LIMIT] : []),
    ];
    for (const limiter of limiters) {
      if (!(await limiter.limit({ key: ip })).success) {
        return rateLimited(c);
      }
    }
  }
  return next();
};

/** The routes whose answers the edge cache keeps: the ones that read D1 or KV. The static-file routes read neither. */
const cachedPaths = /^\/api\/v1\/(?:providers|plans|bundles|fx|icon)(?:\/|$)/;

/**
 * Cloudflare's Cache API in front of the routes that read D1 or KV (BLUEPRINT §5.1). An answer marked public is kept,
 * keyed by its URL, for its own max-age, and the cache answers that URL again, If-None-Match included, without the
 * route running. The Worker still runs, so this saves D1 and KV reads and CPU, not requests. Errors (no-store) and
 * 304s are never kept. The cache is written after the answer is sent (waitUntil), so a call without an execution
 * context, like a test calling the Worker directly, skips it.
 */
export const edgeCache: MiddlewareHandler<Api> = async (c, next) => {
  const context = executionContext(c);
  if (!context || c.req.method !== 'GET' || !cachedPaths.test(c.req.path)) {
    return next();
  }
  const cache = caches.default;
  const hit = await cache.match(c.req.raw);
  if (hit) {
    // A cached answer's headers can't change, so the API's own go on a copy (apiHeaders).
    return new Response(hit.body, hit);
  }
  await next();
  if (c.res.status !== 304 && c.res.headers.get('Cache-Control')?.startsWith('public')) {
    context.waitUntil(cache.put(c.req.url, c.res.clone()));
  }
  return undefined;
};

/** 404 not_found, in the contract's shape, for a path or method no route answers. */
export const noRoute: NotFoundHandler<Api> = (c) =>
  notFound(c, `No API route answers ${c.req.method} ${c.req.path}.`);

/**
 * 500 internal for anything a route didn't expect. The log names the error and the route's pattern, never the URL:
 * its query can name a website someone subscribes to (BLUEPRINT §5.4).
 */
export const unexpectedError: ErrorHandler<Api> = (error, c) => {
  console.error(`Unexpected ${error.name} answering ${c.req.method} ${c.req.routePath}.`);
  return internalError(c);
};

function executionContext(c: Context<Api>): Pick<ExecutionContext, 'waitUntil'> | undefined {
  try {
    return c.executionCtx;
  } catch {
    // Hono throws when the Worker was called without one.
    return undefined;
  }
}
