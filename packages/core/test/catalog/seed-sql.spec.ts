import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedSql,
  readCatalogSource,
  readSeedState,
  seedFormat,
  type CatalogSnapshot,
  type CatalogSourceFile,
  type SeedState,
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
  const byJson = (items: readonly { id: string }[]) =>
    new Map(items.map((item) => [item.id, JSON.stringify(item)]));
  return {
    catalog: { version: snapshot.meta.catalogVersion, seedFormat },
    providers: providerHashes(snapshot),
    features: byJson(snapshot.data.features),
    bundles: byJson(snapshot.data.bundles),
  };
}

function linesOf(snapshot = snapshotOf(), current?: SeedState): string[] {
  const sql = buildSeedSql(snapshot, { providerHashes: providerHashes(snapshot), current });
  return sql === '' ? [] : sql.trimEnd().split('\n');
}

/** The statements that take D1 from `before` to `after`. */
function changesFrom(before: CatalogSnapshot, after: CatalogSnapshot): string[] {
  return linesOf(after, stateOf(before));
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

const catalogRow = (version = 'abc1234') =>
  `INSERT INTO catalog (id, version, built_at, seed_format, counts) VALUES (1, '${version}', '2026-10-23T12:00:00Z', ${seedFormat}, '{"providers":4,"plans":10,"addOns":2,"bundles":1,"features":10}') ON CONFLICT (id) DO UPDATE SET version = excluded.version, built_at = excluded.built_at, seed_format = excluded.seed_format, counts = excluded.counts;`;

describe('buildSeedSql, without what D1 holds', () => {
  it('empties every table first', () => {
    expect(linesOf().slice(0, 9)).toEqual([
      'DELETE FROM catalog;',
      'DELETE FROM bundle_plans;',
      'DELETE FROM bundles;',
      'DELETE FROM plan_features;',
      'DELETE FROM features;',
      'DELETE FROM prices;',
      'DELETE FROM plans;',
      'DELETE FROM provider_categories;',
      'DELETE FROM providers;',
    ]);
  });

  it('replaces everything when D1 has no catalog row, or one of another seed format', () => {
    const full = linesOf();
    const current = stateOf(snapshotOf());
    expect(linesOf(snapshotOf(), { ...current, catalog: undefined })).toEqual(full);
    expect(
      linesOf(snapshotOf(), { ...current, catalog: { version: 'abc1234', seedFormat: 0 } }),
    ).toEqual(full);
  });

  it('writes one statement per line', () => {
    for (const line of linesOf()) {
      expect(line).toMatch(/^(DELETE FROM|INSERT INTO|UPDATE) \w+ .*;$|^DELETE FROM \w+;$/);
    }
  });

  it('inserts the features before the plan features that refer to them, and the catalog row last', () => {
    const lines = summary(linesOf());
    const lastFeature = lines.lastIndexOf('insert features includes-subscription');
    expect(lines.indexOf('insert features video.quality')).toBe(9);
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

  it('replaces only the provider whose prices changed', () => {
    const after = snapshotOf(
      catalogWith(mullvad, ['plans', 0, 'prices', 0, 'amount'], 5.5),
      'def5678',
    );
    expect(summary(changesFrom(snapshotOf(), after))).toEqual([
      "delete providers where id IN ('mullvad')",
      'insert providers mullvad',
      'insert provider_categories vpn',
      'insert plans mullvad.vpn',
      'insert prices mullvad.vpn',
      'insert prices mullvad.vpn',
      'insert plan_features mullvad.vpn',
      'insert plan_features mullvad.vpn',
      'insert plan_features mullvad.vpn',
      'insert catalog 1',
    ]);
  });

  it('links unchanged bundles to the plans of a provider it replaced again', () => {
    const after = snapshotOf(catalogWith(netflix, ['plans', 1, 'prices', 0, 'amount'], 20.99));
    const lines = summary(changesFrom(snapshotOf(), after));
    expect(lines[0]).toBe("delete providers where id IN ('netflix')");
    expect(lines.filter((line) => line.includes('bundle'))).toEqual([
      'insert bundle_plans bundle.netflix-crave netflix.standard',
    ]);
    expect(lines.filter((line) => /crave|mullvad|proton/.test(line))).toEqual([
      'insert bundle_plans bundle.netflix-crave netflix.standard',
    ]);
  });

  it('inserts a new provider and deletes a removed one', () => {
    const withoutMullvad = catalog().filter(({ file }) => !file.includes('mullvad'));
    expect(summary(changesFrom(snapshotOf(), snapshotOf(withoutMullvad)))).toEqual([
      "delete providers where id IN ('mullvad')",
    ]);
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
    expect(linesOf(snapshotOf(), current)).toEqual([
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

describe('readSeedState', () => {
  it('reads the rows of each query', () => {
    const state = readSeedState([
      [{ version: 'abc1234', seed_format: 1 }],
      [{ id: 'netflix', hash: 'f00' }],
      [{ id: 'video.quality', json: '{}' }],
      [],
    ]);
    expect(state).toEqual({
      catalog: { version: 'abc1234', seedFormat: 1 },
      providers: new Map([['netflix', 'f00']]),
      features: new Map([['video.quality', '{}']]),
      bundles: new Map(),
    });
  });

  it('has no catalog when D1 has no catalog row', () => {
    expect(readSeedState([[], [], [], []]).catalog).toBeUndefined();
  });

  it('refuses rows of another shape', () => {
    expect(() => readSeedState([[], [{ id: 'netflix', hash: 1 }], [], []])).toThrow();
    expect(() => readSeedState([[]])).toThrow();
  });
});
