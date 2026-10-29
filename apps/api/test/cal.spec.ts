import { addDays, type CalendarFeed, type CalendarSetBody } from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanUp } from '../src/clean-up';
import { utcDay } from '../src/http';
import worker from '../src/index';
import { dailyCaps } from '../src/writes';
import { freshRateLimitWindow } from './rate-limit-window';

// The live calendar's routes (src/routes/cal.ts, M10.2) beyond the contract's examples: a set's calendars and what
// each holds, what PUT keeps, revokes and adds, the manage key, the limits per feed and per set, the daily cap, the
// clean-up, and that no token, key or id reaches a log.
const BASE = 'https://sub.simplely.ca/api/v1/cal';

const netflix = { uid: 'netflix000000001', date: '2026-11-12', title: 'Netflix: $19.94' };
const mullvad = { uid: 'mullvad000000001', date: '2027-01-20', title: 'Renew Mullvad VPN: €60.00' };
const crave = { uid: 'crave00000000001', date: '2026-10-31', title: 'Crave: $22.00' };

const everything: CalendarFeed = { name: 'Simply Sub', events: [netflix, mullvad, crave] };
const family: CalendarFeed = { name: 'Simply Sub: Family', color: '#1E88E5', events: [netflix] };
const noTag: CalendarFeed = { name: 'Simply Sub: No tag', events: [mullvad, crave] };

const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(async () => {
  errors.mockClear();
  await env.USER_DB.batch([
    env.USER_DB.prepare('DELETE FROM cal_feeds'),
    env.USER_DB.prepare('DELETE FROM cal_sets'),
    env.USER_DB.prepare('DELETE FROM daily_counts'),
  ]);
});

