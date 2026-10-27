-- M1.10 (BLUEPRINT §4.3, §5.3): a plan can be in service categories of its own (Proton VPN Plus is a VPN, while
-- Proton is a privacy suite), so GET /providers?category= finds a provider by any category its plans are in, through
-- this table, rather than by providers.category, its main one. The seed writes one row per category of each provider
-- (core's providerCategories), and deleting a provider takes its rows. seedFormat 2 in core makes the next seed fill
-- the table in full.
-- The key starts with the category, which every GET /providers?category= reads by. There's no index by provider:
-- each index entry is a row written, and the cascade that would use it runs only when a provider changes, scanning a
-- small table.

CREATE TABLE provider_categories (
  category TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers (id) ON DELETE CASCADE,
  PRIMARY KEY (category, provider_id)
) STRICT, WITHOUT ROWID;
