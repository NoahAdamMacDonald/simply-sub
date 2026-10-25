import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { InvalidRecordError, type ListItem } from '@simply-sub/core';
import { IDBKeyRange } from 'fake-indexeddb';
import { ItemsRepository } from './items-repository';
import { ListsRepository } from './lists-repository';
import { RejectedRecords } from './rejected-records';
import { INDEXED_DB } from './storage-service';
import { plantRows, storedRows, testStorage, until, type TestStorage } from './storage.testing';

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const plantedId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const created = '2026-10-25T12:00:00.000Z';

function newItem(listId: string): Omit<ListItem, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    listId,
    source: { kind: 'catalog', planId: 'netflix.standard' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    priceOverride: { amount: 15.99, currency: 'CAD', until: '2027-01-01' },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
  };
}

describe('RecordRepository', () => {
  let storage: TestStorage;

  beforeEach(() => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is loading at first, then ready with no records', async () => {
    const lists = TestBed.inject(ListsRepository);
    expect(lists.status()).toBe('loading');
    expect(lists.records()).toEqual([]);
    await until(() => lists.status() === 'ready');
    expect(lists.records()).toEqual([]);
  });

  describe('create', () => {
    it('stores a record with a new UUID v7 id and the time now', async () => {
      const lists = TestBed.inject(ListsRepository);
      const list = await lists.create({ name: 'Work Related' });
      expect(list).toEqual({
        id: expect.stringMatching(uuidV7),
        name: 'Work Related',
        createdAt: created,
        updatedAt: created,
      });
      // A UUID v7 starts with its time in milliseconds.
      expect(parseInt(list.id.replace(/-/g, '').slice(0, 12), 16)).toBe(Date.parse(created));
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([list]);
    });

    it('shows the new record in the signals', async () => {
      const lists = TestBed.inject(ListsRepository);
      const list = await lists.create({ name: 'Work Related' });
      await until(() => lists.records().length === 1);
      expect(lists.records()).toEqual([list]);
      expect(lists.byId().get(list.id)).toEqual(list);
    });

    it('stores the record as its schema returns it', async () => {
      const list = await TestBed.inject(ListsRepository).create({ name: '  Family  ' });
      expect(list.name).toBe('Family');
    });

    it('refuses an invalid record and stores nothing', async () => {
      const lists = TestBed.inject(ListsRepository);
      await expect(lists.create({ name: ' ' })).rejects.toThrow(InvalidRecordError);
      await expect(lists.create({ name: 'Family', color: 'red' } as never)).rejects.toThrow(
        'Invalid lists record',
      );
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([]);
    });

    it('keeps the records in the order they were created', async () => {
      const lists = TestBed.inject(ListsRepository);
      for (const [index, name] of ['First', 'Second', 'Third'].entries()) {
        storage.clock.time = `2026-10-25T12:00:0${index}.000Z`;
        await lists.create({ name });
      }
      await until(() => lists.records().length === 3);
      expect(lists.records().map((list) => list.name)).toEqual(['First', 'Second', 'Third']);
    });
  });

  describe('update', () => {
    it('changes the record and moves updatedAt forward', async () => {
      const lists = TestBed.inject(ListsRepository);
      const list = await lists.create({ name: 'Work' });
      storage.clock.time = '2026-10-26T08:00:00.000Z';
      const updated = await lists.update(list.id, { name: 'Family' });
      expect(updated).toEqual({ ...list, name: 'Family', updatedAt: '2026-10-26T08:00:00.000Z' });
      await until(() => lists.records()[0]?.name === 'Family');
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([updated]);
    });

    it('clears a field set to undefined', async () => {
      const items = TestBed.inject(ItemsRepository);
      const item = await items.create(newItem(plantedId));
      const updated = await items.update(item.id, { priceOverride: undefined });
      expect('priceOverride' in updated).toBe(false);
      expect(await storedRows(storage.indexedDB, 'items')).toEqual([updated]);
    });

    it('moves updatedAt forward even when the clock has gone back', async () => {
      const lists = TestBed.inject(ListsRepository);
      const list = await lists.create({ name: 'Work' });
      storage.clock.time = '2026-10-24T12:00:00.000Z';
      expect((await lists.update(list.id, { name: 'Family' })).updatedAt).toBe(
        '2026-10-25T12:00:00.001Z',
      );
    });

    it('refuses a change that makes the record invalid, and keeps the stored one', async () => {
      const lists = TestBed.inject(ListsRepository);
      const list = await lists.create({ name: 'Work' });
      await expect(lists.update(list.id, { name: 'x'.repeat(61) })).rejects.toThrow(
        InvalidRecordError,
      );
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([list]);
    });

    it('fails for a record that is not there', async () => {
      await expect(
        TestBed.inject(ListsRepository).update(plantedId, { name: 'x' }),
      ).rejects.toThrow(`There's no lists record ${plantedId} to change`);
    });
  });

  describe('remove', () => {
    it('soft-deletes the record: it leaves the signals but stays stored', async () => {
      const lists = TestBed.inject(ListsRepository);
      const list = await lists.create({ name: 'Work' });
      await until(() => lists.records().length === 1);
      storage.clock.time = '2026-10-26T08:00:00.000Z';
      await lists.remove(list.id);
      await until(() => lists.records().length === 0);
      expect(lists.byId().has(list.id)).toBe(false);
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([
        { ...list, updatedAt: '2026-10-26T08:00:00.000Z', deletedAt: '2026-10-26T08:00:00.000Z' },
      ]);
    });

    it('leaves a deleted record as it is, and refuses to change it', async () => {
      const lists = TestBed.inject(ListsRepository);
      const list = await lists.create({ name: 'Work' });
      await lists.remove(list.id);
      const [deleted] = await storedRows(storage.indexedDB, 'lists');
      storage.clock.time = '2026-10-27T08:00:00.000Z';
      await lists.remove(list.id);
      await expect(lists.update(list.id, { name: 'Family' })).rejects.toThrow("There's no lists");
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([deleted]);
    });

    it('does nothing for a record that is not there', async () => {
      await TestBed.inject(ListsRepository).remove(plantedId);
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([]);
    });
  });

  describe('records stored by something else', () => {
    const valid = { id: plantedId, name: 'Planted', createdAt: created, updatedAt: created };
    const secret = 'Netflix 4111 SECRET';
    const malformed = {
      id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e',
      name: secret,
      note: secret,
      createdAt: 'yesterday',
      updatedAt: created,
    };

    it('shows a valid record written in another tab', async () => {
      const lists = TestBed.inject(ListsRepository);
      await until(() => lists.status() === 'ready');
      await plantRows(storage.indexedDB, 'lists', [valid]);
      await until(() => lists.records().length === 1);
      expect(lists.records()).toEqual([valid]);
    });

    it('rejects a malformed record rather than showing it, and leaves it stored', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await plantRows(storage.indexedDB, 'lists', [valid, malformed]);
      const lists = TestBed.inject(ListsRepository);
      await until(() => lists.status() === 'ready');
      expect(lists.records()).toEqual([valid]);
      expect(lists.byId().has(malformed.id)).toBe(false);
      expect(TestBed.inject(RejectedRecords).count()).toBe(1);
      expect(await storedRows(storage.indexedDB, 'lists')).toContainEqual(malformed);
      expect(warn).toHaveBeenCalledWith(
        `A saved record couldn't be read, so it's hidden. lists record ${malformed.id}: createdAt: invalid_format; (record): unrecognized_keys`,
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');
    });

    it('refuses to change a record it cannot read', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await plantRows(storage.indexedDB, 'lists', [malformed]);
      const lists = TestBed.inject(ListsRepository);
      await expect(lists.update(malformed.id, { name: 'Fixed' })).rejects.toThrow(
        InvalidRecordError,
      );
      await lists.remove(malformed.id).catch(() => undefined);
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([malformed]);
    });
  });

  describe('when IndexedDB is blocked', () => {
    beforeEach(() => {
      const blocked = {
        open: () => {
          throw new DOMException('The user denied permission', 'SecurityError');
        },
      };
      TestBed.overrideProvider(INDEXED_DB, { useValue: { indexedDB: blocked, IDBKeyRange } });
    });

    it('has an error status and no records', async () => {
      const lists = TestBed.inject(ListsRepository);
      await until(() => lists.status() === 'error');
      expect(lists.records()).toEqual([]);
    });

    it('fails a write', async () => {
      await expect(TestBed.inject(ListsRepository).create({ name: 'Work' })).rejects.toThrow();
    });
  });
});

describe('ItemsRepository', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testStorage().providers });
  });

  it("groups the items that aren't deleted by list", async () => {
    const items = TestBed.inject(ItemsRepository);
    const otherList = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
    const first = await items.create(newItem(plantedId));
    const second = await items.create(newItem(plantedId));
    const other = await items.create(newItem(otherList));
    const removed = await items.create(newItem(otherList));
    await items.remove(removed.id);
    await until(() => items.records().length === 3);
    expect(items.byList()).toEqual(
      new Map([
        [plantedId, [first, second]],
        [otherList, [other]],
      ]),
    );
  });
});
