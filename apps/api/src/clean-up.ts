import { addDays, type IsoDate } from '@simply-sub/core';

// The nightly clean-up (BLUEPRINT §5.4, M10.1), from wrangler.jsonc's cron trigger at 02:30 UTC: what users sent that
// has expired goes, with the daily counts (writes.ts) before yesterday. Each kind of user data brings its own statements
// with its tables: the live calendar's feed sets (M10.2) and the sync chains (M10.8); the reports go to the bot
// (M10.10).

/** Deletes from the user database what has expired by `today` (UTC), in one batch. */
export async function cleanUp(db: D1Database, today: IsoDate): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM daily_counts WHERE day < ?').bind(addDays(today, -1)),
    // A set's feeds go before it: D1 enforces foreign keys.
    db
      .prepare(
        'DELETE FROM cal_feeds WHERE set_id IN (SELECT id FROM cal_sets WHERE expires_on <= ?)',
      )
      .bind(today),
    db.prepare('DELETE FROM cal_sets WHERE expires_on <= ?').bind(today),
  ]);
}
