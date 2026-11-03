import { TestBed } from '@angular/core/testing';
import { InvalidRecordError, type CatalogCache, type PolicyCache } from '@simply-sub/core';
import { catalogFile } from '../catalog/catalog.testing';
import { CatalogCacheRepository } from './catalog-cache-repository';
import { PolicyCacheRepository } from './policy-cache-repository';
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

  it('leaves out the Terms and policies files beside them, which are PolicyCacheRepository’s (M11.8)', async () => {
    const policies: PolicyCache = {
      key: 'policies/mullvad',
      file: {
        id: 'mullvad',
        policies: {
          links: [{ name: 'Terms of service', url: 'https://mullvad.net/en/help/terms-service' }],
          ratings: [
            {
              topic: 'legal.disputes',
              tier: 'great',
              reason: 'Swedish courts or the consumer disputes board.',
              sources: [
                { url: 'https://mullvad.net/en/help/terms-service', quote: 'Swedish courts' },
              ],
              lastVerified: '2026-10-22',
            },
          ],
        },
      },
      catalogVersion: '1111111',
      fetchedAt: '2026-10-24T12:00:00.000Z',
    };
    await repository.replace([cached('CA')], []);
    await TestBed.inject(PolicyCacheRepository).put(policies);
    await until(() => repository.status() === 'ready');

    expect([...repository.files().keys()]).toEqual(['CA']);
    expect(await repository.read()).toEqual([cached('CA')]);
    expect(await TestBed.inject(PolicyCacheRepository).get('policies/mullvad')).toEqual(policies);
    expect(await TestBed.inject(PolicyCacheRepository).get('CA')).toBeUndefined();
  });

  it('writes nothing when a file fails its schema', async () => {
    await repository.replace([cached('CA')], []);
    await expect(
      repository.replace([cached('EU'), { ...cached('US'), key: 'CA' }], ['CA']),
    ).rejects.toThrow(InvalidRecordError);
    expect(await storedKeys()).toEqual(['CA 1111111']);
  });
});
