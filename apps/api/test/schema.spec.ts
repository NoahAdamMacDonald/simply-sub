import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

// The catalog tables as migrations/0002_seed_what_changed.sql leaves them (BLUEPRINT §5.3): the keys
// and cascades the seed relies on (M2.1).
const db = env.DB;

/** Empties the catalog the way a full reseed does (the cascades clear the rest), then adds one plan. */
async function seedNetflix() {
  await db.batch([
    db.prepare('DELETE FROM catalog'),
    db.prepare('DELETE FROM providers'),
    db.prepare('DELETE FROM features'),
    db.prepare('DELETE FROM bundles'),
    db.prepare(
      `INSERT INTO providers (id, name, hash, json) VALUES ('netflix', 'Netflix', 'f00', '{}')`,
    ),
    db.prepare(
      `INSERT INTO plans (id, provider_id, name, json)
       VALUES ('netflix.standard', 'netflix', 'Standard', '{}')`,
    ),
    db.prepare(`INSERT INTO features (id, json) VALUES ('video.quality', '{}')`),
    db.prepare(
      `INSERT INTO prices (plan_id, region, currency, amount, interval, interval_count, monthly_equiv)
       VALUES ('netflix.standard', 'CA', 'CAD', 18.99, 'month', 1, 18.99)`,
    ),
    db.prepare(
      `INSERT INTO plan_features (plan_id, feature_id, value, rank_value)
       VALUES ('netflix.standard', 'video.quality', '1080p', 2)`,
    ),
    db.prepare(`INSERT INTO bundles (id, json) VALUES ('bundle.test', '{}')`),
    db.prepare(
      `INSERT INTO bundle_plans (bundle_id, plan_id) VALUES ('bundle.test', 'netflix.standard')`,
    ),
  ]);
}

async function count(table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

describe('catalog schema', () => {
  beforeEach(async () => {
    await seedNetflix();
  });

  it('records the migrations as applied', async () => {
    const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(['0001_init.sql', '0002_seed_what_changed.sql']);
  });

  it('has no snapshots table, and keeps every table WITHOUT ROWID and STRICT', async () => {
    const { results } = await db
      .prepare(
        `SELECT name, wr, strict FROM pragma_table_list
         WHERE schema = 'main' AND type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'
           AND name NOT LIKE 'sqlite%' AND name <> 'd1_migrations'
         ORDER BY name`,
      )
      .all<{ name: string; wr: number; strict: number }>();
    expect(results).toEqual(
      [
        'bundle_plans',
        'bundles',
        'catalog',
        'features',
        'plan_features',
        'plans',
        'prices',
        'providers',
      ].map((name) => ({ name, wr: 1, strict: 1 })),
    );
  });

  it('removes plans, prices, features and bundle links with their provider', async () => {
    await db.prepare(`DELETE FROM providers WHERE id = 'netflix'`).run();

    for (const table of ['plans', 'prices', 'plan_features', 'bundle_plans']) {
      expect(await count(table), table).toBe(0);
    }
    expect(await count('bundles')).toBe(1);
  });

  it('rejects a plan for a provider that does not exist', async () => {
    const insert = db.prepare(
      `INSERT INTO plans (id, provider_id, name, json) VALUES ('ghost.basic', 'ghost', 'Basic', '{}')`,
    );
    await expect(insert.run()).rejects.toThrow(/FOREIGN KEY/);
  });

  it('rejects a second price for the same plan, region, currency and interval', async () => {
    const insert = db.prepare(
      `INSERT INTO prices (plan_id, region, currency, amount, interval, interval_count, monthly_equiv)
       VALUES ('netflix.standard', 'CA', 'CAD', 20.99, 'month', 1, 20.99)`,
    );
    await expect(insert.run()).rejects.toThrow(/UNIQUE/);
  });

  it('enforces column types (STRICT)', async () => {
    const insert = db.prepare(
      `INSERT INTO prices (plan_id, region, currency, amount, interval, interval_count, monthly_equiv)
       VALUES ('netflix.standard', 'US', 'USD', 'cheap', 'month', 1, 0)`,
    );
    await expect(insert.run()).rejects.toThrow(/cannot store TEXT value in REAL column/);
  });

  it('needs a hash for every provider', async () => {
    const insert = db.prepare(
      `INSERT INTO providers (id, name, json) VALUES ('crave', 'Crave', '{}')`,
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
});
