import { describe, expect, it } from 'vitest';
import {
  catalogCheckDue,
  catalogFileKey,
  catalogFilePath,
  fullCatalogKey,
  planCatalogSync,
  type CachedCatalogFile,
} from '../../src';

// A deploy's index.json: Germany has prices of its own, the rest of the EU has the group's.
const index = { catalogVersion: 'abc1234', regions: ['CA', 'DE', 'EU', 'US'] };

function cached(key: string, catalogVersion = index.catalogVersion): CachedCatalogFile {
  return { key, snapshot: { meta: { catalogVersion } } };
}

describe('catalogFileKey', () => {
  it.each([
    ['CA', 'CA'],
    ['DE', 'DE'],
    ['SE', 'EU'],
    ['NZ', fullCatalogKey],
  ])('serves %s from %s', (region, key) => {
    expect(catalogFileKey(region, index)).toBe(key);
  });

  it("gives the same answers from a snapshot's meta.regions, which has GLOBAL too", () => {
    const meta = { regions: ['CA', 'DE', 'EU', 'GLOBAL', 'US'] };
    for (const region of ['CA', 'DE', 'SE', 'NZ']) {
      expect(catalogFileKey(region, meta)).toBe(catalogFileKey(region, index));
    }
  });
});

describe('catalogFilePath', () => {
  it("finds a region's file beside index.json, and the full catalog above it", () => {
    expect(catalogFilePath('CA')).toBe('data/catalog/CA.json');
    expect(catalogFilePath('EU')).toBe('data/catalog/EU.json');
    expect(catalogFilePath(fullCatalogKey)).toBe('data/catalog.json');
  });
});

describe('planCatalogSync', () => {
  it("fetches the country's file when nothing is cached", () => {
    expect(planCatalogSync(index, ['CA'], [])).toEqual({ fetch: ['CA'], remove: [] });
  });

  it('fetches nothing when the cached files are the current version', () => {
    expect(planCatalogSync(index, ['CA', 'US'], [cached('CA'), cached('US')])).toEqual({
      fetch: [],
      remove: [],
    });
  });

  it('fetches every needed file again when the version changed', () => {
    const old = [cached('CA', '0000000'), cached('US', '0000000')];
    expect(planCatalogSync(index, ['US', 'CA'], old)).toEqual({ fetch: ['CA', 'US'], remove: [] });
  });

  it("serves a region with no file of its own from its group's, or else the full catalog", () => {
    expect(planCatalogSync(index, ['SE'], []).fetch).toEqual(['EU']);
    expect(planCatalogSync(index, ['NZ'], []).fetch).toEqual([fullCatalogKey]);
  });

  it('fetches a file that several regions share once', () => {
    expect(planCatalogSync(index, ['CA', 'SE', 'DK', 'NZ', 'JP'], [cached('CA')]).fetch).toEqual([
      'EU',
      fullCatalogKey,
    ]);
  });

  it('drops the files no region needs any more, whatever their version', () => {
    const files = [cached('CA'), cached('US', '0000000'), cached(fullCatalogKey)];
    expect(planCatalogSync(index, ['DE'], files)).toEqual({
      fetch: ['DE'],
      remove: ['CA', 'US', fullCatalogKey],
    });
  });
});

describe('catalogCheckDue', () => {
  const checked = '2026-10-26T12:00:00.000Z';

  it('is due before the first check', () => {
    expect(catalogCheckDue(undefined, checked)).toBe(true);
  });

  it('is due an hour after the last check, not before', () => {
    expect(catalogCheckDue(checked, '2026-10-26T12:59:59.999Z')).toBe(false);
    expect(catalogCheckDue(checked, '2026-10-26T13:00:00.000Z')).toBe(true);
  });

  it('is due when the clock went back', () => {
    expect(catalogCheckDue(checked, '2026-10-26T11:59:00.000Z')).toBe(true);
  });
});
