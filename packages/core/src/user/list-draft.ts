import * as z from 'zod';
import { addDuplicateIssues } from '../catalog/checks';
import { listItemSchema, type ListItem } from './list-item';
import { recordIdSchema, timestampSchema, type Timestamp } from './record';
import { softDeleted, withChanges } from './stamps';
import { subscriptionListSchema, type SubscriptionList } from './subscription-list';

// A list's unsaved edits (PROJECT-PLAN P5's draft model). Opening the editor copies the list and its items into a
// draft kept in Dexie, so a trip to Search (pick mode) or a reload keeps the changes. Save writes them to the list and
// its items in one transaction and deletes the draft; Cancel deletes it.

/** The name a new list gets, unless a list has it already (newListName). */
export const defaultListName = 'Subscription List';

/** An item in a draft: as edited, and as it was saved when the draft started. */
export const draftItemSchema = z.strictObject({
  /** The item as edited. Save sets the timestamps of what it writes. */
  item: listItemSchema,
  /** As saved when the draft started, which tells what the draft changed; absent for an item the draft added. */
  saved: listItemSchema.optional(),
  /** Removed in the draft: Save soft-deletes a saved one. It stays here, so Undo can put it back. */
  removed: z.literal(true).optional(),
});
export type DraftItem = z.infer<typeof draftItemSchema>;

/** One list's draft, keyed by the list's id: one draft per list. */
export const listDraftSchema = z
  .strictObject({
    listId: recordIdSchema,
    /** A list made on /lists/new: it's only in its draft until Save creates it. */
    isNew: z.boolean(),
    name: subscriptionListSchema.shape.name,
    /** The name when the draft started: the list's saved name, or a new list's default. */
    startName: subscriptionListSchema.shape.name,
    items: z.array(draftItemSchema),
    startedAt: timestampSchema,
  })
  .superRefine((draft, ctx) => {
    const ids = draft.items.map(({ item }) => item.id);
    addDuplicateIssues(ctx, ids, (index) => ['items', index, 'item', 'id']);
    draft.items.forEach(({ item, saved }, index) => {
      const issue = (message: string, ...path: string[]) =>
        ctx.addIssue({ code: 'custom', message, path: ['items', index, ...path] });
      if (item.listId !== draft.listId) issue("Must be the draft's listId", 'item', 'listId');
      if (item.deletedAt !== undefined) issue('Use removed instead', 'item', 'deletedAt');
      if (saved === undefined) return;
      if (draft.isNew) issue("A new list's items aren't saved yet", 'saved');
      else if (saved.id !== item.id) issue('Must be the same item', 'saved', 'id');
      if (saved.deletedAt !== undefined) issue("A deleted item isn't copied", 'saved', 'deletedAt');
    });
  });
export type ListDraft = z.infer<typeof listDraftSchema>;

/** A draft of `list` and its `items`, the ones that aren't deleted, started at `now`. */
export function startDraft(
  list: SubscriptionList,
  items: readonly ListItem[],
  now: Timestamp,
): ListDraft {
  return {
    listId: list.id,
    isNew: false,
    name: list.name,
    startName: list.name,
    items: items.map((item) => ({ item, saved: item })),
    startedAt: now,
  };
}

/** A new list's draft, with no items. */
export function newListDraft(listId: string, name: string, now: Timestamp): ListDraft {
  return { listId, isNew: true, name, startName: name, items: [], startedAt: now };
}

