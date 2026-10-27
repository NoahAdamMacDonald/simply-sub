import { describe, expect, it } from 'vitest';
import {
  draftChanged,
  draftItems,
  listDraftSchema,
  listsWithDrafts,
  newListDraft,
  newListName,
  savedItem,
  savedList,
  startDraft,
  type DraftItem,
  type ListDraft,
  type ListItem,
  type SubscriptionList,
} from '../../src';
import { issues, withValue } from '../catalog/helpers';
import { cardId, item as fullItem, list as savedWork, listId } from './fixtures';

const started = '2026-10-25T12:00:00.000Z';
const now = '2026-10-26T08:00:00.000Z';
const addedId = '0192f1c9-5061-7273-8e8f-9a0b1c2d3e4f';

const list = savedWork as SubscriptionList;
/** The fixtures' item, not deleted. */
const netflix = withValue(fullItem, ['deletedAt'], undefined) as ListItem;
const added: ListItem = {
  ...netflix,
  id: addedId,
  source: { kind: 'catalog', planId: 'mullvad.vpn' },
  createdAt: started,
  updatedAt: started,
};

/** Work Related's draft: Netflix copied unchanged. */
const draft: ListDraft = startDraft(list, [netflix], started);

describe('listDraftSchema', () => {
  it('accepts a draft of a list and returns it unchanged', () => {
    expect(listDraftSchema.parse(draft)).toEqual(draft);
  });

  it('accepts changed, added and removed items, and a new name', () => {
    const edited: ListDraft = {
      ...draft,
      name: 'Work',
      items: [
        { item: { ...netflix, pinned: false }, saved: netflix, removed: true },
        { item: added },
      ],
    };
    expect(issues(listDraftSchema, edited)).toEqual([]);
  });

  it('accepts a new list’s draft', () => {
    const fresh = {
      ...newListDraft(listId, 'Subscription List', started),
      items: [{ item: added }],
    };
    expect(listDraftSchema.parse(fresh)).toEqual(fresh);
  });

  it.each([
    ['empty', '  ', 'name: Must not be empty'],
    ['over 60 characters', 'x'.repeat(61), 'name: Use at most 60 characters'],
  ])('rejects a name that is %s', (_name, name, expected) => {
    expect(issues(listDraftSchema, { ...draft, name })).toEqual([expected]);
  });

  it('rejects an item of another list', () => {
    const other = withValue(draft, ['items', 0, 'item', 'listId'], addedId);
    expect(issues(listDraftSchema, other)).toEqual([
      "items.0.item.listId: Must be the draft's listId",
    ]);
  });

  it('rejects an item listed twice', () => {
    const twice = { ...draft, items: [draft.items[0], draft.items[0]] };
    expect(issues(listDraftSchema, twice)).toEqual([
      `items.1.item.id: "${netflix.id}" is listed more than once`,
    ]);
  });

  it('rejects a saved copy of another item', () => {
    const other = withValue(draft, ['items', 0, 'saved', 'id'], addedId);
    expect(issues(listDraftSchema, other)).toEqual(['items.0.saved.id: Must be the same item']);
  });

  it('rejects saved items in a new list', () => {
    expect(issues(listDraftSchema, { ...draft, isNew: true })).toEqual([
      "items.0.saved: A new list's items aren't saved yet",
    ]);
  });

  it('rejects a deleted item, which a draft removes instead', () => {
    const deleted = withValue(draft, ['items', 0, 'item', 'deletedAt'], started);
    expect(issues(listDraftSchema, deleted)).toEqual([
      'items.0.item.deletedAt: Use removed instead',
    ]);
  });

  it('rejects a malformed item, removed set to false, an unknown field and a missing startedAt', () => {
    const broken = withValue(draft, ['items', 0, 'item', 'pinned'], 'yes');
    expect(issues(listDraftSchema, broken)).toEqual([
      'items.0.item.pinned: Invalid input: expected boolean, received string',
    ]);
    expect(issues(listDraftSchema, withValue(draft, ['items', 0, 'removed'], false))).toEqual([
      'items.0.removed: Invalid input: expected true',
    ]);
    expect(issues(listDraftSchema, { ...draft, colour: 'red' })).toEqual([
      ': Unrecognized key: "colour"',
    ]);
    expect(issues(listDraftSchema, withValue(draft, ['startedAt'], undefined))).toEqual([
      'startedAt: Use a UTC timestamp with milliseconds, as toISOString writes it',
    ]);
  });
});

describe('startDraft', () => {
  it('copies the list and its items, each with its saved copy', () => {
    expect(draft).toEqual({
      listId,
      isNew: false,
      name: 'Work Related',
      startName: 'Work Related',
      items: [{ item: netflix, saved: netflix }],
      startedAt: started,
    });
  });
});

describe('newListName', () => {
  it('is Subscription List, or the first number after it no list has', () => {
    expect(newListName([])).toBe('Subscription List');
    expect(newListName(['Work Related'])).toBe('Subscription List');
    expect(newListName(['Subscription List'])).toBe('Subscription List 2');
    expect(newListName(['subscription list', 'Subscription List 2'])).toBe('Subscription List 3');
    expect(newListName(['Subscription List 2'])).toBe('Subscription List');
  });
});

