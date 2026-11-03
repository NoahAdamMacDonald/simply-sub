import {
  buildCatalogData,
  buildCatalogMeta,
  planSeed,
  providersToRead,
  readCatalogSource,
  readSeedState,
  readStoredRows,
  seedFormat,
  seedStateQueries,
  storedRowQueries,
  type CatalogSnapshot,
  type CatalogSource,
  type CatalogSourceFile,
  type Price,
  type SeedFormat,
  type SeedOptions,
  type SeedSource,
  type SeedTable,
  seedShape,
  sqlTable,
  storedHash,
  type SeedStep,
  buildSeedIndex,
  seedNext,
  seedTables,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

// The seed that scripts/seed-d1.ts runs (BLUEPRINT §5.3, §6.3), against the real D1 schema: it reads what D1 holds
// with seedStateQueries and the changed providers' rows with storedRowQueries, then writes only the rows that changed
// (M11.8). db.batch reports rows_written as D1 bills them (each index entry and each deleted row is a row written),
// which is what the free plan's 100,000 a day counts, and what core's estimate must match.
const db = env.DB;

const tables: SeedTable[] = [
  'providers',
  'provider_categories',
  'plans',
  'prices',
  'features',
  'plan_features',
  'provider_features',
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
  policySets: [],
  redirects: [],
  raters: [],
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

/** The tests' own catalog, test/fixtures/catalog/ (vitest.config.ts reads it, M11.8). */
function testCatalog(edit?: (files: CatalogSourceFile[]) => void): CatalogSource {
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
  /** What core said it would write. */
  estimated: number;
  /** What it left for the next seed. */
  waiting: string[];
}

/** Seeds D1 the way scripts/seed-d1.ts does: from what it holds, or in full, within `budget` when there's one. */
async function seed(
  snapshot: CatalogSnapshot,
  { full = false, budget }: { full?: boolean; budget?: SeedOptions['budget'] } = {},
): Promise<SeedRun> {
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
        (await db.batch(seedStateQueries().map((query) => db.prepare(query)))).map(
          (result) => result.results,
        ),
      );
  const ids = current ? providersToRead(snapshot, { providerHashes, current }) : [];
  const rows =
    ids.length > 0
      ? readStoredRows(
          ids,
          (await db.batch(storedRowQueries(ids).map((query) => db.prepare(query)))).map(
            (result) => result.results,
          ),
        )
      : undefined;
  const plan = planSeed(snapshot, { providerHashes, current, rows, budget });
  const statements = plan.sql === '' ? [] : plan.sql.trimEnd().split('\n');
  if (statements.length === 0) {
    return { statements: 0, rowsWritten: 0, estimated: plan.writes, waiting: plan.waiting };
  }
  const results = await db.batch(statements.map((statement) => db.prepare(statement)));
  return {
    statements: statements.length,
    rowsWritten: results.reduce((sum, result) => sum + result.meta.rows_written, 0),
    estimated: plan.writes,
    waiting: plan.waiting,
  };
}

/** Empties the catalog's tables: the live shape's, which the API reads through views (M11.8). */
async function emptyCatalog(): Promise<void> {
  await db.batch(tables.map((table) => db.prepare(`DELETE FROM ${sqlTable(seedShape, table)}`)));
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
      provider_features: 0,
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
      // Nothing waits, and without a budget (a test's, a local D1's) no day's count is kept (M11.8).
      waiting: 0,
      written_on: null,
      written: 0,
    });
  });

  it("stores each provider's hash", async () => {
    const row = await db
      .prepare(`SELECT hash FROM providers WHERE id = 'crave'`)
      .first<{ hash: string }>();
    const crave = snapshotOf(source).data.providers[0];
    // Under the seed format, so a new format compares every provider again (M11.8).
    expect(row?.hash).toBe(storedHash(seedFormat, await sha256(JSON.stringify(crave))));
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
    await emptyCatalog();
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
    [
      'a provider-wide feature',
      (catalog) => {
        catalog.features.push(platforms);
        catalog.providers[1].features = { platforms: ['web', 'tv'] };
      },
    ],
    ['a new category', (catalog) => catalog.categories.spend.push({ id: 'news', name: 'News' })],
  ])('leaves D1 as a full seed would after %s', async (_change, edit) => {
    const changed = snapshotOf(edited(edit), 'def5678');
    await seed(changed);
    const fromChanges = await dump();
    await seed(changed, { full: true });
    expect(fromChanges).toEqual(await dump());
  });
});

