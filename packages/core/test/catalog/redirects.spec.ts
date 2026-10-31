import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  catalogIds,
  dueRedirects,
  formatCatalogIssue,
  readCatalogSource,
  redirectMap,
  redirectedCatalogId,
  redirectedRankKey,
  redirectsFileSchema,
  regionSnapshot,
  validateCatalog,
  type CatalogSourceFile,
  type Redirect,
} from '../../src';
import { catalog, edited, today } from './catalog-files';
import { issues } from './helpers';

// data/redirects.yaml (BLUEPRINT §4.3, M10.27): old id → new id, validated against the catalog, published with it.

const file = 'data/redirects.yaml';
const netflix = 'data/providers/netflix.yaml';

function withRedirects(
  redirects: unknown[],
  files: CatalogSourceFile[] = catalog(),
): CatalogSourceFile[] {
  return [...files, { file, data: redirects }];
}

function messages(files: CatalogSourceFile[]): string[] {
  return validateCatalog(files, today).map((issue) => formatCatalogIssue(issue));
}

const gone = { kind: 'plan', from: 'netflix.basic', to: 'netflix.standard-ads', on: '2026-10-01' };

describe('the redirects file', () => {
  it('checks each id’s form for its kind, and one entry per old id', () => {
    expect(issues(redirectsFileSchema, [gone])).toEqual([]);
    expect(
      issues(redirectsFileSchema, [
        { kind: 'plan', from: 'netflix', to: 'netflix.standard', on: '2026-10-01' },
        { kind: 'feature', from: 'streaming.ad-free', to: 'ad-free', on: '2026-10-01' },
        { kind: 'perk', from: 'perk:xbox/fortnite', to: 'gaming.battle-pass', on: '2026-10-01' },
        { kind: 'bundle', from: 'bundle.a', to: 'bundle.a', on: '2026-10-01' },
        gone,
        gone,
      ]),
    ).toEqual([
      '0.from: Use <provider id>.<slug> (netflix.standard)',
      '3.to: Points to itself',
      '5.from: "netflix.basic" is listed more than once',
    ]);
  });

  it('accepts an old id that’s gone, pointing at one that’s sold', () => {
    expect(messages(withRedirects([gone]))).toEqual([]);
  });

  it('refuses a target that doesn’t exist or is retired, and a chain', () => {
    const retired = edited(catalog(), netflix, ['plans', 0, 'retired'], '2026-10-01');
    expect(
      messages(
        withRedirects(
          [
            { kind: 'plan', from: 'netflix.old', to: 'netflix.standrd', on: '2026-10-01' },
            gone,
            { kind: 'plan', from: 'netflix.older', to: 'netflix.basic', on: '2026-10-01' },
            { kind: 'feature', from: 'video.resolution', to: 'video.quality=8k', on: '2026-10-01' },
          ],
          retired,
        ),
      ),
    ).toEqual([
      `${file} 0.to: "netflix.standrd" isn't a plan (did you mean netflix.standard?)`,
      `${file} 1.to: "netflix.standard-ads" is retired: point it at a plan still sold`,
      `${file} 2.to: "netflix.basic" is redirected itself: point this entry where that one points, so redirects never chain`,
      `${file} 3.to: "video.quality=8k" isn't a rank key of data/features.yaml (did you mean video.quality=4k?)`,
    ]);
  });

  it('takes an old id still in the catalog only as a retired plan’s move, which doesn’t end too', () => {
    const move = {
      kind: 'plan',
      from: 'netflix.standard',
      to: 'netflix.premium',
      on: '2026-12-01',
    };
    expect(messages(withRedirects([move]))).toEqual([
      `${file} 0.from: "netflix.standard" is still in the catalog: a redirect is for an id that's gone, or a retired plan's subscribers moving (retire it first)`,
    ]);
    const retired = edited(catalog(), netflix, ['plans', 1, 'retired'], '2026-10-01');
    expect(messages(withRedirects([move], retired))).toEqual([]);
    const ending = edited(retired, netflix, ['plans', 1, 'endsOn'], '2027-01-01');
    expect(messages(withRedirects([move], ending))).toEqual([
      `${file} 0.from: A plan whose subscribers move doesn't end: leave out its endsOn`,
    ]);
    expect(
      messages(
        withRedirects([
          {
            kind: 'feature',
            from: 'video.quality=4k',
            to: 'video.quality=1080p',
            on: '2026-10-01',
          },
        ]),
      ),
    ).toEqual([
      `${file} 0.from: "video.quality=4k" is still a rank key of data/features.yaml: a redirect is for a key that's gone`,
    ]);
  });

  it('is published in the catalog, its region files and ids.json', () => {
    const files = withRedirects([gone]);
    const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
    const snapshot = {
      data,
      meta: buildCatalogMeta(data, {
        catalogVersion: '1234567',
        generatedAt: '2026-10-30T00:00:00Z',
      }),
    };
    expect(data.redirects).toEqual([gone]);
    expect(regionSnapshot(snapshot, 'CA').data.redirects).toEqual([gone]);
    const ids = catalogIds(snapshot);
    expect(redirectedCatalogId('netflix.basic', 'plan', ids)).toBe('netflix.standard-ads');
    expect(redirectedCatalogId('netflix.basic', 'provider', ids)).toBeUndefined();
    // None: nothing is published.
    const plain = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');
    expect(plain).not.toHaveProperty('redirects');
  });
});

describe('dueRedirects', () => {
  const catalogData = {
    providers: [{ id: 'netflix', plans: [{ id: 'netflix.standard' }] }],
    bundles: [],
  };
  const move: Redirect = {
    kind: 'plan',
    from: 'netflix.standard',
    to: 'netflix.premium',
    on: '2026-12-01',
  };
  const changed: Redirect = {
    kind: 'plan',
    from: 'netflix.basic',
    to: 'netflix.standard',
    on: '2027-01-01',
  };

  it('follows an id that’s gone at once, and a retired plan’s move from its date', () => {
    const redirects = [move, changed];
    expect(dueRedirects({ ...catalogData, redirects }, '2026-11-30')).toEqual([changed]);
    expect(dueRedirects({ ...catalogData, redirects }, '2026-12-01')).toEqual([move, changed]);
  });
});

describe('redirectedRankKey', () => {
  const map = redirectMap([
    { kind: 'feature', from: 'streaming.ad-free', to: 'ad-free', on: '2026-11-15' },
    { kind: 'feature', from: 'video.resolution', to: 'video.quality', on: '2026-11-15' },
    { kind: 'perk', from: 'perk:xbox/fortnite', to: 'gaming.battle-pass', on: '2026-11-15' },
    { kind: 'provider', from: 'xbox', to: 'xbox-game-pass', on: '2026-11-15' },
  ]);

  it('moves a key, the keys of a feature’s values with it, and a provider’s perks', () => {
    expect(redirectedRankKey(map, 'streaming.ad-free')).toBe('ad-free');
    expect(redirectedRankKey(map, 'video.resolution=4k')).toBe('video.quality=4k');
    expect(redirectedRankKey(map, 'perk:xbox/fortnite')).toBe('gaming.battle-pass');
    expect(redirectedRankKey(map, 'perk:xbox/ea-play')).toBe('perk:xbox-game-pass/ea-play');
    expect(redirectedRankKey(map, 'video.hdr')).toBe('video.hdr');
  });
});
