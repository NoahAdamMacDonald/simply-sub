-- Catalog tables (BLUEPRINT §5.3). D1 is a cache of data/**/*.yaml, reseeded in full on every deploy
-- (M1.5), so nothing here is edited by hand. Each `json` column holds the record as the API returns
-- it; the other columns exist for filtering, sorting and joins.
-- STRICT makes SQLite enforce the column types. D1 always enforces foreign keys, and ON DELETE
-- CASCADE means deleting a provider during a reseed also removes its plans, prices and features.

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  spend_category TEXT,
  json TEXT NOT NULL
) STRICT;

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  json TEXT NOT NULL
) STRICT;

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
) STRICT;

CREATE TABLE features (
  id TEXT PRIMARY KEY,
  category TEXT,
  json TEXT NOT NULL
) STRICT;

-- One row per feature value; a set feature has one row per member, so rank-key filters such as
-- password-manager.item-types=passkey are plain lookups. rank_value is an enum's position
-- (1080p = 2, 4k = 3) or the number itself, so "1080p or better" is a numeric comparison.
CREATE TABLE plan_features (
  plan_id TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  rank_value REAL,
  PRIMARY KEY (plan_id, feature_id, value)
) STRICT;

CREATE TABLE bundles (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
) STRICT;

CREATE TABLE bundle_plans (
  bundle_id TEXT NOT NULL REFERENCES bundles (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  PRIMARY KEY (bundle_id, plan_id)
) STRICT;

-- Prebuilt GET /catalog payloads, one per region. sha is the catalog version (the Git commit) and
-- built_at the build time (ISO 8601 UTC); /health reports both.
CREATE TABLE snapshots (
  region TEXT PRIMARY KEY,
  sha TEXT NOT NULL,
  built_at TEXT NOT NULL,
  json TEXT NOT NULL
) STRICT;

CREATE INDEX idx_prices_region ON prices (region, monthly_equiv);
CREATE INDEX idx_pf_feature ON plan_features (feature_id, rank_value);
CREATE INDEX idx_plans_provider ON plans (provider_id);
-- GET /bundles?plans=… looks bundles up by plan.
CREATE INDEX idx_bundle_plans_plan ON bundle_plans (plan_id);
