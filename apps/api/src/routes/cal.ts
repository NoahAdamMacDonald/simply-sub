import {
  addDays,
  calendarFeedsSchema,
  feedIcs,
  type CalendarFeed,
  type CalendarFeeds,
  type ErrorBody,
  type FeedLink,
} from '@simply-sub/core';
import { Hono, type Context } from 'hono';
import {
  badBody,
  forbidden,
  jsonType,
  notModified,
  rateLimited,
  utcDay,
  utcTimestamp,
} from '../http';
import { contentHash, openFeed, sealFeed } from '../feed-seal';
import {
  bearerSecret,
  bodyProblems,
  capReached,
  countWrite,
  isSecretOf,
  newSecret,
  readJson,
  resourceAllowed,
  secretHash,
  storageCap,
  storageFull,
} from '../writes';

// The live calendar (BLUEPRINT §5.2, §11.3, M10.2), in the user database, under the write rules (writes.ts). POST /cal
// makes a feed set, PUT /cal/:id changes it and DELETE /cal/:id revokes it, each but the first with the manage key POST
// gave; GET /cal/:token.ics serves one of its calendars to the apps that subscribe. The database keeps the set's id, its
// manage key's hash and when it's deleted, and per feed its token's hash and its calendar file (core's feedIcs), sealed
// with a key only the token gives (feed-seal.ts, M10.21), so it names no link and says nothing of what's paid for.
// Calendar apps' servers fetch many users' feeds from one address, so a feed is limited by itself (FEED_RATE_LIMIT, 30
// a minute), not by IP (middleware.ts).

interface Api {
  Bindings: Env;
}

/** A set's body: 2,000 events with 120-character titles are about 330 kB of JSON. */
const bodyLimit = 512 * 1024;
/** A set is deleted this many days after the app last wrote it (the owner's choice, BLUEPRINT §14). */
const keptDays = 180;
/** The rows a write of a set or one of its feeds costs: its row and its index's. */
const rowsEach = 2;

/** A stored feed, as the database keeps it. */
export interface FeedRow {
  /**
   * A hash of what the calendar was made from, keyed by its token: its ETag's start, and how a PUT knows it hasn't
   * changed. A feed stored before M10.21 has a plain SHA-256 until it's sealed.
   */
  content_hash: string;
  /** Its calendar file, sealed (feed-seal.ts), as base64; null for a feed stored before M10.21 until it's sealed. */
  sealed: string | null;
  /** The plain calendar file of a feed stored before M10.21; null once it's sealed. */
  ics: string | null;
}

/** What a feed's calendar is made from, as its content hash takes it. */
function feedContent({ name, color, events }: CalendarFeed): string {
  return JSON.stringify({ name, color: color ?? null, events });
}

/**
 * The row for `feed` under `token`, whose hash is `tokenHash`, written at `stamp`: its calendar file sealed with the
 * token's key, and the keyed hash of what it was made from.
 */
export async function feedRow(
  feed: CalendarFeed,
  token: string,
  tokenHash: string,
  stamp: string,
): Promise<{ content_hash: string; sealed: string }> {
  const [content_hash, sealed] = await Promise.all([
    contentHash(token, feedContent(feed)),
    sealFeed(token, tokenHash, feedIcs(feed, stamp)),
  ]);
  return { content_hash, sealed };
}

