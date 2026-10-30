import { TestBed } from '@angular/core/testing';
import {
  readSyncCopy,
  syncSchemaVersion,
  type Settings,
  type SubscriptionList,
  type SyncCopy,
} from '@simply-sub/core';
import { openCopy, sealCopy, syncKeys, type SyncKeys } from '../../core/crypto/sync-crypto';
import { AppLockRepository } from '../../core/storage/app-lock-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { SettingsRepository } from '../../core/storage/settings-repository';
import {
  deleteRows,
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { StorageService } from '../../core/storage/storage-service';
import { SyncRepository } from '../../core/storage/sync-repository';
import { SYNC_TIMING, SyncService } from './sync-service';
import { FakeSyncServer } from './sync.testing';

// Device sync in the app (M10.9) on a fake IndexedDB and a stand-in for the Worker's /api/v1/sync. "Another device" is
// the test writing a sealed copy to the server with the chain's keys, as a device would.

const settings: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-AB',
  currency: 'CAD',
  monthlyBudget: 200,
  theme: 'dark',
  updatedAt: '2026-10-20T09:15:00.000Z',
};

const seed = Uint8Array.from({ length: 32 }, (_, index) => index);
const otherDevice = { id: '0192f1d0-0000-7000-8000-00000000000b', name: 'Phone' };
/** setTimeout before a spec fakes it. */
const realTimeout = globalThis.setTimeout;

