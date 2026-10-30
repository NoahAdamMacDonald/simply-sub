import { priceReportSchema, reportPriceKey } from '@simply-sub/core';
import { Hono } from 'hono';
import { badBody, rateLimited, utcDay } from '../http';
import { bodyProblems, capReached, countWrite, readJson } from '../writes';

// "Report a wrong price" (BLUEPRINT §5.2, §14; M10.10): a plan, the visitor's country and what's wrong, in choices only
// (core's priceReportSchema), for a plan the catalog has. The user database counts it, a row per plan, country,
// problem and price, keeping nothing about the sender; the nightly clean-up hands the counts to the bot (clean-up.ts),
// which checks the plan's pages that night. 3 a minute per IP on top of the write limit, and 500 a day: the cap's
// 1,000 rows at two a report.

interface Api {
  Bindings: Env;
}

/** A report's JSON is well under this. */
const bodyLimit = 1_024;
/** The rows a report writes besides the day's count: its plan, country, problem and price's. */
const rowsEach = 1;

export const reports = new Hono<Api>().post('/', async (c) => {
  const ip = c.req.header('CF-Connecting-IP');
  if (ip !== undefined && !(await c.env.REPORT_RATE_LIMIT.limit({ key: ip })).success) {
    return rateLimited(c);
  }
  const read = await readJson(c, bodyLimit);
  if (read instanceof Response) return read;
  const parsed = priceReportSchema.safeParse(read.json);
  if (!parsed.success) return badBody(c, bodyProblems(parsed.error.issues));
  const report = parsed.data;
  const known = await c.env.DB.prepare('SELECT 1 FROM plans WHERE id = ?')
    .bind(report.plan)
    .first();
  if (known === null) {
    return badBody(c, [{ path: 'plan', issue: `The catalog has no plan ${report.plan}.` }]);
  }

  const now = new Date();
  const today = utcDay(now);
  const counted = await countWrite(c.env.USER_DB, 'report', rowsEach, today);
  if (!counted.allowed) return capReached(c, now);
  await c.env.USER_DB.prepare(
    `INSERT INTO price_reports (plan, country, problem, price, count, first_day, last_day)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
     ON CONFLICT (plan, country, problem, price)
       DO UPDATE SET count = price_reports.count + 1, last_day = excluded.last_day`,
  )
    .bind(
      report.plan,
      report.country,
      report.problem,
      reportPriceKey(report.problem === 'price' ? report.price : undefined),
      today,
    )
    .run();
  return c.body(null, 202, { 'Cache-Control': 'no-store' });
});
