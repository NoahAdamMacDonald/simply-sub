import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

// The catalog tables as the migrations leave them (BLUEPRINT §5.3): the keys and cascades the seed relies on
// (M2.1), provider_categories (0003, M1.10) and provider_features (0004, M11.4), each named for its shape since 0006
// (M11.8), with a view of its plain name, which the API reads. Writes go to the shape's tables; reads may use views.
const db = env.DB;

/** The shape the migrations' views show: 5 since 0009, until a seed points them at its own. */
const live = 5;

/** A table of the live shape. */
const table = (name: string) => `${name}_s${live}`;

/** Empties the catalog the way a full reseed does (the cascades clear the rest), then adds one plan. */
async function seedNetflix() {
  await db.batch([
    db.prepare('DELETE FROM catalog'),
    db.prepare(`DELETE FROM ${table('providers')}`),
    db.prepare(`DELETE FROM ${table('features')}`),
    db.prepare(`DELETE FROM ${table('bundles')}`),
    db.prepare(
      `INSERT INTO ${table('providers')} (id, name, hash, json, search) VALUES ('netflix', 'Netflix', 'f00', '{}', '{}')`,
    ),
    db.prepare(
      `INSERT INTO ${table('provider_categories')} (category, provider_id) VALUES ('streaming', 'netflix')`,
    ),
    db.prepare(
      `INSERT INTO ${table('plans')} (id, provider_id, name, json)
       VALUES ('netflix.standard', 'netflix', 'Standard', '{}')`,
    ),
    db.prepare(`INSERT INTO ${table('features')} (id, json) VALUES ('video.quality', '{}')`),
    db.prepare(`INSERT INTO ${table('features')} (id, json) VALUES ('platforms', '{}')`),
    db.prepare(
      `INSERT INTO ${table('provider_features')} (feature_id, value, provider_id, rank_value)
       VALUES ('platforms', 'web', 'netflix', NULL)`,
    ),
    db.prepare(
      `INSERT INTO ${table('prices')} (plan_id, region, currency, amount, interval, interval_count, monthly_equiv)
       VALUES ('netflix.standard', 'CA', 'CAD', 18.99, 'month', 1, 18.99)`,
    ),
    db.prepare(
      `INSERT INTO ${table('plan_features')} (plan_id, feature_id, value, rank_value)
       VALUES ('netflix.standard', 'video.quality', '1080p', 2)`,
    ),
    db.prepare(`INSERT INTO ${table('bundles')} (id, json) VALUES ('bundle.test', '{}')`),
    db.prepare(
      `INSERT INTO ${table('bundle_plans')} (bundle_id, plan_id) VALUES ('bundle.test', 'netflix.standard')`,
    ),
  ]);
}

async function count(name: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).first<{ n: number }>();
  return row?.n ?? -1;
}

