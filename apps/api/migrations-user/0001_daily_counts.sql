-- M10.1 (BLUEPRINT §5.4, §7.1): the user database, simply-sub-user, holds what users send: the live calendar's feeds
-- (M10.2), sync's sealed copies (M10.8) and price reports (M10.10), each in tables of their own migrations.
-- D1's 100,000 rows written a day are the account's, shared with the catalog's deploys, so every write first counts
-- its rows here, per day and kind, and a kind stops at its cap (src/writes.ts). The nightly clean-up deletes the
-- counts before yesterday. WITHOUT ROWID, so the primary key is the table and a count costs one row written.

CREATE TABLE daily_counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  rows INTEGER NOT NULL,
  PRIMARY KEY (day, kind)
) STRICT, WITHOUT ROWID;
