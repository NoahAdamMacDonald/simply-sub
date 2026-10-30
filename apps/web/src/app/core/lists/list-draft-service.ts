import { Service, inject } from '@angular/core';
import {
  draftChanged,
  withChanges,
  withEndsRestored,
  withReleasedItems,
  withoutApplied,
  type AppliedSuggestion,
  type CatalogData,
  type DraftEdit,
  type DraftItem,
  type ListDraft,
  type ListItem,
  type Timestamp,
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
 * A draft after a change to one of its items, and the items the change released: each ended on the day what it
 * changed or took out took over from it, so it goes on now (core's withReleasedItems). They're as they were, for Undo.
 */
export interface DraftItemChange {
  draft: ListDraft;
  released: ListItem[];
}

/** What tells what takes over from an item (core's itemReplacements): the plans' add-ons, the bundles. */
export type ReplacementCatalog = Pick<CatalogData, 'providers' | 'bundles'>;

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

  /** Changes an item in the draft, and with `catalog`, lets the items it no longer takes over from go on. */
  updateItem(
    listId: string,
    itemId: string,
    changes: DraftItemChanges,
    catalog?: ReplacementCatalog,
  ): Promise<DraftItemChange> {
    return this.changeReleasing(listId, catalog, (draft, now) =>
      changeItem(draft, itemId, (entry) => ({
        ...entry,
        item: withChanges<ListItem>(entry.item, changes, now),
      })),
    );
  }

  /**
   * Removes an item from the draft, and with `catalog`, lets the items it took over from go on. It stays in the draft,
   * marked, so restoreItem can undo it.
   */
  removeItem(
    listId: string,
    itemId: string,
    catalog?: ReplacementCatalog,
  ): Promise<DraftItemChange> {
    return this.changeReleasing(listId, catalog, (draft) =>
      changeItem(draft, itemId, (entry) => ({ ...entry, removed: true })),
    );
  }

  /** Puts a removed item back, and the end dates of the items its removal released: the snackbar's Undo (P5). */
  restoreItem(
    listId: string,
    itemId: string,
    released: readonly ListItem[] = [],
  ): Promise<ListDraft> {
    return this.drafts.change(listId, (draft, now) =>
      withEndsRestored(
        changeItem(draft, itemId, ({ item, saved }) => ({ item, ...(saved && { saved }) })),
        released,
        now,
      ),
    );
  }

  /**
   * Several edits at once, as one change to the draft: an optimizer suggestion applied (P14), recorded with what it
   * changed when `suggestion` names it, so Review changes can undo it on its own (M8.6).
   */
  applyEdits(
    listId: string,
    edits: readonly DraftEdit[],
    suggestion?: AppliedSuggestion,
  ): Promise<ListDraft> {
    return this.drafts.applyEdits(listId, edits, suggestion);
  }

  /** Undoes applied change `index`, with the later ones that build on it (M8.6's Review changes). */
  undoApplied(listId: string, index: number): Promise<ListDraft> {
    return this.drafts.change(listId, (draft) => withoutApplied(draft, index));
  }

  /** The Undo of applied edits (P14, M8.4): the draft as it was before them. */
  putBack(listId: string, draft: ListDraft): Promise<ListDraft> {
    return this.drafts.change(listId, () => draft);
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

  /** One change to the draft, in one write with the items it releases, which takes `catalog` to tell. */
  private async changeReleasing(
    listId: string,
    catalog: ReplacementCatalog | undefined,
    change: (draft: ListDraft, now: Timestamp) => ListDraft,
  ): Promise<DraftItemChange> {
    let released: ListItem[] = [];
    const draft = await this.drafts.change(listId, (current, now) => {
      const changed = change(current, now);
      if (!catalog) return changed;
      const result = withReleasedItems(current, changed, catalog, now);
      released = result.released;
      return result.draft;
    });
    return { draft, released };
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