describe('catalog schema', () => {
  beforeEach(async () => {
    await seedNetflix();
  });

  it('records the migrations as applied', async () => {
    const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      '0001_init.sql',
      '0002_seed_what_changed.sql',
      '0003_provider_categories.sql',
      '0004_provider_features.sql',
      '0005_seed_budget.sql',
      '0006_table_shapes.sql',
      '0007_search_shape.sql',
      '0008_price_pages.sql',
      '0009_drop_shape_4.sql',
    ]);
  });

  it('reads each table of the live shape through a view of its plain name (0006, M11.8)', async () => {
    const { results } = await db
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name`)
      .all<{ name: string; sql: string }>();
    expect(results.map(({ name, sql }) => `${name}: ${sql}`)).toEqual(
      [
        'bundle_plans',
        'bundles',
        'features',
        'plan_features',
        'plans',
        'prices',
        'provider_categories',
        'provider_features',
        'provider_prices',
        'providers',
      ].map((name) => `${name}: CREATE VIEW ${name} AS SELECT * FROM ${table(name)}`),
    );
    expect(await count('providers')).toBe(1);
  });

  it('keeps shape 5 only, every table WITHOUT ROWID and STRICT, and no snapshots table (0009)', async () => {
    const { results } = await db
      .prepare(
        `SELECT name, wr, strict FROM pragma_table_list
         WHERE schema = 'main' AND type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'
           AND name NOT LIKE 'sqlite%' AND name <> 'd1_migrations'
           AND name NOT LIKE 'provider_search%'
         ORDER BY name`,
      )
      .all<{ name: string; wr: number; strict: number }>();
    expect(results).toEqual(
      [
        'bundle_plans_s5',
        'bundles_s5',
        'catalog',
        'features_s5',
        'plan_features_s5',
        'plans_s5',
        'prices_s5',
        'provider_categories_s5',
        'provider_features_s5',
        'provider_prices_s5',
        'providers_s5',
      ].map((name) => ({ name, wr: 1, strict: 1 })),
    );
    // Shape 4's FTS5 table went with its shadow tables, and its indexes with their tables.
    const search = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE name LIKE 'provider\\_search%' ESCAPE '\\' ORDER BY name`,
      )
      .all<{ name: string }>();
    expect(search.results.map(({ name }) => name)).toEqual(
      ['', '_config', '_content', '_data', '_docsize', '_idx'].map(
        (part) => `provider_search_s5${part}`,
      ),
    );
    const indexes = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`,
      )
      .all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name)).toEqual([
      'idx_bundle_plans_plan_s5',
      'idx_pf_feature_s5',
      'idx_plans_provider_s5',
      'idx_prices_region_s5',
    ]);
  });

  it('removes categories, plans, prices, features and bundle links with their provider', async () => {
    await db.prepare(`DELETE FROM ${table('providers')} WHERE id = 'netflix'`).run();

    for (const name of [
      'provider_categories',
      'provider_features',
      'plans',
      'prices',
      'plan_features',
      'bundle_plans',
    ]) {
      expect(await count(name), name).toBe(0);
    }
    expect(await count('bundles')).toBe(1);
  });

  it("removes a provider's own rows of a feature with the feature", async () => {
    await db.prepare(`DELETE FROM ${table('features')} WHERE id = 'platforms'`).run();
    expect(await count('provider_features')).toBe(0);
    expect(await count('providers')).toBe(1);
  });

  it('rejects a plan for a provider that does not exist', async () => {
    const insert = db.prepare(
      `INSERT INTO ${table('plans')} (id, provider_id, name, json) VALUES ('ghost.basic', 'ghost', 'Basic', '{}')`,
    );
    await expect(insert.run()).rejects.toThrow(/FOREIGN KEY/);
  });

  it('rejects a second price for the same plan, region, currency and interval', async () => {
    const insert = db.prepare(
      `INSERT INTO ${table('prices')} (plan_id, region, currency, amount, interval, interval_count, monthly_equiv)
       VALUES ('netflix.standard', 'CA', 'CAD', 20.99, 'month', 1, 20.99)`,
    );
    await expect(insert.run()).rejects.toThrow(/UNIQUE/);
  });

  it('enforces column types (STRICT)', async () => {
    const insert = db.prepare(
      `INSERT INTO ${table('prices')} (plan_id, region, currency, amount, interval, interval_count, monthly_equiv)
       VALUES ('netflix.standard', 'US', 'USD', 'cheap', 'month', 1, 0)`,
    );
    await expect(insert.run()).rejects.toThrow(/cannot store TEXT value in REAL column/);
  });

  it('needs a hash for every provider', async () => {
    const insert = db.prepare(
      `INSERT INTO ${table('providers')} (id, name, json, search) VALUES ('crave', 'Crave', '{}', '{}')`,
    );
    await expect(insert.run()).rejects.toThrow(/NOT NULL/);
  });

  it('keeps one catalog row', async () => {
    const insert = (id: number) =>
      db
        .prepare(
          `INSERT INTO catalog (id, version, built_at, seed_format, counts)
           VALUES (?, 'abc1234', '2026-10-23T12:00:00Z', 1, '{}')`,
        )
        .bind(id)
        .run();
    await insert(1);
    await expect(insert(2)).rejects.toThrow(/CHECK/);
    await expect(insert(1)).rejects.toThrow(/UNIQUE/);
  });

  it('starts a catalog row with nothing waiting, no day counted and no currencies (0005, 0008)', async () => {
    await db
      .prepare(
        `INSERT INTO catalog (id, version, built_at, seed_format, counts)
         VALUES (1, 'abc1234', '2026-10-23T12:00:00Z', 1, '{}')`,
      )
      .run();
    expect(
      await db.prepare('SELECT waiting, written_on, written, currencies FROM catalog').first(),
    ).toEqual({ waiting: 0, written_on: null, written: 0, currencies: '[]' });
  });

  it("keeps shape 5's lowest prices by currency, ties by name, and removes them with their provider (0008)", async () => {
    // seedNetflix put Netflix in providers_s5.
    await db
      .prepare(
        `INSERT INTO provider_prices_s5 (currency, low, name, provider_id) VALUES ('CAD', 7.99, 'netflix', 'netflix')`,
      )
      .run();
    // The walk GET /providers' price pages take (M11.8): in the key's order, with no sort of its own.
    const plan = await db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT low, name, provider_id FROM provider_prices_s5 WHERE currency = 'CAD' ORDER BY low, name, provider_id LIMIT 10`,
      )
      .all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail)).toEqual([
      'SEARCH provider_prices_s5 USING PRIMARY KEY (currency=?)',
    ]);

    await db.prepare(`DELETE FROM providers_s5 WHERE id = 'netflix'`).run();
    expect(await count('provider_prices_s5')).toBe(0);
  });
});