/** A provider-wide feature (M11.4), which a provider states once for its plans. */
const platforms: CatalogSource['features'][number] = {
  id: 'platforms',
  name: 'Platforms',
  category: 'streaming',
  type: 'set',
  values: [
    { id: 'web', name: 'Web browser' },
    { id: 'tv', name: 'TVs and streaming devices' },
    { id: 'ios', name: 'iPhone and iPad' },
  ],
  providerWide: true,
};

describe('provider-wide features (M11.4)', () => {
  beforeEach(async () => {
    await emptyCatalog();
  });

  it("writes a provider's platforms once, not once per plan", async () => {
    const once = edited((catalog) => {
      catalog.features.push(platforms);
      catalog.providers[1].features = { platforms: ['web', 'tv', 'ios'] };
    });
    const perPlan = edited((catalog) => {
      catalog.features.push(platforms);
      for (const plan of catalog.providers[1].plans)
        plan.features['platforms'] = ['web', 'tv', 'ios'];
    });
    await seed(snapshotOf(source), { full: true });
    const providerWide = await seed(snapshotOf(once, 'def5678'));
    expect(await count('provider_features')).toBe(3);
    const { results } = await db.prepare('SELECT * FROM provider_features ORDER BY value').all();
    expect(results).toEqual(
      ['ios', 'tv', 'web'].map((value) => ({
        feature_id: 'platforms',
        value,
        provider_id: 'netflix',
        rank_value: null,
      })),
    );

    await seed(snapshotOf(source), { full: true });
    const onEachPlan = await seed(snapshotOf(perPlan, 'def5678'));
    // Netflix's two plans: 3 rows each with an index entry, and each plan's json (M11.8), against 3 rows once.
    expect(onEachPlan.rowsWritten - providerWide.rowsWritten).toBe(2 * 3 * 2 + 2 - 3);
  });

  it("goes with its provider: replacing or deleting it takes the provider's rows", async () => {
    const withPlatforms = edited((catalog) => {
      catalog.features.push(platforms);
      catalog.providers[1].features = { platforms: ['web'] };
    });
    await seed(snapshotOf(withPlatforms), { full: true });
    await seed(
      snapshotOf(
        edited((catalog) => {
          catalog.features.push(platforms);
          catalog.providers[1].features = { platforms: ['tv'] };
        }),
        'def5678',
      ),
    );
    expect(
      await db
        .prepare('SELECT value FROM provider_features')
        .all()
        .then((r) => r.results),
    ).toEqual([{ value: 'tv' }]);
    await seed(
      snapshotOf(
        edited((catalog) => catalog.features.push(platforms)),
        '1234567',
      ),
    );
    expect(await count('provider_features')).toBe(0);
  });
});

