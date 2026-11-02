-- M11.4 (BLUEPRINT §4.2 rule 9, §5.3): a provider states its provider-wide features (platforms, sign-in, open source,
-- languages, support) once, for every plan that doesn't state its own value, so D1 keeps them once per provider rather
-- than once per plan: the same rows as plan_features (a set's members one per row, rank_value as there), keyed by
-- provider. The seed writes them with the provider, and deleting a provider takes its rows. seedFormat 3 in core makes
-- the next seed fill the table in full.
-- The key starts with the feature, which GET /providers?feature= reads by, so the table is its own index. There's no
-- index by provider: each index entry is a row written, and the cascade that would use it runs only when a provider
-- changes, scanning a small table (provider_categories does the same).

CREATE TABLE provider_features (
  feature_id TEXT NOT NULL REFERENCES features (id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  rank_value REAL,
  PRIMARY KEY (feature_id, value, provider_id)
) STRICT, WITHOUT ROWID;
