import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedSql,
  partialCatalogVersion,
  planSeed,
  providersToRead,
  readCatalogSource,
  readSeedState,
  readStoredRows,
  seedFormat,
  seedStateOf,
  storedRowQueries,
  storedRowsOf,
  type CatalogSnapshot,
  type CatalogSourceFile,
  type SeedOptions,
  type SeedState,
  type StoredProvider,
} from '../../src';
import { catalog, catalogWith, edited } from './catalog-files';

const netflix = 'data/providers/netflix.yaml';
const mullvad = 'data/providers/mullvad.yaml';

function snapshotOf(
  files: readonly CatalogSourceFile[] = catalog(),
  catalogVersion = 'abc1234',
): CatalogSnapshot {
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  const meta = buildCatalogMeta(data, { catalogVersion, generatedAt: '2026-10-23T12:00:00Z' });
  return { data, meta };
}

/** A stand-in for the SHA-256 the scripts use: FNV-1a, which changes whenever the JSON does. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (const character of text) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function providerHashes({ data }: CatalogSnapshot): Map<string, string> {
  return new Map(data.providers.map((provider) => [provider.id, hashOf(JSON.stringify(provider))]));
}

/** What D1 holds once `snapshot` is seeded. */
function stateOf(snapshot: CatalogSnapshot): SeedState {
  return seedStateOf(snapshot, providerHashes(snapshot));
}

/** A stored provider with no rows: one D1 has only a hash for, in a hand-made state. */
const noRows = (): StoredProvider => ({
  providers: [],
  provider_categories: [],
  provider_features: [],
  plans: [],
  prices: [],
  plan_features: [],
  bundle_plans: [],
});

function linesOf(
  snapshot = snapshotOf(),
  current?: SeedState,
  rows?: SeedOptions['rows'],
): string[] {
  const sql = buildSeedSql(snapshot, { providerHashes: providerHashes(snapshot), current, rows });
  return sql === '' ? [] : sql.trimEnd().split('\n');
}

/** The plan that takes D1 from `before` to `after`. */
function planFrom(
  before: CatalogSnapshot,
  after: CatalogSnapshot,
  options: Pick<SeedOptions, 'budget'> & { current?: Partial<SeedState> } = {},
) {
  return planSeed(after, {
    providerHashes: providerHashes(after),
    current: { ...stateOf(before), ...options.current },
    rows: storedRowsOf(before, providerHashes(before)),
    budget: options.budget,
  });
}

/** The statements that take D1 from `before` to `after`. */
function changesFrom(before: CatalogSnapshot, after: CatalogSnapshot): string[] {
  const { sql } = planFrom(before, after);
  return sql === '' ? [] : sql.trimEnd().split('\n');
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The plan_features rows of one plan, as `feature value rank_value`. */
function featureRows(planId: string, lines = linesOf()): string[] {
  const prefix = `INSERT INTO plan_features (plan_id, feature_id, value, rank_value) VALUES ('${planId}', `;
  return lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length, -2).replaceAll("'", '').replaceAll(', ', ' '));
}

/** Each statement as its first words and the ids it names, for reading which rows it writes at a glance. */
function summary(lines: string[]): string[] {
  return lines.map((line) => {
    const [, action, table] = /^(INSERT INTO|DELETE FROM|UPDATE) (\w+)/.exec(line) ?? [];
    const ids = /VALUES \('([^']*)'(?:, '([^']*)')?/.exec(line);
    const where = /WHERE (.*);$/.exec(line)?.[1];
    if (action === 'INSERT INTO') {
      const key =
        table === 'catalog' ? '1' : table === 'bundle_plans' ? `${ids?.[1]} ${ids?.[2]}` : ids?.[1];
      return `insert ${table} ${key}`;
    }
    return `${action === 'UPDATE' ? 'update' : 'delete'} ${table}${where ? ` where ${where}` : ''}`;
  });
}

/** A provider-wide enum (M11.4), for a provider's own features. */
const openSource = {
  id: 'software.open-source',
  name: 'Open source',
  category: 'streaming',
  type: 'enum',
  values: [
    { id: 'proprietary', name: 'Closed source' },
    { id: 'open-clients', name: 'Open-source apps' },
  ],
  providerWide: true,
};