describe('rows written', () => {
  beforeEach(async () => {
    await emptyCatalog();
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
    await seed(snapshotOf(testCatalog()), { full: true });

    expect(await seed(snapshotOf(testCatalog()))).toEqual({
      statements: 0,
      rowsWritten: 0,
      estimated: 0,
      waiting: [],
    });
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
    const { removed, added, replaced } = await providerCosts(testCatalog, 'netflix', netflix);

    // Since M11.8 only the rows that changed (the price with its index entry, its plan's json, Netflix's json and
    // hash) and the catalog row, not deleting Netflix and inserting it again.
    expect(replaced).toBe(5);
    expect(removed + added).toBeGreaterThan(20 * replaced);
  });

  it('counts each row and each index entry, for a full seed of the tests’ catalog into empty tables', async () => {
    const snapshot = snapshotOf(testCatalog());
    const { rowsWritten } = await seed(snapshot, { full: true });
    const rows = (await Promise.all(tables.map(count))).reduce((sum, n) => sum + n, 0);
    // The rows themselves, plus an entry in each of the 4 indexes on prices, plan_features, plans and bundle_plans
    // (provider_categories and provider_features have none).
    const indexEntries = (
      await Promise.all(['prices', 'plan_features', 'plans', 'bundle_plans'].map(count))
    ).reduce((sum, n) => sum + n, 0);

    expect(rowsWritten).toBe(rows + indexEntries);
  });

  it('also counts each deleted row, but not its index entries, for a full reseed', async () => {
    const snapshot = snapshotOf(testCatalog());
    const { rowsWritten: intoEmpty } = await seed(snapshot, { full: true });
    const rows = (await Promise.all(tables.map(count))).reduce((sum, n) => sum + n, 0);

    expect((await seed(snapshot, { full: true })).rowsWritten).toBe(rows + intoEmpty);
  });
});

/** The tests' catalog with `edit` applied to its source. */
function changed(edit: (catalog: CatalogSource) => void): CatalogSource {
  const catalog = testCatalog();
  edit(catalog);
  return catalog;
}

describe('the estimate (M11.8)', () => {
  beforeEach(async () => {
    await emptyCatalog();
  });

  it.each<[string, (catalog: CatalogSource) => void]>([
    ['a price', (catalog) => (catalog.providers[0].plans[0].prices[0].amount += 1)],
    [
      'a plan gone',
      (catalog) => {
        const proton = catalog.providers.find((provider) => provider.id === 'proton');
        proton?.plans.splice(1, 1);
      },
    ],
    ['a provider gone', (catalog) => catalog.providers.splice(1, 1)],
    [
      'a provider new',
      (catalog) =>
        catalog.providers.push({
          ...structuredClone(catalog.providers[0]),
          id: 'zz',
          plans: catalog.providers[0].plans.map((plan) => ({
            ...structuredClone(plan),
            id: plan.id.replace(/^[^.]+/, 'zz'),
          })),
        }),
    ],
    [
      'an enum value moved',
      (catalog) => {
        const quality = catalog.features.find((feature) => feature.id === 'video.quality');
        if (quality?.type === 'enum') quality.values.splice(1, 0, { id: '1440p', name: '1440p' });
      },
    ],
    ['a feature renamed', (catalog) => (catalog.features[0].name = 'Something else')],
  ])('is what D1 counts, for %s', async (_change, edit) => {
    await seed(snapshotOf(testCatalog()), { full: true });
    const run = await seed(snapshotOf(changed(edit), 'def5678'));

    expect(run.rowsWritten).toBeGreaterThan(0);
    expect(run.estimated).toBe(run.rowsWritten);
  });

  it('is what D1 counts, for a full seed into empty tables and over full ones', async () => {
    const first = await seed(snapshotOf(testCatalog()));
    expect(first.estimated).toBe(first.rowsWritten);
    const current = readSeedState(
      (await db.batch(seedStateQueries().map((query) => db.prepare(query)))).map(
        (result) => result.results,
      ),
    );
    // Another seed format: everything again, the deletes counted from D1's row counts.
    const snapshot = snapshotOf(testCatalog(), 'def5678');
    const hashes = new Map(snapshot.data.providers.map((provider) => [provider.id, 'x']));
    const plan = planSeed(snapshot, {
      providerHashes: hashes,
      current: {
        ...current,
        ...(current.catalog && { catalog: { ...current.catalog, seedFormat: seedFormat - 1 } }),
      },
    });
    const results = await db.batch(
      plan.sql
        .trimEnd()
        .split('\n')
        .map((statement) => db.prepare(statement)),
    );
    expect(plan.writes).toBe(results.reduce((sum, result) => sum + result.meta.rows_written, 0));
  });

  it('is each provider’s few rows for a feature added to 100 providers', async () => {
    // 100 providers like Netflix, each with its two plans.
    const hundred = (withFeature: boolean) =>
      edited((catalog) => {
        if (withFeature) catalog.features.push(platforms);
        const [netflix] = catalog.providers.splice(1, 1);
        catalog.bundles = [];
        for (let n = 0; n < 100; n++) {
          const id = `netflix-${n}`;
          catalog.providers.push({
            ...structuredClone(netflix),
            id,
            ...(withFeature && { features: { platforms: ['web', 'tv'] } }),
            plans: netflix.plans.map((plan) => ({
              ...structuredClone(plan),
              id: plan.id.replace('netflix', id),
            })),
          });
        }
      });
    await seed(snapshotOf(hundred(false)), { full: true });
    const run = await seed(snapshotOf(hundred(true), 'def5678'));

    // Each provider's json and 2 provider_features rows, the feature, and the catalog row.
    expect(run.rowsWritten).toBe(100 * 3 + 1 + 1);
    expect(run.estimated).toBe(run.rowsWritten);
  });
});

