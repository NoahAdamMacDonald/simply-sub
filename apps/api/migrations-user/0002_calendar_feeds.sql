-- M10.2 (BLUEPRINT §11.3): the live calendar's feed sets. A set is what one device made: its id, the SHA-256 of its
-- manage key (the key itself is shown once, to the app) and the day it's deleted on, 180 days after the app last wrote
-- it. Each feed is one calendar of a set, found by the SHA-256 of its token, with its calendar file as served and a
-- hash of what it was made from, for its ETag and to leave a feed that hasn't changed as it is. Neither a token nor a
-- key is kept, so the database names no link. A feed goes before its set: D1 enforces foreign keys.

CREATE TABLE cal_sets (
  id TEXT PRIMARY KEY,
  manage_hash TEXT NOT NULL,
  expires_on TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX cal_sets_by_expiry ON cal_sets (expires_on);

CREATE TABLE cal_feeds (
  token_hash TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES cal_sets (id),
  content_hash TEXT NOT NULL,
  ics TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX cal_feeds_by_set ON cal_feeds (set_id);
