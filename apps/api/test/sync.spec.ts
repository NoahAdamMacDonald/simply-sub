import { maxSealedCopyBytes, type SyncWriteBody } from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanUp } from '../src/clean-up';
import { utcDay } from '../src/http';
import worker from '../src/index';
import { dailyCaps } from '../src/writes';
import { freshRateLimitWindow } from './rate-limit-window';

// Device sync's routes (src/routes/sync.ts, M10.8) beyond the contract's examples: writes conditional on the version
// read, so two devices can't both win; the auth secret; the size, rate and daily limits; a chain past its days and the
// clean-up; that the server keeps nothing it can read; and that no chain or secret reaches a log.
const BASE = 'https://sub.simplely.ca/api/v1/sync';
// The secret of the code 0x00..0x1f (the web app's sync-crypto.spec.ts derives it). Each test has a chain of its own,
// since a chain takes 6 writes a minute.
const secret = 'eB-fvhcPV5EjET-L_3Eq09laqjt3_jCD0EV2QhRDeDg';
let chain: string;
let url: string;

const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(async () => {
  errors.mockClear();
  const id = crypto.getRandomValues(new Uint8Array(16));
  chain = btoa(String.fromCharCode(...id))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  url = `${BASE}/${chain}`;
  await env.USER_DB.batch([
    env.USER_DB.prepare('DELETE FROM sync_chains'),
    env.USER_DB.prepare('DELETE FROM daily_counts'),
  ]);
});

const bytes = (text: string) => new TextEncoder().encode(text);

async function send(
  method: string,
  {
    body,
    key = secret,
    headers = {},
  }: { body?: Uint8Array; key?: string | null; headers?: Record<string, string> } = {},
  bindings: Partial<Env> = {},
  at = url,
): Promise<Response> {
  return worker.fetch(
    new Request(at, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/octet-stream' }),
        ...(key !== null && { Authorization: `Bearer ${key}` }),
        ...headers,
      },
      ...(body !== undefined && { body }),
    }),
    { ...env, ...bindings },
  );
}

const start = (body: Uint8Array, options: { key?: string } = {}) =>
  send('PUT', { body, ...options, headers: { 'If-None-Match': '*' } });
const replace = (body: Uint8Array, version: string) =>
  send('PUT', { body, headers: { 'If-Match': `"${version}"` } });

/** The copy a GET reads, as text, with its ETag; or its status when it doesn't answer 200. */
async function read(): Promise<{ copy: string; etag: string | null } | number> {
  const answer = await send('GET');
  if (answer.status !== 200) return answer.status;
  // Its bytes decoded: workerd warns about text() on an octet-stream body.
  return {
    copy: new TextDecoder().decode(await answer.arrayBuffer()),
    etag: answer.headers.get('ETag'),
  };
}

const chains = async () =>
  (
    await env.USER_DB.prepare('SELECT COUNT(*) AS chains FROM sync_chains').first<{
      chains: number;
    }>()
  )?.chains;

describe('PUT /sync/:chain', () => {
  it('starts a chain with If-None-Match: *, then replaces its copy only from the version read', async () => {
    const started = await start(bytes('first'));
    expect(started.status).toBe(201);
    expect(started.headers.get('ETag')).toBe('"1"');
    expect((await started.json<SyncWriteBody>()).data.version).toBe('1');
    expect(await read()).toEqual({ copy: 'first', etag: '"1"' });

    const replaced = await replace(bytes('second'), '1');
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get('ETag')).toBe('"2"');

    // Another device still on version 1 changes nothing, and is told to read again.
    const stale = await replace(bytes('stale'), '1');
    expect(stale.status).toBe(412);
    expect((await stale.json<{ error: { code: string } }>()).error.code).toBe('stale_version');
    expect(await read()).toEqual({ copy: 'second', etag: '"2"' });
  });

  it('lets only one of two devices that read the same version win', async () => {
    await start(bytes('first'));
    const answers = await Promise.all([
      replace(bytes('from the laptop'), '1'),
      replace(bytes('from the phone'), '1'),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 412]);
    const winner = answers[0].status === 200 ? 'from the laptop' : 'from the phone';
    expect(await read()).toEqual({ copy: winner, etag: '"2"' });
  });

  it('refuses a copy over 1 MiB, and keeps nothing', async () => {
    const answer = await start(new Uint8Array(maxSealedCopyBytes + 1));
    expect(answer.status).toBe(413);
    expect(await chains()).toBe(0);
    expect((await start(new Uint8Array(maxSealedCopyBytes))).status).toBe(201);
  });

  it('refuses a write that names no version, a body of another type, or an empty copy', async () => {
    const statuses = [
      (await send('PUT', { body: bytes('copy') })).status,
      (
        await send('PUT', {
          body: bytes('copy'),
          headers: { 'If-None-Match': '*', 'Content-Type': 'application/json' },
        })
      ).status,
      (await start(new Uint8Array())).status,
    ];
    expect(statuses).toEqual([400, 400, 400]);
    expect(await chains()).toBe(0);
  });

  it('refuses a second start, and another secret, or none, anything at all', async () => {
    await start(bytes('first'));
    const other = 'otherSecret0000000000000000000000000000000';

    expect((await start(bytes('again'))).status).toBe(412);
    expect((await start(bytes('again'), { key: other })).status).toBe(403);
    const refused = [
      await send('GET', { key: other }),
      await send('GET', { key: null }),
      await send('PUT', { key: other, body: bytes('x'), headers: { 'If-Match': '"1"' } }),
      await send('DELETE', { key: other }),
      await send('DELETE', { key: null }),
    ];
    expect(refused.map((answer) => answer.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await read()).toEqual({ copy: 'first', etag: '"1"' });
  });

  it('answers 404 to a write to a chain there is none of, and to a malformed id', async () => {
    expect((await replace(bytes('copy'), '1')).status).toBe(404);
    expect(
      (
        await send(
          'PUT',
          { body: bytes('x'), headers: { 'If-None-Match': '*' } },
          {},
          `${BASE}/short`,
        )
      ).status,
    ).toBe(404);
  });

  it('holds a chain to 6 writes a minute', async () => {
    await freshRateLimitWindow();
    const statuses = [(await start(bytes('v1'))).status];
    for (let version = 1; version <= 6; version++) {
      statuses.push((await replace(bytes(`v${version + 1}`), String(version))).status);
    }

    expect(statuses).toEqual([201, 200, 200, 200, 200, 200, 429]);
  });

  it("answers 503 once the day's writes reach their cap, and keeps nothing", async () => {
    await env.USER_DB.prepare('INSERT INTO daily_counts (day, kind, rows) VALUES (?, ?, ?)')
      .bind(utcDay(new Date()), 'sync', dailyCaps.sync)
      .run();

    const answer = await start(bytes('first'));
    expect(answer.status).toBe(503);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe('over_capacity');
    expect(await chains()).toBe(0);
  });
});

