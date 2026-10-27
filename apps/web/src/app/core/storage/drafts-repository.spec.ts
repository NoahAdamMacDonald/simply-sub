import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import {
  InvalidRecordError,
  type ListDraft,
  type ListItem,
  type SubscriptionList,
} from '@simply-sub/core';
import { DraftsRepository } from './drafts-repository';
import { ItemsRepository } from './items-repository';
import { ListsRepository } from './lists-repository';
import type { NewRecord } from './record-repository';
import { plantRows, storedRows, testStorage, until, type TestStorage } from './storage.testing';

const unknownId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';

function itemFields(planId: string): Omit<NewRecord<'items'>, 'listId'> {
  return {
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
  };
}

describe('DraftsRepository', () => {
  let storage: TestStorage;
  let drafts: DraftsRepository;
  let work: SubscriptionList;
  let netflix: ListItem;
  let mullvad: ListItem;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    drafts = TestBed.inject(DraftsRepository);
    const lists = TestBed.inject(ListsRepository);
    const items = TestBed.inject(ItemsRepository);
    work = await lists.create({ name: 'Work Related' });
    const family = await lists.create({ name: 'Family' });
    netflix = await items.create({ ...itemFields('netflix.standard'), listId: work.id });
    mullvad = await items.create({ ...itemFields('mullvad.vpn'), listId: work.id });
    const removed = await items.create({ ...itemFields('proton.mail-plus'), listId: work.id });
    await items.remove(removed.id);
    await items.create({ ...itemFields('crave.premium'), listId: family.id });
    storage.clock.time = '2026-10-26T08:00:00.000Z';
    await until(() => drafts.status() === 'ready');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const stored = async () => (await storedRows(storage.indexedDB, 'drafts')) as ListDraft[];
  const storedList = async (id: string) =>
    ((await storedRows(storage.indexedDB, 'lists')) as SubscriptionList[]).find(
      (list) => list.id === id,
    );
  const storedItems = async () => (await storedRows(storage.indexedDB, 'items')) as ListItem[];

  describe('start', () => {
    it('copies the list and its items into a draft, leaving out deleted ones and other lists’', async () => {
      const started = await drafts.start(work.id);

      const draft: ListDraft = {
        listId: work.id,
        isNew: false,
        name: 'Work Related',
        startName: 'Work Related',
        items: [
          { item: netflix, saved: netflix },
          { item: mullvad, saved: mullvad },
        ],
        startedAt: '2026-10-26T08:00:00.000Z',
      };
      expect(started).toEqual({ draft, resumed: false });
      expect(await stored()).toEqual([draft]);
      await until(() => drafts.byList().has(work.id));
      expect(drafts.drafts()).toEqual([draft]);
    });

    it('resumes the draft there is, with its changes', async () => {
      await drafts.start(work.id);
      await drafts.change(work.id, (draft) => ({ ...draft, name: 'Work' }));

      const again = await drafts.start(work.id);
      expect(again?.resumed).toBe(true);
      expect(again?.draft.name).toBe('Work');
      expect(await stored()).toHaveLength(1);
    });

    it('starts nothing for a list there isn’t, or a deleted one', async () => {
      expect(await drafts.start(unknownId)).toBeUndefined();
      await TestBed.inject(ListsRepository).remove(work.id);
      expect(await drafts.start(work.id)).toBeUndefined();
      expect(await stored()).toEqual([]);
    });

    it('replaces a draft it can’t read with a fresh copy', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await plantRows(storage.indexedDB, 'drafts', [{ listId: work.id, name: 42 }]);

      const started = await drafts.start(work.id);
      expect(started?.resumed).toBe(false);
      expect(await stored()).toEqual([started?.draft]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`drafts record ${work.id}`));
    });
  });

  describe('create', () => {
    it('makes a new list’s draft with a new id, and nothing in the lists table', async () => {
      const draft = await drafts.create();

      expect(draft).toEqual({
        listId: expect.any(String),
        isNew: true,
        name: 'Subscription List',
        startName: 'Subscription List',
        items: [],
        startedAt: '2026-10-26T08:00:00.000Z',
      });
      expect(await stored()).toEqual([draft]);
      expect(await storedList(draft.listId)).toBeUndefined();
      expect(await drafts.start(draft.listId)).toEqual({ draft, resumed: true });
    });

    it('names it after the lists there are, not deleted ones', async () => {
      const lists = TestBed.inject(ListsRepository);
      await lists.create({ name: 'Subscription List' });
      const deleted = await lists.create({ name: 'Subscription List 2' });
      await lists.remove(deleted.id);

      expect((await drafts.create()).name).toBe('Subscription List 2');
    });
  });

  describe('change', () => {
    it('refuses an invalid change, or a list with no draft, and writes nothing', async () => {
      const { draft } = (await drafts.start(work.id))!;

      await expect(
        drafts.change(work.id, (current) => ({ ...current, name: ' ' })),
      ).rejects.toThrow(InvalidRecordError);
      await expect(drafts.change(unknownId, (current) => current)).rejects.toThrow('no draft');
      expect(await stored()).toEqual([draft]);
    });

    it('adds an item with a new id and the time now', async () => {
      await drafts.start(work.id);
      const item = await drafts.addItem(work.id, itemFields('crave.premium'));

      expect(item).toEqual({
        ...itemFields('crave.premium'),
        id: expect.any(String),
        listId: work.id,
        createdAt: '2026-10-26T08:00:00.000Z',
        updatedAt: '2026-10-26T08:00:00.000Z',
      });
      expect((await stored())[0].items.at(-1)).toEqual({ item });
    });
  });

  describe('save', () => {
    it('writes the list and its items, and deletes the draft', async () => {
      await drafts.start(work.id);
      const added = await drafts.addItem(work.id, itemFields('crave.premium'));
      await drafts.change(work.id, (draft) => ({
        ...draft,
        name: 'Work',
        items: draft.items.map((entry) =>
          entry.item.id === mullvad.id ? { ...entry, removed: true } : entry,
        ),
      }));
      storage.clock.time = '2026-10-27T09:00:00.000Z';
      await drafts.save(work.id);

      const now = '2026-10-27T09:00:00.000Z';
      expect(await storedList(work.id)).toEqual({ ...work, name: 'Work', updatedAt: now });
      const items = await storedItems();
      expect(items.find((item) => item.id === netflix.id)).toEqual(netflix);
      expect(items.find((item) => item.id === mullvad.id)).toEqual({
        ...mullvad,
        updatedAt: now,
        deletedAt: now,
      });
      expect(items.find((item) => item.id === added.id)).toEqual({
        ...added,
        createdAt: now,
        updatedAt: now,
      });
      expect(await stored()).toEqual([]);
    });

    it('creates a new list', async () => {
      const draft = await drafts.create();
      const added = await drafts.addItem(draft.listId, itemFields('crave.premium'));
      await drafts.save(draft.listId);

      expect(await storedList(draft.listId)).toEqual({
        id: draft.listId,
        name: 'Subscription List',
        createdAt: '2026-10-26T08:00:00.000Z',
        updatedAt: '2026-10-26T08:00:00.000Z',
      });
      expect((await storedItems()).find((item) => item.id === added.id)?.listId).toBe(draft.listId);
      expect(await stored()).toEqual([]);
    });

    it('writes nothing when it fails part way, and keeps the draft', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await drafts.start(work.id);
      await drafts.change(work.id, (draft) => ({
        ...draft,
        name: 'Work',
        items: draft.items.map((entry) => ({ ...entry, item: { ...entry.item, pinned: true } })),
      }));
      const draft = (await stored())[0];
      const before = { lists: await storedList(work.id), items: await storedItems() };
      // Mullvad's saved record, damaged since: Save reads it after writing the list and Netflix, then fails.
      const damaged = { ...mullvad, pinned: 'yes' };
      await plantRows(storage.indexedDB, 'items', [damaged]);

      await expect(drafts.save(work.id)).rejects.toThrow(InvalidRecordError);
      expect(await storedList(work.id)).toEqual(before.lists);
      expect(await storedItems()).toEqual(
        before.items.map((item) => (item.id === mullvad.id ? damaged : item)),
      );
      expect(await stored()).toEqual([draft]);
    });

    it('fails when there’s no draft', async () => {
      await expect(drafts.save(work.id)).rejects.toThrow('no draft');
    });
  });

  it('deletes a list with its items and its draft, and leaves other lists’ items', async () => {
    await drafts.start(work.id);
    const before = await storedItems();
    storage.clock.time = '2026-10-27T09:00:00.000Z';
    await drafts.deleteList(work.id);

    const now = '2026-10-27T09:00:00.000Z';
    expect(await storedList(work.id)).toEqual({ ...work, updatedAt: now, deletedAt: now });
    expect(await storedItems()).toEqual(
      before.map((item) =>
        item.listId === work.id && item.deletedAt === undefined
          ? { ...item, updatedAt: now, deletedAt: now }
          : item,
      ),
    );
    expect(await stored()).toEqual([]);
  });

  it('puts back a deleted list and the items it deleted, and no others', async () => {
    const before = await storedItems();
    const deleted = await drafts.deleteList(work.id);
    expect(deleted).toEqual({
      listId: work.id,
      itemIds: before
        .filter((item) => item.listId === work.id && item.deletedAt === undefined)
        .map((item) => item.id),
    });

    storage.clock.time = '2026-10-27T09:00:05.000Z';
    await drafts.restoreList(deleted);
    const now = '2026-10-27T09:00:05.000Z';
    expect(await storedList(work.id)).toEqual({ ...work, updatedAt: now });
    expect(await storedItems()).toEqual(
      before.map((item) =>
        deleted.itemIds.includes(item.id) ? { ...item, updatedAt: now } : item,
      ),
    );
  });

  it('deletes a draft outright', async () => {
    await drafts.start(work.id);
    await drafts.remove(work.id);
    expect(await stored()).toEqual([]);
    await until(() => drafts.drafts().length === 0);
  });
});