describe('the daily budget (M11.8)', () => {
  beforeEach(async () => {
    await emptyCatalog();
  });

  const today = '2026-11-03';
  const catalogRow = () =>
    db
      .prepare('SELECT version, waiting, written_on, written FROM catalog')
      .first<{ version: string; waiting: number; written_on: string | null; written: number }>();

  it('applies whole providers until the next wouldn’t fit, and the next seeds carry on', async () => {
    const before = snapshotOf(testCatalog(), 'abc1234');
    await seed(before, { full: true });
    // Every provider's price up: each costs its few rows.
    const after = snapshotOf(
      changed((catalog) => {
        for (const provider of catalog.providers) provider.plans[0].prices[0].amount += 1;
      }),
      'def5678',
    );
    const providers = after.data.providers.map((provider) => provider.id);

    const first = await seed(after, { budget: { today, daily: 12 } });
    expect(first.rowsWritten).toBeLessThanOrEqual(12);
    expect(first.estimated).toBe(first.rowsWritten);
    expect(first.waiting.length).toBeGreaterThan(0);
    // The ones that wait are the last in the catalog's order.
    expect(first.waiting).toEqual(providers.slice(providers.length - first.waiting.length));
    expect(await catalogRow()).toEqual({
      version: 'abc1234',
      waiting: first.waiting.length,
      written_on: today,
      written: first.rowsWritten,
    });

    // The same day: nothing left, nothing written.
    expect((await seed(after, { budget: { today, daily: 12 } })).statements).toBe(0);

    // The next days, until nothing waits; then the catalog row names the new version.
    let day = 4;
    for (let left = first.waiting.length; left > 0; day++) {
      const next = await seed(after, { budget: { today: `2026-11-0${day}`, daily: 12 } });
      expect(next.waiting.length).toBeLessThan(left);
      left = next.waiting.length;
    }
    expect(await catalogRow()).toMatchObject({ version: 'def5678', waiting: 0 });
    // The rows a full seed writes, but for the catalog row's count of the day's writes, which a full seed restarts.
    const resumed = { ...(await dump()), catalog: [] };
    await seed(after, { full: true });
    expect(resumed).toEqual({ ...(await dump()), catalog: [] });
  });

  it('fills an empty D1 over several days, naming no version until it holds the whole catalog', async () => {
    const snapshot = snapshotOf(source, 'def5678');
    // Its features, Crave and the catalog row, with room kept for the bundle and the switch of views.
    const first = await seed(snapshot, { budget: { today, daily: 48 } });
    expect(first.waiting).toEqual(['netflix', 'bundle.netflix-crave']);
    expect(await catalogRow()).toMatchObject({ version: '0000000', waiting: 2 });

    await seed(snapshot, { budget: { today: '2026-11-04', daily: 50_000 } });
    expect(await catalogRow()).toMatchObject({ version: 'def5678', waiting: 0 });
  });
});

