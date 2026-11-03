-- M11.8 (BLUEPRINT §5.3): shape 5, for GET /providers' price-sorted pages, and shape 3's tables gone.
-- - The views go to shape 4's tables, which the deploy of 0007 filled and switched to, so a new database reads the
--   same, and shape 3's tables are dropped, children first.
-- - Shape 5's tables go beside shape 4's, empty, as 0007's did: the seed fills them through its daily budget (seed
--   format 5), then points the views at them. They're shape 4's, with provider_prices: each provider's lowest monthly
--   equivalent in each currency its plans are priced in, and its name as core compares names. Its key walks them from
--   the cheapest, ties (every free plan's 0) by name as core breaks them, so a page sorted from the cheapest reads the
--   providers it needs, not all of them.
-- - The catalog row says which currencies provider_prices may hold, for the API to walk each.

DROP VIEW IF EXISTS providers;
DROP VIEW IF EXISTS provider_categories;
DROP VIEW IF EXISTS provider_features;
DROP VIEW IF EXISTS plans;
DROP VIEW IF EXISTS prices;
DROP VIEW IF EXISTS features;
DROP VIEW IF EXISTS plan_features;
DROP VIEW IF EXISTS bundles;
DROP VIEW IF EXISTS bundle_plans;
CREATE VIEW providers AS SELECT * FROM providers_s4;
CREATE VIEW provider_categories AS SELECT * FROM provider_categories_s4;
CREATE VIEW provider_features AS SELECT * FROM provider_features_s4;
CREATE VIEW plans AS SELECT * FROM plans_s4;
CREATE VIEW prices AS SELECT * FROM prices_s4;
CREATE VIEW features AS SELECT * FROM features_s4;
CREATE VIEW plan_features AS SELECT * FROM plan_features_s4;
CREATE VIEW bundles AS SELECT * FROM bundles_s4;
CREATE VIEW bundle_plans AS SELECT * FROM bundle_plans_s4;

DROP TABLE bundle_plans_s3;
DROP TABLE plan_features_s3;
DROP TABLE provider_features_s3;
DROP TABLE prices_s3;
DROP TABLE plans_s3;
DROP TABLE provider_categories_s3;
DROP TABLE bundles_s3;
DROP TABLE features_s3;
DROP TABLE providers_s3;

ALTER TABLE catalog ADD COLUMN currencies TEXT NOT NULL DEFAULT '[]';

CREATE TABLE providers_s5 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  spend_category TEXT,
  hash TEXT NOT NULL,
  json TEXT NOT NULL,
  search TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE VIRTUAL TABLE provider_search_s5 USING fts5(provider_id UNINDEXED, text, tokenize = 'trigram');

CREATE TABLE provider_prices_s5 (
  currency TEXT NOT NULL,
  low REAL NOT NULL,
  name TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers_s5 (id) ON DELETE CASCADE,
  PRIMARY KEY (currency, low, name, provider_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE provider_categories_s5 (
  category TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers_s5 (id) ON DELETE CASCADE,
  PRIMARY KEY (category, provider_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE plans_s5 (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers_s5 (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE prices_s5 (
  plan_id TEXT NOT NULL REFERENCES plans_s5 (id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount REAL NOT NULL,
  interval TEXT NOT NULL,
  interval_count INTEGER NOT NULL,
  monthly_equiv REAL NOT NULL,
  PRIMARY KEY (plan_id, region, currency, interval, interval_count)
) STRICT, WITHOUT ROWID;

CREATE TABLE features_s5 (
  id TEXT PRIMARY KEY,
  category TEXT,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE plan_features_s5 (
  plan_id TEXT NOT NULL REFERENCES plans_s5 (id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL REFERENCES features_s5 (id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  rank_value REAL,
  PRIMARY KEY (plan_id, feature_id, value)
) STRICT, WITHOUT ROWID;

CREATE TABLE provider_features_s5 (
  feature_id TEXT NOT NULL REFERENCES features_s5 (id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers_s5 (id) ON DELETE CASCADE,
  rank_value REAL,
  PRIMARY KEY (feature_id, value, provider_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE bundles_s5 (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE bundle_plans_s5 (
  bundle_id TEXT NOT NULL REFERENCES bundles_s5 (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans_s5 (id) ON DELETE CASCADE,
  PRIMARY KEY (bundle_id, plan_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_prices_region_s5 ON prices_s5 (region, monthly_equiv);
CREATE INDEX idx_pf_feature_s5 ON plan_features_s5 (feature_id, rank_value);
CREATE INDEX idx_plans_provider_s5 ON plans_s5 (provider_id);
CREATE INDEX idx_bundle_plans_plan_s5 ON bundle_plans_s5 (plan_id);
