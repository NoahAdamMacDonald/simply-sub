import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  buildSeedSql,
  readCatalogSource,
  type CatalogSnapshot,
  type CatalogSourceFile,
} from '../../src';
import { catalog, catalogWith } from './catalog-files';

const netflix = 'data/providers/netflix.yaml';

function snapshotOf(files: readonly CatalogSourceFile[] = catalog()): CatalogSnapshot {
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  const meta = buildCatalogMeta(data, {
    catalogVersion: 'abc1234',
    generatedAt: '2026-10-23T12:00:00Z',
  });
  return { data, meta };
}

function linesOf(snapshot = snapshotOf()): string[] {
  return buildSeedSql(snapshot).trimEnd().split('\n');
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

/** The snapshot JSON, put back together from its INSERT and UPDATE pieces. */
function snapshotJson(lines: string[]): string {
  // The last string literal: the one before `);` in the INSERT, and before the WHERE in each UPDATE.
  const literal = (text: string) =>
    /'((?:[^']|'')*)'\)?;?$/.exec(text.replace(/ WHERE region = 'ALL';$/, ''))?.[1] ?? '';
  return lines
    .filter((line) => /^(INSERT INTO|UPDATE) snapshots /.test(line))
    .map((line) => literal(line).replaceAll("''", "'"))
    .join('');
}

describe('buildSeedSql', () => {
  it('empties every table first', () => {
    expect(linesOf().slice(0, 8)).toEqual([
      'DELETE FROM snapshots;',
      'DELETE FROM bundle_plans;',
      'DELETE FROM bundles;',
      'DELETE FROM plan_features;',
      'DELETE FROM features;',
      'DELETE FROM prices;',
      'DELETE FROM plans;',
      'DELETE FROM providers;',
    ]);
  });

  it('writes one statement per line', () => {
    for (const line of linesOf()) {
      expect(line).toMatch(/^(DELETE FROM|INSERT INTO|UPDATE) \w+ .*;$|^DELETE FROM \w+;$/);
    }
  });

  it('inserts providers and plans with their JSON as in the snapshot', () => {
    const snapshot = snapshotOf();
    const crave = snapshot.data.providers[0];
    const lines = linesOf(snapshot);
    expect(lines).toContain(
      `INSERT INTO providers (id, name, category, spend_category, json) VALUES ('crave', 'Crave', 'streaming', 'streaming', ${sqlText(JSON.stringify(crave))});`,
    );
    expect(lines).toContain(
      `INSERT INTO plans (id, provider_id, name, json) VALUES ('crave.premium', 'crave', 'Premium', ${sqlText(JSON.stringify(crave.plans[1]))});`,
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
    expect(linesOf().filter((line) => / bundle(s|_plans)\b/.test(line))).toEqual([
      'DELETE FROM bundle_plans;',
      'DELETE FROM bundles;',
      expect.stringMatching(
        /^INSERT INTO bundles \(id, json\) VALUES \('bundle\.netflix-crave', '\{/,
      ),
      "INSERT INTO bundle_plans (bundle_id, plan_id) VALUES ('bundle.netflix-crave', 'netflix.standard');",
      "INSERT INTO bundle_plans (bundle_id, plan_id) VALUES ('bundle.netflix-crave', 'crave.premium');",
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

  it('stores the snapshot as the exact JSON of data/catalog.json', () => {
    const snapshot = snapshotOf();
    const lines = linesOf(snapshot);
    const inserts = lines.filter((line) => line.startsWith('INSERT INTO snapshots '));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(
      /^INSERT INTO snapshots \(region, sha, built_at, json\) VALUES \('ALL', 'abc1234', '2026-10-23T12:00:00Z', '/,
    );
    expect(snapshotJson(lines)).toBe(JSON.stringify(snapshot));
  });

  it('splits a large snapshot into pieces that each fit in a statement', () => {
    const notes = `It's ${'x'.repeat(50_000)}`;
    const snapshot = snapshotOf(catalogWith(netflix, ['notes'], notes));
    const lines = linesOf(snapshot);
    expect(lines.filter((line) => line.startsWith('UPDATE snapshots ')).length).toBeGreaterThan(1);
    expect(snapshotJson(lines)).toBe(JSON.stringify(snapshot));
  });

  it('refuses a statement over 100,000 bytes, counting UTF-8 bytes', () => {
    // 60,000 characters, but 120,000 bytes.
    const snapshot = snapshotOf(catalogWith(netflix, ['notes'], 'é'.repeat(60_000)));
    expect(() => buildSeedSql(snapshot)).toThrow("A seed statement is over D1's 100000-byte limit");
  });

  it('refuses a value of the wrong type', () => {
    const files = catalogWith(netflix, ['plans', 0, 'features', 'video.quality'], true);
    expect(() => buildSeedSql(snapshotOf(files))).toThrow(
      "netflix.standard-ads: true isn't a video.quality value: run npm run data:validate",
    );
  });
});
