import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { lockedTables, readRecords, type BackupData, type UserTable } from '@simply-sub/core';
import { IDBKeyRange } from 'fake-indexeddb';
import { fromBase64, toBase64 } from '../crypto/passphrase-crypto';
import { AppLockRepository } from './app-lock-repository';
import { BackupRepository } from './backup-repository';
import { ListsRepository } from './lists-repository';
import { RejectedRecords } from './rejected-records';
import { SettingsRepository } from './settings-repository';
import { AppLockedError, openStorageEngine, type StorageEngine } from './storage-engine';
import { LOCK_HINT_STORAGE_KEY, StorageService } from './storage-service';
import { plantRows, storedRows, testStorage, until, type TestStorage } from './storage.testing';
import { TagsRepository } from './tags-repository';

// The app lock (P13, P15, BLUEPRINT §11.5) on a fake IndexedDB, with 1,000 iterations: what's sealed on disk, turning
// it on and off, unlocking and locking, writes from a tab that's locked, another tab, and backups while it's on.

const ids = {
  work: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
  old: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e',
  netflix: '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
  gym: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c',
  gymPlan: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d',
  family: '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d',
  card: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
};
const stamps = { createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-20T09:15:00.000Z' };
const passphrase = 'correct horse battery';

const netflix = {
  id: ids.netflix,
  listId: ids.work,
  source: { kind: 'catalog', planId: 'netflix.standard' },
  billing: {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-11-12',
    autoRenew: true,
  },
  tagIds: [ids.family],
  rankOverrides: { 'streaming.ad-free': 'essential' },
  pinned: true,
  nickname: 'Mom’s',
  ...stamps,
};

/** A row in every table, the caches too, with words and amounts that mustn't show on disk once it's locked. */
const records: Record<UserTable, readonly unknown[]> = {
  settings: [
    {
      key: 'settings',
      country: 'CA',
      subdivision: 'CA-AB',
      currency: 'CAD',
      monthlyBudget: 271,
      theme: 'dark',
      updatedAt: '2026-10-20T09:15:00.000Z',
    },
  ],
  lists: [
    { id: ids.work, name: 'Work Related', ...stamps },
    { id: ids.old, name: 'Old Stuff', ...stamps, deletedAt: '2026-10-21T08:00:00.000Z' },
  ],
  items: [netflix],
  customSubs: [
    {
      id: ids.gym,
      name: 'Goodlife Gym',
      plans: [
        {
          id: ids.gymPlan,
          name: 'Monthly',
          features: {},
          price: { amount: 43.21, currency: 'CAD', interval: 'month', intervalCount: 1 },
          autoRenewAvailable: true,
        },
      ],
      ...stamps,
    },
  ],
  rankings: [{ rankKey: 'video.quality=4k', rank: 'unwanted', ...stamps }],
  cards: [
    {
      id: ids.card,
      name: 'Travel Visa',
      type: 'credit',
      network: 'visa',
      currency: 'CAD',
      cashbackPercent: 1.5,
      fxFeePercent: 2.5,
      ...stamps,
    },
  ],
  tags: [{ id: ids.family, name: 'Family', color: '#1e88e5', ...stamps }],
  drafts: [
    {
      listId: ids.work,
      isNew: false,
      name: 'Work Draft Name',
      startName: 'Work Related',
      items: [{ item: netflix, saved: netflix }],
      startedAt: '2026-10-24T10:00:00.000Z',
    },
  ],
  dismissedSuggestions: [{ fingerprint: '3f9a0c1d2e4b5a67', listId: ids.work, ...stamps }],
  liveCalendar: [
    {
      key: 'liveCalendar',
      setId: 'Qx3Lm8Rt5Vw2Yz7Bd4Gh1J',
      manageKey: 'Jd8f2LqP0zXn5Vt7Bc3HyA',
      calendars: [{ holds: 'all', token: 'k7Qm2Zp9XvT4bN8cR1sW0a' }],
      titles: 'name-amount',
      sentAt: '2026-10-29T18:20:00.000Z',
      updatedAt: '2026-10-29T18:20:00.000Z',
    },
  ],
  sync: [
    {
      key: 'sync',
      seed: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
      deviceId: '0192f1d0-0000-7000-8000-00000000000a',
      deviceName: 'Work Laptop',
      updatedAt: '2026-10-29T18:20:00.000Z',
    },
  ],
  catalogCache: [],
  fxRates: [
    {
      key: 'fx',
      rates: {
        base: 'CAD',
        date: '2026-10-24',
        source: 'European Central Bank via Frankfurter',
        rates: { USD: 0.72 },
      },
      fetchedAt: '2026-10-24T06:00:00.000Z',
    },
  ],
};

/** A sealed row's iv and ciphertext: base64, and nothing else. */
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** What mustn't show in a locked table's rows. */
const secrets = [
  'Work Related',
  'Old Stuff',
  'Mom’s',
  'netflix.standard',
  'Goodlife Gym',
  '43.21',
  'unwanted',
  'Travel Visa',
  'Family',
  'Work Draft Name',
  '271',
  'CA-AB',
  // The live calendar's manage key and link (M10.3).
  'Jd8f2LqP0zXn5Vt7Bc3HyA',
  // Sync's code and this device's name (M10.9).
  'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  'Work Laptop',
  'k7Qm2Zp9XvT4bN8cR1sW0a',
];

const allTables = Object.keys(records) as UserTable[];

async function plantAll(indexedDB: IDBFactory): Promise<void> {
  for (const table of allTables) {
    if (records[table].length > 0) await plantRows(indexedDB, table, records[table]);
  }
}

async function snapshot(indexedDB: IDBFactory): Promise<Record<string, unknown[]>> {
  const tables: Record<string, unknown[]> = {};
  for (const table of allTables) tables[table] = await storedRows(indexedDB, table);
  return tables;
}

describe('the app lock', () => {
  let storage: TestStorage;

  /** A visit: a new app on the same database, as after a reload. */
  function visit(): StorageService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    return TestBed.inject(StorageService);
  }

  async function opened(service: StorageService): Promise<StorageService> {
    await service.engine();
    return service;
  }

  beforeEach(async () => {
    localStorage.clear();
    storage = testStorage();
    await plantAll(storage.indexedDB);
    visit();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('turned on', () => {
    beforeEach(async () => {
      await TestBed.inject(AppLockRepository).turnOn(passphrase, 30);
    });

    it('seals every user table, with only keys and indexes in plain text', async () => {
      const rows = await snapshot(storage.indexedDB);
      for (const table of lockedTables) {
        // The sealed bytes are random base64, which can hold a short secret's digits by chance ("…k3+271Fw…"), so
        // they're checked for being base64 (no record's JSON is) and left out of the search.
        const text = JSON.stringify(rows[table], (key, value: unknown) =>
          key === 'iv' || key === 'ciphertext' ? '' : value,
        );
        for (const secret of secrets) expect(text, `${table}: ${secret}`).not.toContain(secret);
        for (const row of rows[table]) {
          expect(row).toMatchObject({
            sealed: {
              iv: expect.stringMatching(base64),
              ciphertext: expect.stringMatching(base64),
            },
          });
        }
      }
      expect(rows['lists']).toContainEqual({
        id: ids.work,
        updatedAt: stamps.updatedAt,
        sealed: { iv: expect.any(String), ciphertext: expect.any(String) },
      });
      expect(Object.keys(rows['items'][0] as object)).toEqual([
        'id',
        'listId',
        'updatedAt',
        'sealed',
      ]);
      expect(Object.keys(rows['drafts'][0] as object)).toEqual(['listId', 'sealed']);
      expect(Object.keys(rows['rankings'][0] as object)).toEqual(['rankKey', 'sealed']);
    });

    it('keeps the theme and the lock plain, and stores nothing that opens the data', async () => {
      const [settings] = (await storedRows(storage.indexedDB, 'settings')) as Record<
        string,
        unknown
      >[];
      expect(settings).toEqual({
        key: 'settings',
        theme: 'dark',
        appLock: {
          salt: expect.any(String),
          iterations: 1_000,
          check: { iv: expect.any(String), ciphertext: expect.any(String) },
          idleMinutes: 30,
        },
        sealed: expect.any(Object),
      });
      expect(fromBase64((settings['appLock'] as { salt: string }).salt)).toHaveLength(16);
    });

    it('leaves the caches plain', async () => {
      expect(await storedRows(storage.indexedDB, 'fxRates')).toEqual(records.fxRates);
    });

    it('shows the records while unlocked, and seals what’s written', async () => {
      const lists = TestBed.inject(ListsRepository);
      await until(() => lists.records().length === 1);
      expect(lists.records()[0].name).toBe('Work Related');
      const created = await lists.create({ name: 'Streaming Plans' });
      await until(() => lists.records().length === 2);
      expect(JSON.stringify(await storedRows(storage.indexedDB, 'lists'))).not.toContain(
        'Streaming',
      );
      await lists.update(created.id, { name: 'Streaming' });
      await until(() => lists.byId().get(created.id)?.name === 'Streaming');
    });

    it('keeps the lock when the settings are saved whole, without it', async () => {
      const settings = TestBed.inject(SettingsRepository);
      await until(() => settings.settings() !== undefined);
      const lock = settings.settings()?.appLock;
      expect(lock?.idleMinutes).toBe(30);
      const saved = await settings.save({ country: 'CA', currency: 'CAD', theme: 'light' });
      expect(saved.appLock).toEqual(lock);
      const [row] = (await storedRows(storage.indexedDB, 'settings')) as { appLock: unknown }[];
      expect(row.appLock).toEqual(lock);
    });

    it('changes Lock after with no key, in plain text', async () => {
      const lock = TestBed.inject(AppLockRepository);
      const settings = TestBed.inject(SettingsRepository);
      await lock.setIdle(60);
      await until(() => settings.settings()?.appLock?.idleMinutes === 60);
      await lock.setIdle('never');
      await until(() => settings.settings()?.appLock !== undefined);
      await until(() => settings.settings()?.appLock?.idleMinutes === undefined);
      // The rest of the settings still open.
      expect(settings.settings()?.monthlyBudget).toBe(271);
    });

    it('asks for the passphrase on the next visit, and a wrong one unlocks nothing', async () => {
      const service = await opened(visit());
      const lists = TestBed.inject(ListsRepository);
      const settings = TestBed.inject(SettingsRepository);
      expect(service.lock()).toBe('locked');
      expect(service.locked()).toBe(true);
      expect(service.access()).toBeUndefined();
      expect(lists.status()).toBe('loading');
      expect(settings.settings()).toBeUndefined();

      const lock = TestBed.inject(AppLockRepository);
      expect(await lock.unlock('correct horse battery!')).toBe(false);
      expect(await lock.unlock('')).toBe(false);
      expect(service.lock()).toBe('locked');
      expect(lists.records()).toEqual([]);
      const engine = await service.engine();
      await expect(engine.read('lists')).rejects.toBeInstanceOf(AppLockedError);

      expect(await lock.unlock(passphrase)).toBe(true);
      expect(service.lock()).toBe('unlocked');
      await until(() => lists.records().length === 1 && settings.settings() !== undefined);
      expect(lists.records()[0].name).toBe('Work Related');
      expect(settings.settings()?.monthlyBudget).toBe(271);
    });

    it('settles while locked, with nothing waiting for the locked tables to load', async () => {
      const service = await opened(visit());
      const lists = TestBed.inject(ListsRepository);
      expect(service.lock()).toBe('locked');
      TestBed.tick();
      await TestBed.inject(ApplicationRef).whenStable();
      expect(lists.status()).toBe('loading');
    });

    it('ends a locked table’s watch when it locks, so its records are let go', async () => {
      const engine = await TestBed.inject(StorageService).engine();
      const seen: string[][] = [];
      const ended = vi.fn();
      engine.watch('lists').subscribe({
        next: (lists) => seen.push(lists.map((list) => list.name)),
        complete: ended,
      });
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      engine.lock();
      expect(ended).toHaveBeenCalled();
      // A cache's watch carries on.
      const rates = vi.fn();
      engine.watch('fxRates').subscribe(rates);
      await vi.waitFor(() => expect(rates).toHaveBeenCalled());
    });

    it('drops the key and the repositories’ records when it locks', async () => {
      const service = TestBed.inject(StorageService);
      const tags = TestBed.inject(TagsRepository);
      await until(() => tags.records().length === 1);
      service.lockNow();
      await until(() => service.lock() === 'locked');
      TestBed.tick();
      expect(tags.records()).toEqual([]);
      expect(tags.status()).toBe('loading');
      const engine = await service.engine();
      await expect(engine.read('tags')).rejects.toBeInstanceOf(AppLockedError);

      expect(await TestBed.inject(AppLockRepository).unlock(passphrase)).toBe(true);
      await until(() => tags.records().length === 1);
    });

    it('writes nothing while locked', async () => {
      const service = TestBed.inject(StorageService);
      const before = await snapshot(storage.indexedDB);
      service.lockNow();
      await until(() => service.lock() === 'locked');
      const lists = TestBed.inject(ListsRepository);
      await expect(lists.create({ name: 'Leak' })).rejects.toBeInstanceOf(AppLockedError);
      await expect(
        TestBed.inject(SettingsRepository).save({ country: 'CA', currency: 'CAD', theme: 'light' }),
      ).rejects.toBeInstanceOf(AppLockedError);
      expect(await snapshot(storage.indexedDB)).toEqual(before);
    });

    it('remembers it was on, so the next visit shows the lock screen before the database opens', () => {
      expect(localStorage.getItem(LOCK_HINT_STORAGE_KEY)).toBe('on');
      const service = visit();
      expect(service.lock()).toBeUndefined();
      expect(service.locked()).toBe(true);
    });

    it('hides a sealed row that doesn’t open, and shows the rest', async () => {
      const rows = (await storedRows(storage.indexedDB, 'lists')) as {
        id: string;
        sealed: { iv: string; ciphertext: string };
      }[];
      const work = rows.find((row) => row.id === ids.work);
      if (!work) throw new Error('No Work Related row');
      const bytes = fromBase64(work.sealed.ciphertext);
      bytes[0] ^= 1;
      // A changed value, and a value moved to another list's row.
      const moved = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4f';
      await plantRows(storage.indexedDB, 'lists', [
        { ...work, sealed: { ...work.sealed, ciphertext: toBase64(bytes) } },
        { ...work, id: moved },
      ]);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      visit();
      expect(await TestBed.inject(AppLockRepository).unlock(passphrase)).toBe(true);
      const lists = TestBed.inject(ListsRepository);
      await until(() => lists.status() === 'ready');
      // Old Stuff is deleted, so no list shows, and both rows are reported by key alone.
      expect(lists.records()).toEqual([]);
      const reported = warn.mock.calls.map(([message]) => String(message)).join('\n');
      expect(reported).toContain(`lists record ${ids.work}: sealed: unopened`);
      expect(reported).toContain(`lists record ${moved}: sealed: unopened`);
      expect(reported).not.toContain('Work Related');
    });

    it('turns off only with its passphrase, and gives back every table exactly', async () => {
      const lock = TestBed.inject(AppLockRepository);
      const sealed = await snapshot(storage.indexedDB);
      expect(await lock.turnOff('wrong passphrase')).toBe(false);
      expect(await snapshot(storage.indexedDB)).toEqual(sealed);

      expect(await lock.turnOff(passphrase)).toBe(true);
      expect(TestBed.inject(StorageService).lock()).toBe('off');
      expect(await snapshot(storage.indexedDB)).toEqual(records);
      expect(localStorage.getItem(LOCK_HINT_STORAGE_KEY)).toBeNull();
    });

    describe('with backups', () => {
      it('exports the opened records, without the lock', async () => {
        const data = await TestBed.inject(BackupRepository).read();
        expect(data?.lists.map((list) => list.name)).toEqual(['Work Related', 'Old Stuff']);
        expect(data?.settings).toEqual(records.settings[0]);
      });

      it('replaces everything, keeping the lock and sealing what it writes', async () => {
        const backup = (await TestBed.inject(BackupRepository).read()) as BackupData;
        const renamed = { ...backup, lists: [{ ...backup.lists[0], name: 'Imported List' }] };
        await TestBed.inject(BackupRepository).replace(renamed);
        expect(TestBed.inject(StorageService).lock()).toBe('unlocked');
        const rows = await snapshot(storage.indexedDB);
        expect(JSON.stringify(rows['lists'])).not.toContain('Imported');
        expect(rows['settings'][0]).toHaveProperty('appLock');
        const lists = TestBed.inject(ListsRepository);
        await until(() => lists.records()[0]?.name === 'Imported List');
      });

      it('restores a backup from the lock screen: everything else gone, the lock off, written plain', async () => {
        const backup = (await TestBed.inject(BackupRepository).read()) as BackupData;
        const service = await opened(visit());
        expect(service.lock()).toBe('locked');
        await TestBed.inject(BackupRepository).restore({ ...backup, lists: [backup.lists[0]] });
        expect(service.lock()).toBe('off');
        const rows = await snapshot(storage.indexedDB);
        expect(rows['lists']).toEqual([records.lists[0]]);
        expect(rows['drafts']).toEqual([]);
        expect(rows['fxRates']).toEqual([]);
        expect(rows['settings']).toEqual(records.settings);
      });

      it('deletes all data from the lock screen, the lock with it', async () => {
        const service = await opened(visit());
        await TestBed.inject(BackupRepository).deleteAll();
        expect(service.lock()).toBe('off');
        for (const rows of Object.values(await snapshot(storage.indexedDB)))
          expect(rows).toEqual([]);
      });
    });
  });

  it('starts from valid records in every table, so the round trip is the app’s own data', () => {
    for (const table of allTables) {
      expect(readRecords(table, records[table]).rejected, table).toEqual([]);
    }
  });

  it('turns on and off under live repositories with nothing reported unreadable', async () => {
    const lists = TestBed.inject(ListsRepository);
    const settings = TestBed.inject(SettingsRepository);
    const lock = TestBed.inject(AppLockRepository);
    await until(() => lists.records().length === 1 && settings.settings() !== undefined);
    for (let round = 0; round < 3; round++) {
      await lock.turnOn(passphrase, 15);
      expect(TestBed.inject(StorageService).lock()).toBe('unlocked');
      await until(() => settings.settings()?.appLock !== undefined);
      expect(await lock.turnOff(passphrase)).toBe(true);
      await until(() => settings.settings() !== undefined && !settings.settings()?.appLock);
    }
    expect(lists.records()[0].name).toBe('Work Related');
    expect(TestBed.inject(RejectedRecords).count()).toBe(0);
  });

  it('can’t turn on before the first run has saved the settings', async () => {
    await plantRows(storage.indexedDB, 'settings', []);
    const engine = await openStorageEngine({
      dependencies: { indexedDB: storage.indexedDB, IDBKeyRange },
      onRejected: () => undefined,
      onWrite: () => undefined,
      lockIterations: 1_000,
    });
    await engine.transaction(['settings'], (transaction) => transaction.clear('settings'));
    await expect(engine.enableLock(passphrase)).rejects.toThrow('no settings');
    engine.close();
  });

  describe('in two tabs', () => {
    let first: StorageEngine;
    let second: StorageEngine;

    function open(): Promise<StorageEngine> {
      return openStorageEngine({
        dependencies: { indexedDB: storage.indexedDB, IDBKeyRange },
        onRejected: () => undefined,
        onWrite: () => undefined,
        lockIterations: 1_000,
      });
    }

    beforeEach(async () => {
      first = await open();
      second = await open();
    });

    afterEach(() => {
      first.close();
      second.close();
    });

    it('locks the other tab when one turns it on, which then writes nothing plain', async () => {
      expect(second.lockState()).toBe('off');
      await first.enableLock(passphrase);
      await vi.waitFor(() => expect(second.lockState()).toBe('locked'));
      await expect(second.read('lists')).rejects.toBeInstanceOf(AppLockedError);
      await expect(
        second.add('lists', {
          id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c50',
          name: 'Leak',
          ...stamps,
        }),
      ).rejects.toBeInstanceOf(AppLockedError);
      expect(JSON.stringify(await storedRows(storage.indexedDB, 'lists'))).not.toContain('Leak');

      expect(await second.unlock(passphrase)).toBe(true);
      expect((await second.read('lists')).map((list) => list.name)).toEqual([
        'Work Related',
        'Old Stuff',
      ]);
    });

    it('refuses a write made before this tab heard the lock went on', async () => {
      await first.enableLock(passphrase);
      // The second tab hasn't heard yet: its write still reads the lock that's stored.
      const write = second.modify('tags', ids.family, (tag) => tag && { ...tag, name: 'Leak' });
      await expect(write).rejects.toBeInstanceOf(AppLockedError);
      expect(JSON.stringify(await storedRows(storage.indexedDB, 'tags'))).not.toContain('Leak');
    });

    it('locks a tab whose key is for a passphrase changed in another tab', async () => {
      await first.enableLock(passphrase);
      await vi.waitFor(() => expect(second.lockState()).toBe('locked'));
      expect(await second.unlock(passphrase)).toBe(true);
      expect(await first.disableLock(passphrase)).toBe(true);
      await first.enableLock('another passphrase');
      await vi.waitFor(() => expect(second.lockState()).toBe('locked'));
      expect(await second.unlock(passphrase)).toBe(false);
      expect(await second.unlock('another passphrase')).toBe(true);
    });
  });
});
