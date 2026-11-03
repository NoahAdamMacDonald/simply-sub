-- M11.8 (BLUEPRINT §5.3): the seed writes only the rows that changed, and counts them against the catalog's share of
-- D1's 100,000 rows written a day for the account (core's seedDailyWrites). Over it, whole providers wait for the next
-- seed. The catalog row records how many providers and bundles wait (waiting, which /health reports) and how many rows
-- the day's seeds wrote (written_on, the UTC day, and written). No catalog row's other columns change, so the rows stay
-- as they are (no seedFormat bump).

ALTER TABLE catalog ADD COLUMN waiting INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog ADD COLUMN written_on TEXT;
ALTER TABLE catalog ADD COLUMN written INTEGER NOT NULL DEFAULT 0;
