import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { ListItem, SubscriptionList } from '@simply-sub/core';
import { ItemsRepository } from '../storage/items-repository';
import { ListsRepository } from '../storage/lists-repository';
import { storedRows, testStorage, until, type TestStorage } from '../storage/storage.testing';
import { ListDraftService, type DraftItemFields } from './list-draft-service';

const netflixFields: DraftItemFields = {
  source: { kind: 'catalog', planId: 'netflix.standard' },
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
const yearly = { ...netflixFields.billing, interval: 'year' } as const;

describe('ListDraftService', () => {
  let storage: TestStorage;
  let service: ListDraftService;
  let work: SubscriptionList;
  let netflix: ListItem;

  /** A fresh injector on the same IndexedDB: what a reload, or another tab, starts with. */
  function inject(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    service = TestBed.inject(ListDraftService);
  }

  beforeEach(async () => {
    storage = testStorage();
    inject();
    work = await TestBed.inject(ListsRepository).create({ name: 'Work Related' });
    netflix = await TestBed.inject(ItemsRepository).create({ ...netflixFields, listId: work.id });
    storage.clock.time = '2026-10-26T08:00:00.000Z';
  });

  const storedList = async () => (await storedRows(storage.indexedDB, 'lists'))[0];
  const storedItems = async () => (await storedRows(storage.indexedDB, 'items')) as ListItem[];
  const draftsStored = () => storedRows(storage.indexedDB, 'drafts');

  it('keeps a draft through a reload, and resumes it', async () => {
    await service.start(work.id);
    await service.rename(work.id, 'Work');
    const added = await service.addItem(work.id, { ...netflixFields, pinned: true });

    inject();
    const resumed = await service.start(work.id);
    expect(resumed?.resumed).toBe(true);
    expect(resumed?.draft.name).toBe('Work');
    expect(resumed?.draft.items.map(({ item }) => item)).toEqual([netflix, added]);
    await until(() => service.byList().has(work.id));
    expect(service.hasChanges(work.id)).toBe(true);
  });

  it('resumes the draft on a second edit of the same list', async () => {
    const first = await service.start(work.id);
    expect(first?.resumed).toBe(false);
    await service.updateItem(work.id, netflix.id, { billing: yearly });

    const second = await service.start(work.id);
    expect(second?.resumed).toBe(true);
    expect(second?.draft.items[0].item.billing).toEqual(yearly);
    expect(await draftsStored()).toHaveLength(1);
  });

  it('tells whether anything changed since the draft started', async () => {
    await service.start(work.id);
    await until(() => service.byList().has(work.id));
    expect(service.hasChanges(work.id)).toBe(false);

    await service.removeItem(work.id, netflix.id);
    await until(() => service.hasChanges(work.id));
    await service.restoreItem(work.id, netflix.id);
    await until(() => !service.hasChanges(work.id));
    expect(service.hasChanges('no-such-list')).toBe(false);
  });

  it('refuses a change to an item the draft hasn’t', async () => {
    await service.start(work.id);
    await expect(service.removeItem(work.id, work.id)).rejects.toThrow('has no item');
  });

  it('saves the draft, keeping a pinned changed elsewhere since', async () => {
    await service.start(work.id);
    await service.updateItem(work.id, netflix.id, { billing: yearly });
    // The list view pins it, straight to the item, while the draft is open (P4).
    await TestBed.inject(ItemsRepository).update(netflix.id, { pinned: true });

    storage.clock.time = '2026-10-27T09:00:00.000Z';
    await service.save(work.id);
    const [item] = await storedItems();
    expect(item).toEqual({
      ...netflix,
      billing: yearly,
      pinned: true,
      updatedAt: '2026-10-27T09:00:00.000Z',
    });
    expect(await draftsStored()).toEqual([]);
  });

  it('saves a pinned the draft changed', async () => {
    await service.start(work.id);
    await service.updateItem(work.id, netflix.id, { pinned: true });
    await service.save(work.id);
    expect((await storedItems())[0].pinned).toBe(true);
  });

  it('leaves the list as it was on Cancel, after a reload too', async () => {
    await service.start(work.id);
    await service.rename(work.id, 'Work');
    await service.removeItem(work.id, netflix.id);
    await service.addItem(work.id, netflixFields);
    await service.cancel(work.id);

    inject();
    expect(await draftsStored()).toEqual([]);
    expect(await storedList()).toEqual(work);
    expect(await storedItems()).toEqual([netflix]);
    expect((await service.start(work.id))?.resumed).toBe(false);
  });

  it('names a new list so it doesn’t take a list’s name', async () => {
    const first = await service.startNew();
    expect(first.name).toBe('Subscription List');
    await service.save(first.listId);

    const second = await service.startNew();
    expect(second.name).toBe('Subscription List 2');
    expect(second.listId).not.toBe(first.listId);
  });
});
