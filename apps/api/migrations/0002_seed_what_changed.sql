-- M2.1 (BLUEPRINT §5.3): the seed writes only what changed, so a code-only deploy writes no rows.
-- - Every table is rebuilt WITHOUT ROWID. Each has a text or composite primary key, which SQLite
--   otherwise keeps as an index of its own next to the rowid, and each index entry counts as a row
--   written.
-- - providers.hash is a SHA-256 of the provider's JSON, so the seed replaces only the providers
--   whose hash changed.
-- - The one-row catalog table replaces snapshots: the catalog version, build time and counts that
--   /health reports, and the seed format the rows were written with. The snapshots themselves are
--   static files now (data/catalog.json and data/catalog/<region>.json, BLUEPRINT §6.3).
-- D1 is a cache of data/, so the tables go with their rows, and the next seed refills them in full
-- because there is no catalog row. Children go first: D1 always enforces foreign keys.

DROP TABLE snapshots;
DROP TABLE bundle_plans;
DROP TABLE plan_features;
DROP TABLE prices;
DROP TABLE plans;
DROP TABLE bundles;
DROP TABLE features;
DROP TABLE providers;

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  spend_category TEXT,
  hash TEXT NOT NULL,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- One row per stored price. A plan can have several regions, currencies and intervals.
CREATE TABLE prices (
  plan_id TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount REAL NOT NULL,
  interval TEXT NOT NULL,
  interval_count INTEGER NOT NULL,
  monthly_equiv REAL NOT NULL,
  PRIMARY KEY (plan_id, region, currency, interval, interval_count)
) STRICT, WITHOUT ROWID;

-- The seed upserts features and never deletes one that is still in data/features.yaml: the cascade
-- would take every plan's rows for it.
CREATE TABLE features (
  id TEXT PRIMARY KEY,
  category TEXT,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- One row per feature value; a set feature has one row per member, so rank-key filters such as
-- password-manager.item-types=passkey are plain lookups. rank_value is an enum's position
-- (1080p = 2, 4k = 3) or the number itself, so "1080p or better" is a numeric comparison.
CREATE TABLE plan_features (
  plan_id TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  rank_value REAL,
  PRIMARY KEY (plan_id, feature_id, value)
) STRICT, WITHOUT ROWID;

CREATE TABLE bundles (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

-- Deleting a provider takes the links to its plans too, so the seed links unchanged bundles again.
CREATE TABLE bundle_plans (
  bundle_id TEXT NOT NULL REFERENCES bundles (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  PRIMARY KEY (bundle_id, plan_id)
) STRICT, WITHOUT ROWID;

-- The catalog D1 holds: version is meta.catalogVersion and built_at its generatedAt (ISO 8601 UTC),
-- counts is meta.counts as JSON, and seed_format the seedFormat in core it was written with.
CREATE TABLE catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version TEXT NOT NULL,
  built_at TEXT NOT NULL,
  seed_format INTEGER NOT NULL,
  counts TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_prices_region ON prices (region, monthly_equiv);
CREATE INDEX idx_pf_feature ON plan_features (feature_id, rank_value);
CREATE INDEX idx_plans_provider ON plans (provider_id);
-- GET /bundles?plans=… looks bundles up by plan.
CREATE INDEX idx_bundle_plans_plan ON bundle_plans (plan_id);