describe('the catalog tables', () => {
  it('have the keys and indexes core counts writes with', async () => {
    for (const [table, shape] of Object.entries(seedTables)) {
      const { results } = await db
        .prepare(
          `SELECT name, origin FROM pragma_index_list('${sqlTable(seedShape, table as SeedTable)}') WHERE origin = 'c'`,
        )
        .all<{ name: string }>();
      const indexes = await Promise.all(
        results.map(async ({ name }) =>
          (
            await db
              .prepare(`SELECT name FROM pragma_index_info('${name}') ORDER BY seqno`)
              .all<{ name: string }>()
          ).results.map((column) => column.name),
        ),
      );
      const key = (
        await db
          .prepare(
            `SELECT name FROM pragma_table_info('${sqlTable(seedShape, table as SeedTable)}') WHERE pk > 0 ORDER BY pk`,
          )
          .all<{ name: string }>()
      ).results.map((column) => column.name);
      expect({ table, key, indexes }).toEqual({ table, key: shape.key, indexes: shape.indexes });
    }
  });
});

describe('the bot’s steps (M11.8)', () => {
  beforeEach(async () => {
    await emptyCatalog();
  });

  /** D1 as the bot's seed uses it, counting what each write wrote. */
  const written: number[] = [];
  const database = {
    read: async (queries: readonly string[]) =>
      (await db.batch(queries.map((query) => db.prepare(query)))).map((result) => result.results),
    write: async (statements: readonly string[]) => {
      const results = await db.batch(statements.map((statement) => db.prepare(statement)));
      written.push(results.reduce((sum, result) => sum + result.meta.rows_written, 0));
    },
  };

  /** The build as data:build publishes it: its seed index and a file per provider. */
  async function sourceOf(
    snapshot: CatalogSnapshot,
    files = new Map(
      snapshot.data.providers.map((provider) => [provider.id, JSON.stringify(provider)]),
    ),
    format = seedFormat,
  ): Promise<SeedSource> {
    const hashes = new Map(
      await Promise.all(
        snapshot.data.providers.map(
          async (provider) => [provider.id, await sha256(JSON.stringify(provider))] as const,
        ),
      ),
    );
    const index = buildSeedIndex(snapshot, hashes, format);
    return {
      index: async () => index,
      provider: async (id) => files.get(id) ?? '',
      sha256,
    };
  }

  /** One night: steps until nothing more fits, or nothing waits. */
  async function night(
    source: SeedSource,
    today: string,
    daily: number,
    format?: SeedFormat,
  ): Promise<SeedStep[]> {
    const steps: SeedStep[] = [];
    for (;;) {
      written.length = 0;
      const step = await seedNext(database, source, { today, daily }, format);
      // What it said it wrote is what D1 counted.
      expect(step.writes).toBe(written[0] ?? 0);
      steps.push(step);
      if (step.result !== 'more') return steps;
    }
  }

  const everyPrice = () =>
    snapshotOf(
      changed((catalog) => {
        for (const provider of catalog.providers) provider.plans[0].prices[0].amount += 1;
      }),
      'def5678',
    );

  it('brings in what a deploy left, a provider a step, and ends where a full seed would', async () => {
    await seed(snapshotOf(testCatalog(), 'abc1234'), { full: true });
    const after = everyPrice();
    const deploy = await seed(after, { budget: { today: '2026-11-03', daily: 12 } });
    expect(deploy.waiting.length).toBeGreaterThan(5);

    const source = await sourceOf(after);
    const first = await night(source, '2026-11-04', 12);
    // Two providers of 4 rows, each with the catalog row's 1, and then the next doesn't fit.
    expect(first.map((step) => step.result)).toEqual(['more', 'more', 'budget']);
    expect(first.map((step) => step.wrote)).toEqual([
      deploy.waiting[0],
      deploy.waiting[1],
      undefined,
    ]);
    expect((await db.prepare('SELECT version, waiting FROM catalog').first())?.['waiting']).toBe(
      deploy.waiting.length - 2,
    );

    for (let day = 5; day < 10; day++) {
      const steps = await night(source, `2026-11-0${day}`, 50_000);
      if (steps.at(-1)?.result === 'done') break;
    }
    expect(await db.prepare('SELECT version, waiting FROM catalog').first()).toEqual({
      version: 'def5678',
      waiting: 0,
    });
    const resumed = { ...(await dump()), catalog: [] };
    await seed(after, { full: true });
    expect(resumed).toEqual({ ...(await dump()), catalog: [] });
  });

  it('writes the registry’s changes first, when the deploy could write none of it', async () => {
    await seed(snapshotOf(testCatalog(), 'abc1234'), { full: true });
    // 1440p goes in before 4k: every 4k row's rank moves, and a price changes.
    const after = snapshotOf(
      changed((catalog) => {
        const quality = catalog.features.find((feature) => feature.id === 'video.quality');
        if (quality?.type === 'enum') quality.values.splice(-1, 0, { id: '1440p', name: '1440p' });
        catalog.providers[0].plans[0].prices[0].amount += 1;
      }),
      'def5678',
    );
    const deploy = await seed(after, { budget: { today: '2026-11-03', daily: 2 } });
    // Nothing fits but the catalog row, which says what waits.
    expect(deploy.rowsWritten).toBe(1);

    const steps = await night(await sourceOf(after), '2026-11-04', 50_000);
    // The last provider's step names the build in the catalog row.
    expect(steps.map((step) => step.wrote)).toEqual([
      'the registry and removals',
      after.data.providers[0].id,
    ]);
    expect(steps.at(-1)?.result).toBe('done');
    const resumed = { ...(await dump()), catalog: [] };
    await seed(after, { full: true });
    expect(resumed).toEqual({ ...(await dump()), catalog: [] });
  });

  it('does nothing when nothing waits', async () => {
    const snapshot = snapshotOf(testCatalog(), 'abc1234');
    await seed(snapshot, { full: true });
    expect(
      await seedNext(database, await sourceOf(snapshot), { today: '2026-11-04', daily: 50_000 }),
    ).toEqual({
      result: 'idle',
      writes: 0,
    });
  });

  it('refuses a provider file that isn’t the one the index names, writing nothing', async () => {
    await seed(snapshotOf(testCatalog(), 'abc1234'), { full: true });
    const after = everyPrice();
    await seed(after, { budget: { today: '2026-11-03', daily: 2 } });
    const source = await sourceOf(after, new Map());
    // The registry is unchanged, so the first step is a provider's.
    await expect(
      seedNext(database, source, { today: '2026-11-04', daily: 50_000 }),
    ).rejects.toThrow("isn't the file the seed index names");
  });

  /** A new shape's tables as its migration would make them: the live shape's, under the new number (M11.8). */
  async function createShape(shape: number): Promise<void> {
    const { results } = await db
      .prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE sql IS NOT NULL AND (name LIKE '%\\_s${seedShape}' ESCAPE '\\'
           OR (type = 'index' AND tbl_name LIKE '%\\_s${seedShape}' ESCAPE '\\'))`,
      )
      .all<{ type: string; name: string; sql: string }>();
    const renamed = (sql: string) => sql.replaceAll(`_s${seedShape}`, `_s${shape}`);
    await db.batch(
      [
        ...results.filter(({ type }) => type === 'table').map(({ sql }) => renamed(sql)),
        ...results
          .filter(({ type }) => type === 'index')
          .map(({ name, sql }) => renamed(sql).replace(name, `${name}_s${shape}`)),
      ].map((sql) => db.prepare(sql)),
    );
  }

  /** The deploy's seed of `snapshot` in `format`, from what that format's tables hold. */
  async function deploy(
    snapshot: CatalogSnapshot,
    format: SeedFormat,
    budget: SeedOptions['budget'],
  ): Promise<string[]> {
    const providerHashes = new Map(
      await Promise.all(
        snapshot.data.providers.map(
          async (provider) => [provider.id, await sha256(JSON.stringify(provider))] as const,
        ),
      ),
    );
    const current = readSeedState(
      (await db.batch(seedStateQueries(format.shape).map((query) => db.prepare(query)))).map(
        (result) => result.results,
      ),
    );
    const ids = providersToRead(snapshot, { providerHashes, current, format });
    const rows =
      ids.length > 0
        ? readStoredRows(
            ids,
            (
              await db.batch(storedRowQueries(ids, format.shape).map((query) => db.prepare(query)))
            ).map((result) => result.results),
          )
        : undefined;
    const plan = planSeed(snapshot, { providerHashes, current, rows, budget, format });
    const statements = plan.sql.trimEnd().split('\n');
    const results = await db.batch(statements.map((statement) => db.prepare(statement)));
    expect(plan.writes).toBe(results.reduce((sum, result) => sum + result.meta.rows_written, 0));
    return plan.waiting;
  }

  /** What the API reads: the catalog row, and a plan's first price through the views. */
  async function served(planId: string) {
    const plan = await db
      .prepare('SELECT json FROM plans WHERE id = ?')
      .bind(planId)
      .first<{ json: string }>();
    return {
      catalog: await db.prepare('SELECT version, seed_format FROM catalog').first(),
      amount: plan && (JSON.parse(plan.json) as { prices: { amount: number }[] }).prices[0].amount,
    };
  }

  it('fills a new shape’s tables over three days, the API reading the whole live ones until it switches', async () => {
    await seed(snapshotOf(testCatalog(), 'abc1234'), { full: true });
    await createShape(4);
    const after = everyPrice();
    const shape4 = { seedFormat: 4, shape: 4 };
    const planId = after.data.providers[0].plans[0].id;
    const before = await served(planId);

    // Day 1, a deploy: what fits of the new shape's tables, while the API reads the old ones, whole.
    const daily = 1_100;
    const waiting = await deploy(after, shape4, { today: '2026-11-03', daily });
    expect(waiting.length).toBeGreaterThan(0);
    expect(await served(planId)).toEqual(before);
    expect(before.catalog).toEqual({ version: 'abc1234', seed_format: seedFormat });

    // The next days, the bot, until the new tables are whole: the API reads only the old ones meanwhile.
    const source = await sourceOf(after, undefined, 4);
    const nights: (string | undefined)[] = [];
    for (let day = 4; day < 9 && nights.at(-1) !== 'done'; day++) {
      expect(await served(planId)).toEqual(before);
      nights.push((await night(source, `2026-11-0${day}`, daily, shape4)).at(-1)?.result);
    }
    // Three days in all: this catalog's Bitdefender and Proton are most of a day each.
    expect(nights).toEqual(['budget', 'done']);

    // Whole: the views go to the new tables, and the catalog row names the build and its format.
    expect(await served(planId)).toEqual({
      catalog: { version: 'def5678', seed_format: 4 },
      amount: (before.amount ?? 0) + 1,
    });
    expect(
      (await db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'providers'`).first())?.['sql'],
    ).toBe('CREATE VIEW providers AS SELECT * FROM providers_s4');
  });

  it('compares every provider again for a new format that keeps its shape, through the budget', async () => {
    const snapshot = snapshotOf(testCatalog(), 'abc1234');
    await seed(snapshot, { full: true });
    const format = { seedFormat: 4, shape: seedShape };
    // Only each provider's hash (and json) is new: 1 row each, 4 in a day of 5 with the catalog row.
    const waiting = await deploy(snapshot, format, { today: '2026-11-03', daily: 5 });
    expect(waiting).toHaveLength(snapshot.data.providers.length - 4);
    expect(
      (await night(await sourceOf(snapshot, undefined, 4), '2026-11-04', 50_000, format)).at(-1)
        ?.result,
    ).toBe('done');
    const { results } = await db.prepare('SELECT hash FROM providers').all<{ hash: string }>();
    expect(results.every(({ hash }) => hash.startsWith('4.'))).toBe(true);
    expect(await db.prepare('SELECT seed_format FROM catalog').first()).toEqual({ seed_format: 4 });
  });
});
