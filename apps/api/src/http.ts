import type { BodyProblem, ErrorBody } from '@simply-sub/core';
import type { Context } from 'hono';

// What every route answers the same way: the JSON content type, the catalog's caching, the 400 bad_request,
// 404 not_found, 413 too_large, 429 rate_limited, 500 internal, 502 and 503 over_capacity shapes (core's ErrorBody,
// the contract's error envelope), timestamps, If-None-Match and the ETag's hash. No error may be cached.

// Hono's default is plain application/json, so every JSON answer sets the contract's type.
export const jsonType = 'application/json; charset=utf-8';

/** The contract's caching for catalog responses (BLUEPRINT §5.1). */
export const catalogCacheControl = 'public, max-age=3600, stale-while-revalidate=86400';

export interface ParamProblem {
  param: string;
  issue: string;
}

/** 400 bad_request, listing each problem with the query. Nothing may cache it. */
export function badQuery(c: Context, problems: readonly ParamProblem[]): Response {
  const message =
    problems.length === 1
      ? `Invalid query parameter '${problems[0].param}'.`
      : `${problems.length} query parameters are invalid.`;
  const body = {
    error: { code: 'bad_request', message, details: [...problems] },
  } satisfies ErrorBody;
  return c.json(body, 400, { 'Content-Type': jsonType, 'Cache-Control': 'no-store' });
}

/** 400 bad_request for a body that isn't what its route takes, listing each problem by where it is (M10.1). */
export function badBody(c: Context, problems: readonly BodyProblem[]): Response {
  const message =
    problems.length === 1
      ? problems[0].path === ''
        ? problems[0].issue
        : `Invalid body field '${problems[0].path}'.`
      : `${problems.length} body fields are invalid.`;
  const body = {
    error: { code: 'bad_request', message, details: [...problems] },
  } satisfies ErrorBody;
  return c.json(body, 400, { 'Content-Type': jsonType, 'Cache-Control': 'no-store' });
}

/** 403 forbidden: a write without the secret its feed set or sync chain was made with, or with another (M10.2). */
export function forbidden(c: Context, message: string): Response {
  return c.json({ error: { code: 'forbidden', message } } satisfies ErrorBody, 403, {
    'Content-Type': jsonType,
    'Cache-Control': 'no-store',
  });
}

/** 412 stale_version: a sync chain's write named a version another device has written past (M10.8). */
export function staleVersion(c: Context, message: string): Response {
  return c.json({ error: { code: 'stale_version', message } } satisfies ErrorBody, 412, {
    'Content-Type': jsonType,
    'Cache-Control': 'no-store',
  });
}

/** 413 too_large: the body is over its route's limit, which the message names in bytes (M10.1). */
export function tooLarge(c: Context, limit: number): Response {
  return c.json(
    {
      error: {
        code: 'too_large',
        message: `The request's body is over its limit of ${limit} bytes.`,
      },
    } satisfies ErrorBody,
    413,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
  );
}

/**
 * 503 over_capacity: a daily cap on what users store was reached, or the storage is full (M10.1). Either way, try
 * again after `retryAfter` seconds.
 */
export function overCapacity(c: Context, message: string, retryAfter: number): Response {
  return c.json({ error: { code: 'over_capacity', message } } satisfies ErrorBody, 503, {
    'Content-Type': jsonType,
    'Cache-Control': 'no-store',
    'Retry-After': String(retryAfter),
  });
}

/** A problem for each query parameter, on a route that takes none. */
export function noParams(c: Context, route: string): ParamProblem[] {
  return Object.keys(c.req.queries()).map((param) => ({
    param,
    issue: `Unknown parameter. ${route} takes none.`,
  }));
}

/**
 * 404 not_found, with the id the request may have meant (docs/api-output-examples.json). Nothing may cache it: the
 * next deploy can add what's missing.
 */
export function notFound(c: Context, message: string, suggestion?: string): Response {
  return c.json(
    {
      error: {
        code: 'not_found',
        message,
        ...(suggestion !== undefined && { details: [{ suggestion }] }),
      },
    } satisfies ErrorBody,
    404,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
  );
}

/** 429 rate_limited: the client is over a per-IP limit (middleware.ts), whose window is a minute. */
export function rateLimited(c: Context): Response {
  return c.json(
    {
      error: { code: 'rate_limited', message: 'Too many requests. Try again in 60 seconds.' },
    } satisfies ErrorBody,
    429,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store', 'Retry-After': '60' },
  );
}

/** 500 internal: D1 has no catalog row, so a route that reads it has nothing to answer with. */
export function notSeeded(c: Context): Response {
  return c.json(
    {
      error: {
        code: 'internal',
        message: "The catalog isn't in D1 yet: the deploy's seed hasn't run.",
      },
    } satisfies ErrorBody,
    500,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
  );
}

/** 500 internal: a route threw something it didn't expect (the error middleware, middleware.ts). */
export function internalError(c: Context): Response {
  return c.json(
    {
      error: { code: 'internal', message: 'Something went wrong on our side. Try again later.' },
    } satisfies ErrorBody,
    500,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
  );
}

/** 502 upstream_unavailable: Frankfurter is down and no rates are kept (fx.ts). */
export function noExchangeRates(c: Context): Response {
  return c.json(
    {
      error: {
        code: 'upstream_unavailable',
        message:
          "Exchange rates are temporarily unavailable. Converted prices can't be shown right now.",
      },
    } satisfies ErrorBody,
    502,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
  );
}

/** Whether the request's If-None-Match names `etag`, with the weak comparison RFC 9110 asks for. */
export function notModified(c: Context, etag: string): boolean {
  return (c.req.header('If-None-Match') ?? '')
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*');
}

/** `date` as the API writes timestamps: ISO 8601 in UTC, to the second. */
export function utcTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The day `date` is in UTC, as an ISO date: what the user database's dates and daily counts use (M10.1). */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The first 4 hex digits of a SHA-256 of `text`: the part of an ETag after D1's catalog version. */
export async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 2)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
