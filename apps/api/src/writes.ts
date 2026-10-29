import type { Context, MiddlewareHandler } from 'hono';
import { badBody, overCapacity, rateLimited, tooLarge } from './http';

// The rules for every request that stores something (BLUEPRINT §5.4, M10.1): the live calendar's feeds (M10.2), sync's
// sealed copies (M10.8) and price reports (M10.10), all in the user database (USER_DB). An IP's writes have a limit of
// their own on top of the API's, and so has each feed set or sync chain; every body has a size limit; each kind of
// data has a daily cap on the rows it writes, since D1 counts them for the whole account, the catalog's deploys
// included; and a secret is kept only as its hash, never logged.

interface Api {
  Bindings: Env;
}

/** The methods that store or delete something. */
const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 429 rate_limited for an IP over 10 writes a minute (WRITE_RATE_LIMIT), on top of rateLimit's 60 requests, keyed and
 * counted the same way (middleware.ts).
 */
export const writeLimit: MiddlewareHandler<Api> = async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP');
  if (
    ip !== undefined &&
    writeMethods.has(c.req.method) &&
    !(await c.env.WRITE_RATE_LIMIT.limit({ key: ip })).success
  ) {
    return rateLimited(c);
  }
  return next();
};

/** Whether a feed set or sync chain may be written now: 6 writes a minute each (RESOURCE_RATE_LIMIT), by its id. */
export async function resourceAllowed(env: Env, id: string): Promise<boolean> {
  return (await env.RESOURCE_RATE_LIMIT.limit({ key: id })).success;
}

/**
 * The request's body, or the 413 that refuses it when it's over `limit` bytes: at once when its Content-Length says
 * so, else as it streams in, so a long body is never read whole.
 */
export async function readBody(c: Context<Api>, limit: number): Promise<Uint8Array | Response> {
  if (Number(c.req.header('Content-Length')) > limit) {
    return tooLarge(c, limit);
  }
  const stream = c.req.raw.body;
  if (stream === null) {
    return new Uint8Array();
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return tooLarge(c, limit);
    }
    chunks.push(read.value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/** The request's JSON body (at most `limit` bytes of UTF-8), or the 400 or 413 that refuses it. */
export async function readJson(
  c: Context<Api>,
  limit: number,
): Promise<{ json: unknown } | Response> {
  if (!/^application\/json\s*(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) {
    return badBody(c, [
      { path: '', issue: 'Send the body as JSON, with Content-Type: application/json.' },
    ]);
  }
  const body = await readBody(c, limit);
  if (body instanceof Response) {
    return body;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body);
    return { json: JSON.parse(text) as unknown };
  } catch {
    return badBody(c, [{ path: '', issue: "The body isn't JSON." }]);
  }
}

/**
 * The rows each kind of user data may write a day, its count's own row included (one a write): 41,000 together, under
 * half of D1's 100,000 a day, which the account's catalog deploys share (BLUEPRINT §7.1).
 */
export const dailyCaps = { cal: 15_000, sync: 25_000, report: 1_000 } as const;
export type WriteKind = keyof typeof dailyCaps;

/** New feed sets and sync chains stop once the user database is this big, in bytes: 400 MB of D1's 500. */
export const storageCap = 400_000_000;

/** What counting a write found. */
export interface CountedWrite {
  /** Whether the write fits in its kind's cap for the day. When it doesn't, nothing was counted. */
  allowed: boolean;
  /** How big the user database is, in bytes. */
  size: number;
}

/**
 * Counts a write of `rows` rows of `kind` on `day` (UTC), with the count's own row, unless that would take the kind
 * past its daily cap. One statement, so two writes can't both take a cap's last rows.
 */
export async function countWrite(
  db: D1Database,
  kind: WriteKind,
  rows: number,
  day: string,
): Promise<CountedWrite> {
  const { results, meta } = await db
    .prepare(
      `INSERT INTO daily_counts (day, kind, rows) VALUES (?1, ?2, ?3)
       ON CONFLICT (day, kind) DO UPDATE SET rows = daily_counts.rows + excluded.rows
       WHERE daily_counts.rows + excluded.rows <= ?4
       RETURNING rows`,
    )
    .bind(day, kind, rows + 1, dailyCaps[kind])
    .all();
  return { allowed: results.length > 0, size: meta.size_after };
}

/** 503 over_capacity for a kind past its daily cap, until the counts start again at midnight UTC. */
export function capReached(c: Context<Api>, now: Date): Response {
  return overCapacity(
    c,
    'Too many changes were stored today. Try again tomorrow.',
    secondsToMidnight(now),
  );
}

/** 503 over_capacity when the user database is full: the nightly clean-up may make room by tomorrow. */
export function storageFull(c: Context<Api>, now: Date): Response {
  return overCapacity(
    c,
    'There is no room to store more right now. Try again tomorrow.',
    secondsToMidnight(now),
  );
}

/** Seconds from `now` to the next midnight UTC, at least 1. */
export function secondsToMidnight(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1000));
}

/** A new random secret of `bytes` bytes, as base64url: 16 bytes (128 bits) is 22 characters. */
export function newSecret(bytes = 16): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** What the user database keeps of a secret: its SHA-256, in hex. */
export async function secretHash(secret: string): Promise<string> {
  return [...(await sha256(secret))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Whether `secret` is the one `hash` (secretHash's) was made from, compared in constant time. */
export async function isSecretOf(secret: string, hash: string): Promise<boolean> {
  const kept = /^[0-9a-f]{64}$/.test(hash)
    ? Uint8Array.from(hash.match(/../g) ?? [], (pair) => parseInt(pair, 16))
    : undefined;
  return kept !== undefined && crypto.subtle.timingSafeEqual(await sha256(secret), kept);
}

/** The secret an `Authorization: Bearer` header carries, when it has a secret's form: base64url, 22 to 64 characters. */
export function bearerSecret(c: Context<Api>): string | undefined {
  return /^Bearer ([A-Za-z0-9_-]{22,64})$/.exec(c.req.header('Authorization') ?? '')?.[1];
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
