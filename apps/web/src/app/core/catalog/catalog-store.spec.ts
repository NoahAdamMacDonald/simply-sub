import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CatalogCache, Settings } from '@simply-sub/core';
import { SettingsStore } from '../settings/settings-store';
import { CatalogCacheRepository } from '../storage/catalog-cache-repository';
import { ItemsRepository } from '../storage/items-repository';
import { RejectedRecords } from '../storage/rejected-records';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../storage/storage.testing';
import { catalogFile, catalogIndex, pricedIn } from './catalog.testing';
import { CatalogStore } from './catalog-store';

const v1 = '1111111';
const v2 = '2222222';

function settingsIn(country: string): Settings {
  return {
    key: 'settings',
    country,
    currency: 'CAD',
    theme: 'system',
    updatedAt: '2026-10-25T12:00:00.000Z',
  };
}

/** A file the app downloaded before, at `version`. `region` undefined: the full catalog.json. */
function cached(region: string | undefined, version = v1): CatalogCache {
  return {
    key: region ?? 'catalog',
    snapshot: catalogFile(region, version),
    fetchedAt: '2026-10-24T12:00:00.000Z',
  };
}

/** The static files of a deploy, as the Worker serves them, and the requests the app made. */
class FakeServer {
  readonly requests: string[] = [];
  /** The network is down: every request fails, as fetch does offline. */
  down = false;
  /** Holds every answer back until it resolves. */
  hold?: Promise<void>;
  private files = new Map<string, unknown>();

  /** Deploys a catalog version: index.json, each region's file and the full catalog. */
  deploy(version: string, generatedAt?: string): void {
    this.files = new Map<string, unknown>([
      ['data/catalog/index.json', catalogIndex(version, generatedAt)],
      ['data/catalog.json', catalogFile(undefined, version, generatedAt)],
      ...['CA', 'EU', 'US'].map((region) => [
        `data/catalog/${region}.json`,
        catalogFile(region, version, generatedAt),
      ]),
    ] as [string, unknown][]);
  }

  /** Serves `body` at `path` in place of the deployed file. */
  serve(path: string, body: unknown): void {
    this.files.set(path, body);
  }

  readonly fetch = async (path: string): Promise<Response> => {
    this.requests.push(path);
    await this.hold;
    if (this.down) throw new TypeError('Failed to fetch');
    const body = this.files.get(path);
    // A missing static file is answered with the app's index.html, the SPA fallback.
    return body === undefined
      ? new Response('<!doctype html><title>Simply Sub</title>', {
          headers: { 'Content-Type': 'text/html' },
        })
      : Response.json(body);
  };
}

