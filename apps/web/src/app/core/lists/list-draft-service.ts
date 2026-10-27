import { Service, inject } from '@angular/core';
import {
  draftChanged,
  withChanges,
  type DraftItem,
  type ListDraft,
  type ListItem,
} from '@simply-sub/core';
import {
  DraftsRepository,
  type DeletedList,
  type StartedDraft,
} from '../storage/drafts-repository';
import type { NewRecord, RecordChanges } from '../storage/record-repository';

/** An item's own fields, as the item dialog fills them: the draft gives it an id, its list and the time. */
export type DraftItemFields = Omit<NewRecord<'items'>, 'listId'>;

/** Changes to a draft's item. A field set to undefined is cleared. */
export type DraftItemChanges = Omit<RecordChanges<'items'>, 'listId'>;

/**
 * Edits to a list before Save (PROJECT-PLAN P5's draft model). The list editor (M6.4) and the item dialog (M6.5)
 * change a draft kept in Dexie (DraftsRepository), so a trip to Search in pick mode, or a reload, keeps them. Save
 * writes them all in one transaction, and Cancel drops them.
 */
@Service()
export class ListDraftService {
  private readonly drafts = inject(DraftsRepository);

  /** Each list's draft, by list id. They follow every change, in this tab or another one. */
  readonly byList = this.drafts.byList;
  readonly status = this.drafts.status;

  /**
   * Starts editing a list: resumes its draft (`resumed`), a new list's included, or else copies the list and its
   * items into a new one. Undefined for a list there isn't (P15).
   */
  start(listId: string): Promise<StartedDraft | undefined> {
    return this.drafts.start(listId);
  }

  /**
   * /lists/new: a new list's draft, with a new id, named "Subscription List" ("Subscription List 2" when that's
   * taken). The list is only in its draft until Save.
   */
  startNew(): Promise<ListDraft> {
    return this.drafts.create();
  }

  /** Whether the list's draft has changes since it started, for Cancel and leaving to ask first (P5). */
  hasChanges(listId: string): boolean {
    const draft = this.byList().get(listId);
    return draft !== undefined && draftChanged(draft);
  }

  rename(listId: string, name: string): Promise<ListDraft> {
    return this.drafts.change(listId, (draft) => ({ ...draft, name }));
  }

  /** Adds an item to the draft, and returns it with its new id. */
  addItem(listId: string, fields: DraftItemFields): Promise<ListItem> {
    return this.drafts.addItem(listId, fields);
  }

  updateItem(listId: string, itemId: string, changes: DraftItemChanges): Promise<ListDraft> {
    return this.drafts.change(listId, (draft, now) =>
      changeItem(draft, itemId, (entry) => ({
        ...entry,
        item: withChanges<ListItem>(entry.item, changes, now),
      })),
    );
  }

  /** Removes an item from the draft. It stays in the draft, marked, so restoreItem can undo it. */
  removeItem(listId: string, itemId: string): Promise<ListDraft> {
    return this.drafts.change(listId, (draft) =>
      changeItem(draft, itemId, (entry) => ({ ...entry, removed: true })),
    );
  }

  /** Puts a removed item back: the snackbar's Undo (P5). */
  restoreItem(listId: string, itemId: string): Promise<ListDraft> {
    return this.drafts.change(listId, (draft) =>
      changeItem(draft, itemId, ({ item, saved }) => ({ item, ...(saved && { saved }) })),
    );
  }

  /**
   * Save: the list and its items are written in one transaction and the draft deleted, or nothing is. A field the
   * draft didn't change keeps its saved value, so pinning and the like done elsewhere since stay (core's savedItem).
   */
  save(listId: string): Promise<void> {
    return this.drafts.save(listId);
  }

  /** Cancel: drops the draft, and the list stays as saved. */
  cancel(listId: string): Promise<void> {
    return this.drafts.remove(listId);
  }

  /** Delete list: the list and its items are soft-deleted, and the draft dropped, together. */
  deleteList(listId: string): Promise<DeletedList> {
    return this.drafts.deleteList(listId);
  }

  /** Undo of a Delete list: the list and the items it deleted come back, together. */
  restoreList(deleted: DeletedList): Promise<void> {
    return this.drafts.restoreList(deleted);
  }
}

/** `draft` with one item changed. Throws when it has no such item. */
function changeItem(
  draft: ListDraft,
  itemId: string,
  change: (entry: DraftItem) => DraftItem,
): ListDraft {
  if (!draft.items.some((entry) => entry.item.id === itemId)) {
    throw new Error(`The draft of list ${draft.listId} has no item ${itemId}`);
  }
  return {
    ...draft,
    items: draft.items.map((entry) => (entry.item.id === itemId ? change(entry) : entry)),
  };
}