/** A new list's name: "Subscription List", or "Subscription List 2", 3… when a list in `taken` has it. */
export function newListName(taken: readonly string[]): string {
  const names = new Set(taken.map((name) => name.toLowerCase()));
  for (let count = 1; ; count++) {
    const name = count === 1 ? defaultListName : `${defaultListName} ${count}`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

/** The draft's items as edited, without the removed ones. */
export function draftItems(draft: ListDraft): ListItem[] {
  return draft.items.filter((entry) => entry.removed === undefined).map(({ item }) => item);
}

/** Whether the draft differs from the list as it started: a new name, or an item added, changed or removed. */
export function draftChanged(draft: ListDraft): boolean {
  return (
    draft.name !== draft.startName ||
    draft.items.some(({ item, saved, removed }) =>
      saved === undefined
        ? removed === undefined
        : removed !== undefined || Object.keys(changedFields(item, saved)).length > 0,
    )
  );
}

/**
 * The list record Save writes, or undefined when it's unchanged: a new list is created, and an existing one gets
 * the draft's name if the draft changed it. Throws when an existing list was deleted since, or a new one exists.
 */
export function savedList(
  draft: ListDraft,
  current: SubscriptionList | undefined,
  now: Timestamp,
): SubscriptionList | undefined {
  if (draft.isNew) {
    if (current !== undefined) throw new Error(`The new list ${draft.listId} is saved already`);
    return { id: draft.listId, name: draft.name, createdAt: now, updatedAt: now };
  }
  if (current === undefined || current.deletedAt !== undefined) {
    throw new Error(`The list ${draft.listId} was deleted, so its draft can't be saved`);
  }
  return draft.name === draft.startName
    ? undefined
    : withChanges(current, { name: draft.name }, now);
}

/**
 * The item record Save writes for a draft's item, or undefined when there's nothing to write. An added item is
 * created, a removed one soft-deleted, and a changed one gets only the fields the draft changed: the others keep
 * their saved values, so what was changed elsewhere since the draft started stays (pinning and P4's "Wrong date?",
 * P11's card). An item deleted since, with its list, stays deleted.
 */
export function savedItem(
  { item, saved, removed }: DraftItem,
  current: ListItem | undefined,
  now: Timestamp,
): ListItem | undefined {
  if (saved === undefined) {
    return removed === undefined ? { ...item, createdAt: now, updatedAt: now } : undefined;
  }
  if (current === undefined || current.deletedAt !== undefined) return undefined;
  if (removed !== undefined) return softDeleted(current, now);
  const changes = changedFields(item, saved);
  return Object.keys(changes).length === 0
    ? undefined
    : withChanges<ListItem>(current, changes, now);
}

/**
 * The lists an editor adds to, for Search's pick mode (P7, flow F2): `lists`, the saved ones that aren't deleted,
 * each named as its draft names it, then the new lists, which have only a draft until Save.
 */
export function listsWithDrafts(
  lists: readonly SubscriptionList[],
  drafts: readonly ListDraft[],
): Pick<SubscriptionList, 'id' | 'name'>[] {
  const byList = new Map(drafts.map((draft) => [draft.listId, draft]));
  return [
    ...lists.map(({ id, name }) => ({ id, name: byList.get(id)?.name ?? name })),
    ...drafts.filter((draft) => draft.isNew).map(({ listId, name }) => ({ id: listId, name })),
  ];
}

/** The fields of an item that aren't its id, list or timestamps. */
type ItemFields = Omit<ListItem, 'id' | 'listId' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

const itemMeta: ReadonlySet<string> = new Set([
  'id',
  'listId',
  'createdAt',
  'updatedAt',
  'deletedAt',
]);

/** The fields `edited` changed from `saved`, as `edited` has them: undefined for one it cleared. */
function changedFields(edited: ListItem, saved: ListItem): Partial<ItemFields> {
  const changes: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(edited), ...Object.keys(saved)])) {
    if (itemMeta.has(key)) continue;
    const value = (edited as Record<string, unknown>)[key];
    if (!sameValue(value, (saved as Record<string, unknown>)[key])) changes[key] = value;
  }
  return changes as Partial<ItemFields>;
}

/** Whether two records' values are the same, in any key order: they're JSON, as the schemas return them. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keys = Object.keys(aRecord);
  return (
    keys.length === Object.keys(bRecord).length &&
    keys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]))
  );
}