describe('SyncService', () => {
  let storage: TestStorage;
  let server: FakeSyncServer;
  let service: SyncService;
  let keys: SyncKeys;

  beforeEach(async () => {
    storage = testStorage();
    server = new FakeSyncServer();
    vi.stubGlobal('fetch', server.fetch);
    await plantRows(storage.indexedDB, 'settings', [settings]);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: SYNC_TIMING, useValue: { settleMs: 0, pollMs: 10_000, pollMaxMs: 300_000 } },
      ],
    });
    service = TestBed.inject(SyncService);
    keys = await syncKeys(seed);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lists = () => TestBed.inject(ListsRepository);

  /** The chain's copy as the server keeps it, opened. */
  async function chainCopy(): Promise<SyncCopy> {
    const stored = server.chain(keys.chainId);
    if (!stored) throw new Error('No chain');
    const reading = readSyncCopy(await openCopy(keys, stored.bytes));
    if (reading.kind !== 'copy') throw new Error(reading.kind);
    return reading.copy;
  }

  /** Another device's write: the chain's copy changed by `change`, sealed, as its next version. */
  async function otherDeviceWrites(change: (copy: SyncCopy) => SyncCopy): Promise<void> {
    const copy = change(await chainCopy());
    server.store(keys.chainId, keys.authSecret, await sealCopy(keys, copy));
  }

  function newList(name: string, at: string): SubscriptionList {
    return {
      id: `0192f1c4-7b2e-7c3a-9d41-${String(name.length).padStart(12, '0')}`,
      name,
      createdAt: at,
      updatedAt: at,
    };
  }

  async function turnOn(): Promise<void> {
    await lists().create({ name: 'Work Related' });
    expect(await service.turnOn(seed)).toBe('synced');
    await until(() => service.record() !== undefined);
  }

  it('turns sync on: the chain starts with this device’s data, sealed, and the settings it shares', async () => {
    await turnOn();

    expect(server.requests.map(({ method, condition }) => `${method} ${condition ?? ''}`)).toEqual([
      'GET ',
      'PUT *',
    ]);
    const copy = await chainCopy();
    expect(copy.data.lists.map((list) => list.name)).toEqual(['Work Related']);
    expect(copy.settings).toMatchObject({ country: 'CA', monthlyBudget: 200 });
    expect(copy.settings).not.toHaveProperty('theme');
    expect(copy.devices).toEqual([expect.objectContaining({ name: 'This browser' })]);
    expect(service.record()).toMatchObject({ version: '1', syncedAt: expect.any(String) });
    // The code is kept here, and only here.
    expect(new TextDecoder().decode(server.chain(keys.chainId)?.bytes)).not.toContain('Work');
  });

  it('takes another device’s changes, deletions included, and sends its own', async () => {
    await turnOn();
    const added = newList('Family', '2026-10-26T10:00:00.000Z');
    await otherDeviceWrites((copy) => ({
      ...copy,
      data: { ...copy.data, lists: [...copy.data.lists, added] },
      devices: [...copy.devices, { ...otherDevice, syncedAt: '2026-10-26T10:00:00.000Z' }],
    }));

    expect(await service.sync()).toBe('synced');
    await until(() => lists().records().length === 2);
    expect(service.devices().map((device) => device.name)).toContain('Phone');

    // Deleted here: the deletion reaches the chain.
    await lists().remove(added.id);
    expect(await service.sync()).toBe('synced');
    const copy = await chainCopy();
    expect(copy.data.lists.find((list) => list.id === added.id)?.deletedAt).toBeDefined();
  });

  it('reads an unchanged chain with a 304, and sends nothing when there’s nothing new', async () => {
    await turnOn();
    server.requests.length = 0;

    expect(await service.sync()).toBe('synced');
    expect(server.requests).toEqual([{ method: 'GET', chain: keys.chainId, condition: '"1"' }]);
  });

  it('reads and merges again when another device wrote first, so both changes survive', async () => {
    await turnOn();
    await lists().create({ name: 'Mine' });
    const theirs = newList('Theirs', '2026-10-26T10:00:00.000Z');
    server.beforeNextWrite = () =>
      otherDeviceWrites((copy) => ({
        ...copy,
        data: { ...copy.data, lists: [...copy.data.lists, theirs] },
      }));

    expect(await service.sync()).toBe('synced');
    const names = (await chainCopy()).data.lists.map((list) => list.name).sort();
    expect(names).toEqual(['Mine', 'Theirs', 'Work Related']);
    await until(() => lists().records().length === 3);
  });

  it('stops, saying why, when the chain was deleted or needs a newer app', async () => {
    await turnOn();
    server.forget(keys.chainId);
    expect(await service.sync()).toBe('stopped');
    await until(() => service.record()?.problem === 'gone');
    expect(await service.sync()).toBe('off');
  });

  it('stops for a copy from a newer version of the app', async () => {
    await turnOn();
    await otherDeviceWrites((copy) => ({ ...copy, schemaVersion: syncSchemaVersion + 1 }));
    expect(await service.sync()).toBe('stopped');
    await until(() => service.record()?.problem === 'newer');
  });

  it('waits when offline, and says so', async () => {
    await turnOn();
    server.fail = 'offline';
    expect(await service.sync()).toBe('offline');
    expect(service.snag()).toBe('offline');
    server.fail = undefined;
    expect(await service.sync()).toBe('synced');
    expect(service.snag()).toBeUndefined();
  });

  describe('joining with a code', () => {
    async function firstDevice(): Promise<void> {
      const copy: SyncCopy = {
        schemaVersion: syncSchemaVersion,
        settings: {
          country: 'CA',
          subdivision: 'CA-ON',
          currency: 'CAD',
          monthlyBudget: 300,
          updatedAt: '2026-10-19T10:00:00.000Z',
        },
        data: {
          tags: [],
          customSubs: [],
          lists: [newList('Shared', '2026-10-19T10:00:00.000Z')],
          items: [],
          rankings: [],
          cards: [],
          dismissedSuggestions: [],
          liveCalendar: [],
        },
        devices: [{ ...otherDevice, syncedAt: '2026-10-19T10:00:00.000Z' }],
      };
      server.store(keys.chainId, keys.authSecret, await sealCopy(keys, copy));
    }

    it('previews what the chain holds, or says there’s none', async () => {
      expect(await service.preview(seed)).toEqual({ kind: 'none' });
      await firstDevice();
      const preview = await service.preview(seed);
      expect(preview).toMatchObject({ kind: 'copy', version: '1', counts: { lists: 1, items: 0 } });
    });

    it('merges: this device keeps its records, takes the chain’s, and its shared settings, not its theme', async () => {
      await lists().create({ name: 'Mine' });
      await firstDevice();
      const preview = await service.preview(seed);
      if (preview.kind !== 'copy') throw new Error(preview.kind);

      // The theme on screen starts only a new device's settings (M10.15): this one keeps its own.
      expect(await service.join(seed, preview, 'merge', 'light')).toBe('synced');
      await until(() => lists().records().length === 2);
      const saved = (await storedRows(storage.indexedDB, 'settings'))[0] as Settings;
      expect(saved).toMatchObject({ subdivision: 'CA-ON', monthlyBudget: 300, theme: 'dark' });
      const copy = await chainCopy();
      expect(copy.data.lists.map((list) => list.name).sort()).toEqual(['Mine', 'Shared']);
      expect(copy.devices.map((device) => device.name)).toEqual(['This browser', 'Phone']);
    });

    it('joins a new device in its first run: its settings start from the chain’s and its theme (M10.15)', async () => {
      await deleteRows(storage.indexedDB, 'settings', ['settings']);
      await firstDevice();
      const preview = await service.preview(seed);
      if (preview.kind !== 'copy') throw new Error(preview.kind);

      expect(await service.join(seed, preview, 'merge', 'light')).toBe('synced');
      await until(() => lists().records().length === 1);
      expect(await storedRows(storage.indexedDB, 'settings')).toEqual([
        expect.objectContaining({
          country: 'CA',
          subdivision: 'CA-ON',
          currency: 'CAD',
          monthlyBudget: 300,
          theme: 'light',
          sharedUpdatedAt: '2026-10-19T10:00:00.000Z',
        }),
      ]);
      expect((await chainCopy()).devices.map((device) => device.name)).toEqual([
        'This browser',
        'Phone',
      ]);
    });

    it('replaces: this device’s records give way to the chain’s', async () => {
      await lists().create({ name: 'Mine' });
      await firstDevice();
      const preview = await service.preview(seed);
      if (preview.kind !== 'copy') throw new Error(preview.kind);

      expect(await service.join(seed, preview, 'replace')).toBe('synced');
      await until(
        () =>
          lists()
            .records()
            .map((list) => list.name)
            .join() === 'Shared',
      );
      expect((await chainCopy()).data.lists.map((list) => list.name)).toEqual(['Shared']);
    });
  });

  describe('checking for the other devices’ changes (M10.26)', () => {
    beforeEach(async () => {
      await turnOn();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
      Reflect.deleteProperty(document, 'visibilityState');
    });

    /** Each read of the chain is a check: a Worker request. */
    const checks = () => server.requests.filter((request) => request.method === 'GET').length;

    /** Change detection, and Dexie's live queries, which wait for a setTimeout of 0. */
    function tick(): void {
      vi.advanceTimersByTime(0);
      TestBed.tick();
    }

    /** Waits on real time, since vi.waitFor (and so `until`) would move the fake clock the checks wait on. */
    async function soon(condition: () => boolean): Promise<void> {
      for (let tries = 0; tries < 1000; tries++) {
        tick();
        if (condition()) return;
        await new Promise((resolve) => realTimeout(resolve, 1));
      }
      throw new Error('Not yet');
    }

    /** Long enough on real time for a sync something started to have made its request. */
    async function pause(): Promise<void> {
      for (let tries = 0; tries < 10; tries++) {
        tick();
        await new Promise((resolve) => realTimeout(resolve, 5));
      }
    }

    /** `count` checks made, and none under way. */
    function checked(count: number): () => boolean {
      return () => checks() === count && !service.syncing();
    }

    /** Starts syncing by itself, as the background does, and waits for the start's sync and the tables' watches. */
    async function start(): Promise<void> {
      const before = checks();
      service.start();
      await soon(checked(before + 1));
      await pause();
    }

    /** The next check comes `ms` from now, and not before. */
    async function nextCheckIn(ms: number): Promise<void> {
      const before = checks();
      vi.advanceTimersByTime(ms - 1);
      await pause();
      expect(checks()).toBe(before);
      vi.advanceTimersByTime(1);
      await soon(checked(before + 1));
    }

    async function phoneJoins(): Promise<void> {
      await otherDeviceWrites((copy) => ({
        ...copy,
        devices: [...copy.devices, { ...otherDevice, syncedAt: '2026-10-26T10:00:00.000Z' }],
      }));
    }

    function showTab(shown: boolean): void {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: shown ? 'visible' : 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }

    it('waits 10 s, then twice as long after each check while nothing happens, up to 5 minutes', async () => {
      await phoneJoins();
      await start();
      for (const seconds of [10, 20, 40, 80, 160, 300, 300]) await nextCheckIn(seconds * 1000);
    });

    it('checks 10 s after a press, a key or focus, which never put off a check due sooner', async () => {
      await phoneJoins();
      await start();
      await nextCheckIn(10_000);
      for (const used of [
        () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })),
        () => document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })),
        () => window.dispatchEvent(new FocusEvent('focus')),
      ]) {
        await nextCheckIn(20_000);
        // The wait is 40 s now: in use, it's 10 again, from the first use, then 20.
        vi.advanceTimersByTime(5_000);
        used();
        vi.advanceTimersByTime(5_000);
        used();
        await nextCheckIn(5_000);
      }
    });

    it('checks at once when the tab is shown again, then 10 s on, and never while it’s hidden', async () => {
      await phoneJoins();
      await start();
      await nextCheckIn(10_000);
      showTab(false);
      vi.advanceTimersByTime(3_600_000);
      await pause();
      const hidden = checks();

      showTab(true);
      await soon(checked(hidden + 1));
      await nextCheckIn(10_000);
    });

    it('checks 10 s after a change here, or a merge that took something in', async () => {
      await phoneJoins();
      await start();
      await nextCheckIn(10_000);
      await nextCheckIn(20_000);

      // Sent once it settles (settleMs 0 here), with the next check 10 s on.
      const before = checks();
      await lists().create({ name: 'Mine' });
      await soon(checked(before + 1));
      await nextCheckIn(10_000);
      await nextCheckIn(20_000);

      await otherDeviceWrites((copy) => ({
        ...copy,
        data: {
          ...copy.data,
          lists: [...copy.data.lists, newList('Family', '2026-10-26T10:00:00.000Z')],
        },
      }));
      const merged = checks();
      vi.advanceTimersByTime(40_000);
      // What the merge wrote is a change too: settled, it makes one more check.
      await soon(() => lists().records().length === 3 && checked(merged + 2)());
      await nextCheckIn(10_000);
    });

    it('never checks while this device is the chain’s only one, and starts once a second is seen', async () => {
      await start();
      vi.advanceTimersByTime(3_600_000);
      await pause();
      expect(checks()).toBe(2);

      // The phone is seen at this device's next sync: back online here, shown again, a change, or Sync now.
      await phoneJoins();
      window.dispatchEvent(new Event('online'));
      await soon(checked(3));
      expect(service.devices().map((device) => device.name)).toContain('Phone');
      await nextCheckIn(10_000);
    });

    it('makes no request for this device’s own settings: the theme, the Calendar’s lists, the lock', async () => {
      await start();
      const settings = TestBed.inject(SettingsRepository);
      const list = await lists().create({ name: 'Mine' });
      await soon(checked(3));
      const before = server.requests.length;

      await settings.update({ theme: 'light' });
      await settings.update({ calendarHiddenLists: [list.id] });
      await TestBed.inject(AppLockRepository).turnOn('correct horse battery', 5);
      await pause();
      expect(server.requests.length).toBe(before);

      // A setting every device shares does.
      await settings.update({ monthlyBudget: 250 });
      await soon(checked(4));
      expect((await chainCopy()).settings).toMatchObject({ monthlyBudget: 250 });
    });

    it('syncs a change made after the app locked and unlocked', async () => {
      await start();
      const storage = TestBed.inject(StorageService);
      const lock = TestBed.inject(AppLockRepository);
      await lock.turnOn('correct horse battery', 5);
      storage.lockNow();
      await soon(() => storage.lock() === 'locked');
      expect(await lock.unlock('correct horse battery')).toBe(true);
      // Unlocked, it syncs, as on start.
      await soon(checked(3));

      await lists().create({ name: 'Mine' });
      await soon(checked(4));
      expect((await chainCopy()).data.lists.map((list) => list.name)).toContain('Mine');
    });
  });

  it('starts over with a new code: the data moves to a new chain and the old one is deleted', async () => {
    await turnOn();
    const fresh = Uint8Array.from({ length: 32 }, () => 7);
    const freshKeys = await syncKeys(fresh);

    expect(await service.startOver(fresh)).toBe('synced');
    expect(server.chain(keys.chainId)).toBeUndefined();
    expect(server.chain(freshKeys.chainId)?.version).toBe(1);
  });

  it('changes nothing when offline: Start over waits, and a deletion fails saying why', async () => {
    await turnOn();
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    expect(await service.startOver(Uint8Array.from({ length: 32 }, () => 7))).toBe('offline');
    expect(service.record()?.seed).toBe('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=');

    server.fail = 'offline';
    await expect(service.deleteCopy()).rejects.toThrow();
    expect(server.chain(keys.chainId)).toBeDefined();
    await until(() => service.record() !== undefined);
  });

  it('deletes the synced copy for every device, and turns sync off here', async () => {
    await turnOn();
    await service.deleteCopy();
    expect(server.chain(keys.chainId)).toBeUndefined();
    await until(() => service.record() === undefined);
    expect(TestBed.inject(SyncRepository).record()).toBeUndefined();
    expect(lists().records()).toHaveLength(1);
  });
});
