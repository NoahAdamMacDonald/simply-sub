-- M11.8 (BLUEPRINT §5.3): shape 4's tables gone. The deploy of 0008 filled shape 5 beside them and pointed the views at
-- it (2026-11-03), so nothing reads shape 4 now: its tables held the catalog as it was at the switch.
-- - The views go to shape 5's tables, as that seed left them, so a new database reads the same: provider_prices too,
--   which 0008's views (shape 4's) didn't have.
-- - Shape 4's tables are dropped, children first; dropping provider_search_s4 drops its FTS5 shadow tables, and each
--   table its indexes.
-- Core's seedShapes no longer names shapes 3 or 4, so a database still at their formats is seeded again in full.

DROP VIEW IF EXISTS providers;
DROP VIEW IF EXISTS provider_categories;
DROP VIEW IF EXISTS provider_features;
DROP VIEW IF EXISTS provider_prices;
DROP VIEW IF EXISTS plans;
DROP VIEW IF EXISTS prices;
DROP VIEW IF EXISTS features;
DROP VIEW IF EXISTS plan_features;
DROP VIEW IF EXISTS bundles;
DROP VIEW IF EXISTS bundle_plans;
CREATE VIEW providers AS SELECT * FROM providers_s5;
CREATE VIEW provider_categories AS SELECT * FROM provider_categories_s5;
CREATE VIEW provider_features AS SELECT * FROM provider_features_s5;
CREATE VIEW provider_prices AS SELECT * FROM provider_prices_s5;
CREATE VIEW plans AS SELECT * FROM plans_s5;
CREATE VIEW prices AS SELECT * FROM prices_s5;
CREATE VIEW features AS SELECT * FROM features_s5;
CREATE VIEW plan_features AS SELECT * FROM plan_features_s5;
CREATE VIEW bundles AS SELECT * FROM bundles_s5;
CREATE VIEW bundle_plans AS SELECT * FROM bundle_plans_s5;

DROP TABLE provider_search_s4;
DROP TABLE bundle_plans_s4;
DROP TABLE plan_features_s4;
DROP TABLE provider_features_s4;
DROP TABLE prices_s4;
DROP TABLE plans_s4;
DROP TABLE provider_categories_s4;
DROP TABLE bundles_s4;
DROP TABLE features_s4;
DROP TABLE providers_s4;