async function send(
  method: string,
  url: string,
  {
    body,
    key,
    headers = {},
  }: { body?: unknown; key?: string; headers?: Record<string, string> } = {},
  bindings: Partial<Env> = {},
): Promise<Response> {
  return worker.fetch(
    new Request(url, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(key !== undefined && { Authorization: `Bearer ${key}` }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    { ...env, ...bindings },
  );
}

async function createSet(feeds: CalendarFeed[] = [everything, family, noTag]) {
  const answer = await send('POST', BASE, { body: { feeds } });
  expect(answer.status).toBe(201);
  return (await answer.json<CalendarSetBody>()).data;
}

/** The summaries of a feed's events, or its status when it doesn't answer 200. */
async function summaries(url: string): Promise<string[] | number> {
  const answer = await send('GET', url);
  if (answer.status !== 200) return answer.status;
  return [...(await answer.text()).matchAll(/^SUMMARY:(.*)\r$/gm)].map(([, summary]) => summary);
}

describe('POST /cal', () => {
  it("makes a calendar of each feed, holding only that feed's payments", async () => {
    const set = await createSet();

    expect(set.feeds.map((feed) => feed.eventCount)).toEqual([3, 1, 2]);
    expect(await summaries(set.feeds[0].url)).toEqual([
      'Netflix: $19.94',
      'Renew Mullvad VPN: €60.00',
      'Crave: $22.00',
    ]);
    expect(await summaries(set.feeds[1].url)).toEqual(['Netflix: $19.94']);
    expect(await summaries(set.feeds[2].url)).toEqual([
      'Renew Mullvad VPN: €60.00',
      'Crave: $22.00',
    ]);
    expect(set.feeds[1].webcalUrl).toBe(set.feeds[1].url.replace('https:', 'webcal:'));
  });

  it('keeps no token, key or link: only their hashes', async () => {
    const set = await createSet();
    const { results } = await env.USER_DB.prepare(
      'SELECT s.*, f.* FROM cal_sets s JOIN cal_feeds f ON f.set_id = s.id',
    ).all();
    const stored = JSON.stringify(results);

    for (const secret of [set.manageKey, ...set.feeds.map((feed) => feed.token)]) {
      expect(stored).not.toContain(secret);
    }
    expect(stored).not.toContain('/api/v1/cal/');
  });

  it("refuses a new set's feed that has a token, as it can't have one yet", async () => {
    const answer = await send('POST', BASE, {
      body: { feeds: [{ ...family, token: 'k7Qm2Zp9XvT4bN8cR1sW0a' }] },
    });

    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({
      error: { details: [{ path: 'feeds.0.token', issue: "A new set's feeds have no token yet" }] },
    });
  });

  it('refuses a body over 512 kB, and writes nothing', async () => {
    const title = 'x'.repeat(120);
    const events = Array.from({ length: 2000 }, (_, index) => ({
      uid: `event${String(index).padStart(11, '0')}`,
      date: '2026-11-12',
      title,
    }));
    const answer = await send('POST', BASE, {
      body: { feeds: [{ name: 'Simply Sub', events }], pad: 'x'.repeat(300_000) },
    });

    expect(answer.status).toBe(413);
    expect(
      (await env.USER_DB.prepare('SELECT COUNT(*) AS sets FROM cal_sets').first<{ sets: number }>())
        ?.sets,
    ).toBe(0);
  });

  it("answers 503 once the day's writes reach their cap, and stores nothing", async () => {
    await env.USER_DB.prepare('INSERT INTO daily_counts (day, kind, rows) VALUES (?, ?, ?)')
      .bind(utcDay(new Date()), 'cal', dailyCaps.cal)
      .run();

    const answer = await send('POST', BASE, { body: { feeds: [family] } });

    expect(answer.status).toBe(503);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe('over_capacity');
    expect(
      (await env.USER_DB.prepare('SELECT COUNT(*) AS sets FROM cal_sets').first<{ sets: number }>())
        ?.sets,
    ).toBe(0);
  });
});

describe('GET /cal/:token.ics', () => {
  it('answers 304 to the ETag it gave, and revalidates every time', async () => {
    const [feed] = (await createSet()).feeds;
    const first = await send('GET', feed.url);
    const again = await send('GET', feed.url, {
      headers: { 'If-None-Match': first.headers.get('ETag') ?? '' },
    });

    expect(first.headers.get('Cache-Control')).toBe('no-cache');
    expect(first.headers.get('ETag')).toMatch(/^"[0-9a-f]{16}"$/);
    expect(again.status).toBe(304);
  });

  it('holds each feed to 30 fetches a minute, but not an IP, which calendar apps share', async () => {
    await freshRateLimitWindow();
    const set = await createSet();
    const fromOneIp = (url: string) =>
      send('GET', url, { headers: { 'CF-Connecting-IP': '198.51.100.7' } });

    const statuses: number[] = [];
    for (let fetch = 0; fetch < 30; fetch++) {
      for (const feed of set.feeds) statuses.push((await fromOneIp(feed.url)).status);
    }

    // 90 from one IP, over its 60 a minute, and each feed at its 30.
    expect(statuses.filter((status) => status !== 200)).toEqual([]);
    expect((await fromOneIp(set.feeds[0].url)).status).toBe(429);
  });

  it.each([
    ['a token of the wrong form', `${BASE}/short.ics`],
    ['a path without .ics', `${BASE}/k7Qm2Zp9XvT4bN8cR1sW0a`],
  ])('answers 404 to %s', async (_name, url) => {
    expect((await send('GET', url)).status).toBe(404);
  });
});

describe('PUT /cal/:id', () => {
  it("keeps a kept feed's link, revokes the ones left out and adds the new", async () => {
    const set = await createSet();
    const [all, kids, rest] = set.feeds;
    const work: CalendarFeed = { name: 'Simply Sub: Work', color: '#E53935', events: [crave] };

    const answer = await send('PUT', `${BASE}/${set.id}`, {
      key: set.manageKey,
      body: {
        feeds: [
          { ...everything, token: all.token, events: [netflix] },
          { ...noTag, token: rest.token },
          work,
        ],
      },
    });

    expect(answer.status).toBe(200);
    const { data } = await answer.json<{ data: CalendarSetBody['data'] }>();
    expect(data.feeds.slice(0, 2).map((feed) => feed.url)).toEqual([all.url, rest.url]);
    expect(data.feeds[2].token).not.toBe(kids.token);
    expect(await summaries(all.url)).toEqual(['Netflix: $19.94']);
    expect(await summaries(kids.url)).toBe(404);
    expect(await summaries(data.feeds[2].url)).toEqual(['Crave: $22.00']);
  });

  it("leaves a feed that hasn't changed as it was, and starts the set's 180 days again", async () => {
    const set = await createSet();
    const before = await send('GET', set.feeds[1].url);
    await env.USER_DB.prepare('UPDATE cal_sets SET expires_on = ?')
      .bind(addDays(utcDay(new Date()), 5))
      .run();

    await send('PUT', `${BASE}/${set.id}`, {
      key: set.manageKey,
      body: {
        feeds: set.feeds.map((feed, index) => ({
          ...[everything, family, noTag][index],
          token: feed.token,
        })),
      },
    });

    const after = await send('GET', set.feeds[1].url);
    expect(after.headers.get('ETag')).toBe(before.headers.get('ETag'));
    expect(await after.text()).toBe(await before.text());
    const expiry = await env.USER_DB.prepare('SELECT expires_on FROM cal_sets').first<{
      expires_on: string;
    }>();
    expect(expiry?.expires_on).toBe(addDays(utcDay(new Date()), 180));
  });

  it.each([
    ['without a key', undefined, 403],
    ['with another key', 'Jd8f2LqP0zXn5Vt7Bc3HyA', 403],
  ])('refuses a change %s, and changes nothing', async (_name, key, status) => {
    const set = await createSet();

    const answer = await send('PUT', `${BASE}/${set.id}`, { key, body: { feeds: [family] } });

    expect(answer.status).toBe(status);
    expect(await summaries(set.feeds[0].url)).toHaveLength(3);
  });

  it('answers 404 for a set there is none of', async () => {
    const answer = await send('PUT', `${BASE}/Qx3Lm8Rt5Vw2Yz7Bd4Gh1J`, {
      key: 'Jd8f2LqP0zXn5Vt7Bc3HyA',
      body: { feeds: [family] },
    });

    expect(answer.status).toBe(404);
  });

  it("refuses another set's feed", async () => {
    const mine = await createSet();
    const theirs = await createSet([family]);

    const answer = await send('PUT', `${BASE}/${mine.id}`, {
      key: mine.manageKey,
      body: { feeds: [{ ...family, token: theirs.feeds[0].token }] },
    });

    expect(answer.status).toBe(400);
    expect(await summaries(theirs.feeds[0].url)).toEqual(['Netflix: $19.94']);
  });

  it('holds a set to 6 writes a minute', async () => {
    await freshRateLimitWindow();
    const set = await createSet([family]);
    const statuses: number[] = [];
    for (let write = 0; write < 7; write++) {
      statuses.push(
        (await send('PUT', `${BASE}/${set.id}`, { key: set.manageKey, body: { feeds: [family] } }))
          .status,
      );
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });
});

describe('DELETE /cal/:id', () => {
  it('revokes every calendar of the set, and keeps nothing of it', async () => {
    const set = await createSet();

    const answer = await send('DELETE', `${BASE}/${set.id}`, { key: set.manageKey });

    expect(answer.status).toBe(204);
    for (const feed of set.feeds) expect(await summaries(feed.url)).toBe(404);
    const left = await env.USER_DB.prepare(
      'SELECT (SELECT COUNT(*) FROM cal_sets) AS sets, (SELECT COUNT(*) FROM cal_feeds) AS feeds',
    ).first();
    expect(left).toEqual({ sets: 0, feeds: 0 });
  });

  it("revokes even when the day's writes are at their cap", async () => {
    const set = await createSet([family]);
    await env.USER_DB.prepare('UPDATE daily_counts SET rows = ?').bind(dailyCaps.cal).run();

    expect((await send('DELETE', `${BASE}/${set.id}`, { key: set.manageKey })).status).toBe(204);
  });

  it('refuses another key, and deletes nothing', async () => {
    const set = await createSet([family]);

    expect(
      (await send('DELETE', `${BASE}/${set.id}`, { key: 'Jd8f2LqP0zXn5Vt7Bc3HyA' })).status,
    ).toBe(403);
    expect(await summaries(set.feeds[0].url)).toEqual(['Netflix: $19.94']);
  });
});

describe('the clean-up', () => {
  it('deletes the sets that have expired, with their calendars, and keeps the rest', async () => {
    const old = await createSet([family]);
    const current = await createSet([noTag]);
    await env.USER_DB.prepare('UPDATE cal_sets SET expires_on = ? WHERE id = ?')
      .bind(utcDay(new Date()), old.id)
      .run();

    await cleanUp(env.USER_DB, utcDay(new Date()));

    expect(await summaries(old.feeds[0].url)).toBe(404);
    expect(await summaries(current.feeds[0].url)).toEqual([
      'Renew Mullvad VPN: €60.00',
      'Crave: $22.00',
    ]);
    expect(
      (
        await env.USER_DB.prepare('SELECT COUNT(*) AS feeds FROM cal_feeds').first<{
          feeds: number;
        }>()
      )?.feeds,
    ).toBe(1);
  });
});

describe('the logs', () => {
  it('never name a token, a key or a set, when a route fails', async () => {
    const broken = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('D1 is down');
        },
      },
    );
    const token = 'k7Qm2Zp9XvT4bN8cR1sW0a';
    const key = 'Jd8f2LqP0zXn5Vt7Bc3HyA';
    const id = 'Qx3Lm8Rt5Vw2Yz7Bd4Gh1J';
    const userDb = { USER_DB: broken as unknown as D1Database };

    const answers = [
      await send('GET', `${BASE}/${token}.ics`, {}, userDb),
      await send('PUT', `${BASE}/${id}`, { key, body: { feeds: [family] } }, userDb),
      await send('DELETE', `${BASE}/${id}`, { key }, userDb),
      await send('POST', BASE, { body: { feeds: [family] } }, userDb),
    ];

    expect(answers.map((answer) => answer.status)).toEqual([500, 500, 500, 500]);
    expect(errors).toHaveBeenCalledTimes(4);
    const logged = JSON.stringify(errors.mock.calls);
    for (const secret of [token, key, id]) expect(logged).not.toContain(secret);
  });
});
