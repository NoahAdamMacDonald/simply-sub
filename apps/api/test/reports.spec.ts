import { reportKey, type ErrorBody, type ReportedPlan, type ReportedPrice } from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanUp, type ReportsKv } from '../src/clean-up';
import { utcDay } from '../src/http';
import worker from '../src/index';
import { countWrite, dailyCaps } from '../src/writes';
import { freshRateLimitWindow } from './rate-limit-window';
import { catalogSnapshot, seedCatalog } from './seeded-catalog';

// "Report a wrong price" (src/routes/reports.ts, M10.10): a report counted, a row per plan, country, problem and price
// with nothing about its sender; the refusals; the limits; and the nightly hand-over to the bot's KV (src/clean-up.ts).

const BASE = 'https://sub.simplely.ca/api/v1/reports';
const standard = {
  amount: 20.99,
  currency: 'CAD',
  interval: 'month',
  intervalCount: 1,
} satisfies ReportedPrice;
const priceReport = { plan: 'netflix.standard', country: 'CA', problem: 'price', price: standard };

beforeAll(() => seedCatalog(catalogSnapshot('abc1234')));

beforeEach(async () => {
  await env.USER_DB.batch([
    env.USER_DB.prepare('DELETE FROM price_reports'),
    env.USER_DB.prepare('DELETE FROM daily_counts'),
  ]);
});

/** POSTs `body` as JSON (or `raw` as it is), from `ip` when given, as Cloudflare's edge would say. */
async function post(
  body: unknown,
  { ip, raw }: { ip?: string; raw?: string } = {},
): Promise<Response> {
  return worker.fetch(
    new Request(BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ip !== undefined && { 'CF-Connecting-IP': ip }),
      },
      body: raw ?? JSON.stringify(body),
    }),
    env,
  );
}

/** A random IP of the documentation range, so each test's limits start afresh. */
const someIp = () => `203.0.113.${Math.floor(Math.random() * 254) + 1}`;

/** A price_reports row. */
interface Row {
  plan: string;
  country: string;
  problem: string;
  price: string;
  count: number;
  first_day: string;
  last_day: string;
}

async function rows(): Promise<Row[]> {
  const { results } = await env.USER_DB.prepare(
    'SELECT * FROM price_reports ORDER BY problem, price',
  ).all<Row>();
  return results;
}

describe('POST /reports', () => {
  it('counts a report, a row per plan, country, problem and price, with nothing about its sender', async () => {
    const today = utcDay(new Date());
    const answer = await post(priceReport, { ip: someIp() });
    expect(answer.status).toBe(202);
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(await answer.text()).toBe('');
    expect((await post(priceReport)).status).toBe(202);
    expect(
      (await post({ plan: 'netflix.standard', country: 'CA', problem: 'discontinued' })).status,
    ).toBe(202);

    expect(await rows()).toEqual([
      {
        plan: 'netflix.standard',
        country: 'CA',
        problem: 'discontinued',
        price: '',
        count: 1,
        first_day: today,
        last_day: today,
      },
      {
        plan: 'netflix.standard',
        country: 'CA',
        problem: 'price',
        price: JSON.stringify(standard),
        count: 2,
        first_day: today,
        last_day: today,
      },
    ]);
  });

  it('refuses an unknown plan, a bad price, free text or anything else unasked, counting nothing', async () => {
    const refused = async (body: unknown, raw?: string) => {
      const answer = await post(body, { raw });
      expect(answer.status).toBe(400);
      return ((await answer.json()) as ErrorBody).error.details;
    };
    expect(await refused({ ...priceReport, plan: 'netflix.ultra' })).toEqual([
      { path: 'plan', issue: 'The catalog has no plan netflix.ultra.' },
    ]);
    expect(await refused({ ...priceReport, price: { ...standard, amount: -1 } })).toEqual([
      { path: 'price.amount', issue: 'Must be more than 0' },
    ]);
    expect(await refused({ ...priceReport, comment: 'My bill went up' })).toEqual([
      { path: '', issue: 'Unrecognized key: "comment"' },
    ]);
    expect(await refused({ ...priceReport, country: 'UK' })).toEqual([
      { path: 'country', issue: 'Use a two-letter ISO 3166-1 country code in capitals (CA, GB)' },
    ]);
    expect(await refused(undefined, 'not json')).toEqual([
      { path: '', issue: "The body isn't JSON." },
    ]);

    expect(await rows()).toEqual([]);
    expect(await env.USER_DB.prepare('SELECT count(*) AS n FROM daily_counts').first('n')).toBe(0);
  });

  it('holds an IP to 3 reports a minute, but not another IP', async () => {
    await freshRateLimitWindow();
    const ip = someIp();
    for (let sent = 0; sent < 3; sent++) expect((await post(priceReport, { ip })).status).toBe(202);
    const limited = await post(priceReport, { ip });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as ErrorBody).error.code).toBe('rate_limited');
    expect((await post(priceReport, { ip: `${ip}0` })).status).toBe(202);
  });

  it('takes 500 a day, the cap’s 1,000 rows at two a report, then says so until midnight UTC', async () => {
    const today = utcDay(new Date());
    // 499 reports' rows counted already.
    await countWrite(env.USER_DB, 'report', dailyCaps.report - 4, today);
    expect((await post(priceReport)).status).toBe(202);
    const refused = await post(priceReport);
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as ErrorBody).error.code).toBe('over_capacity');
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await rows())[0]?.count).toBe(1);
  });
});