describe('CatalogStore', () => {
  let storage: TestStorage;
  let server: FakeServer;

  beforeEach(() => {
    storage = testStorage();
    server = new FakeServer();
    server.deploy(v1);
    vi.stubGlobal('fetch', server.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Starts the app's store on what an earlier visit left in IndexedDB. */
  async function start({
    settings,
    files = [],
  }: { settings?: Settings; files?: CatalogCache[] } = {}): Promise<CatalogStore> {
    if (settings) await plantRows(storage.indexedDB, 'settings', [settings]);
    if (files.length > 0) await plantRows(storage.indexedDB, 'catalogCache', files);
    TestBed.configureTestingModule({ providers: storage.providers });
    return TestBed.inject(CatalogStore);
  }

  /** Starts the store and waits for its first check. */
  async function started(options?: Parameters<typeof start>[0]): Promise<CatalogStore> {
    const store = await start(options);
    await until(() => store.lastCheck() !== undefined);
    return store;
  }

  const storedKeys = async () =>
    ((await storedRows(storage.indexedDB, 'catalogCache')) as CatalogCache[]).map(
      ({ key, snapshot }) => `${key} ${snapshot.meta.catalogVersion}`,
    );

  describe('on start', () => {
    it('shows the cached catalog before the check answers', async () => {
      server.hold = new Promise(() => undefined);
      const store = await start({ settings: settingsIn('CA'), files: [cached('CA')] });
      await until(() => store.catalog() !== undefined && server.requests.length === 1);
      expect(store.version()).toBe(v1);
      expect(store.generatedAt()).toBe('2026-10-22T12:00:00Z');
      expect(pricedIn(store.catalog())).toEqual(['CA']);
      expect(store.checking()).toBe(true);
      expect(store.offline()).toBe(false);
    });

    it('asks only for index.json when the cached version is current', async () => {
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      expect(store.lastCheck()).toBe('current');
      expect(server.requests).toEqual(['data/catalog/index.json']);
    });

    it('downloads a new version once, and keeps it', async () => {
      server.deploy(v2, '2026-10-26T12:00:00Z');
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      expect(store.lastCheck()).toBe('updated');
      expect(store.version()).toBe(v2);
      expect(store.generatedAt()).toBe('2026-10-26T12:00:00Z');
      expect(await storedKeys()).toEqual([`CA ${v2}`]);

      expect(await store.check()).toBe('current');
      expect(server.requests).toEqual([
        'data/catalog/index.json',
        'data/catalog/CA.json',
        'data/catalog/index.json',
      ]);
    });

    it('checks only that the server is there before the first run, then downloads the chosen country', async () => {
      const store = await started();
      expect(store.lastCheck()).toBe('current');
      expect(store.catalog()).toBeUndefined();
      expect(server.requests).toEqual(['data/catalog/index.json']);

      await TestBed.inject(SettingsStore).save({ country: 'US', currency: 'USD', theme: 'system' });
      await until(() => store.version() === v1);
      expect(pricedIn(store.catalog())).toEqual(['US']);
      expect(server.requests.slice(1)).toEqual(['data/catalog/index.json', 'data/catalog/US.json']);
    });
  });

  describe('the file a region gets', () => {
    it.each([
      ['its own', 'CA', 'data/catalog/CA.json', ['CA']],
      ["its group's", 'SE', 'data/catalog/EU.json', ['EU']],
      ['the full catalog', 'NZ', 'data/catalog.json', ['CA', 'EU', 'US']],
    ])('is %s (%s)', async (_name, country, path, prices) => {
      const store = await started({ settings: settingsIn(country) });
      expect(server.requests).toEqual(['data/catalog/index.json', path]);
      expect(pricedIn(store.catalog())).toEqual(prices);
    });

    it("also downloads the region a list item was bought in, and serves that item's region from it", async () => {
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      await TestBed.inject(ItemsRepository).create({
        listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
        source: { kind: 'catalog', planId: 'mullvad.vpn' },
        region: 'US',
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-10-01',
          autoRenew: true,
        },
        tagIds: [],
        rankOverrides: {},
        pinned: false,
      });
      await until(() => store.catalogFor('US') !== undefined);
      expect(pricedIn(store.catalogFor('US'))).toEqual(['US']);
      expect(pricedIn(store.catalog())).toEqual(['CA']);
      expect(store.catalogFor('SE')).toBeUndefined();
      expect(server.requests).toEqual([
        'data/catalog/index.json',
        'data/catalog/index.json',
        'data/catalog/US.json',
      ]);
      expect(await storedKeys()).toEqual([`CA ${v1}`, `US ${v1}`]);
    });

    it('downloads a region a page needs for an item not saved yet, while the page is there', async () => {
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      const page = TestBed.inject(EnvironmentInjector);
      const child = createEnvironmentInjector([], page);
      const region = signal<readonly string[]>(['US']);
      runInInjectionContext(child, () => store.need(region));

      await until(() => store.catalogFor('US') !== undefined);
      region.set(['SE']);
      await until(() => store.catalogFor('SE') !== undefined);
      expect(await storedKeys()).toEqual([`CA ${v1}`, `EU ${v1}`]);

      // Once the page has gone, the next check drops what only it needed.
      child.destroy();
      await vi.waitFor(async () => expect(await storedKeys()).toEqual([`CA ${v1}`]));
    });

    it('drops the files no region needs after the country changes', async () => {
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      await TestBed.inject(SettingsStore).update({ country: 'DE', currency: 'EUR' });
      await until(() => pricedIn(store.catalog())?.[0] === 'EU');
      await vi.waitFor(async () => expect(await storedKeys()).toEqual([`EU ${v1}`]));
    });
  });

  describe('offline', () => {
    it('keeps the cached catalog and says so, until a check gets through', async () => {
      server.down = true;
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      expect(store.lastCheck()).toBe('offline');
      expect(store.offline()).toBe(true);
      expect(store.version()).toBe(v1);

      server.down = false;
      window.dispatchEvent(new Event('online'));
      await until(() => !store.offline());
      expect(store.lastCheck()).toBe('current');
    });

    it('says so as soon as the browser goes offline', async () => {
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      window.dispatchEvent(new Event('offline'));
      TestBed.tick();
      expect(store.offline()).toBe(true);
    });

    it('has no catalog to show on a first visit with no network', async () => {
      server.down = true;
      const store = await started({ settings: settingsIn('CA') });
      expect(store.offline()).toBe(true);
      expect(store.catalog()).toBeUndefined();
      expect(store.generatedAt()).toBeUndefined();
    });
  });

  describe('a download that goes wrong', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it.each([
      ['is of another version than index.json', catalogFile('CA', '3333333')],
      ['fails its schema', { ...catalogFile('CA', v2), extra: true }],
      ['is the SPA fallback', undefined],
      ["isn't the region asked for", catalogFile('US', v2)],
    ])('keeps the cached catalog when the file %s', async (_name, body) => {
      server.deploy(v2);
      server.serve('data/catalog/CA.json', body);
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      expect(store.lastCheck()).toBe('failed');
      expect(store.offline()).toBe(false);
      expect(store.version()).toBe(v1);
      expect(await storedKeys()).toEqual([`CA ${v1}`]);
      expect(console.error).toHaveBeenCalledWith(
        "The catalog couldn't be checked for updates:",
        expect.any(Error),
      );
    });

    it('keeps a download in this tab when it cannot be saved', async () => {
      server.deploy(v2);
      vi.spyOn(CatalogCacheRepository.prototype, 'replace').mockRejectedValue(
        new DOMException('Quota exceeded', 'QuotaExceededError'),
      );
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      expect(store.version()).toBe(v2);
      expect(await storedKeys()).toEqual([`CA ${v1}`]);
    });
  });

  it("downloads a cached file that fails its schema again, and doesn't tell the user", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = { ...cached('CA'), fetchedAt: 'yesterday' };
    const store = await started({ settings: settingsIn('CA'), files: [broken] });
    expect(store.lastCheck()).toBe('updated');
    expect(store.version()).toBe(v1);
    expect(await storedKeys()).toEqual([`CA ${v1}`]);
    expect(TestBed.inject(RejectedRecords).count()).toBe(0);
  });

  describe('checking again', () => {
    function show(): void {
      document.dispatchEvent(new Event('visibilitychange'));
    }

    beforeEach(() => {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    });

    it('happens when a tab is shown again after an hour, not before', async () => {
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      storage.clock.time = '2026-10-25T12:59:00.000Z';
      show();
      expect(store.checking()).toBe(false);

      storage.clock.time = '2026-10-25T13:01:00.000Z';
      show();
      expect(store.checking()).toBe(true);
      await until(() => !store.checking());
      expect(server.requests).toEqual(['data/catalog/index.json', 'data/catalog/index.json']);
    });

    it('waits for a check that is running, and follows it with one more', async () => {
      const store = await started({ settings: settingsIn('CA'), files: [cached('CA')] });
      server.requests.length = 0;
      const checks = [store.check(), store.check(), store.check()];
      expect(await Promise.all(checks)).toEqual(['current', 'current', 'current']);
      expect(server.requests).toEqual(['data/catalog/index.json', 'data/catalog/index.json']);
    });

    it('holds a Web Lock while checking, so tabs take turns', async () => {
      const request = vi.fn((_name: string, task: () => Promise<unknown>) => task());
      Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
      try {
        await started({ settings: settingsIn('CA'), files: [cached('CA')] });
        expect(request).toHaveBeenCalledWith('simply-sub-catalog', expect.any(Function));
      } finally {
        Reflect.deleteProperty(navigator, 'locks');
      }
    });
  });
});
