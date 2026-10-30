-- M10.21 (BLUEPRINT §11.3): each feed's calendar sealed at rest. The app's PUT and a calendar app's GET bring a feed's
-- token, which the database keeps only as its hash: a key derived from it (HKDF-SHA256) seals the file (AES-256-GCM,
-- gzipped first, as base64 in `sealed`), and keys the hash of what it was made from, so the database alone can't say
-- what's in a calendar. A feed stored before keeps its plain file in `ics` until the next request that brings its token
-- seals it. SQLite can't take NOT NULL off a column, so the table is made again with both, exactly one of them set.

CREATE TABLE cal_feeds_sealed (
  token_hash TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES cal_sets (id),
  content_hash TEXT NOT NULL,
  sealed TEXT,
  ics TEXT,
  updated_at TEXT NOT NULL,
  CHECK ((sealed IS NULL) <> (ics IS NULL))
) STRICT, WITHOUT ROWID;

INSERT INTO cal_feeds_sealed (token_hash, set_id, content_hash, ics, updated_at)
  SELECT token_hash, set_id, content_hash, ics, updated_at FROM cal_feeds;

DROP TABLE cal_feeds;

ALTER TABLE cal_feeds_sealed RENAME TO cal_feeds;

CREATE INDEX cal_feeds_by_set ON cal_feeds (set_id);
