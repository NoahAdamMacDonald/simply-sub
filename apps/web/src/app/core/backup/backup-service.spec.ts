import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { backupRefusals, type BackupReading, type UserTable } from '@simply-sub/core';
import { CatalogStore } from '../catalog/catalog-store';
import { plantRows, storedRows, testStorage, type TestStorage } from '../storage/storage.testing';
import { BackupService } from './backup-service';

// Backups (P13's Your data) on a fake IndexedDB: Export, Delete all data, Import's Replace and Merge, plain and
// encrypted, and the files Import refuses, with nothing written. The clock says Oct 25, 2026.

const ids = {
  work: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
  old: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e',
  netflix: '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
  gym: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c',
  gymPlan: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d',
  family: '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d',
};
const stamps = { createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-20T09:15:00.000Z' };

const records = {
  settings: [
    {
      key: 'settings',
      country: 'CA',
      subdivision: 'CA-AB',
      currency: 'CAD',
      monthlyBudget: 200,
      theme: 'dark',
      updatedAt: '2026-10-20T09:15:00.000Z',
    },
  ],
  lists: [
    { id: ids.work, name: 'Work Related', ...stamps },
    // Deleted: a restore gives it back as it was.
    { id: ids.old, name: 'Old', ...stamps, deletedAt: '2026-10-21T08:00:00.000Z' },
  ],
  items: [
    {
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
      nickname: "Mom's",
      note: 'Shared',
      ...stamps,
    },
  ],
  customSubs: [
    {
      id: ids.gym,
      name: 'Gym',
      plans: [
        {
          id: ids.gymPlan,
          name: 'Monthly',
          features: {},
          price: { amount: 40, currency: 'CAD', interval: 'month', intervalCount: 1 },
          autoRenewAvailable: true,
        },
      ],
      ...stamps,
    },
  ],
  rankings: [{ rankKey: 'video.quality=4k', rank: 'wanted', ...stamps }],
  tags: [{ id: ids.family, name: 'Family', color: '#1e88e5', ...stamps }],
};

const backedUp: readonly UserTable[] = [
  'settings',
  'lists',
  'items',
  'customSubs',
  'rankings',
  'cards',
  'tags',
];

describe('BackupService', () => {
  let storage: TestStorage;
  let backups: BackupService;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: CatalogStore, useValue: { version: signal('c4f9a21') } },
      ],
    });
    backups = TestBed.inject(BackupService);
  });

  async function plantAll(): Promise<void> {
    for (const [table, rows] of Object.entries(records)) {
      await plantRows(storage.indexedDB, table as UserTable, rows);
    }
    await plantRows(storage.indexedDB, 'drafts', [
      {
        listId: ids.work,
        isNew: false,
        name: 'Work',
        startName: 'Work Related',
        items: [],
        startedAt: stamps.createdAt,
      },
    ]);
  }

  /** Every backed-up table as stored, each sorted by its key. */
  async function stored(): Promise<Record<string, unknown[]>> {
    const tables: Record<string, unknown[]> = {};
    for (const table of backedUp) {
      const rows = (await storedRows(storage.indexedDB, table)) as Record<string, string>[];
      tables[table] = rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return tables;
  }

  async function opened(reading: BackupReading, passphrase?: string): Promise<BackupReading> {
    if (reading.kind !== 'encrypted' || passphrase === undefined) return reading;
    return backups.open(reading.file, passphrase);
  }

  it('exports every backed-up record, deleted ones too, named by the day', async () => {
    await plantAll();
    const file = await backups.export();
    expect(file?.name).toBe('simply-sub-backup-2026-10-25.json');
    const json = JSON.parse(file?.text ?? '');
    expect(json).toMatchObject({
      app: 'simply-sub',
      schemaVersion: 1,
      exportedAt: '2026-10-25T12:00:00.000Z',
      catalogVersion: 'c4f9a21',
      data: { settings: records.settings[0], cards: [] },
    });
    expect(json.data.lists).toHaveLength(2);
    expect(json.data).not.toHaveProperty('drafts');
  });

  it('exports nothing before the first run', async () => {
    expect(await backups.export()).toBeUndefined();
  });

  it.each([
    ['plain', undefined],
    ['encrypted', 'correct horse battery'],
  ])(
    'Export, Delete all data and Import (Replace) give back identical data: %s',
    async (_, passphrase) => {
      await plantAll();
      const before = await stored();
      const file = await backups.export(passphrase);
      if (!file) throw new Error('No backup');
      if (passphrase) {
        expect(file.text).not.toContain('Work Related');
        expect(file.text).not.toContain("Mom's");
      }

      await backups.deleteAll();
      for (const table of [...backedUp, 'drafts', 'catalogCache', 'fxRates'] as UserTable[]) {
        expect(await storedRows(storage.indexedDB, table)).toEqual([]);
      }

      const reading = await opened(await backups.read(new Blob([file.text])), passphrase);
      if (reading.kind !== 'backup') throw new Error(`Not read: ${reading.kind}`);
      await backups.replace(reading.backup.data);
      expect(await stored()).toEqual(before);
    },
    20_000,
  );

  it('opens nothing with a wrong passphrase, or a changed file, and writes nothing', async () => {
    await plantAll();
    const file = await backups.export('correct horse battery');
    if (!file) throw new Error('No backup');
    await backups.deleteAll();
    const reading = await backups.read(new Blob([file.text]));
    if (reading.kind !== 'encrypted') throw new Error('Not encrypted');

    expect(await backups.open(reading.file, 'wrong horse battery')).toEqual({
      kind: 'refused',
      reason: backupRefusals.wrongPassphrase,
    });
    const ciphertext = reading.file.encrypted.ciphertext;
    const changed = {
      ...reading.file,
      encrypted: {
        ...reading.file.encrypted,
        ciphertext: (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1),
      },
    };
    expect(await backups.open(changed, 'correct horse battery')).toEqual({
      kind: 'refused',
      reason: backupRefusals.wrongPassphrase,
    });
    expect(await storedRows(storage.indexedDB, 'lists')).toEqual([]);
  }, 20_000);

  it('refuses a file too big to be a backup, or one that isn’t a backup', async () => {
    const big = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]);
    expect(await backups.read(big)).toEqual({ kind: 'refused', reason: backupRefusals.tooBig });
    expect(await backups.read(new Blob(['{"app":"other"}']))).toEqual({
      kind: 'refused',
      reason: backupRefusals.notBackup,
    });
  });

  it('merges the records the backup has newer or that aren’t here, keeping newer ones and drafts', async () => {
    await plantAll();
    const file = await backups.export();
    if (!file) throw new Error('No backup');
    const reading = await backups.read(new Blob([file.text]));
    if (reading.kind !== 'backup') throw new Error('Not read');

    // Since the export, the list was renamed here (so it's newer here), and the backup's item is newer than the one here.
    await plantRows(storage.indexedDB, 'lists', [
      { ...records.lists[0], name: 'Work', updatedAt: '2026-10-24T09:00:00.000Z' },
    ]);
    const counts = await backups.merge({
      ...reading.backup.data,
      items: reading.backup.data.items.map((item) => ({
        ...item,
        updatedAt: '2026-10-22T09:00:00.000Z',
      })),
    });

    expect(counts).toMatchObject({ lists: 0, items: 1, settings: 0 });
    const lists = (await storedRows(storage.indexedDB, 'lists')) as { name: string }[];
    expect(lists.map((list) => list.name).sort()).toEqual(['Old', 'Work']);
    expect(
      ((await storedRows(storage.indexedDB, 'items')) as { updatedAt: string }[])[0].updatedAt,
    ).toBe('2026-10-22T09:00:00.000Z');
    expect(await storedRows(storage.indexedDB, 'drafts')).toHaveLength(1);
  });

  it('drops the list drafts on Replace, as they may edit lists that are gone', async () => {
    await plantAll();
    const file = await backups.export();
    const reading = await backups.read(new Blob([file?.text ?? '']));
    if (reading.kind !== 'backup') throw new Error('Not read');
    await backups.replace(reading.backup.data);
    expect(await storedRows(storage.indexedDB, 'drafts')).toEqual([]);
  });
});
