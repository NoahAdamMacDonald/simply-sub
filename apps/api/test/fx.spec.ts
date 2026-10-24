import { ecbRatesUrl, fxFreshSeconds } from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

// GET /fx (docs/api-output-examples.json) with Frankfurter stubbed: the Worker's own fetch is replaced, so no test
// reaches the network. KV starts empty for each test.
const BASE = 'https://sub.simplely.ca/api/v1';
const kvKey = 'fx:ecb';

/** A few of the ECB's rates for 2026-10-23, per euro. */
const perEuro = { AUD: 1.5939, CAD: 1.5665, CHF: 0.9227, GBP: 0.83728, JPY: 175.51, USD: 1.1193 };

/** Frankfurter's answer to ecbRatesUrl. */
function frankfurter(date = '2026-10-23'): Response {
  const rows = [
    { date, base: 'EUR', quote: 'EUR', rate: 1 },
    ...Object.entries(perEuro).map(([quote, rate]) => ({ date, base: 'EUR', quote, rate })),
  ];
  return Response.json(rows);
}

/** An ISO timestamp `hours` before now, to the second. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function keep(fetchedAt: string, date = '2026-10-22', rates = perEuro): Promise<void> {
  await env.KV.put(kvKey, JSON.stringify({ date, rates, fetchedAt }));
}

function get(query: string, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`${BASE}/fx${query}`, { headers }), env));
}

const upstream = vi.spyOn(globalThis, 'fetch');
// The Worker logs each failed fetch; the tests that fail it on purpose would print them.
const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

beforeEach(async () => {
  await env.KV.delete(kvKey);
  upstream.mockReset();
  warn.mockClear();
});

describe('GET /fx', () => {
  it('fetches the ECB rates, keeps them and answers in the base currency', async () => {
    upstream.mockResolvedValue(frankfurter());

    const response = await get('?base=CAD');

    expect(upstream).toHaveBeenCalledOnce();
    expect(String(upstream.mock.calls[0][0])).toBe(ecbRatesUrl);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${fxFreshSeconds}`,
      etag: '"fx-CAD-2026-10-23"',
    });
    const body = await response.json<{ data: unknown; meta: { fetchedAt: string } }>();
    expect(body).toEqual({
      data: {
        base: 'CAD',
        date: '2026-10-23',
        source: 'European Central Bank via Frankfurter',
        rates: {
          AUD: 1.01749,
          CHF: 0.58902,
          EUR: 0.638366,
          GBP: 0.534491,
          JPY: 112.04,
          USD: 0.714523,
        },
      },
      meta: { fetchedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/), stale: false },
    });
    expect(Date.now() - Date.parse(body.meta.fetchedAt)).toBeLessThan(60_000);
    expect(JSON.parse((await env.KV.get(kvKey)) ?? 'null')).toEqual({
      date: '2026-10-23',
      rates: perEuro,
      fetchedAt: body.meta.fetchedAt,
    });
  });

  it("gives the ECB's own rates in euros", async () => {
    upstream.mockResolvedValue(frankfurter());

    const response = await get('?base=EUR');

    expect((await response.json<{ data: { rates: unknown } }>()).data.rates).toEqual(perEuro);
  });

  it('answers from KV while the rates are fresh, and lets the browser keep them until they are due', async () => {
    await keep(hoursAgo(1));

    const response = await get('?base=USD');

    expect(upstream).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"fx-USD-2026-10-22"');
    const maxAge = Number(/max-age=(\d+)$/.exec(response.headers.get('Cache-Control') ?? '')?.[1]);
    expect(maxAge).toBeGreaterThan(fxFreshSeconds - 3_660);
    expect(maxAge).toBeLessThanOrEqual(fxFreshSeconds - 3_600);
  });

  it.each(['"fx-CAD-2026-10-22"', 'W/"fx-CAD-2026-10-22"', '*'])(
    'answers If-None-Match: %s with 304 Not Modified',
    async (ifNoneMatch) => {
      await keep(hoursAgo(1));

      const response = await get('?base=CAD', { 'If-None-Match': ifNoneMatch });

      expect(response.status).toBe(304);
      expect(response.headers.get('ETag')).toBe('"fx-CAD-2026-10-22"');
      expect(response.headers.get('Cache-Control')).toMatch(/^public, max-age=\d+$/);
      expect(await response.text()).toBe('');
    },
  );

  it('sends the rates when the ETag it was given is for another day', async () => {
    await keep(hoursAgo(1));

    const response = await get('?base=CAD', { 'If-None-Match': '"fx-CAD-2026-10-21"' });

    expect(response.status).toBe(200);
  });

  it('fetches again once the kept rates are 12 hours old, and keeps the new ones', async () => {
    await keep(hoursAgo(13));
    upstream.mockResolvedValue(frankfurter('2026-10-23'));

    const response = await get('?base=CAD');

    expect(upstream).toHaveBeenCalledOnce();
    expect(response.headers.get('ETag')).toBe('"fx-CAD-2026-10-23"');
    expect(JSON.parse((await env.KV.get(kvKey)) ?? 'null')).toMatchObject({ date: '2026-10-23' });
  });

  it.each([
    ['answers HTTP 500', () => new Response('down', { status: 500 })],
    ['times out', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['answers with something that is not JSON', () => new Response('<html>')],
    ['answers with an error', () => Response.json({ status: 422, message: 'invalid' })],
  ])('serves the last good rates as stale when Frankfurter %s', async (_name, answer) => {
    const fetchedAt = hoursAgo(30);
    await keep(fetchedAt);
    upstream.mockImplementation(async () => answer());

    const response = await get('?base=CAD');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=900');
    expect(response.headers.get('ETag')).toBeNull();
    expect(await response.json()).toMatchObject({
      data: { base: 'CAD', date: '2026-10-22' },
      meta: { fetchedAt, stale: true },
    });
    expect(JSON.parse((await env.KV.get(kvKey)) ?? 'null')).toMatchObject({ fetchedAt });
  });

  it('answers 502 upstream_unavailable when Frankfurter is down and nothing is kept', async () => {
    upstream.mockResolvedValue(new Response('down', { status: 503 }));

    const response = await get('?base=CAD');

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: {
        code: 'upstream_unavailable',
        message:
          "Exchange rates are temporarily unavailable. Converted prices can't be shown right now.",
      },
    });
  });

  it('ignores a kept value it cannot read, and fetches the rates again', async () => {
    await env.KV.put(kvKey, '{"date":');
    upstream.mockResolvedValue(frankfurter());

    const response = await get('?base=CAD');

    expect(upstream).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it.each([
    ['', [{ param: 'base', issue: 'Required: the currency to give the rates in (CAD).' }]],
    [
      '?base=cad',
      [{ param: 'base', issue: 'Use a three-letter ISO 4217 currency code in capitals (CAD).' }],
    ],
    ['?base=CAD&base=USD', [{ param: 'base', issue: 'Give one currency.' }]],
    [
      '?base=CAD&date=2026-10-01',
      [{ param: 'date', issue: 'Unknown parameter. GET /fx takes only base.' }],
    ],
    [
      '?symbols=USD',
      [
        { param: 'base', issue: 'Required: the currency to give the rates in (CAD).' },
        { param: 'symbols', issue: 'Unknown parameter. GET /fx takes only base.' },
      ],
    ],
  ])('refuses %s with 400 bad_request', async (query, details) => {
    const response = await get(query);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'bad_request', message: expect.any(String), details },
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a currency the ECB doesn't publish, listing the ones it does", async () => {
    await keep(hoursAgo(1));

    const response = await get('?base=AED');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'bad_request',
        message: "Invalid query parameter 'base'.",
        details: [
          {
            param: 'base',
            issue: 'The ECB has no rate for AED: use one of AUD, CAD, CHF, EUR, GBP, JPY, USD.',
          },
        ],
      },
    });
  });
});
