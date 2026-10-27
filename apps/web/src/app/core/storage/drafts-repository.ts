import { Service, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  newListDraft,
  newListName,
  savedItem,
  savedList,
  startDraft,
  type ListDraft,
  type ListItem,
  type Timestamp,
} from '@simply-sub/core';
import { storageStatus, type NewRecord } from './record-repository';
import { StorageService } from './storage-service';

/** A list's draft, and whether it was there already rather than started now. */
export interface StartedDraft {
  draft: ListDraft;
  resumed: boolean;
}

/**
 * Lists' unsaved edits (PROJECT-PLAN P5), one draft per list, keyed by the list's id. ListDraftService edits them.
 * A draft is deleted outright when it's saved or cancelled: it's edits not saved yet, with nothing for a sync to pass
 * on. Save and starting a draft read and write the lists and items too, each in one transaction.
 */
@Service()
export class DraftsRepository {
  private readonly storage = inject(StorageService);
  private readonly stored = rxResource({
    params: () => this.storage.mode(),
    stream: () => this.storage.watch('drafts'),
  });

  /** Every valid draft. They follow every write, in this tab or another one. */
  readonly drafts = computed<readonly ListDraft[]>(() =>
    this.stored.hasValue() ? this.stored.value() : [],
  );
  readonly byList = computed<ReadonlyMap<string, ListDraft>>(
    () => new Map(this.drafts().map((draft) => [draft.listId, draft])),
  );
  readonly status = computed(() => storageStatus(this.stored));

  /**
   * The list's draft: the one there is, or else a copy of the list and its items. Undefined when there's no such
   * list, or it's deleted, and no new list's draft. A draft that can't be read is replaced by a copy.
   */
  async start(listId: string): Promise<StartedDraft | undefined> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    return engine.transaction(['lists', 'items', 'drafts'], async (transaction) => {
      const draft = await transaction.get('drafts', listId, { invalid: 'replace' });
      if (draft?.isNew) return { draft, resumed: true };
      const list = await transaction.get('lists', listId);
      if (list === undefined || list.deletedAt !== undefined) return undefined;
      if (draft) return { draft, resumed: true };
      const items = (await transaction.getAll('items')).filter(
        (item) => item.listId === listId && item.deletedAt === undefined,
      );
      const started = startDraft(list, items, now);
      await transaction.put('drafts', started);
      return { draft: started, resumed: false };
    });
  }

  /** A new list's draft, with a new id and a name no saved list has. Nothing goes in the lists table until Save. */
  async create(): Promise<ListDraft> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    return engine.transaction(['lists', 'drafts'], async (transaction) => {
      const lists = await transaction.getAll('lists');
      const taken = lists.filter((list) => list.deletedAt === undefined).map((list) => list.name);
      const draft = newListDraft(this.storage.newId(now), newListName(taken), now);
      await transaction.put('drafts', draft);
      return draft;
    });
  }

  /**
   * Changes a list's draft in a transaction, so changes made in two tabs don't overwrite each other: `change` gets the
   * stored draft and the time now. Fails when there's no draft, it can't be read, or the change is invalid. Returns
   * the draft as stored.
   */
  async change(
    listId: string,
    change: (draft: ListDraft, now: Timestamp) => ListDraft,
  ): Promise<ListDraft> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    const changed = await engine.modify('drafts', listId, (draft) => {
      if (draft === undefined) throw new Error(`There's no draft of list ${listId}`);
      return change(draft, now);
    });
    return changed as ListDraft;
  }

  /** Adds an item to a list's draft, with a new id and the time now. Returns it as stored. */
  async addItem(listId: string, fields: Omit<NewRecord<'items'>, 'listId'>): Promise<ListItem> {
    const now = this.storage.now();
    const id = this.storage.newId(now);
    const item: ListItem = { ...fields, id, listId, createdAt: now, updatedAt: now };
    const draft = await this.change(listId, (current) => ({
      ...current,
      items: [...current.items, { item }],
    }));
    return draft.items.find((entry) => entry.item.id === id)?.item ?? item;
  }

  /**
   * Save (P5): one transaction writes the list and its items, created, changed or soft-deleted, and deletes the
   * draft. If anything fails, nothing is written and the draft stays.
   */
  async save(listId: string): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.transaction(['lists', 'items', 'drafts'], async (transaction) => {
      const draft = await transaction.get('drafts', listId);
      if (draft === undefined) throw new Error(`There's no draft of list ${listId} to save`);
      const list = savedList(draft, await transaction.get('lists', listId), now);
      if (list) await transaction.put('lists', list);
      for (const entry of draft.items) {
        const item = savedItem(entry, await transaction.get('items', entry.item.id), now);
        if (item) await transaction.put('items', item);
      }
      await transaction.delete('drafts', listId);
    });
  }

  /** Deletes a list's draft, if it has one: Cancel (P5). */
  async remove(listId: string): Promise<void> {
    const engine = await this.storage.engine();
    await engine.transaction(['drafts'], (transaction) => transaction.delete('drafts', listId));
  }
}