describe('GET /sync/:chain', () => {
  it('answers 304 to the version it gave, and keeps no copy in a cache', async () => {
    await start(bytes('first'));
    const answer = await send('GET', { headers: { 'If-None-Match': '"1"' } });
    expect(answer.status).toBe(304);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect((await send('GET', { headers: { 'If-None-Match': '"0"' } })).status).toBe(200);
  });
});

describe('DELETE /sync/:chain', () => {
  it('ends the chain for every device, even at the day’s cap, and a new start begins again', async () => {
    await start(bytes('first'));
    await env.USER_DB.prepare(
      'INSERT INTO daily_counts (day, kind, rows) VALUES (?, ?, ?) ON CONFLICT (day, kind) DO UPDATE SET rows = excluded.rows',
    )
      .bind(utcDay(new Date()), 'sync', dailyCaps.sync)
      .run();

    expect((await send('DELETE')).status).toBe(204);
    expect(await read()).toBe(404);
    expect((await replace(bytes('late'), '1')).status).toBe(404);
    await env.USER_DB.prepare('DELETE FROM daily_counts').run();
    expect((await start(bytes('anew'))).headers.get('ETag')).toBe('"1"');
  });
});

describe('a chain past its days', () => {
  it('is gone to a read, starts again with its version moving on, and the clean-up deletes it', async () => {
    const today = utcDay(new Date());
    await start(bytes('first'));
    await replace(bytes('second'), '1');
    const expire = () =>
      env.USER_DB.prepare('UPDATE sync_chains SET expires_on = ?').bind(today).run();

    await expire();
    expect(await read()).toBe(404);
    const again = await start(bytes('anew'));
    expect(again.status).toBe(201);
    // Not "1": a device still holding version 1 of the old copy can't write over the new one.
    expect(again.headers.get('ETag')).toBe('"3"');

    await expire();
    await cleanUp(env.USER_DB, today);
    expect(await chains()).toBe(0);
  });
});

describe('what the server keeps', () => {
  it('is the sealed copy and the secret’s hash: no list name, amount or record id, nor the secret', async () => {
    // The device seals the copy (the web app's sync-crypto.ts); AES-GCM here stands in.
    const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
    const copy = JSON.stringify({
      data: { lists: [{ id: listId, name: 'Work Related' }], items: [{ amount: 19.99 }] },
    });
    const key = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
    ])) as CryptoKey;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes(copy)),
    );
    expect((await start(sealed)).status).toBe(201);

    const row = await env.USER_DB.prepare('SELECT * FROM sync_chains').first<
      Record<string, unknown>
    >();
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'copy',
      'expires_on',
      'id',
      'secret_hash',
      'size',
      'updated_at',
      'version',
    ]);
    const stored = JSON.stringify(row) + atob(String(row?.['copy']));
    for (const text of ['Work Related', '19.99', listId, secret]) {
      expect(stored).not.toContain(text);
    }
    expect(row?.['size']).toBe(sealed.byteLength);
  });
});

describe('the logs', () => {
  it('never name a chain or a secret, when a route fails', async () => {
    const broken = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('D1 is down');
        },
      },
    );
    const userDb = { USER_DB: broken as unknown as D1Database };

    const answers = [
      await send('GET', {}, userDb),
      await send('PUT', { body: bytes('copy'), headers: { 'If-None-Match': '*' } }, userDb),
      await send('DELETE', {}, userDb),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([500, 500, 500]);
    expect(errors).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(errors.mock.calls);
    for (const text of [chain, secret]) expect(logged).not.toContain(text);
  });
});
