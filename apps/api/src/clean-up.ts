import {
  addDays,
  addReports,
  reportCountSchema,
  reportedPlanSchema,
  reportKey,
  type IsoDate,
  type ReportCount,
  type ReportedPlan,
} from '@simply-sub/core';

// The nightly clean-up (BLUEPRINT §5.4, M10.1), from wrangler.jsonc's cron trigger at 02:30 UTC: what users sent that
// has expired goes, with the daily counts (writes.ts) before yesterday. Each kind of user data brings its own statements
// with its tables: the live calendar's feed sets (M10.2) and the sync chains (M10.8). The price reports counted before
// today go to the bot (M10.10), which runs at 03:00 and checks the reported plans' pages that night.

/** The part of Workers KV the hand-over uses. */
export interface ReportsKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** A price_reports row. */
interface ReportRow {
  plan: string;
  country: string;
  problem: string;
  price: string;
  count: number;
  first_day: string;
  last_day: string;
}

/** Deletes from the user database what has expired by `today` (UTC), in one batch, then hands the reports over. */
export async function cleanUp(db: D1Database, kv: ReportsKv, today: IsoDate): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM daily_counts WHERE day < ?').bind(addDays(today, -1)),
    // A set's feeds go before it: D1 enforces foreign keys.
    db
      .prepare(
        'DELETE FROM cal_feeds WHERE set_id IN (SELECT id FROM cal_sets WHERE expires_on <= ?)',
      )
      .bind(today),
    db.prepare('DELETE FROM cal_sets WHERE expires_on <= ?').bind(today),
    db.prepare('DELETE FROM sync_chains WHERE expires_on <= ?').bind(today),
  ]);
  await handOverReports(db, kv, today);
}

/**
 * The reports counted before `today` go to the bot's KV, a key per reported plan added to what it holds until the
 * weekly digest has it, so a night writes a key per plan, not per report. They leave D1 in the statement that reads
 * them, so a report counted meanwhile waits for the next night; a plan whose key can't be written gets its rows back.
 */
async function handOverReports(db: D1Database, kv: ReportsKv, today: IsoDate): Promise<void> {
  const { results } = await db
    .prepare(
      `DELETE FROM price_reports WHERE last_day < ?
       RETURNING plan, country, problem, price, count, first_day, last_day`,
    )
    .bind(today)
    .all<ReportRow>();
  const byPlan = new Map<string, ReportRow[]>();
  for (const row of results) byPlan.set(row.plan, [...(byPlan.get(row.plan) ?? []), row]);
  for (const [plan, rows] of byPlan) {
    try {
      const counts = rows.flatMap((row) => countOf(row) ?? []);
      if (counts.length === 0) continue;
      const kept = keptReports(await kv.get(reportKey(plan)));
      await kv.put(reportKey(plan), JSON.stringify(addReports(kept, plan, counts)));
    } catch {
      await db.batch(
        rows.map((row) =>
          db
            .prepare(
              `INSERT INTO price_reports (plan, country, problem, price, count, first_day, last_day)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
               ON CONFLICT (plan, country, problem, price) DO UPDATE SET
                 count = price_reports.count + excluded.count,
                 first_day = min(price_reports.first_day, excluded.first_day),
                 last_day = max(price_reports.last_day, excluded.last_day)`,
            )
            .bind(
              row.plan,
              row.country,
              row.problem,
              row.price,
              row.count,
              row.first_day,
              row.last_day,
            ),
        ),
      );
    }
  }
}

/** A row as the count the bot reads, or undefined for one that isn't a report's (none should be). */
function countOf(row: ReportRow): ReportCount | undefined {
  try {
    const parsed = reportCountSchema.safeParse({
      country: row.country,
      problem: row.problem,
      ...(row.price !== '' && { price: JSON.parse(row.price) as unknown }),
      count: row.count,
      first: row.first_day,
      last: row.last_day,
    });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** What KV holds for a plan, or undefined for nothing or something that isn't a plan's reports. */
function keptReports(text: string | null): ReportedPlan | undefined {
  if (text === null) return undefined;
  try {
    const parsed = reportedPlanSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
