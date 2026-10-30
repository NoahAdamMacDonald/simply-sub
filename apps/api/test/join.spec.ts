import { joinLinkBodySchema, joinLinkMinutes, maxSealedCodeBytes } from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanUp } from '../src/clean-up';
import { utcDay, utcTimestamp } from '../src/http';
import worker from '../src/index';
import { dailyCaps } from '../src/writes';

// Join links' routes (src/routes/join.ts, M10.14) beyond the contract's examples: a link answers its sealed code once,
// to one of two devices that ask at once; not after its 10 minutes; the size and daily limits; the clean-up; that the
// server keeps no id it answers to; and that no id reaches a log.
const BASE = 'https://sub.simplely.ca/api/v1/join';

const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(async () => {
  errors.mockClear();
  await env.USER_DB.batch([
    env.USER_DB.prepare('DELETE FROM join_links'),
    env.USER_DB.prepare('DELETE FROM daily_counts'),
  ]);
});

/** A sealed code's length: a format byte, a 12-byte IV, the 32-byte code and the 16-byte tag. */
const sealed = () => crypto.getRandomValues(new Uint8Array(61));

async function send(
  method: string,
  at: string,
  { body, type = 'application/octet-stream' }: { body?: Uint8Array; type?: string } = {},
  bindings: Partial<Env> = {},
): Promise<Response> {
  return worker.fetch(
    new Request(at, {
      method,
      ...(body !== undefined && { headers: { 'Content-Type': type }, body }),
    }),
    { ...env, ...bindings },
  );
}

/** Makes a link for `code`, and answers its id. */
async function make(code: Uint8Array): Promise<string> {
  const answer = await send('POST', BASE, { body: code });
  expect(answer.status).toBe(201);
  return joinLinkBodySchema.parse(await answer.json()).data.id;
}

/** The sealed code a DELETE answers, or its status when it doesn't answer 200. */
async function take(id: string): Promise<Uint8Array | number> {
  const answer = await send('DELETE', `${BASE}/${id}`);
  return answer.status === 200 ? new Uint8Array(await answer.arrayBuffer()) : answer.status;
}

const links = async () =>
  (await env.USER_DB.prepare('SELECT COUNT(*) AS links FROM join_links').first<{ links: number }>())
    ?.links;

describe('POST /join', () => {
  it('keeps the sealed code for 10 minutes, and answers the link’s id, kept by no cache', async () => {
    const before = Date.now();
    const answer = await send('POST', BASE, { body: sealed() });

    expect(answer.status).toBe(201);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    const { id, expiresAt } = joinLinkBodySchema.parse(await answer.json()).data;
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const minutes = (Date.parse(expiresAt) - before) / 60_000;
    expect(minutes).toBeGreaterThan(joinLinkMinutes - 0.1);
    expect(minutes).toBeLessThanOrEqual(joinLinkMinutes + 0.1);
  });

  it('refuses a body of another type, an empty one or one over its limit, and keeps nothing', async () => {
    const statuses = [
      (await send('POST', BASE, { body: sealed(), type: 'application/json' })).status,
      (await send('POST', BASE, { body: new Uint8Array() })).status,
      (await send('POST', BASE, { body: new Uint8Array(maxSealedCodeBytes + 1) })).status,
    ];

    expect(statuses).toEqual([400, 400, 413]);
    expect(await links()).toBe(0);
  });

  it("answers 503 once the day's sync writes reach their cap, and keeps nothing", async () => {
    await env.USER_DB.prepare('INSERT INTO daily_counts (day, kind, rows) VALUES (?, ?, ?)')
      .bind(utcDay(new Date()), 'sync', dailyCaps.sync)
      .run();

    const answer = await send('POST', BASE, { body: sealed() });
    expect(answer.status).toBe(503);
    expect(await links()).toBe(0);
  });
});

describe('DELETE /join/:id', () => {
  it('answers the sealed code once, kept by no cache, then 404', async () => {
    const code = sealed();
    const id = await make(code);

    const answer = await send('DELETE', `${BASE}/${id}`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(code);

    expect(await take(id)).toBe(404);
    expect(await links()).toBe(0);
  });

  it('gives the code to only one of two devices that ask at once', async () => {
    const code = sealed();
    const id = await make(code);

    const answers = await Promise.all([take(id), take(id)]);
    expect(answers.filter((answer) => answer === 404)).toHaveLength(1);
    expect(answers.find((answer) => answer !== 404)).toEqual(code);
  });

  it('answers 404 after the link’s 10 minutes, deleting it all the same', async () => {
    const id = await make(sealed());
    await env.USER_DB.prepare('UPDATE join_links SET expires_at = ?')
      .bind(utcTimestamp(new Date(Date.now() - 1000)))
      .run();

    expect(await take(id)).toBe(404);
    expect(await links()).toBe(0);
  });

  it('answers 404 to an id there is no link for, and to a malformed one', async () => {
    await make(sealed());
    expect(await take('AAAAAAAAAAAAAAAAAAAAAA')).toBe(404);
    expect(await take('short')).toBe(404);
    expect(await links()).toBe(1);
  });

  it('answers the code even on a day at the cap: taking it only deletes', async () => {
    const id = await make(sealed());
    await env.USER_DB.prepare('UPDATE daily_counts SET rows = ?').bind(dailyCaps.sync).run();

    expect(await take(id)).toBeInstanceOf(Uint8Array);
  });
});

describe('the clean-up', () => {
  it('deletes the links that stopped working before the day began, and keeps the rest', async () => {
    const insert = env.USER_DB.prepare(
      "INSERT INTO join_links (id_hash, sealed, expires_at) VALUES (?, 'AA==', ?)",
    );
    await env.USER_DB.batch([
      insert.bind('yesterday', '2026-10-29T23:59:00Z'),
      insert.bind('today', '2026-10-30T00:05:00Z'),
    ]);

    await cleanUp(env.USER_DB, env.KV, '2026-10-30');
    const { results } = await env.USER_DB.prepare('SELECT id_hash FROM join_links').all();
    expect(results).toEqual([{ id_hash: 'today' }]);
  });
});

describe('what the server keeps', () => {
  it('is the sealed code under the id’s hash, and when it stops working: never the id', async () => {
    const code = sealed();
    const id = await make(code);

    const row = await env.USER_DB.prepare('SELECT * FROM join_links').first<
      Record<string, unknown>
    >();
    expect(Object.keys(row ?? {}).sort()).toEqual(['expires_at', 'id_hash', 'sealed']);
    expect(JSON.stringify(row)).not.toContain(id);
    expect(Uint8Array.from(atob(String(row?.['sealed'])), (char) => char.charCodeAt(0))).toEqual(
      code,
    );
  });
});

describe('the logs', () => {
  it('never name a link, when a route fails', async () => {
    const broken = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('D1 is down');
        },
      },
    );
    const userDb = { USER_DB: broken as unknown as D1Database };
    const id = 'Q2hhaW5MaW5rSWQwMDAwMA';

    const answers = [
      await send('POST', BASE, { body: sealed() }, userDb),
      await send('DELETE', `${BASE}/${id}`, {}, userDb),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([500, 500]);
    expect(errors).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(id);
  });
});
