import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedSql,
  readCatalogSource,
  readSeedState,
  seedFormat,
  seedStateQueries,
  type CatalogSnapshot,
  type CatalogSource,
  type CatalogSourceFile,
  type Price,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

// The seed that scripts/seed-d1.ts runs (BLUEPRINT §5.3, §6.3), against the real D1 schema: it reads what D1 holds
// with seedStateQueries, then runs only what changed. db.batch reports rows_written as D1 bills them (each index
// entry and each deleted row is a row written), which is what the free plan's 100,000 a day counts.
const db = env.DB;

const tables = [
  'providers',
  'provider_categories',
  'plans',
  'prices',
  'features',
  'plan_features',
  'bundles',
  'bundle_plans',
  'catalog',
];

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
      cancelUrl: 'https://www.crave.ca/cancel',
      category: 'streaming',
      spendCategory: 'streaming',
      // A quote and a line break, which SQL literals can't hold as they are.
      notes: "It's live\nand on demand.",
      plans: [
        {
          id: 'crave.premium',
          name: 'Premium',
          link: 'https://example.com/crave.premium',
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
      cancelUrl: 'https://www.netflix.com/cancel',
      category: 'streaming',
      spendCategory: 'streaming',
      plans: [
        {
          id: 'netflix.standard',
          name: 'Standard',
          link: 'https://example.com/netflix.standard',
          features: { 'video.quality': '1080p', 'streaming.concurrent-streams': 2 },
          prices: [price(18.99)],
        },
        {
          id: 'netflix.premium',
          name: 'Premium',
          link: 'https://example.com/netflix.premium',
          features: { 'video.quality': '4k', 'streaming.concurrent-streams': 4 },
          prices: [price(23.99)],
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
      link: 'https://example.com/bundle',
      prices: [price(35)],
    },
  ],
  resellers: [],
  policyTopics: [],
  redirects: [],
  logos: new Map(),
};

let builds = 0;

/** A build of `catalog`: each one gets a new build time, and the version given (the catalog's hash, really). */
function snapshotOf(catalog: CatalogSource, catalogVersion = 'abc1234'): CatalogSnapshot {
  const data = buildCatalogData(catalog, 'https://sub.simplely.ca/icons/');
  const generatedAt = new Date(Date.UTC(2026, 9, 23, 12, 0, builds++)).toISOString();
  return {
    data,
    meta: buildCatalogMeta(data, {
      catalogVersion,
      generatedAt: generatedAt.replace(/\.\d{3}Z$/, 'Z'),
    }),
  };
}

/** The real catalog in data/ (vitest.config.ts reads it). */
function realCatalog(edit?: (files: CatalogSourceFile[]) => void): CatalogSource {
  const files: CatalogSourceFile[] = [
    ...structuredClone(env.TEST_CATALOG.files),
    ...env.TEST_CATALOG.logos.map((file) => ({ file, bytes: new Uint8Array() })),
  ];
  edit?.(files);
  return readCatalogSource(files);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface SeedRun {
  statements: number;
  rowsWritten: number;
}

/** Seeds D1 the way scripts/seed-d1.ts does: from what it holds, or in full. */
async function seed(snapshot: CatalogSnapshot, { full = false } = {}): Promise<SeedRun> {
  const providerHashes = new Map(
    await Promise.all(
      snapshot.data.providers.map(
        async (provider) => [provider.id, await sha256(JSON.stringify(provider))] as const,
      ),
    ),
  );
  const current = full
    ? undefined
    : readSeedState(
        (await db.batch(seedStateQueries.map((query) => db.prepare(query)))).map(
          (result) => result.results,
        ),
      );
  const sql = buildSeedSql(snapshot, { providerHashes, current });
  const statements = sql === '' ? [] : sql.trimEnd().split('\n');
  if (statements.length === 0) {
    return { statements: 0, rowsWritten: 0 };
  }
  const results = await db.batch(statements.map((statement) => db.prepare(statement)));
  return {
    statements: statements.length,
    rowsWritten: results.reduce((sum, result) => sum + result.meta.rows_written, 0),
  };
}

async function count(table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

/** Every catalog row, sorted, for comparing what two ways of seeding left behind. */
async function dump(): Promise<Record<string, unknown[]>> {
  const rows = await Promise.all(
    tables.map(async (table) => {
      const { results } = await db.prepare(`SELECT * FROM ${table}`).all();
      return [table, results.map((row) => JSON.stringify(row)).sort()] as const;
    }),
  );
  return Object.fromEntries(rows);
}

/** The test catalog with `edit` applied to a copy. */
function edited(edit: (catalog: CatalogSource) => void): CatalogSource {
  const catalog = structuredClone(source);
  edit(catalog);
  return catalog;
}

describe('a full seed', () => {
  beforeEach(async () => {
    await seed(snapshotOf(source), { full: true });
  });

  it('fills every table', async () => {
    const counts = Object.fromEntries(
      await Promise.all(tables.map(async (table) => [table, await count(table)])),
    );
    expect(counts).toEqual({
      providers: 2,
      provider_categories: 2,
      plans: 3,
      prices: 4,
      features: 3,
      plan_features: 8,
      bundles: 1,
      bundle_plans: 2,
      catalog: 1,
    });
  });

  it('records the catalog version, build time, seed format and counts for /health', async () => {
    const snapshot = snapshotOf(source, 'def5678');
    await seed(snapshot, { full: true });
    const row = await db.prepare('SELECT * FROM catalog').first();
    expect(row).toEqual({
      id: 1,
      version: 'def5678',
      built_at: snapshot.meta.generatedAt,
      seed_format: seedFormat,
      counts: JSON.stringify(snapshot.meta.counts),
    });
  });

  it("stores each provider's hash", async () => {
    const row = await db
      .prepare(`SELECT hash FROM providers WHERE id = 'crave'`)
      .first<{ hash: string }>();
    const crave = snapshotOf(source).data.providers[0];
    expect(row?.hash).toBe(await sha256(JSON.stringify(crave)));
  });

  it('keeps quotes and line breaks', async () => {
    const row = await db
      .prepare(`SELECT json FROM providers WHERE id = 'crave'`)
      .first<{ json: string }>();
    expect(JSON.parse(row?.json ?? '{}').notes).toBe(source.providers[0].notes);
  });

  it('stores rank values and monthly equivalents', async () => {
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
    await seed(snapshotOf({ ...source, providers: source.providers.slice(0, 1), bundles: [] }), {
      full: true,
    });
    expect(await count('providers')).toBe(1);
    expect(await count('plans')).toBe(1);
    expect(await count('bundles')).toBe(0);
    expect(await count('bundle_plans')).toBe(0);
    expect(await count('catalog')).toBe(1);
  });
});

describe('a seed from what D1 holds', () => {
  beforeEach(async () => {
    await seed(snapshotOf(source), { full: true });
  });

  it('fills an empty D1 in full: the first deploy after migration 0002', async () => {
    const snapshot = snapshotOf(source);
    await db.batch(tables.map((table) => db.prepare(`DELETE FROM ${table}`)));
    await seed(snapshot);
    const fromEmpty = await dump();
    await seed(snapshot, { full: true });
    expect(fromEmpty).toEqual(await dump());
  });

  it.each<[string, (catalog: CatalogSource) => void]>([
    ['a price', (catalog) => (catalog.providers[1].plans[0].prices[0].amount = 20.99)],
    ['a plan of a provider in a bundle', (catalog) => (catalog.providers[0].plans[0].name = 'Max')],
    [
      'a removed provider',
      (catalog) => {
        // Netflix, and the bundle that includes one of its plans.
        catalog.providers.splice(1, 1);
        catalog.bundles = [];
      },
    ],
    [
      'a new provider',
      (catalog) =>
        catalog.providers.push({
          ...structuredClone(catalog.providers[1]),
          id: 'netflix-2',
          plans: [{ ...structuredClone(catalog.providers[1].plans[0]), id: 'netflix-2.standard' }],
        }),
    ],
    [
      'an enum value moved',
      (catalog) => {
        const quality = catalog.features[0];
        if (quality.type === 'enum') {
          quality.values.splice(1, 0, { id: '1440p', name: '1440p (QHD)' });
        }
      },
    ],
    ['a renamed feature', (catalog) => (catalog.features[1].name = 'Screens at once')],
    [
      'a removed feature',
      (catalog) => {
        catalog.features.splice(2, 1);
        delete catalog.providers[0].plans[0].features['streaming.live'];
      },
    ],
    ['a changed bundle', (catalog) => (catalog.bundles[0].prices[0].amount = 33)],
    ['a new category', (catalog) => catalog.categories.spend.push({ id: 'news', name: 'News' })],
  ])('leaves D1 as a full seed would after %s', async (_change, edit) => {
    const changed = snapshotOf(edited(edit), 'def5678');
    await seed(changed);
    const fromChanges = await dump();
    await seed(changed, { full: true });
    expect(fromChanges).toEqual(await dump());
  });
});

describe('rows written', () => {
  beforeEach(async () => {
    await db.batch(tables.map((table) => db.prepare(`DELETE FROM ${table}`)));
  });

  /**
   * What removing, adding and replacing one provider write, starting from the whole catalog. Each also writes the
   * catalog row, since the version changes.
   */
  async function providerCosts(
    catalog: (edit?: (files: CatalogSourceFile[]) => void) => CatalogSource,
    providerId: string,
    edit: (files: CatalogSourceFile[]) => void,
  ) {
    const file = `data/providers/${providerId}.yaml`;
    const without = catalog((files) =>
      files.splice(
        files.findIndex((source) => source.file === file),
        1,
      ),
    );
    await seed(snapshotOf(catalog(), '0000001'), { full: true });
    const removed = await seed(snapshotOf(without, '0000002'));
    const added = await seed(snapshotOf(catalog(), '0000003'));
    const replaced = await seed(snapshotOf(catalog(edit), '0000004'));
    return {
      removed: removed.rowsWritten,
      added: added.rowsWritten,
      replaced: replaced.rowsWritten,
    };
  }

  it('is 0 for a code-only deploy, which builds the same catalog again', async () => {
    await seed(snapshotOf(realCatalog()), { full: true });

    expect(await seed(snapshotOf(realCatalog()))).toEqual({ statements: 0, rowsWritten: 0 });
  });

  it('is only the provider’s rows for a one-provider price change', async () => {
    const netflix = (files: CatalogSourceFile[]) => {
      const file = files.find(({ file }) => file === 'data/providers/netflix.yaml');
      const data =
        file && 'data' in file ? (file.data as CatalogSource['providers'][number]) : undefined;
      if (!data) {
        throw new Error('data/providers/netflix.yaml is missing');
      }
      data.plans[0].prices[0].amount += 1;
    };
    const { removed, added, replaced } = await providerCosts(realCatalog, 'netflix', netflix);

    // Deleting Netflix and inserting it again, and the catalog row once: nothing of any other provider's.
    expect(removed).toBeGreaterThan(1);
    expect(replaced).toBe(removed - 1 + (added - 1) + 1);
  });

  it('counts each row and each index entry, for a full seed of the real catalog into empty tables', async () => {
    const snapshot = snapshotOf(realCatalog());
    const { rowsWritten } = await seed(snapshot, { full: true });
    const rows = (await Promise.all(tables.map(count))).reduce((sum, n) => sum + n, 0);
    // The rows themselves, plus an entry in each of the 4 indexes on prices, plan_features, plans and bundle_plans.
    const indexEntries = (
      await Promise.all(['prices', 'plan_features', 'plans', 'bundle_plans'].map(count))
    ).reduce((sum, n) => sum + n, 0);

    expect(rowsWritten).toBe(rows + indexEntries);
  });

  it('also counts each deleted row, but not its index entries, for a full reseed', async () => {
    const snapshot = snapshotOf(realCatalog());
    const { rowsWritten: intoEmpty } = await seed(snapshot, { full: true });
    const rows = (await Promise.all(tables.map(count))).reduce((sum, n) => sum + n, 0);

    expect((await seed(snapshot, { full: true })).rowsWritten).toBe(rows + intoEmpty);
  });
});
