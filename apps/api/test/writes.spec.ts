import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanUp } from '../src/clean-up';
import worker from '../src/index';
import {
  bearerSecret,
  capReached,
  countWrite,
  dailyCaps,
  isSecretOf,
  newSecret,
  readJson,
  secondsToMidnight,
  secretHash,
  storageFull,
} from '../src/writes';

// The rules for every request that stores something (src/writes.ts, M10.1) and the nightly clean-up of the user
// database (src/clean-up.ts). The routes that store things come with their tasks (M10.2, M10.8, M10.10); here a route
// of the test's own reads its body.
const BASE = 'https://sub.simplely.ca/api/v1';

beforeEach(async () => {
  await env.USER_DB.exec('DELETE FROM daily_counts');
});

/** A route that reads a JSON body of at most 64 bytes, and answers with it. */
const echo = new Hono<{ Bindings: Env }>().post('/echo', async (c) => {
  const read = await readJson(c, 64);
  return read instanceof Response ? read : c.json(read.json);
});

function sendToEcho(body: BodyInit, headers: Record<string, string>) {
  return echo.fetch(new Request('https://test/echo', { method: 'POST', body, headers }), env);
}

/** A request through the Worker from `ip`, as Cloudflare's edge sends it. */
function fromIp(method: string, path: string, ip: string) {
  return worker.fetch(
    new Request(`${BASE}${path}`, { method, headers: { 'CF-Connecting-IP': ip } }),
    env,
  );
}

describe('the write limit', () => {
  it('holds an IP to 10 writes a minute, but not its reads or another IP', async () => {
    const statuses: number[] = [];
    for (let count = 0; count < 10; count++) {
      statuses.push((await fromIp('POST', '/nowhere', '203.0.113.20')).status);
    }
    const limited = await fromIp('PUT', '/nowhere', '203.0.113.20');
    const read = await fromIp('GET', '/nowhere', '203.0.113.20');
    const other = await fromIp('DELETE', '/nowhere', '203.0.113.21');

    // No route stores anything yet, so the writes the limit lets through are the JSON 404.
    expect(statuses).toEqual(Array(10).fill(404));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(await limited.json()).toEqual({
      error: { code: 'rate_limited', message: 'Too many requests. Try again in 60 seconds.' },
    });
    expect(read.status).toBe(404);
    expect(other.status).toBe(404);
  });
});

describe('bodies', () => {
  const json = { 'Content-Type': 'application/json' };

  it('reads a JSON body within its limit', async () => {
    const answer = await sendToEcho('{"feeds":[]}', json);

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ feeds: [] });
  });

  it('refuses a body whose Content-Length is over the limit', async () => {
    const answer = await sendToEcho(`"${'a'.repeat(70)}"`, json);

    expect(answer.status).toBe(413);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(await answer.json()).toEqual({
      error: { code: 'too_large', message: "The request's body is over its limit of 64 bytes." },
    });
  });

  it('refuses a longer body as it streams in, with no Content-Length', async () => {
    const chunk = new TextEncoder().encode('"' + 'a'.repeat(39));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const answer = await sendToEcho(body, json);

    expect(answer.status).toBe(413);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe('too_large');
  });

  it.each([
    [
      'not sent as JSON',
      '{}',
      { 'Content-Type': 'text/plain' },
      'Send the body as JSON, with Content-Type: application/json.',
    ],
    ['not JSON', '{feeds', json, "The body isn't JSON."],
    ['empty', '', json, "The body isn't JSON."],
    ['not UTF-8', new Uint8Array([0x22, 0xff, 0x22]), json, "The body isn't JSON."],
  ])('refuses a body that is %s', async (_name, body, headers, issue) => {
    const answer = await sendToEcho(body, headers);

    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({
      error: { code: 'bad_request', message: issue, details: [{ path: '', issue }] },
    });
  });
});