export const cal = new Hono<Api>()
  .post('/', async (c) => {
    const feeds = await readFeeds(c);
    if (feeds instanceof Response) return feeds;
    const tokened = feeds.feeds.flatMap(({ token }, index) =>
      token === undefined
        ? []
        : [{ path: `feeds.${index}.token`, issue: "A new set's feeds have no token yet" }],
    );
    if (tokened.length > 0) return badBody(c, tokened);

    const now = new Date();
    const counted = await countWrite(
      c.env.USER_DB,
      'cal',
      rowsEach * (feeds.feeds.length + 1),
      utcDay(now),
    );
    if (!counted.allowed) return capReached(c, now);
    if (counted.size > storageCap) return storageFull(c, now);

    const id = newSecret();
    const manageKey = newSecret();
    const tokens = feeds.feeds.map(() => newSecret());
    const stamp = utcTimestamp(now);
    const db = c.env.USER_DB;
    await db.batch([
      db
        .prepare('INSERT INTO cal_sets (id, manage_hash, expires_on) VALUES (?, ?, ?)')
        .bind(id, await secretHash(manageKey), addDays(utcDay(now), keptDays)),
      ...(await Promise.all(
        feeds.feeds.map(async (feed, index) => insertFeed(db, id, tokens[index], feed, stamp)),
      )),
    ]);
    return c.json({ data: { id, manageKey, feeds: links(c, tokens, feeds) }, meta: {} }, 201, {
      'Content-Type': jsonType,
      'Cache-Control': 'no-store',
      Location: `${new URL(c.req.url).origin}/api/v1/cal/${id}`,
    });
  })
  .put('/:id', async (c) => {
    const id = await managedSet(c);
    if (id instanceof Response) return id;
    const feeds = await readFeeds(c);
    if (feeds instanceof Response) return feeds;

    const db = c.env.USER_DB;
    const { results: stored } = await db
      .prepare('SELECT token_hash, content_hash FROM cal_feeds WHERE set_id = ?')
      .bind(id)
      .all<{ token_hash: string; content_hash: string }>();
    const contents = new Map(stored.map((row) => [row.token_hash, row.content_hash]));
    const hashes = await Promise.all(
      feeds.feeds.map(({ token }) => (token === undefined ? undefined : secretHash(token))),
    );
    const strangers = hashes.flatMap((hash, index) =>
      hash !== undefined && !contents.has(hash)
        ? [{ path: `feeds.${index}.token`, issue: 'This set has no feed with this token' }]
        : [],
    );
    if (strangers.length > 0) return badBody(c, strangers);

    const now = new Date();
    const stamp = utcTimestamp(now);
    const tokens = feeds.feeds.map(({ token }) => token ?? newSecret());
    const writes: D1PreparedStatement[] = [
      db
        .prepare('UPDATE cal_sets SET expires_on = ? WHERE id = ?')
        .bind(addDays(utcDay(now), keptDays), id),
    ];
    for (const [index, feed] of feeds.feeds.entries()) {
      const hash = hashes[index];
      if (hash === undefined) {
        writes.push(await insertFeed(db, id, tokens[index], feed, stamp));
        continue;
      }
      // A calendar that hasn't changed keeps its file, stamp and ETag. One stored before M10.21 has a plain hash, so
      // it's sealed now.
      if ((await contentHash(tokens[index], feedContent(feed))) !== contents.get(hash)) {
        const row = await feedRow(feed, tokens[index], hash, stamp);
        writes.push(
          db
            .prepare(
              'UPDATE cal_feeds SET content_hash = ?, sealed = ?, ics = NULL, updated_at = ? WHERE token_hash = ?',
            )
            .bind(row.content_hash, row.sealed, stamp, hash),
        );
      }
    }
    const kept = new Set(hashes);
    for (const hash of contents.keys()) {
      if (!kept.has(hash))
        writes.push(db.prepare('DELETE FROM cal_feeds WHERE token_hash = ?').bind(hash));
    }

    const counted = await countWrite(db, 'cal', rowsEach * writes.length, utcDay(now));
    if (!counted.allowed) return capReached(c, now);
    if (counted.size > storageCap && hashes.includes(undefined)) return storageFull(c, now);
    await db.batch(writes);
    return c.json(
      { data: { id, feeds: links(c, tokens, feeds), updatedAt: stamp }, meta: {} },
      200,
      { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
    );
  })
  .delete('/:id', async (c) => {
    const id = await managedSet(c);
    if (id instanceof Response) return id;
    // A revoke is never refused for a cap: it only takes away what the caps counted in.
    const db = c.env.USER_DB;
    await db.batch([
      db.prepare('DELETE FROM cal_feeds WHERE set_id = ?').bind(id),
      db.prepare('DELETE FROM cal_sets WHERE id = ?').bind(id),
    ]);
    return c.body(null, 204, { 'Cache-Control': 'no-store' });
  })
  .get('/:file', async (c) => {
    const token = /^([A-Za-z0-9_-]{22})\.ics$/.exec(c.req.param('file'))?.[1];
    if (token === undefined) return feedGone(c, 'calendar feed');
    const hash = await secretHash(token);
    if (!(await c.env.FEED_RATE_LIMIT.limit({ key: hash })).success) return rateLimited(c);
    const row = await c.env.USER_DB.prepare(
      `SELECT f.content_hash, f.sealed, f.ics FROM cal_feeds f JOIN cal_sets s ON s.id = f.set_id
       WHERE f.token_hash = ? AND s.expires_on > ?`,
    )
      .bind(hash, utcDay(new Date()))
      .first<FeedRow>();
    if (row === null) return feedGone(c, 'calendar feed');
    // A feed stored before M10.21 is served as it is, and sealed now that its token is here.
    if (row.ics !== null) await sealStored(c.env.USER_DB, token, hash, row.ics);
    // Revalidated each time, so a revoke or a change shows at the app's next check. A 304 needs no key.
    const headers = { 'Cache-Control': 'no-cache', ETag: `"${row.content_hash.slice(0, 16)}"` };
    if (notModified(c, headers.ETag)) return c.body(null, 304, headers);
    const ics = row.sealed === null ? (row.ics ?? '') : await openFeed(token, hash, row.sealed);
    return c.body(ics, 200, { ...headers, 'Content-Type': 'text/calendar; charset=utf-8' });
  });

/**
 * Seals the plain file of a feed stored before M10.21, with its keyed hash, when the day's writes have room; the next
 * fetch gets the new ETag, and the file again. A failure leaves it plain for the next request: the fetch is answered.
 */
async function sealStored(db: D1Database, token: string, hash: string, ics: string): Promise<void> {
  try {
    const now = new Date();
    if (!(await countWrite(db, 'cal', rowsEach, utcDay(now))).allowed) return;
    const [content_hash, sealed] = await Promise.all([
      contentHash(token, ics),
      sealFeed(token, hash, ics),
    ]);
    await db
      .prepare(
        'UPDATE cal_feeds SET content_hash = ?, sealed = ?, ics = NULL WHERE token_hash = ? AND ics IS NOT NULL',
      )
      .bind(content_hash, sealed, hash)
      .run();
  } catch {
    // Left plain until a request seals it.
  }
}

/** The body of a POST or PUT, checked; or the 400 or 413 that refuses it. */
async function readFeeds(c: Context<Api>): Promise<CalendarFeeds | Response> {
  const read = await readJson(c, bodyLimit);
  if (read instanceof Response) return read;
  const parsed = calendarFeedsSchema.safeParse(read.json);
  return parsed.success ? parsed.data : badBody(c, bodyProblems(parsed.error.issues));
}

/**
 * The id of the set a PUT or DELETE names, once its manage key is shown to be the set's and the set has writes to
 * spare this minute; else the 403, 404 or 429. A request without a key learns nothing of the set.
 */
async function managedSet(c: Context<Api>): Promise<string | Response> {
  const key = bearerSecret(c);
  const noKey = "The manage key is missing or isn't this feed set's.";
  if (key === undefined) return forbidden(c, noKey);
  const id = c.req.param('id') ?? '';
  const set = /^[A-Za-z0-9_-]{22}$/.test(id)
    ? await c.env.USER_DB.prepare(
        'SELECT manage_hash FROM cal_sets WHERE id = ? AND expires_on > ?',
      )
        .bind(id, utcDay(new Date()))
        .first<{ manage_hash: string }>()
    : null;
  if (set === null) return feedGone(c, 'feed set');
  if (!(await isSecretOf(key, set.manage_hash))) return forbidden(c, noKey);
  if (!(await resourceAllowed(c.env, id))) return rateLimited(c);
  return id;
}

/** The statement that stores a new feed of set `id` under `token`. */
async function insertFeed(
  db: D1Database,
  id: string,
  token: string,
  feed: CalendarFeed,
  stamp: string,
): Promise<D1PreparedStatement> {
  const hash = await secretHash(token);
  const row = await feedRow(feed, token, hash, stamp);
  return db
    .prepare(
      'INSERT INTO cal_feeds (token_hash, set_id, content_hash, sealed, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(hash, id, row.content_hash, row.sealed, stamp);
}

/** Each feed's links, in the order sent: its https:// URL, which Google and Proton take, and Apple's webcal://. */
function links(c: Context<Api>, tokens: readonly string[], feeds: CalendarFeeds): FeedLink[] {
  const origin = new URL(c.req.url).origin;
  return tokens.map((token, index) => {
    const url = `${origin}/api/v1/cal/${token}.ics`;
    return {
      token,
      url,
      webcalUrl: url.replace(/^https?:/, 'webcal:'),
      eventCount: feeds.feeds[index].events.length,
    };
  });
}

/** 404 not_found: no such feed or set, or it was revoked or has expired. Nothing may cache it. */
function feedGone(c: Context<Api>, what: 'calendar feed' | 'feed set'): Response {
  return c.json(
    {
      error: { code: 'not_found', message: `This ${what} doesn't exist or was revoked.` },
    } satisfies ErrorBody,
    404,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
  );
}
