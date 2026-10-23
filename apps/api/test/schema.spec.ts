import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

// migrations/0001_init.sql (BLUEPRINT §5.3): the keys and cascades a full reseed relies on (M1.5).
const db = env.DB;

/** Empties the catalog the way a full reseed does (the cascades clear the rest), then adds one plan. */
async function seedNetflix() {
  await db.batch([
    db.prepare('DELETE FROM providers'),
    db.prepare('DELETE FROM features'),
    db.prepare('DELETE FROM bundles'),
    db.prepare('DELETE FROM snapshots'),
    db.prepare(`INSERT INTO providers (id, name, json) VALUES ('netflix', 'Netflix', '{}')`),
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

  it('records the migration as applied', async () => {
    const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(['0001_init.sql']);
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
});