describe('the daily caps', () => {
  const day = '2026-10-29';

  it("counts each write's rows with its count's own, up to its kind's cap, per day", async () => {
    const counts = [
      await countWrite(env.USER_DB, 'report', dailyCaps.report - 2, day),
      await countWrite(env.USER_DB, 'report', 0, day),
      await countWrite(env.USER_DB, 'report', 0, day),
      await countWrite(env.USER_DB, 'cal', 2, day),
      await countWrite(env.USER_DB, 'report', 0, '2026-10-30'),
    ];

    expect(counts.map(({ allowed }) => allowed)).toEqual([true, true, false, true, true]);
    expect(counts[0].size).toBeGreaterThan(0);
    const { results } = await env.USER_DB.prepare(
      'SELECT day, kind, rows FROM daily_counts ORDER BY day, kind',
    ).all();
    expect(results).toEqual([
      { day, kind: 'cal', rows: 3 },
      { day, kind: 'report', rows: dailyCaps.report },
      { day: '2026-10-30', kind: 'report', rows: 1 },
    ]);
  });

  it("lets only one of two writes take a cap's last row", async () => {
    await countWrite(env.USER_DB, 'sync', dailyCaps.sync - 2, day);

    const both = await Promise.all([
      countWrite(env.USER_DB, 'sync', 0, day),
      countWrite(env.USER_DB, 'sync', 0, day),
    ]);

    expect(both.map(({ allowed }) => allowed).sort()).toEqual([false, true]);
  });

  it.each([
    ['a kind past its cap', capReached, 'Too many changes were stored today. Try again tomorrow.'],
    [
      'a full database',
      storageFull,
      'There is no room to store more right now. Try again tomorrow.',
    ],
  ])('answers %s with 503 until midnight UTC', async (_name, answer, message) => {
    const route = new Hono<{ Bindings: Env }>().get('/', (c) =>
      answer(c, new Date('2026-10-29T23:59:30Z')),
    );

    const response = await route.fetch(new Request('https://test/'), env);

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: { code: 'over_capacity', message } });
  });

  it('counts the seconds to midnight UTC, at least one', () => {
    expect(secondsToMidnight(new Date('2026-10-29T00:00:00Z'))).toBe(86_400);
    expect(secondsToMidnight(new Date('2026-10-29T23:59:59.500Z'))).toBe(1);
  });
});

describe('secrets', () => {
  it('makes random base64url secrets of 128 bits, or the bits asked for', () => {
    const secrets = [newSecret(), newSecret()];

    expect(secrets[0]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(secrets[1]).not.toBe(secrets[0]);
    expect(newSecret(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('keeps a hash that only its own secret matches', async () => {
    const secret = newSecret();
    const hash = await secretHash(secret);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await isSecretOf(secret, hash)).toBe(true);
    expect(await isSecretOf(newSecret(), hash)).toBe(false);
    expect(await isSecretOf(secret, hash.slice(1))).toBe(false);
    expect(await isSecretOf(secret, hash.toUpperCase())).toBe(false);
  });

  it.each([
    ['Bearer Jd8f2LqP0zXn5Vt7Bc3HyA', 'Jd8f2LqP0zXn5Vt7Bc3HyA'],
    ['Bearer short', undefined],
    ['Bearer Jd8f2LqP0zXn5Vt7Bc3Hy+', undefined],
    ['Basic Jd8f2LqP0zXn5Vt7Bc3HyA', undefined],
    [undefined, undefined],
  ])('reads the secret of Authorization: %s', async (authorization, secret) => {
    const read = new Hono<{ Bindings: Env }>().get('/', (c) => c.text(bearerSecret(c) ?? 'none'));
    const headers: Record<string, string> = authorization ? { Authorization: authorization } : {};

    const answer = await read.fetch(new Request('https://test/', { headers }), env);

    expect(await answer.text()).toBe(secret ?? 'none');
  });
});

describe('the nightly clean-up', () => {
  async function countDays(): Promise<string[]> {
    const { results } = await env.USER_DB.prepare('SELECT day FROM daily_counts ORDER BY day').all<{
      day: string;
    }>();
    return results.map(({ day }) => day);
  }

  beforeEach(async () => {
    for (const day of ['2026-10-27', '2026-10-28', '2026-10-29']) {
      await countWrite(env.USER_DB, 'cal', 1, day);
    }
  });

  it('deletes the daily counts before yesterday', async () => {
    await cleanUp(env.USER_DB, '2026-10-29');

    expect(await countDays()).toEqual(['2026-10-28', '2026-10-29']);
  });

  it('runs from the cron trigger, on its day in UTC', async () => {
    const context = createExecutionContext();

    await worker.scheduled(
      createScheduledController({ scheduledTime: new Date('2026-10-29T02:30:00Z') }),
      env,
      context,
    );
    await waitOnExecutionContext(context);

    expect(await countDays()).toEqual(['2026-10-28', '2026-10-29']);
  });
});
