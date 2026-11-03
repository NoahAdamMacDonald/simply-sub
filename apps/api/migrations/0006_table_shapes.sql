-- M11.8 (BLUEPRINT §5.3): the catalog's tables take the number of their shape, and the API reads them through views
-- of the names it always used. A change to a table's shape is a migration that creates the next shape's tables
-- beside these (providers_s4…), empty; the seed fills them through its daily budget over the days it needs, while the
-- API still reads these through the views; then, in one transaction, the seed points the views at the new tables and
-- names the new seed format in the catalog row. A later migration drops the old shape's tables. Renaming a table keeps
-- its rows, its indexes and the foreign keys that point at it, so this writes no row. The catalog row stays a table.

ALTER TABLE providers RENAME TO providers_s3;
ALTER TABLE provider_categories RENAME TO provider_categories_s3;
ALTER TABLE provider_features RENAME TO provider_features_s3;
ALTER TABLE plans RENAME TO plans_s3;
ALTER TABLE prices RENAME TO prices_s3;
ALTER TABLE features RENAME TO features_s3;
ALTER TABLE plan_features RENAME TO plan_features_s3;
ALTER TABLE bundles RENAME TO bundles_s3;
ALTER TABLE bundle_plans RENAME TO bundle_plans_s3;

CREATE VIEW providers AS SELECT * FROM providers_s3;
CREATE VIEW provider_categories AS SELECT * FROM provider_categories_s3;
CREATE VIEW provider_features AS SELECT * FROM provider_features_s3;
CREATE VIEW plans AS SELECT * FROM plans_s3;
CREATE VIEW prices AS SELECT * FROM prices_s3;
CREATE VIEW features AS SELECT * FROM features_s3;
CREATE VIEW plan_features AS SELECT * FROM plan_features_s3;
CREATE VIEW bundles AS SELECT * FROM bundles_s3;
CREATE VIEW bundle_plans AS SELECT * FROM bundle_plans_s3;
