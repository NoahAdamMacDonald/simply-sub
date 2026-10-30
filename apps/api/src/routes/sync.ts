import { addDays, maxSealedCopyBytes, type ErrorBody, type SyncWriteBody } from '@simply-sub/core';
import { Hono, type Context } from 'hono';
import {
  badBody,
  forbidden,
  jsonType,
  notModified,
  rateLimited,
  staleVersion,
  utcDay,
  utcTimestamp,
} from '../http';
import {
  bearerSecret,
  capReached,
  countWrite,
  isSecretOf,
  readBody,
  resourceAllowed,
  secretHash,
  storageCap,
  storageFull,
} from '../writes';

// Device sync (BLUEPRINT §5.2, §11.4, M10.8), in the user database under the write rules (writes.ts). A chain is the
// sealed copy its devices share, found by an id each device derives from the sync code, as it does the auth secret it
// shows (Authorization: Bearer). The database keeps the secret's SHA-256, the copy, its size, its version and when it
// changed: nothing it can read. GET reads the copy, its version as the ETag; PUT starts a chain (If-None-Match: *) or
// replaces the copy only if nobody wrote since the version it names (If-Match), one statement comparing and writing,
// so two devices can't both win; DELETE ends the chain for every device. A request without the secret learns nothing.

interface Api {
  Bindings: Env;
}

/** A chain is deleted this many days after its last write (the owner's choice, BLUEPRINT §14). */
const keptDays = 180;
/** The rows a write costs: the chain's and its index's. */
const rowsEach = 2;
const noSecret = "The auth secret is missing or isn't this sync chain's.";

/** A chain as the database keeps it. */
interface ChainRow {
  secret_hash: string;
  version: number;
  copy: string;
}

export const sync = new Hono<Api>()
  .get('/:chain', async (c) => {
    const chain = await knownChain(c);
    if (chain instanceof Response) return chain;
    const headers = { 'Cache-Control': 'no-store', ETag: `"${chain.row.version}"` };
    if (notModified(c, headers.ETag)) return c.body(null, 304, headers);
    return c.body(fromBase64(chain.row.copy), 200, {
      ...headers,
      'Content-Type': 'application/octet-stream',
    });
  })
  .put('/:chain', async (c) => {
    const secret = bearerSecret(c);
    if (secret === undefined) return forbidden(c, noSecret);
    const id = chainId(c);
    if (id === undefined) return chainGone(c);
    const start = c.req.header('If-None-Match')?.trim() === '*';
    const read = /^"([1-9][0-9]*)"$/.exec(c.req.header('If-Match')?.trim() ?? '')?.[1];
    if (!start && read === undefined) {
      return badBody(c, [
        {
          path: 'If-Match',
          issue: 'Send If-None-Match: * to start a chain, or If-Match with the version you read',
        },
      ]);
    }
    if (!(c.req.header('Content-Type') ?? '').startsWith('application/octet-stream')) {
      return badBody(c, [{ path: '', issue: 'Send the sealed copy as application/octet-stream.' }]);
    }
    if (!(await resourceAllowed(c.env, id))) return rateLimited(c);
    const body = await readBody(c, maxSealedCopyBytes);
    if (body instanceof Response) return body;
    if (body.byteLength === 0) return badBody(c, [{ path: '', issue: 'The copy is empty.' }]);

    const now = new Date();
    const today = utcDay(now);
    const db = c.env.USER_DB;
    // A write that can't be made is told why before it's counted: a device learns that its chain was deleted, or that
    // it must read again, even on a day at the cap. The statement below settles a race.
    const before = await refusal(c, secret, await chainState(db, id, today), start, read);
    if (before !== undefined) return before;
    const counted = await countWrite(db, 'sync', rowsEach, today);
    if (!counted.allowed) return capReached(c, now);
    if (start && counted.size > storageCap) return storageFull(c, now);

    const stamp = utcTimestamp(now);
    const values = [toBase64(body), body.byteLength, stamp, addDays(today, keptDays)];
    const written = start
      ? // A chain past its days that the night's clean-up hasn't deleted yet starts again, its version moving on.
        await db
          .prepare(
            `INSERT INTO sync_chains (id, secret_hash, version, copy, size, updated_at, expires_on)
             VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)
             ON CONFLICT (id) DO UPDATE SET secret_hash = excluded.secret_hash, version = sync_chains.version + 1,
               copy = excluded.copy, size = excluded.size, updated_at = excluded.updated_at,
               expires_on = excluded.expires_on
             WHERE sync_chains.expires_on <= ?7
             RETURNING version`,
          )
          .bind(id, await secretHash(secret), ...values, today)
          .first<{ version: number }>()
      : await db
          .prepare(
            `UPDATE sync_chains SET version = version + 1, copy = ?1, size = ?2, updated_at = ?3, expires_on = ?4
             WHERE id = ?5 AND secret_hash = ?6 AND version = ?7 AND expires_on > ?8
             RETURNING version`,
          )
          .bind(...values, id, await secretHash(secret), Number(read), today)
          .first<{ version: number }>();
    if (written === null) {
      // Another device wrote, or ended the chain, since the look above: say which, from the chain as it is now.
      return (
        (await refusal(c, secret, await chainState(db, id, today), start, read)) ??
        staleVersion(c, 'The sync chain changed while this was written: read it and try again.')
      );
    }
    const version = String(written.version);
    return c.json(
      { data: { version, updatedAt: stamp }, meta: {} } satisfies SyncWriteBody,
      start ? 201 : 200,
      { 'Content-Type': jsonType, 'Cache-Control': 'no-store', ETag: `"${version}"` },
    );
  })
  .delete('/:chain', async (c) => {
    const chain = await knownChain(c);
    if (chain instanceof Response) return chain;
    if (!(await resourceAllowed(c.env, chain.id))) return rateLimited(c);
    // Ending a chain is never refused for a cap: it only takes away what the caps counted in.
    await c.env.USER_DB.prepare('DELETE FROM sync_chains WHERE id = ?').bind(chain.id).run();
    return c.body(null, 204, { 'Cache-Control': 'no-store' });
  });

