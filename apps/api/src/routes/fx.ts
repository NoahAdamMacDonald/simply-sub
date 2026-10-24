import { currencySchema, ecbCurrencies, rebaseRates } from '@simply-sub/core';
import { Hono } from 'hono';
import { ecbRates } from '../fx';
import { badQuery, jsonType, notModified, type ParamProblem } from '../http';

/** How long a browser may keep the last good rates while Frankfurter is down: 15 minutes, then it asks again. */
const staleMaxAge = 900;

/**
 * GET /fx?base=CAD (docs/api-output-examples.json): the ECB's daily rates in the user's currency, kept for 12 hours
 * (fx.ts). The ETag is the base and the ECB's date, and a browser may keep fresh rates until they're due again.
 * When Frankfurter is down, the last good rates are sent with meta.stale, for 15 minutes and without an ETag; with
 * none kept, the answer is 502 upstream_unavailable.
 */
export const fx = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const problems = queryProblems(c.req.queries());
  if (problems.length > 0) {
    return badQuery(c, problems);
  }
  const base = c.req.query('base') ?? '';

  // Timestamps are ISO 8601 in UTC, to the second, as in the examples.
  const rates = await ecbRates(c.env, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  if (!rates) {
    return c.json(
      {
        error: {
          code: 'upstream_unavailable',
          message:
            "Exchange rates are temporarily unavailable. Converted prices can't be shown right now.",
        },
      },
      502,
      { 'Content-Type': jsonType, 'Cache-Control': 'no-store' },
    );
  }
  const data = rebaseRates(rates.ecb, base);
  if (!data) {
    return badQuery(c, [
      {
        param: 'base',
        issue: `The ECB has no rate for ${base}: use one of ${ecbCurrencies(rates.ecb).join(', ')}.`,
      },
    ]);
  }

  const body = { data, meta: { fetchedAt: rates.ecb.fetchedAt, stale: rates.stale } };
  if (rates.stale) {
    return c.json(body, 200, {
      'Content-Type': jsonType,
      'Cache-Control': `public, max-age=${staleMaxAge}`,
    });
  }
  const etag = `"fx-${base}-${data.date}"`;
  const cacheControl = `public, max-age=${rates.freshFor}`;
  if (notModified(c, etag)) {
    return c.body(null, 304, { ETag: etag, 'Cache-Control': cacheControl });
  }
  return c.json(body, 200, {
    'Content-Type': jsonType,
    'Cache-Control': cacheControl,
    ETag: etag,
  });
});

/** Each problem with the query: GET /fx takes one `base`, a currency code. */
function queryProblems(queries: Record<string, string[]>): ParamProblem[] {
  const problems = Object.entries(queries).flatMap(([param, values]): ParamProblem[] => {
    if (param !== 'base') {
      return [{ param, issue: 'Unknown parameter. GET /fx takes only base.' }];
    }
    if (values.length > 1) {
      return [{ param, issue: 'Give one currency.' }];
    }
    const checked = currencySchema.safeParse(values[0]);
    return checked.success ? [] : [{ param, issue: `${checked.error.issues[0].message}.` }];
  });
  return Object.hasOwn(queries, 'base')
    ? problems
    : [{ param: 'base', issue: 'Required: the currency to give the rates in (CAD).' }, ...problems];
}
