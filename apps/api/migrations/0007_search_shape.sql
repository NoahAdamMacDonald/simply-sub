-- M11.8 (BLUEPRINT §5.3): shape 4, for GET /providers' search. Its tables go beside shape 3's, empty; the seed fills
-- them through its daily budget (seed format 4), then points the API's views at them and names the format in the
-- catalog row, all in one transaction, while the API reads shape 3's whole tables until then. A later migration drops
-- shape 3's.
-- - providers_s4.search: what core's searchProviders reads of a provider (search-index.ts), so GET /providers parses
--   less than the json that GET /providers/:id returns.
-- - provider_search_s4: an FTS5 table of the names a provider's text can match, one row a provider, with the trigram
--   tokenizer, so a part of a word is found as searchProviders finds it. GET /providers looks text up there and parses
--   only the providers it finds. It has no foreign key, so the seed deletes a provider's row itself.
-- Otherwise the tables are shape 3's: keys, cascades and indexes alike (0002 to 0004), the indexes named for the shape.

CREATE TABLE providers_s4 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  spend_category TEXT,
  hash TEXT NOT NULL,
  json TEXT NOT NULL,
  search TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE VIRTUAL TABLE provider_search_s4 USING fts5(provider_id UNINDEXED, text, tokenize = 'trigram');

CREATE TABLE provider_categories_s4 (
  category TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers_s4 (id) ON DELETE CASCADE,
  PRIMARY KEY (category, provider_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE plans_s4 (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers_s4 (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE prices_s4 (
  plan_id TEXT NOT NULL REFERENCES plans_s4 (id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount REAL NOT NULL,
  interval TEXT NOT NULL,
  interval_count INTEGER NOT NULL,
  monthly_equiv REAL NOT NULL,
  PRIMARY KEY (plan_id, region, currency, interval, interval_count)
) STRICT, WITHOUT ROWID;

CREATE TABLE features_s4 (
  id TEXT PRIMARY KEY,
  category TEXT,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE plan_features_s4 (
  plan_id TEXT NOT NULL REFERENCES plans_s4 (id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL REFERENCES features_s4 (id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  rank_value REAL,
  PRIMARY KEY (plan_id, feature_id, value)
) STRICT, WITHOUT ROWID;

CREATE TABLE provider_features_s4 (
  feature_id TEXT NOT NULL REFERENCES features_s4 (id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers_s4 (id) ON DELETE CASCADE,
  rank_value REAL,
  PRIMARY KEY (feature_id, value, provider_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE bundles_s4 (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE bundle_plans_s4 (
  bundle_id TEXT NOT NULL REFERENCES bundles_s4 (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans_s4 (id) ON DELETE CASCADE,
  PRIMARY KEY (bundle_id, plan_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_prices_region_s4 ON prices_s4 (region, monthly_equiv);
CREATE INDEX idx_pf_feature_s4 ON plan_features_s4 (feature_id, rank_value);
CREATE INDEX idx_plans_provider_s4 ON plans_s4 (provider_id);
CREATE INDEX idx_bundle_plans_plan_s4 ON bundle_plans_s4 (plan_id);