/** The chain a GET or DELETE names, once its auth secret is shown to be the chain's; else the 403 or 404. */
async function knownChain(c: Context<Api>): Promise<{ id: string; row: ChainRow } | Response> {
  const secret = bearerSecret(c);
  if (secret === undefined) return forbidden(c, noSecret);
  const id = chainId(c);
  const row = id === undefined ? null : await liveChain(c.env.USER_DB, id, utcDay(new Date()));
  if (id === undefined || row === null) return chainGone(c);
  if (!(await isSecretOf(secret, row.secret_hash))) return forbidden(c, noSecret);
  return { id, row };
}

/** The request's chain id, when it's one a sync code gives: 16 bytes as base64url. */
function chainId(c: Context<Api>): string | undefined {
  const id = c.req.param('chain') ?? '';
  return /^[A-Za-z0-9_-]{22}$/.test(id) ? id : undefined;
}

/**
 * Why a write can't be made to the chain as it is (`state`, null when there's none), if it can't: none to replace (404),
 * another chain's secret (403), one that exists already or has moved past the version read (412).
 */
async function refusal(
  c: Context<Api>,
  secret: string,
  state: Omit<ChainRow, 'copy'> | null,
  start: boolean,
  read: string | undefined,
): Promise<Response | undefined> {
  if (state === null) return start ? undefined : chainGone(c);
  if (!(await isSecretOf(secret, state.secret_hash))) return forbidden(c, noSecret);
  if (start) {
    return staleVersion(
      c,
      'This sync chain already exists: read it, merge, then write with If-Match.',
    );
  }
  if (String(state.version) !== read) {
    return staleVersion(
      c,
      `Another device wrote since version ${read}: read the chain, merge and try again.`,
    );
  }
  return undefined;
}

/** A chain's secret and version, when it's not past its days: what a write is checked against, without its copy. */
function chainState(
  db: D1Database,
  id: string,
  today: string,
): Promise<Omit<ChainRow, 'copy'> | null> {
  return db
    .prepare('SELECT secret_hash, version FROM sync_chains WHERE id = ? AND expires_on > ?')
    .bind(id, today)
    .first<Omit<ChainRow, 'copy'>>();
}

/** A chain not past its days. */
function liveChain(db: D1Database, id: string, today: string): Promise<ChainRow | null> {
  return db
    .prepare('SELECT secret_hash, version, copy FROM sync_chains WHERE id = ? AND expires_on > ?')
    .bind(id, today)
    .first<ChainRow>();
}

function chainGone(c: Context<Api>): Response {
  return c.json(
    {
      error: { code: 'not_found', message: "This sync chain doesn't exist or was deleted." },
    } satisfies ErrorBody,
    404,
    { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
  );
}

/** Bytes as base64, a chunk at a time: a MiB spread into one call would overflow the stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
