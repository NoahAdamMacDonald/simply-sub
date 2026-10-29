import { TestBed } from '@angular/core/testing';
import {
  readSyncCopy,
  syncSchemaVersion,
  type Settings,
  type SubscriptionList,
  type SyncCopy,
} from '@simply-sub/core';
import { openCopy, sealCopy, syncKeys, type SyncKeys } from '../../core/crypto/sync-crypto';
import { ListsRepository } from '../../core/storage/lists-repository';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
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
        { provide: SYNC_TIMING, useValue: { settleMs: 0, pollMs: 60_000 } },
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

      expect(await service.join(seed, preview, 'merge')).toBe('synced');
      await until(() => lists().records().length === 2);
      const saved = (await storedRows(storage.indexedDB, 'settings'))[0] as Settings;
      expect(saved).toMatchObject({ subdivision: 'CA-ON', monthlyBudget: 300, theme: 'dark' });
      const copy = await chainCopy();
      expect(copy.data.lists.map((list) => list.name).sort()).toEqual(['Mine', 'Shared']);
      expect(copy.devices.map((device) => device.name)).toEqual(['This browser', 'Phone']);
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
