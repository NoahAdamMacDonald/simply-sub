import { TestBed } from '@angular/core/testing';
import { InvalidRecordError, type CatalogCache } from '@simply-sub/core';
import { catalogFile } from '../catalog/catalog.testing';
import { CatalogCacheRepository } from './catalog-cache-repository';
import { plantRows, storedRows, testStorage, until, type TestStorage } from './storage.testing';

function cached(region: string | undefined, version = '1111111'): CatalogCache {
  return {
    key: region ?? 'catalog',
    snapshot: catalogFile(region, version),
    fetchedAt: '2026-10-24T12:00:00.000Z',
  };
}

describe('CatalogCacheRepository', () => {
  let storage: TestStorage;
  let repository: CatalogCacheRepository;

  beforeEach(() => {
    storage = testStorage();
    TestBed.configureTestingModule({ providers: storage.providers });
    repository = TestBed.inject(CatalogCacheRepository);
  });

  const storedKeys = async () =>
    ((await storedRows(storage.indexedDB, 'catalogCache')) as CatalogCache[]).map(
      ({ key, snapshot }) => `${key} ${snapshot.meta.catalogVersion}`,
    );

  it('holds the valid cached files by key, and leaves out one that fails its schema', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await plantRows(storage.indexedDB, 'catalogCache', [
      cached('CA'),
      { ...cached('US'), fetchedAt: 'yesterday' },
    ]);
    await until(() => repository.status() === 'ready');
    expect([...repository.files().keys()]).toEqual(['CA']);
    expect(await repository.read()).toEqual([cached('CA')]);
    vi.restoreAllMocks();
  });

  it('stores new files and deletes the ones no longer needed at once, and the live files follow', async () => {
    await repository.replace([cached('CA'), cached(undefined)], []);
    await until(() => repository.files().size === 2);

    await repository.replace([cached('CA', '2222222'), cached('EU', '2222222')], ['catalog']);
    expect(await storedKeys()).toEqual(['CA 2222222', 'EU 2222222']);
    await until(() => repository.files().has('EU'));
    expect([...repository.files().keys()]).toEqual(['CA', 'EU']);
  });

  it('writes nothing when a file fails its schema', async () => {
    await repository.replace([cached('CA')], []);
    await expect(
      repository.replace([cached('EU'), { ...cached('US'), key: 'CA' }], ['CA']),
    ).rejects.toThrow(InvalidRecordError);
    expect(await storedKeys()).toEqual(['CA 1111111']);
  });
});
