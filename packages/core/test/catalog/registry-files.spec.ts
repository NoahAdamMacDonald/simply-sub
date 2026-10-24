import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  categoriesBody,
  categoriesBodySchema,
  featuresBody,
  featuresBodySchema,
  readCatalogSource,
  type CatalogSnapshot,
} from '../../src';
import { catalog } from './catalog-files';
import { issues } from './helpers';

function snapshotOf(): CatalogSnapshot {
  const data = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');
  return {
    data,
    meta: buildCatalogMeta(data, {
      catalogVersion: 'abc1234',
      generatedAt: '2026-10-23T12:00:00Z',
    }),
  };
}

describe('featuresBody', () => {
  it('is the features in file order, with the catalog version and their count', () => {
    const snapshot = snapshotOf();

    expect(featuresBody(snapshot)).toEqual({
      data: snapshot.data.features,
      meta: { catalogVersion: 'abc1234', count: snapshot.data.features.length },
    });
  });

  it('writes each feature exactly as the snapshot does, key order included', () => {
    const snapshot = snapshotOf();

    expect(JSON.stringify(featuresBody(snapshot))).toBe(
      `{"data":${JSON.stringify(snapshot.data.features)},"meta":{"catalogVersion":"abc1234","count":${snapshot.data.features.length}}}`,
    );
  });

  it('matches its schema', () => {
    expect(issues(featuresBodySchema, featuresBody(snapshotOf()))).toEqual([]);
  });
});

describe('categoriesBody', () => {
  it('is the three category lists as the snapshot writes them, with the catalog version', () => {
    const snapshot = snapshotOf();

    expect(JSON.stringify(categoriesBody(snapshot))).toBe(
      `{"data":${JSON.stringify(snapshot.data.categories)},"meta":{"catalogVersion":"abc1234"}}`,
    );
  });

  it('matches its schema', () => {
    expect(issues(categoriesBodySchema, categoriesBody(snapshotOf()))).toEqual([]);
  });
});
