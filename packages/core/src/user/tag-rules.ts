import type { ListDraft } from './list-draft';
import type { ListItem } from './list-item';
import type { Timestamp } from './record';
import { withChanges } from './stamps';
import type { Tag } from './tag';

// The rules for the user's tags (P6's picker, P13's Custom tags, M6.11): names, colours, what uses a tag and what
// deleting one changes. This file imports no Zod, so Settings can use it without loading the record schemas.

/**
 * The colours a new tag can take (P6's inline create; P13 adds a hex field). They're stored values, not theme
 * colours: a tag chip shows its colour as a dot beside the name, so the name's contrast never depends on it. Each has
 * a name for screen readers.
 */
export const tagColorPresets: readonly { name: string; color: string }[] = [
  { name: 'Red', color: '#e53935' },
  { name: 'Orange', color: '#fb8c00' },
  { name: 'Yellow', color: '#fdd835' },
  { name: 'Lime', color: '#7cb342' },
  { name: 'Green', color: '#2e7d32' },
  { name: 'Teal', color: '#00897b' },
  { name: 'Cyan', color: '#00acc1' },
  { name: 'Blue', color: '#1e88e5' },
  { name: 'Indigo', color: '#3949ab' },
  { name: 'Purple', color: '#8e24aa' },
  { name: 'Pink', color: '#d81b60' },
  { name: 'Grey', color: '#757575' },
];

/** What the rules need of a tag. */
export type TagFields = Pick<Tag, 'id' | 'name' | 'color'>;

/** A name as tags compare them: trimmed, and in any case ("family " is "Family"). */
function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase('en');
}

/** The tag in `tags` with `name`, trimmed and in any case. */
export function tagNamed<T extends TagFields>(tags: readonly T[], name: string): T | undefined {
  const wanted = nameKey(name);
  return tags.find((tag) => nameKey(tag.name) === wanted);
}

/**
 * Each tag whose name, in any case, a tag before it in `tags` has, with that first tag (M10.24). Names are unique when
 * tags are made, but a backup's Merge and sync join tags by id, so two devices that each made "Family" end with two.
 * Settings offers to merge each into the first; nothing merges them by itself.
 */
export function namesakes<T extends TagFields>(tags: readonly T[]): Map<string, T> {
  const first = new Map<string, T>();
  const found = new Map<string, T>();
  for (const tag of tags) {
    const key = nameKey(tag.name);
    const earlier = first.get(key);
    if (earlier === undefined) first.set(key, tag);
    else found.set(tag.id, earlier);
  }
  return found;
}

/**
 * What's wrong with `name` for a tag, or undefined when nothing is: it needs a name once trimmed, and one no other
 * tag has, in any case. `id` is the tag being renamed, which may keep its own name.
 */
export function tagNameIssue(
  name: string,
  tags: readonly TagFields[],
  id?: string,
): string | undefined {
  if (name.trim() === '') return 'Give the tag a name';
  const other = tagNamed(
    tags.filter((tag) => tag.id !== id),
    name,
  );
  return other === undefined ? undefined : `There's a tag called “${other.name.trim()}” already`;
}

/** The first preset no tag has yet, so new tags look different; once all are taken, they go round again. */
export function freeTagColor(tags: readonly TagFields[]): string {
  const used = new Set(tags.map((tag) => tag.color.toLowerCase()));
  const free = tagColorPresets.find((preset) => !used.has(preset.color));
  return (free ?? tagColorPresets[tags.length % tagColorPresets.length]).color;
}

/** A typed colour as a tag stores it, `#rrggbb` in lower case, or undefined when it isn't six hex digits. */
export function parseTagColor(text: string): string | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return match ? `#${match[1].toLowerCase()}` : undefined;
}

/** A colour's name for screen readers: its preset's ("Teal"), else its hex digits. */
export function tagColorName(color: string): string {
  const lower = color.toLowerCase();
  return tagColorPresets.find((preset) => preset.color === lower)?.name ?? lower;
}

/**
 * How many subscriptions use the tag `tagId`: the items in lists and the ones in lists' unsaved edits (drafts), each
 * once, leaving out deleted ones and ones removed in a draft. Deleting a tag in use asks first (P13).
 */
export function tagUsage(
  tagId: string,
  items: readonly ListItem[],
  drafts: readonly ListDraft[],
): number {
  const using = new Set<string>();
  for (const item of items) {
    if (item.deletedAt === undefined && item.tagIds.includes(tagId)) using.add(item.id);
  }
  for (const draft of drafts) {
    for (const { item, removed } of draft.items) {
      if (removed === undefined && item.tagIds.includes(tagId)) using.add(item.id);
    }
  }
  return using.size;
}

/** The records deleting a tag changes. */
export interface TagRemoval {
  /** Every item that had the tag, soft-deleted ones too, without it and changed at `now`. */
  items: ListItem[];
  /**
   * Every draft with an item that had it, without it in the item as edited and in its saved copy, so the draft
   * doesn't look changed. A draft's items keep their timestamps: Save sets them.
   */
  drafts: ListDraft[];
}

/**
 * What deleting the tag `tagId` changes besides the tag (M6.11): it comes off every item and every draft, so nothing
 * names a tag that's gone. A list's Undo can then never bring it back on a deleted item.
 */
export function withoutTag(
  tagId: string,
  items: readonly ListItem[],
  drafts: readonly ListDraft[],
  now: Timestamp,
): TagRemoval {
  return replacedTag(tagId, undefined, items, drafts, now);
}

/**
 * What merging the tag `fromId` into `intoId` changes besides deleting `fromId` (M10.24): every item and draft that had
 * it has `intoId` in its place, once, so the subscriptions keep their label.
 */
export function withTagMerged(
  fromId: string,
  intoId: string,
  items: readonly ListItem[],
  drafts: readonly ListDraft[],
  now: Timestamp,
): TagRemoval {
  return replacedTag(fromId, intoId, items, drafts, now);
}

/** `tagId` taken off every item and draft, or `replacement` put in its place, where it isn't already. */
function replacedTag(
  tagId: string,
  replacement: string | undefined,
  items: readonly ListItem[],
  drafts: readonly ListDraft[],
  now: Timestamp,
): TagRemoval {
  const has = (item: ListItem | undefined) => item?.tagIds.includes(tagId) === true;
  const replaced = (tagIds: readonly string[]) => {
    const kept = tagIds.filter((id) => id !== tagId);
    return replacement === undefined || kept.includes(replacement) ? kept : [...kept, replacement];
  };
  return {
    items: items
      .filter((item) => has(item))
      .map((item) => withChanges(item, { tagIds: replaced(item.tagIds) }, now)),
    drafts: drafts
      .filter((draft) => draft.items.some(({ item, saved }) => has(item) || has(saved)))
      .map((draft) => ({
        ...draft,
        items: draft.items.map((entry) => ({
          ...entry,
          item: has(entry.item)
            ? { ...entry.item, tagIds: replaced(entry.item.tagIds) }
            : entry.item,
          ...(entry.saved && {
            saved: has(entry.saved)
              ? { ...entry.saved, tagIds: replaced(entry.saved.tagIds) }
              : entry.saved,
          }),
        })),
      })),
  };
}
