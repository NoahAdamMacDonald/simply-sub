import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedSql,
  type CatalogSnapshot,
  type CatalogSource,
  type Price,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// The seed.sql that scripts/build-catalog.ts writes (BLUEPRINT §6.3), run against the real D1 schema: the deploy
// runs the same statements with `wrangler d1 execute --file` (BLUEPRINT §7.6).
const db = env.DB;

function price(amount: number, interval: Price['interval'] = 'month'): Price {
  return {
    region: 'CA',
    currency: 'CAD',
    amount,
    interval,
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

const source: CatalogSource = {
  features: [
    {
      id: 'video.quality',
      name: 'Video quality',
      category: 'streaming',
      type: 'enum',
      values: [
        { id: '1080p', name: '1080p (Full HD)' },
        { id: '4k', name: '4K (Ultra HD)' },
      ],
    },
    { id: 'streaming.concurrent-streams', name: 'Streams', category: 'streaming', type: 'number' },
    {
      id: 'streaming.live',
      name: 'Live TV and sports',
      category: 'streaming',
      type: 'set',
      values: [
        { id: 'tv-channels', name: 'Live TV channels' },
        { id: 'sports', name: 'Live sports' },
      ],
    },
  ],
  categories: {
    service: [{ id: 'streaming', name: 'Streaming video', icon: 'live_tv' }],
    feature: [{ id: 'streaming', name: 'Streaming' }],
    spend: [{ id: 'streaming', name: 'Streaming & digital media' }],
  },
  providers: [
    {
      id: 'crave',
      name: 'Crave',
      website: 'https://www.crave.ca',
      category: 'streaming',
      spendCategory: 'streaming',
      // A quote and a line break, which SQL literals can't hold as they are, and enough text that the snapshot
      // goes into its row in several pieces.
      notes: `It's live\nand on demand. ${'More. '.repeat(8_000)}`,
      plans: [
        {
          id: 'crave.premium',
          name: 'Premium',
          features: {
            'video.quality': '4k',
            'streaming.concurrent-streams': 'unlimited',
            'streaming.live': ['tv-channels', 'sports'],
          },
          prices: [price(22), price(220, 'year')],
        },
      ],
    },
    {
      id: 'netflix',
      name: 'Netflix',
      website: 'https://www.netflix.com',
      category: 'streaming',
      spendCategory: 'streaming',
      plans: [
        {
          id: 'netflix.standard',
          name: 'Standard',
          features: { 'video.quality': '1080p', 'streaming.concurrent-streams': 2 },
          prices: [price(18.99)],
        },
      ],
    },
  ],
  bundles: [
    {
      id: 'bundle.netflix-crave',
      name: 'Netflix and Crave',
      soldBy: 'crave',
      includes: ['netflix.standard', 'crave.premium'],
      prices: [price(35)],
    },
  ],
};

function snapshotOf(catalog: CatalogSource): CatalogSnapshot {
  const data = buildCatalogData(catalog, 'https://simplely.ca/simply/sub/icons/');
  return {
    data,
    meta: buildCatalogMeta(data, {
      catalogVersion: 'abc1234',
      generatedAt: '2026-10-23T12:00:00Z',
    }),
  };
}

async function seed(snapshot: CatalogSnapshot): Promise<void> {
  const statements = buildSeedSql(snapshot).trimEnd().split('\n');
  await db.batch(statements.map((statement) => db.prepare(statement)));
}

async function count(table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

describe('seed.sql', () => {
  it('fills every table', async () => {
    await seed(snapshotOf(source));
    const counts = Object.fromEntries(
      await Promise.all(
        [
          'providers',
          'plans',
          'prices',
          'features',
          'plan_features',
          'bundles',
          'bundle_plans',
          'snapshots',
        ].map(async (table) => [table, await count(table)]),
      ),
    );
    expect(counts).toEqual({
      providers: 2,
      plans: 2,
      prices: 3,
      features: 3,
      plan_features: 6,
      bundles: 1,
      bundle_plans: 2,
      snapshots: 1,
    });
  });

  it('stores the snapshot as the exact text of data/catalog.json, put back together from its pieces', async () => {
    const snapshot = snapshotOf(source);
    await seed(snapshot);
    const row = await db
      .prepare(`SELECT sha, built_at, json FROM snapshots WHERE region = 'ALL'`)
      .first<{ sha: string; built_at: string; json: string }>();
    expect(row).toEqual({
      sha: 'abc1234',
      built_at: '2026-10-23T12:00:00Z',
      json: JSON.stringify(snapshot),
    });
  });

  it('keeps quotes and line breaks', async () => {
    await seed(snapshotOf(source));
    const row = await db
      .prepare(`SELECT json FROM providers WHERE id = 'crave'`)
      .first<{ json: string }>();
    expect(JSON.parse(row?.json ?? '{}').notes).toBe(source.providers[0].notes);
  });

  it('stores rank values and monthly equivalents', async () => {
    await seed(snapshotOf(source));
    const { results: features } = await db
      .prepare(
        `SELECT feature_id, value, rank_value FROM plan_features WHERE plan_id = 'crave.premium'
         ORDER BY feature_id, value`,
      )
      .all();
    expect(features).toEqual([
      { feature_id: 'streaming.concurrent-streams', value: 'unlimited', rank_value: 1e308 },
      { feature_id: 'streaming.live', value: 'sports', rank_value: null },
      { feature_id: 'streaming.live', value: 'tv-channels', rank_value: null },
      { feature_id: 'video.quality', value: '4k', rank_value: 1 },
    ]);
    const yearly = await db
      .prepare(
        `SELECT monthly_equiv FROM prices WHERE plan_id = 'crave.premium' AND interval = 'year'`,
      )
      .first<{ monthly_equiv: number }>();
    expect(yearly?.monthly_equiv).toBeCloseTo(220 / 12, 10);
  });

  it('replaces the previous catalog', async () => {
    await seed(snapshotOf(source));
    await seed(snapshotOf({ ...source, providers: source.providers.slice(0, 1), bundles: [] }));
    expect(await count('providers')).toBe(1);
    expect(await count('plans')).toBe(1);
    expect(await count('bundles')).toBe(0);
    expect(await count('bundle_plans')).toBe(0);
    expect(await count('snapshots')).toBe(1);
  });
});