const catalogRow = (version = 'abc1234') =>
  `INSERT INTO catalog (id, version, built_at, seed_format, counts, waiting) VALUES (1, '${version}', '2026-10-23T12:00:00Z', ${seedFormat}, '{"providers":4,"plans":10,"addOns":2,"bundles":1,"features":10}', 0) ON CONFLICT (id) DO UPDATE SET version = excluded.version, built_at = excluded.built_at, seed_format = excluded.seed_format, counts = excluded.counts, waiting = excluded.waiting;`;

describe('buildSeedSql, without what D1 holds', () => {
  it('empties every table first', () => {
    expect(linesOf().slice(0, 10)).toEqual([
      'DELETE FROM catalog;',
      'DELETE FROM bundle_plans;',
      'DELETE FROM bundles;',
      'DELETE FROM plan_features;',
      'DELETE FROM features;',
      'DELETE FROM prices;',
      'DELETE FROM plans;',
      'DELETE FROM provider_features;',
      'DELETE FROM provider_categories;',
      'DELETE FROM providers;',
    ]);
  });

  it('replaces everything when D1 has rows but no catalog row, or one of another seed format', () => {
    const full = linesOf();
    const current = stateOf(snapshotOf());
    expect(linesOf(snapshotOf(), { ...current, catalog: undefined })).toEqual(full);
    expect(
      linesOf(snapshotOf(), {
        ...current,
        catalog: { version: 'abc1234', seedFormat: 0, waiting: 0, written: 0 },
      }),
    ).toEqual(full);
  });

  it('fills an empty D1 with inserts only, which a budget can spread (M11.8)', () => {
    const empty: SeedState = {
      providers: new Map(),
      features: new Map(),
      bundles: new Map(),
      rows: Object.fromEntries(
        Object.keys(stateOf(snapshotOf()).rows).map((table) => [table, 0]),
      ) as SeedState['rows'],
    };
    const lines = linesOf(snapshotOf(), empty);
    expect(lines.some((line) => line.startsWith('DELETE'))).toBe(false);
    expect(lines.filter((line) => line.startsWith('INSERT'))).toEqual(
      linesOf().filter((line) => line.startsWith('INSERT')),
    );
  });

  it('writes one statement per line', () => {
    for (const line of linesOf()) {
      expect(line).toMatch(/^(DELETE FROM|INSERT INTO|UPDATE) \w+ .*;$|^DELETE FROM \w+;$/);
    }
  });

  it('inserts the features before the plan features that refer to them, and the catalog row last', () => {
    const lines = summary(linesOf());
    const lastFeature = lines.lastIndexOf('insert features includes-subscription');
    expect(lines.indexOf('insert features video.quality')).toBe(10);
    expect(lastFeature).toBeLessThan(
      lines.findIndex((line) => line.startsWith('insert plan_features')),
    );
    expect(lines.at(-1)).toBe('insert catalog 1');
    expect(linesOf().at(-1)).toBe(catalogRow());
  });

  it('writes each category a provider’s plans are in, once, after the provider', () => {
    const lines = linesOf();
    const categories = (id: string) =>
      lines
        .filter(
          (line) => line.startsWith('INSERT INTO provider_categories') && line.includes(`'${id}')`),
        )
        .map((line) => /VALUES \('([^']*)'/.exec(line)?.[1]);

    // Proton is a privacy suite, and its plans are VPNs too; Netflix's plans are in its own category.
    expect(categories('proton')).toEqual(['privacy-suite', 'vpn']);
    expect(categories('netflix')).toEqual(['streaming']);
    expect(lines).toContain(
      "INSERT INTO provider_categories (category, provider_id) VALUES ('vpn', 'proton');",
    );
    const proton = summary(lines).indexOf('insert providers proton');
    expect(summary(lines).slice(proton + 1, proton + 3)).toEqual([
      'insert provider_categories privacy-suite',
      'insert provider_categories vpn',
    ]);
  });

  it("writes a provider's own features once, after its categories, as plan_features rows are (M11.4)", () => {
    const files = edited(catalog(), 'data/features.yaml', [10], openSource);
    const lines = summary(
      linesOf(
        snapshotOf(
          edited(files, netflix, ['features'], { 'software.open-source': 'open-clients' }),
        ),
      ),
    );
    const at = lines.indexOf('insert providers netflix');
    expect(lines.slice(at + 1, at + 3)).toEqual([
      'insert provider_categories streaming',
      'insert provider_features software.open-source',
    ]);
    expect(lines.filter((line) => line.startsWith('insert provider_features'))).toHaveLength(1);
    expect(
      linesOf(
        snapshotOf(
          edited(files, netflix, ['features'], { 'software.open-source': 'open-clients' }),
        ),
      ),
    ).toContain(
      "INSERT INTO provider_features (feature_id, value, provider_id, rank_value) VALUES ('software.open-source', 'open-clients', 'netflix', 1);",
    );
  });

  it('inserts providers with their hash, and plans, with their JSON as in the snapshot', () => {
    const snapshot = snapshotOf();
    const crave = snapshot.data.providers[0];
    const lines = linesOf(snapshot);
    expect(lines).toContain(
      `INSERT INTO providers (id, name, category, spend_category, hash, json) VALUES ('crave', 'Crave', 'streaming', 'streaming', '${hashOf(JSON.stringify(crave))}', ${sqlText(JSON.stringify(crave))});`,
    );
    expect(lines).toContain(
      `INSERT INTO plans (id, provider_id, name, json) VALUES ('crave.premium', 'crave', 'Premium', ${sqlText(JSON.stringify(crave.plans[1]))});`,
    );
  });

  it('upserts features, so an existing one is updated rather than deleted', () => {
    const [feature] = snapshotOf().data.features;
    expect(linesOf()).toContain(
      `INSERT INTO features (id, category, json) VALUES ('video.quality', 'streaming', ${sqlText(JSON.stringify(feature))}) ON CONFLICT (id) DO UPDATE SET category = excluded.category, json = excluded.json;`,
    );
  });

  it('inserts each plan price with its monthly equivalent, but not add-on or bundle prices', () => {
    const prices = linesOf().filter((line) => line.startsWith('INSERT INTO prices '));
    expect(prices).toContain(
      `INSERT INTO prices (plan_id, region, currency, amount, interval, interval_count, monthly_equiv) VALUES ('crave.standard', 'CA', 'CAD', 119.99, 'year', 1, ${119.99 / 12});`,
    );
    expect(prices).toHaveLength(18);
    expect(prices.some((line) => line.includes("'crave.starz'"))).toBe(false);
  });

  it('gives plan_features the rank values of BLUEPRINT §5.3', () => {
    expect(featureRows('netflix.standard')).toEqual([
      'video.quality 1080p 2',
      'streaming.ad-free true 1',
      'streaming.concurrent-streams 2 2',
    ]);
    expect(featureRows('crave.premium')).toEqual([
      'video.quality 4k 3',
      'streaming.live tv-channels NULL',
      'streaming.live sports NULL',
    ]);
    expect(featureRows('proton.duo')).toContain('includes-subscription proton.unlimited NULL');
  });

  it('ranks unlimited above every number, and false as 0', () => {
    const files = catalogWith(netflix, ['plans', 0, 'features'], {
      'streaming.concurrent-streams': 'unlimited',
      'streaming.ad-free': false,
    });
    expect(featureRows('netflix.standard-ads', linesOf(snapshotOf(files)))).toEqual([
      'streaming.concurrent-streams unlimited 1e+308',
      'streaming.ad-free false 0',
    ]);
  });

  it('links bundles to their plans', () => {
    expect(summary(linesOf()).filter((line) => / bundle(s|_plans)\b/.test(line))).toEqual([
      'delete bundle_plans',
      'delete bundles',
      'insert bundles bundle.netflix-crave',
      'insert bundle_plans bundle.netflix-crave netflix.standard',
      'insert bundle_plans bundle.netflix-crave crave.premium',
    ]);
  });

  it('doubles quotes and splices in line breaks, keeping one statement per line', () => {
    const files = catalogWith(netflix, ['plans', 0, 'name'], "Members'\nchoice");
    const line = linesOf(snapshotOf(files)).find((text) =>
      text.startsWith(
        "INSERT INTO plans (id, provider_id, name, json) VALUES ('netflix.standard-ads'",
      ),
    );
    expect(line).toContain(`'Members''' || char(10) || 'choice'`);
  });

  it('refuses a statement over 100,000 bytes, counting UTF-8 bytes', () => {
    // 60,000 characters, but 120,000 bytes.
    const snapshot = snapshotOf(catalogWith(netflix, ['notes'], 'é'.repeat(60_000)));
    expect(() => linesOf(snapshot)).toThrow("A seed statement is over D1's 100000-byte limit");
  });

  it('refuses a value of the wrong type', () => {
    const files = catalogWith(netflix, ['plans', 0, 'features', 'video.quality'], true);
    expect(() => linesOf(snapshotOf(files))).toThrow(
      "netflix.standard-ads: true isn't a video.quality value: run npm run data:validate",
    );
  });

  it('refuses a provider without a hash', () => {
    const snapshot = snapshotOf();
    expect(() => buildSeedSql(snapshot, { providerHashes: new Map() })).toThrow(
      'No hash for provider crave',
    );
  });
});