describe('draftChanged and draftItems', () => {
  const change = (items: DraftItem[], name = draft.name): ListDraft => ({ ...draft, name, items });

  it('is unchanged as it started, and after a change made and undone', () => {
    expect(draftChanged(draft)).toBe(false);
    // The same fields in another order, and the timestamps an edit moves.
    const { pinned, ...rest } = netflix;
    const reordered = { pinned, ...rest, updatedAt: now };
    expect(draftChanged(change([{ item: reordered, saved: netflix }]))).toBe(false);
  });

  it('is changed by a new name, or an item added, changed, cleared or removed', () => {
    expect(draftChanged(change(draft.items, 'Work'))).toBe(true);
    expect(draftChanged(change([...draft.items, { item: added }]))).toBe(true);
    expect(draftChanged(change([{ item: { ...netflix, pinned: false }, saved: netflix }]))).toBe(
      true,
    );
    const cleared = withValue(netflix, ['priceOverride'], undefined) as ListItem;
    expect(draftChanged(change([{ item: cleared, saved: netflix }]))).toBe(true);
    expect(draftChanged(change([{ ...draft.items[0], removed: true }]))).toBe(true);
  });

  it('is unchanged by an item added and removed again, which it leaves out', () => {
    const edited = change([...draft.items, { item: added, removed: true }]);
    expect(draftChanged(edited)).toBe(false);
    expect(draftItems(edited)).toEqual([netflix]);
  });
});

describe('savedList', () => {
  it('creates a new list', () => {
    expect(savedList(newListDraft(addedId, 'Subscription List', started), undefined, now)).toEqual({
      id: addedId,
      name: 'Subscription List',
      createdAt: now,
      updatedAt: now,
    });
  });

  it('renames the list only when the draft did', () => {
    expect(savedList(draft, list, now)).toBeUndefined();
    expect(savedList({ ...draft, name: 'Work' }, list, now)).toEqual({
      ...list,
      name: 'Work',
      updatedAt: now,
    });
  });

  it('keeps a name changed elsewhere when the draft kept it', () => {
    expect(savedList(draft, { ...list, name: 'Office' }, now)).toBeUndefined();
  });

  it('refuses a list deleted since, and a new list that exists', () => {
    expect(() => savedList(draft, undefined, now)).toThrow("can't be saved");
    expect(() => savedList(draft, { ...list, deletedAt: now }, now)).toThrow("can't be saved");
    expect(() => savedList({ ...draft, isNew: true, items: [] }, list, now)).toThrow(
      'is saved already',
    );
  });
});

describe('savedItem', () => {
  it('creates an added item, stamped now', () => {
    expect(savedItem({ item: added }, undefined, now)).toEqual({
      ...added,
      createdAt: now,
      updatedAt: now,
    });
    expect(savedItem({ item: added, removed: true }, undefined, now)).toBeUndefined();
  });

  it('writes nothing for an unchanged item, whatever changed elsewhere', () => {
    expect(savedItem(draft.items[0], { ...netflix, pinned: false }, now)).toBeUndefined();
  });

  it('writes the fields the draft changed, and keeps the ones changed elsewhere', () => {
    const billing = { ...netflix.billing, autoRenew: false };
    const edited: DraftItem = { item: { ...netflix, billing, tagIds: [] }, saved: netflix };
    // Unpinned and given another card elsewhere since the draft started.
    const current = { ...netflix, pinned: false, cardId: addedId };
    expect(savedItem(edited, current, now)).toEqual({
      ...current,
      billing,
      tagIds: [],
      updatedAt: now,
    });
  });

  it('writes pinned and the card when the draft changed them, and clears what it cleared', () => {
    expect(netflix.cardId).toBe(cardId);
    const noCard = { ...(withValue(netflix, ['cardId'], undefined) as ListItem), pinned: false };
    const edited: DraftItem = { item: noCard, saved: netflix };
    expect(savedItem(edited, netflix, now)).toEqual({ ...noCard, updatedAt: now });
  });

  it('soft-deletes a removed item', () => {
    expect(savedItem({ ...draft.items[0], removed: true }, netflix, now)).toEqual({
      ...netflix,
      updatedAt: now,
      deletedAt: now,
    });
  });

  it('leaves an item deleted since as it is', () => {
    const edited: DraftItem = { item: { ...netflix, pinned: false }, saved: netflix };
    expect(savedItem(edited, undefined, now)).toBeUndefined();
    expect(savedItem(edited, { ...netflix, deletedAt: started }, now)).toBeUndefined();
  });
});

describe('listsWithDrafts', () => {
  it('names the saved lists as their drafts do, then adds the new lists', () => {
    const family = { ...list, id: addedId, name: 'Family' };
    const fresh = newListDraft('0192f1ca-6172-7384-9f90-a1b2c3d4e5f6', 'Subscription List', now);
    expect(listsWithDrafts([list, family], [{ ...draft, name: 'Work' }, fresh])).toEqual([
      { id: listId, name: 'Work' },
      { id: addedId, name: 'Family' },
      { id: fresh.listId, name: 'Subscription List' },
    ]);
  });
});
