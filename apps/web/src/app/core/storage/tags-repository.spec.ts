import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { ListDraft, ListItem, Tag } from '@simply-sub/core';
import { AppLockRepository } from './app-lock-repository';
import { DraftsRepository } from './drafts-repository';
import { ItemsRepository } from './items-repository';
import { ListsRepository } from './lists-repository';
import type { NewRecord } from './record-repository';
import { RejectedRecords } from './rejected-records';
import { SettingsRepository } from './settings-repository';
import { StorageService } from './storage-service';
import { storedRows, testStorage, until, type TestStorage } from './storage.testing';
import { TagsRepository } from './tags-repository';

// Deleting a tag (P13, P6's picker, M6.11): the tag soft-deleted and taken off every item and draft, in one
// transaction, with the app lock off and on.

function itemFields(planId: string, tagIds: string[]): Omit<NewRecord<'items'>, 'listId'> {
  return {
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    tagIds,
    rankOverrides: {},
    pinned: false,
  };
}

describe('TagsRepository', () => {
  let storage: TestStorage;
  let tags: TagsRepository;
  let items: ItemsRepository;
  let drafts: DraftsRepository;
  let family: Tag;
  let work: Tag;
  let netflix: ListItem;
  let mullvad: ListItem;
  let gone: ListItem;
  let listId: string;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    tags = TestBed.inject(TagsRepository);
    items = TestBed.inject(ItemsRepository);
    drafts = TestBed.inject(DraftsRepository);
    await TestBed.inject(SettingsRepository).save({
      country: 'CA',
      currency: 'CAD',
      theme: 'system',
    });
    family = await tags.create({ name: 'Family', color: '#1e88e5' });
    work = await tags.create({ name: 'Work', color: '#e53935' });
    listId = (await TestBed.inject(ListsRepository).create({ name: 'Work Related' })).id;
    netflix = await items.create({
      ...itemFields('netflix.standard', [family.id, work.id]),
      listId,
    });
    mullvad = await items.create({ ...itemFields('mullvad.vpn', [work.id]), listId });
    gone = await items.create({ ...itemFields('crave.premium', [family.id]), listId });
    await items.remove(gone.id);
    // The editor's open, with Mullvad tagged Family in it, not saved yet.
    await drafts.start(listId);
    await drafts.change(listId, (draft) => ({
      ...draft,
      items: draft.items.map((entry) =>
        entry.item.id === mullvad.id
          ? { ...entry, item: { ...entry.item, tagIds: [work.id, family.id] } }
          : entry,
      ),
    }));
    storage.clock.time = '2026-10-28T10:00:00.000Z';
    await until(() => tags.records().length === 2 && drafts.drafts().length === 1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every record as stored, opened when sealed, read through the repositories' engine. */
  async function readAll<T extends 'items' | 'drafts' | 'tags'>(table: T) {
    const engine = await TestBed.inject(StorageService).engine();
    return engine.read(table);
  }

  async function expectRemoved(): Promise<void> {
    const storedTags = (await readAll('tags')) as Tag[];
    expect(storedTags.find((tag) => tag.id === family.id)?.deletedAt).toBe(
      '2026-10-28T10:00:00.000Z',
    );
    expect(storedTags.find((tag) => tag.id === work.id)?.deletedAt).toBeUndefined();

    const storedItems = (await readAll('items')) as ListItem[];
    const byId = new Map(storedItems.map((item) => [item.id, item]));
    expect(byId.get(netflix.id)?.tagIds).toEqual([work.id]);
    expect(byId.get(netflix.id)?.updatedAt).toBe('2026-10-28T10:00:00.000Z');
    expect(byId.get(mullvad.id)?.tagIds).toEqual([work.id]);
    // Untouched: it never had the tag.
    expect(byId.get(mullvad.id)?.updatedAt).toBe(mullvad.updatedAt);
    // A deleted item loses it too, so a list's Undo can't bring it back.
    expect(byId.get(gone.id)?.tagIds).toEqual([]);
    expect(byId.get(gone.id)?.deletedAt).toBeDefined();

    const [draft] = (await readAll('drafts')) as ListDraft[];
    for (const { item, saved } of draft.items) {
      expect(item.tagIds).not.toContain(family.id);
      expect(saved?.tagIds ?? []).not.toContain(family.id);
    }

    await until(() => !tags.byId().has(family.id));
    expect(tags.records().map((tag) => tag.name)).toEqual(['Work']);
    expect(TestBed.inject(RejectedRecords).count()).toBe(0);
  }

  it('deletes a tag in use: soft-deleted, and off every item and draft, in one transaction', async () => {
    await tags.removeWithItems(family.id);
    await expectRemoved();
  });

  it('does the same with the app lock on, writing every changed row sealed', async () => {
    await TestBed.inject(AppLockRepository).turnOn('correct horse battery', 15);
    await tags.removeWithItems(family.id);
    await expectRemoved();
    for (const table of ['tags', 'items', 'drafts'] as const) {
      const rows = await storedRows(storage.indexedDB, table);
      for (const row of rows) expect(row, table).toHaveProperty('sealed');
      expect(JSON.stringify(rows), table).not.toContain('Family');
    }
  });

  it('changes nothing when the tag is deleted already, or there is none', async () => {
    await tags.removeWithItems(family.id);
    const before = await storedRows(storage.indexedDB, 'items');
    storage.clock.time = '2026-10-29T10:00:00.000Z';
    await tags.removeWithItems(family.id);
    await tags.removeWithItems('0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2f');
    expect(await storedRows(storage.indexedDB, 'items')).toEqual(before);
  });

  it('writes nothing when a step fails', async () => {
    const before = await storedRows(storage.indexedDB, 'items');
    const real = await TestBed.inject(StorageService).engine();
    // A write that fails part way, after the tag and the items.
    vi.spyOn(real, 'transaction').mockImplementationOnce(async (tables, work) =>
      real.transaction.call(real, tables, async (transaction) =>
        work({
          ...transaction,
          put: async (table, record) => {
            if (table === 'drafts') throw new Error('Disk full');
            return transaction.put(table, record);
          },
        }),
      ),
    );
    await expect(tags.removeWithItems(family.id)).rejects.toThrow('Disk full');
    expect(await storedRows(storage.indexedDB, 'items')).toEqual(before);
    expect(((await readAll('tags')) as Tag[]).every((tag) => tag.deletedAt === undefined)).toBe(
      true,
    );
  });
});