describe('buildSeedSql, given what D1 holds', () => {
  it('writes nothing when the catalog is the same: a code-only deploy', () => {
    expect(changesFrom(snapshotOf(), snapshotOf())).toEqual([]);
  });

  it('writes only the catalog row when nothing in D1 changed but the version did', () => {
    // A categories.yaml edit, for one: D1 has no categories table.
    expect(changesFrom(snapshotOf(), snapshotOf(catalog(), 'def5678'))).toEqual([
      catalogRow('def5678'),
    ]);
  });

  it('updates only the rows a price change touches: the price, its plan and its provider (M11.8)', () => {
    const before = snapshotOf();
    const after = snapshotOf(
      catalogWith(mullvad, ['plans', 0, 'prices', 0, 'amount'], 5.5),
      'def5678',
    );
    const lines = changesFrom(before, after);
    expect(summary(lines)).toEqual([
      "update providers where id = 'mullvad'",
      "update plans where id = 'mullvad.vpn'",
      "update prices where plan_id = 'mullvad.vpn' AND region = 'GLOBAL' AND currency = 'EUR' AND interval = 'month' AND interval_count = 1",
      'insert catalog 1',
    ]);
    const [mullvadAfter] = after.data.providers.filter((provider) => provider.id === 'mullvad');
    expect(lines[0]).toBe(
      `UPDATE providers SET hash = '${hashOf(JSON.stringify(mullvadAfter))}', json = ${sqlText(JSON.stringify(mullvadAfter))} WHERE id = 'mullvad';`,
    );
    expect(lines[2]).toBe(
      "UPDATE prices SET amount = 5.5, monthly_equiv = 5.5 WHERE plan_id = 'mullvad.vpn' AND region = 'GLOBAL' AND currency = 'EUR' AND interval = 'month' AND interval_count = 1;",
    );
    // A row each, the price's index entry, and the catalog row.
    expect(planFrom(before, after).writes).toBe(5);
  });

  it('deletes the rows a provider no longer has and inserts its new ones, leaving the rest (M11.8)', () => {
    const before = snapshotOf();
    // Netflix keeps only its second plan, which gets a price in another region. catalog() is a copy each time.
    const source = catalog().find(({ file }) => file === netflix) as {
      data: { plans: { prices: unknown[] }[] };
    };
    const standard = source.data.plans[1];
    standard.prices.push({
      region: 'GB',
      currency: 'GBP',
      amount: 12.99,
      interval: 'month',
      intervalCount: 1,
      autoRenew: true,
      lastVerified: '2026-10-20',
    });
    const after = snapshotOf(edited(catalog(), netflix, ['plans'], [standard]));
    const lines = summary(changesFrom(before, after));
    expect(lines).toContain("delete plans where id IN ('netflix.standard-ads', 'netflix.premium')");
    expect(lines).toContain('insert prices netflix.standard');
    // The plans' prices and features went with them: no row of theirs is deleted again.
    expect(lines.filter((line) => /standard-ads|premium/.test(line))).toEqual([
      "delete plans where id IN ('netflix.standard-ads', 'netflix.premium')",
    ]);
    expect(lines.filter((line) => /crave|mullvad|proton|bundle/.test(line))).toEqual([]);
  });

  it('keeps the bundles’ links to a changed provider’s plans, which stay in D1 (M11.8)', () => {
    const after = snapshotOf(catalogWith(netflix, ['plans', 1, 'prices', 0, 'amount'], 20.99));
    const lines = summary(changesFrom(snapshotOf(), after));
    expect(lines.filter((line) => line.includes('bundle'))).toEqual([]);
    expect(lines.filter((line) => /crave|mullvad|proton/.test(line))).toEqual([]);
  });

  it('inserts a new provider and deletes a removed one, counting the rows that go with it', () => {
    const withoutMullvad = catalog().filter(({ file }) => !file.includes('mullvad'));
    expect(summary(changesFrom(snapshotOf(), snapshotOf(withoutMullvad)))).toEqual([
      "delete providers where id IN ('mullvad')",
    ]);
    // Its provider row, its category, its plan, 2 prices and 3 plan features.
    expect(planFrom(snapshotOf(), snapshotOf(withoutMullvad)).writes).toBe(8);
    expect(summary(changesFrom(snapshotOf(withoutMullvad), snapshotOf()))[0]).toBe(
      'insert providers mullvad',
    );
  });

  it('upserts a changed feature without touching the plans that use it', () => {
    const after = snapshotOf(edited(catalog(), 'data/features.yaml', [1, 'name'], 'No ads'));
    expect(summary(changesFrom(snapshotOf(), after))).toEqual([
      'insert features streaming.ad-free',
    ]);
  });

  it("updates the rank of an enum's values that moved, and only those", () => {
    // 1440p goes in before 4k, so 4k moves from 3 to 4.
    const values = [
      { id: '480p', name: '480p (SD)' },
      { id: '720p', name: '720p (HD)' },
      { id: '1080p', name: '1080p (Full HD)' },
      { id: '1440p', name: '1440p (QHD)' },
      { id: '4k', name: '4K (Ultra HD)' },
    ];
    const after = snapshotOf(edited(catalog(), 'data/features.yaml', [0, 'values'], values));
    expect(changesFrom(snapshotOf(), after)).toEqual([
      expect.stringMatching(/^INSERT INTO features .* VALUES \('video\.quality', /),
      "UPDATE plan_features SET rank_value = 4 WHERE feature_id = 'video.quality' AND value = '4k' AND rank_value IS NOT 4;",
    ]);
  });

  it("updates a provider-wide enum's moved values in provider_features too", () => {
    const files = edited(
      edited(catalog(), 'data/features.yaml', [10], openSource),
      netflix,
      ['features'],
      { 'software.open-source': 'open-clients' },
    );
    const values = [{ id: 'source-available', name: 'Source available' }, ...openSource.values];
    const after = snapshotOf(edited(files, 'data/features.yaml', [10, 'values'], values));
    expect(summary(changesFrom(snapshotOf(files), after))).toEqual([
      'insert features software.open-source',
      "update plan_features where feature_id = 'software.open-source' AND value = 'proprietary' AND rank_value IS NOT 1",
      "update provider_features where feature_id = 'software.open-source' AND value = 'proprietary' AND rank_value IS NOT 1",
      "update plan_features where feature_id = 'software.open-source' AND value = 'open-clients' AND rank_value IS NOT 2",
      "update provider_features where feature_id = 'software.open-source' AND value = 'open-clients' AND rank_value IS NOT 2",
    ]);
  });

  it('updates every value of an enum whose stored order it can’t read', () => {
    const before = { ...stateOf(snapshotOf()) };
    before.features = new Map([...before.features, ['video.quality', '{}']]);
    expect(summary(linesOf(snapshotOf(), before)).slice(1)).toEqual([
      "update plan_features where feature_id = 'video.quality' AND value = '480p' AND rank_value IS NOT 0",
      "update plan_features where feature_id = 'video.quality' AND value = '720p' AND rank_value IS NOT 1",
      "update plan_features where feature_id = 'video.quality' AND value = '1080p' AND rank_value IS NOT 2",
      "update plan_features where feature_id = 'video.quality' AND value = '4k' AND rank_value IS NOT 3",
    ]);
  });

  it('deletes features, providers and bundles that are no longer in the catalog', () => {
    const before = stateOf(snapshotOf());
    const current: SeedState = {
      ...before,
      features: new Map([...before.features, ['old.feature', '{}']]),
      bundles: new Map([...before.bundles, ['bundle.old', '{}']]),
      providers: new Map([...before.providers, ['old-provider', '0']]),
    };
    expect(linesOf(snapshotOf(), current, new Map([['old-provider', noRows()]]))).toEqual([
      "DELETE FROM bundles WHERE id IN ('bundle.old');",
      "DELETE FROM providers WHERE id IN ('old-provider');",
      "DELETE FROM features WHERE id IN ('old.feature');",
    ]);
  });

  it('replaces a bundle whose JSON changed', () => {
    const after = snapshotOf(
      edited(catalog(), 'data/bundles/netflix-crave.yaml', ['name'], 'Netflix + Crave'),
    );
    expect(summary(changesFrom(snapshotOf(), after))).toEqual([
      "delete bundles where id IN ('bundle.netflix-crave')",
      'insert bundles bundle.netflix-crave',
      'insert bundle_plans bundle.netflix-crave netflix.standard',
      'insert bundle_plans bundle.netflix-crave crave.premium',
    ]);
  });
});

const counts = {
  providers: 1,
  provider_categories: 1,
  provider_features: 0,
  plans: 1,
  prices: 1,
  plan_features: 0,
  features: 1,
  bundles: 0,
  bundle_plans: 0,
  catalog: 1,
};

describe('readSeedState', () => {
  it('reads the rows of each query', () => {
    const state = readSeedState([
      [{ version: 'abc1234', seed_format: 1, waiting: 2, written_on: '2026-11-03', written: 40 }],
      [{ id: 'netflix', hash: 'f00' }],
      [{ id: 'video.quality', json: '{}' }],
      [],
      [counts],
    ]);
    expect(state).toEqual({
      catalog: {
        version: 'abc1234',
        seedFormat: 1,
        waiting: 2,
        writtenOn: '2026-11-03',
        written: 40,
      },
      providers: new Map([['netflix', 'f00']]),
      features: new Map([['video.quality', '{}']]),
      bundles: new Map(),
      rows: counts,
    });
  });

  it('has no catalog when D1 has no catalog row, and no day when the row has none', () => {
    expect(readSeedState([[], [], [], [], [counts]]).catalog).toBeUndefined();
    expect(
      readSeedState([
        [{ version: 'abc1234', seed_format: 1, waiting: 0, written_on: null, written: 0 }],
        [],
        [],
        [],
        [counts],
      ]).catalog,
    ).toEqual({ version: 'abc1234', seedFormat: 1, waiting: 0, written: 0 });
  });

  it('refuses rows of another shape', () => {
    expect(() => readSeedState([[], [{ id: 'netflix', hash: 1 }], [], [], [counts]])).toThrow();
    expect(() => readSeedState([[]])).toThrow();
  });
});

describe('the rows of the providers that changed (M11.8)', () => {
  it('reads those D1 holds under another hash and those the catalog no longer has', () => {
    const before = stateOf(snapshotOf());
    const after = snapshotOf(catalogWith(mullvad, ['plans', 0, 'prices', 0, 'amount'], 5.5));
    const current = { ...before, providers: new Map([...before.providers, ['gone', '0']]) };
    expect(providersToRead(after, { providerHashes: providerHashes(after), current })).toEqual([
      'mullvad',
      'gone',
    ]);
    expect(providersToRead(after, { providerHashes: providerHashes(after) })).toEqual([]);
  });

  it('asks for each table’s rows of those providers, and sorts the answers by provider', () => {
    const queries = storedRowQueries(['mullvad', "o'brien"]);
    expect(queries[0]).toBe(
      "SELECT id, name, category, spend_category, hash FROM providers WHERE id IN ('mullvad', 'o''brien')",
    );
    expect(queries[4]).toBe(
      "SELECT plan_id, region, currency, amount, interval, interval_count, monthly_equiv FROM prices WHERE plan_id IN (SELECT id FROM plans WHERE provider_id IN ('mullvad', 'o''brien'))",
    );
    const stored = readStoredRows(
      ['mullvad'],
      [
        [
          {
            id: 'mullvad',
            name: 'Mullvad VPN',
            category: 'vpn',
            spend_category: 'software',
            hash: 'f00',
          },
        ],
        [{ category: 'vpn', provider_id: 'mullvad' }],
        [],
        [{ id: 'mullvad.vpn', provider_id: 'mullvad', name: 'Mullvad VPN', json: '{}' }],
        [
          {
            plan_id: 'mullvad.vpn',
            region: 'GLOBAL',
            currency: 'EUR',
            amount: 5,
            interval: 'month',
            interval_count: 1,
            monthly_equiv: 5,
          },
        ],
        [],
        [{ bundle_id: 'bundle.x', plan_id: 'mullvad.vpn' }],
      ],
    );
    expect(stored.get('mullvad')?.prices).toHaveLength(1);
    expect(stored.get('mullvad')?.bundle_plans).toEqual([
      { bundle_id: 'bundle.x', plan_id: 'mullvad.vpn' },
    ]);
    expect(() => readStoredRows([], [[{ id: 'mullvad' }], [], [], [], [], [], []])).toThrow();
  });

  it('refuses to compare a changed provider without its rows', () => {
    const after = snapshotOf(catalogWith(mullvad, ['plans', 0, 'prices', 0, 'amount'], 5.5));
    expect(() => linesOf(after, stateOf(snapshotOf()))).toThrow(
      'No stored rows for provider mullvad: read them with storedRowQueries',
    );
  });
});

describe('the daily budget (M11.8)', () => {
  const today = '2026-11-03';
  /** Every provider's first price up: each provider costs its 4 rows, and the catalog row 1. */
  const allPrices = () => {
    let files = catalog();
    for (const file of [
      'data/providers/crave.yaml',
      mullvad,
      netflix,
      'data/providers/proton.yaml',
    ]) {
      const data = (
        files.find((source) => source.file === file) as {
          data: { plans: { prices: { amount: number }[] }[] };
        }
      ).data;
      files = edited(
        files,
        file,
        ['plans', 0, 'prices', 0, 'amount'],
        data.plans[0].prices[0].amount + 1,
      );
    }
    return snapshotOf(files, 'def5678');
  };

  it('applies whole providers in the catalog’s order until the next wouldn’t fit, and keeps the last version', () => {
    const plan = planFrom(snapshotOf(), allPrices(), { budget: { today, daily: 10 } });
    expect(plan.waiting).toEqual(['netflix', 'proton']);
    expect(plan.writes).toBe(9);
    expect(plan.sql.trimEnd().split('\n').at(-1)).toBe(
      `UPDATE catalog SET waiting = 2, written_on = '${today}', written = 9 WHERE id = 1;`,
    );
  });

  it('counts the day’s writes already made, and starts again on a new day', () => {
    const current = {
      catalog: { version: 'abc1234', seedFormat, waiting: 0, writtenOn: today, written: 2 },
    };
    expect(
      planFrom(snapshotOf(), allPrices(), { budget: { today, daily: 10 }, current }).waiting,
    ).toEqual(['mullvad', 'netflix', 'proton']);
    expect(
      planFrom(snapshotOf(), allPrices(), { budget: { today: '2026-11-04', daily: 10 }, current })
        .waiting,
    ).toEqual(['netflix', 'proton']);
  });

  it('writes nothing once the day’s rows are spent', () => {
    const current = {
      catalog: { version: 'abc1234', seedFormat, waiting: 0, writtenOn: today, written: 10 },
    };
    const plan = planFrom(snapshotOf(), allPrices(), { budget: { today, daily: 10 }, current });
    expect(plan.sql).toBe('');
    expect(plan.waiting).toHaveLength(4);
  });

  it('holds a bundle back with a provider whose plans it includes', () => {
    const after = snapshotOf(
      edited(
        catalogWith(netflix, ['plans', 1, 'prices', 0, 'amount'], 20.99),
        'data/bundles/netflix-crave.yaml',
        ['name'],
        'Netflix + Crave',
      ),
      'def5678',
    );
    const plan = planFrom(snapshotOf(), after, { budget: { today, daily: 12 } });
    expect(plan.waiting).toEqual(['netflix', 'bundle.netflix-crave']);
  });

  it('names no version while an empty D1 fills, then the build’s', () => {
    const empty: SeedState = {
      providers: new Map(),
      features: new Map(),
      bundles: new Map(),
      rows: {
        ...counts,
        providers: 0,
        provider_categories: 0,
        plans: 0,
        prices: 0,
        features: 0,
        catalog: 0,
      },
    };
    const plan = planSeed(snapshotOf(), {
      providerHashes: providerHashes(snapshotOf()),
      current: empty,
      budget: { today, daily: 60 },
    });
    expect(plan.waiting.length).toBeGreaterThan(0);
    expect(plan.sql).toContain(`VALUES (1, '${partialCatalogVersion}', `);
  });

  it('holds nothing back without a budget', () => {
    expect(planFrom(snapshotOf(), allPrices()).waiting).toEqual([]);
  });
});
