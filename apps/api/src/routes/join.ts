import {
  joinLinkMinutes,
  maxSealedCodeBytes,
  type ErrorBody,
  type JoinLinkBody,
} from '@simply-sub/core';
import { Hono, type Context } from 'hono';
import { badBody, jsonType, utcDay, utcTimestamp } from '../http';
import {
  capReached,
  countWrite,
  fromBase64,
  newSecret,
  readBody,
  secretHash,
  storageCap,
  storageFull,
  toBase64,
} from '../writes';

// Join links (BLUEPRINT §5.2, §11.4, M10.14), in the user database under the write rules (writes.ts): the one-time QR
// codes that add a device to a sync chain. POST /join keeps a sync code that the device sealed with a key only the link
// carries, for 10 minutes, and answers the link's id; the first DELETE /join/:id answers the sealed bytes and deletes
// them in the same statement, so a link works once, and one left in a browser's History opens nothing. The database
// keeps the id's SHA-256, the sealed bytes and when they stop working: nothing it can open, and no id it answers to.

interface Api {
  Bindings: Env;
}

/** The rows a link costs: its row now, and its deletion later, which isn't counted then. */
const rowsEach = 2;

export const join = new Hono<Api>()
  .post('/', async (c) => {
    if (!(c.req.header('Content-Type') ?? '').startsWith('application/octet-stream')) {
      return badBody(c, [{ path: '', issue: 'Send the sealed code as application/octet-stream.' }]);
    }
    const body = await readBody(c, maxSealedCodeBytes);
    if (body instanceof Response) return body;
    if (body.byteLength === 0) {
      return badBody(c, [{ path: '', issue: 'The sealed code is empty.' }]);
    }

    const now = new Date();
    const db = c.env.USER_DB;
    const counted = await countWrite(db, 'sync', rowsEach, utcDay(now));
    if (!counted.allowed) return capReached(c, now);
    if (counted.size > storageCap) return storageFull(c, now);

    const id = newSecret();
    const expiresAt = utcTimestamp(new Date(now.getTime() + joinLinkMinutes * 60_000));
    await db
      .prepare('INSERT INTO join_links (id_hash, sealed, expires_at) VALUES (?, ?, ?)')
      .bind(await secretHash(id), toBase64(body), expiresAt)
      .run();
    return c.json({ data: { id, expiresAt }, meta: {} } satisfies JoinLinkBody, 201, {
      'Content-Type': jsonType,
      'Cache-Control': 'no-store',
    });
  })
  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    // Taken and deleted in one statement, so two devices can't both have it. A deletion isn't counted against the cap:
    // POST counted it.
    const row = /^[A-Za-z0-9_-]{22}$/.test(id)
      ? await c.env.USER_DB.prepare(
          'DELETE FROM join_links WHERE id_hash = ? RETURNING sealed, expires_at',
        )
          .bind(await secretHash(id))
          .first<{ sealed: string; expires_at: string }>()
      : null;
    // One past its 10 minutes goes all the same, and answers as one that's gone.
    if (row === null || row.expires_at <= utcTimestamp(new Date())) return linkGone(c);
    return c.body(fromBase64(row.sealed), 200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
  });

/** 404 not_found: no such link, or it was used or has expired. Nothing may cache it. */
function linkGone(c: Context<Api>): Response {
  return c.json(
    {
      error: {
        code: 'not_found',
        message:
          'This join link was used or has expired: show the code again on your other device.',
      },
    } satisfies ErrorBody,
    404,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
  );
}