describe('the nightly hand-over', () => {
  /** Counts reports as POST /reports would have, on their days. */
  async function counted(
    rowsToAdd: {
      plan: string;
      problem?: string;
      price?: string;
      count: number;
      days: [string, string];
    }[],
  ): Promise<void> {
    await env.USER_DB.batch(
      rowsToAdd.map(({ plan, problem = 'price', price = JSON.stringify(standard), count, days }) =>
        env.USER_DB.prepare(
          `INSERT INTO price_reports (plan, country, problem, price, count, first_day, last_day)
           VALUES (?, 'CA', ?, ?, ?, ?, ?)`,
        ).bind(plan, problem, price, count, ...days),
      ),
    );
  }

  const kept = async (plan: string) =>
    JSON.parse((await env.KV.get(reportKey(plan))) ?? 'null') as ReportedPlan | null;

  beforeEach(async () => {
    for (const plan of ['netflix.standard', 'netflix.premium', 'spotify.premium-individual']) {
      await env.KV.delete(reportKey(plan));
    }
  });

  it('moves the reports counted before today to the bot’s KV, a key per plan, added to what it holds', async () => {
    await counted([
      { plan: 'netflix.standard', count: 2, days: ['2026-10-27', '2026-10-28'] },
      {
        plan: 'netflix.standard',
        problem: 'discontinued',
        price: '',
        count: 1,
        days: ['2026-10-28', '2026-10-28'],
      },
      { plan: 'netflix.premium', count: 4, days: ['2026-10-28', '2026-10-28'] },
      // Still being counted today: it waits for the next night.
      { plan: 'spotify.premium-individual', count: 1, days: ['2026-10-29', '2026-10-29'] },
    ]);
    await env.KV.put(
      reportKey('netflix.standard'),
      JSON.stringify({
        plan: 'netflix.standard',
        reports: [
          {
            country: 'CA',
            problem: 'price',
            price: standard,
            count: 3,
            first: '2026-10-20',
            last: '2026-10-21',
          },
        ],
      } satisfies ReportedPlan),
    );

    await cleanUp(env.USER_DB, env.KV, '2026-10-29');

    expect(await kept('netflix.standard')).toEqual({
      plan: 'netflix.standard',
      reports: [
        {
          country: 'CA',
          problem: 'price',
          price: standard,
          count: 5,
          first: '2026-10-20',
          last: '2026-10-28',
        },
        {
          country: 'CA',
          problem: 'discontinued',
          count: 1,
          first: '2026-10-28',
          last: '2026-10-28',
        },
      ],
    });
    expect(await kept('netflix.premium')).toEqual({
      plan: 'netflix.premium',
      reports: [
        {
          country: 'CA',
          problem: 'price',
          price: standard,
          count: 4,
          first: '2026-10-28',
          last: '2026-10-28',
        },
      ],
    });
    expect(await kept('spotify.premium-individual')).toBeNull();
    expect((await rows()).map((row) => row.plan)).toEqual(['spotify.premium-individual']);
  });

  it('gives a plan its rows back when its key can’t be written, for the next night', async () => {
    await counted([{ plan: 'netflix.standard', count: 2, days: ['2026-10-27', '2026-10-28'] }]);
    const failing: ReportsKv = {
      get: () => Promise.resolve(null),
      put: () => Promise.reject(new Error('KV is down')),
    };

    await cleanUp(env.USER_DB, failing, '2026-10-29');

    expect(await rows()).toEqual([
      {
        plan: 'netflix.standard',
        country: 'CA',
        problem: 'price',
        price: JSON.stringify(standard),
        count: 2,
        first_day: '2026-10-27',
        last_day: '2026-10-28',
      },
    ]);
  });
});
