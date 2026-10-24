import type { Context } from 'hono';

// What every route answers the same way: the JSON content type, the 400 bad_request shape and If-None-Match.

// Hono's default is plain application/json; M2.8 sets the contract's type for every route.
export const jsonType = 'application/json; charset=utf-8';

export interface ParamProblem {
  param: string;
  issue: string;
}

/** 400 bad_request, listing each problem with the query. */
export function badQuery(c: Context, problems: readonly ParamProblem[]): Response {
  const message =
    problems.length === 1
      ? `Invalid query parameter '${problems[0].param}'.`
      : `${problems.length} query parameters are invalid.`;
  return c.json({ error: { code: 'bad_request', message, details: problems } }, 400, {
    'Content-Type': jsonType,
  });
}

/** A problem for each query parameter, on a route that takes none. */
export function noParams(c: Context, route: string): ParamProblem[] {
  return Object.keys(c.req.queries()).map((param) => ({
    param,
    issue: `Unknown parameter. ${route} takes none.`,
  }));
}

/** Whether the request's If-None-Match names `etag`, with the weak comparison RFC 9110 asks for. */
export function notModified(c: Context, etag: string): boolean {
  return (c.req.header('If-None-Match') ?? '')
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*');
}
