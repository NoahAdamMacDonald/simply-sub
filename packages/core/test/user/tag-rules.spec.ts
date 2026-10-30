import { describe, expect, it } from 'vitest';
import {
  draftChanged,
  freeTagColor,
  listDraftSchema,
  listItemSchema,
  namesakes,
  parseTagColor,
  savedItem,
  startDraft,
  tagColorName,
  tagColorPresets,
  tagColorSchema,
  tagNameIssue,
  tagNamed,
  tagUsage,
  withTagMerged,
  withoutTag,
  type ListDraft,
  type ListItem,
  type SubscriptionList,
  type TagFields,
} from '../../src';
import { withValue } from '../catalog/helpers';
import { item as fullItem, list as savedWork, listId, tagId } from './fixtures';

const otherTagId = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2e';
const secondItemId = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0c';
const thirdItemId = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0d';
const now = '2026-10-28T10:00:00.000Z';

const family: TagFields = { id: tagId, name: 'Family', color: '#1e88e5' };
const work: TagFields = { id: otherTagId, name: ' Work ', color: '#e53935' };

/** The fixtures' item, not deleted, tagged Family. */
const netflix = withValue(fullItem, ['deletedAt'], undefined) as ListItem;
const tagged = (id: string, tagIds: string[], deleted = false): ListItem => ({
  ...netflix,
  id,
  tagIds,
  ...(deleted && { deletedAt: netflix.updatedAt }),
});

describe('tagColorPresets', () => {
  it('has 12 colours a tag can store, each named once', () => {
    expect(tagColorPresets).toHaveLength(12);
    for (const { color } of tagColorPresets) expect(tagColorSchema.parse(color)).toBe(color);
    expect(new Set(tagColorPresets.map((preset) => preset.name)).size).toBe(12);
    expect(new Set(tagColorPresets.map((preset) => preset.color)).size).toBe(12);
  });
});

describe('tagNamed and tagNameIssue', () => {
  it('finds a tag by its name, trimmed and in any case', () => {
    expect(tagNamed([family, work], 'family ')).toBe(family);
    expect(tagNamed([family, work], 'WORK')).toBe(work);
    expect(tagNamed([family, work], 'Gym')).toBeUndefined();
  });

  it('needs a name once trimmed', () => {
    expect(tagNameIssue('', [family])).toBe('Give the tag a name');
    expect(tagNameIssue('   ', [family])).toBe('Give the tag a name');
  });

  it("refuses another tag's name in any case, naming it as it's stored, trimmed", () => {
    expect(tagNameIssue('family', [family, work])).toBe("There's a tag called “Family” already");
    expect(tagNameIssue(' work', [family, work])).toBe("There's a tag called “Work” already");
    expect(tagNameIssue('Gym', [family, work])).toBeUndefined();
  });

  it('lets a tag being renamed keep its own name, or change its case', () => {
    expect(tagNameIssue('FAMILY', [family, work], tagId)).toBeUndefined();
    expect(tagNameIssue('Work', [family, work], tagId)).toBe("There's a tag called “Work” already");
  });
});

describe('freeTagColor', () => {
  it('takes the first preset no tag has, in any case', () => {
    expect(freeTagColor([])).toBe(tagColorPresets[0].color);
    expect(freeTagColor([{ ...work, color: '#E53935' }])).toBe(tagColorPresets[1].color);
  });

  it('goes round again once every preset is taken', () => {
    const all = tagColorPresets.map((preset, index) => ({
      ...family,
      id: `${index}`,
      color: preset.color,
    }));
    expect(freeTagColor(all)).toBe(tagColorPresets[0].color);
    expect(freeTagColor([...all, family])).toBe(tagColorPresets[1].color);
  });
});

describe('parseTagColor and tagColorName', () => {
  it('takes six hex digits, with or without #, in lower case', () => {
    expect(parseTagColor('#1E88E5')).toBe('#1e88e5');
    expect(parseTagColor(' 00897b ')).toBe('#00897b');
  });

  it('refuses anything else, which a style could misread', () => {
    for (const text of ['', '#fff', '#12345', '#1234567', 'red', '#12345g', 'url(x)']) {
      expect(parseTagColor(text)).toBeUndefined();
    }
  });

  it('names a preset by its name, and any other colour by its digits', () => {
    expect(tagColorName('#00897B')).toBe('Teal');
    expect(tagColorName('#123ABC')).toBe('#123abc');
  });
});

describe('tagUsage', () => {
  it('counts the items in lists and in drafts that have the tag, each once', () => {
    const items = [
      tagged(netflix.id, [tagId]),
      tagged(secondItemId, [otherTagId]),
      tagged(thirdItemId, [tagId], true),
    ];
    const draft: ListDraft = {
      ...startDraft(savedWork as SubscriptionList, [tagged(netflix.id, [tagId])], now),
      items: [
        { item: tagged(netflix.id, [tagId]), saved: tagged(netflix.id, [tagId]) },
        // Added in the draft, not saved yet.
        { item: tagged(thirdItemId, [tagId]) },
      ],
    };
    // Netflix once (saved and in the draft), and the draft's new item; not the deleted one.
    expect(tagUsage(tagId, items, [draft])).toBe(2);
    expect(tagUsage(otherTagId, items, [draft])).toBe(1);
  });

  it("leaves out a draft's item that was removed in it", () => {
    const draft: ListDraft = {
      ...startDraft(savedWork as SubscriptionList, [], now),
      items: [{ item: tagged(netflix.id, [tagId]), removed: true }],
    };
    expect(tagUsage(tagId, [], [draft])).toBe(0);
  });
});

describe('withoutTag', () => {
  it('takes the tag off every item that has it, a deleted one too, as a change made now', () => {
    const items = [
      tagged(netflix.id, [otherTagId, tagId]),
      tagged(secondItemId, [otherTagId]),
      tagged(thirdItemId, [tagId], true),
    ];
    const { items: changed } = withoutTag(tagId, items, [], now);
    expect(changed.map((item) => [item.id, item.tagIds, item.updatedAt])).toEqual([
      [netflix.id, [otherTagId], now],
      [thirdItemId, [], now],
    ]);
    // Still deleted, and still a valid item.
    expect(changed[1].deletedAt).toBe(netflix.updatedAt);
    for (const item of changed) expect(listItemSchema.safeParse(item).success).toBe(true);
  });

  it("takes it off a draft's items as edited and as saved, so the draft doesn't look changed", () => {
    const saved = tagged(netflix.id, [tagId, otherTagId]);
    const draft = startDraft(savedWork as SubscriptionList, [saved], now);
    const untouched: ListDraft = {
      ...startDraft({ ...(savedWork as SubscriptionList), id: listId }, [], now),
      listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e',
    };
    const { drafts } = withoutTag(tagId, [], [draft, untouched], now);
    expect(drafts).toHaveLength(1);
    const [entry] = drafts[0].items;
    expect(entry.item.tagIds).toEqual([otherTagId]);
    expect(entry.saved?.tagIds).toEqual([otherTagId]);
    // The item's own timestamps are Save's to set.
    expect(entry.item.updatedAt).toBe(saved.updatedAt);
    expect(draftChanged(drafts[0])).toBe(false);
    expect(listDraftSchema.safeParse(drafts[0]).success).toBe(true);
    // Saving it later writes nothing: the stored item lost the tag in the same change.
    const stored = withoutTag(tagId, [saved], [], now).items[0];
    expect(savedItem(entry, stored, now)).toBeUndefined();
  });

  it('changes nothing when nothing has the tag', () => {
    const items = [tagged(netflix.id, [otherTagId])];
    expect(withoutTag(tagId, items, [], now)).toEqual({ items: [], drafts: [] });
  });
});

describe('namesakes', () => {
  it('pairs each tag with the first before it of its name, in any case, as two devices’ tags meet (M10.24)', () => {
    const phoneFamily: TagFields = { id: 'phone', name: 'family ', color: '#8e24aa' };
    const third: TagFields = { id: 'third', name: 'FAMILY', color: '#757575' };
    const found = namesakes([family, work, phoneFamily, third]);
    expect([...found].map(([id, first]) => [id, first.id])).toEqual([
      ['phone', tagId],
      ['third', tagId],
    ]);
    expect(namesakes([family, work])).toEqual(new Map());
  });
});

describe('withTagMerged', () => {
  const into = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2f';

  it('puts the tag kept in place of the merged one, once, on every item that had it, as a change made now', () => {
    const items = [
      tagged(netflix.id, [tagId, otherTagId]),
      tagged(secondItemId, [tagId, into]),
      tagged(thirdItemId, [otherTagId]),
    ];
    const { items: changed } = withTagMerged(tagId, into, items, [], now);
    expect(changed.map((item) => [item.id, item.tagIds, item.updatedAt])).toEqual([
      [netflix.id, [otherTagId, into], now],
      [secondItemId, [into], now],
    ]);
  });

  it("does the same in a draft, as edited and as saved, so the draft doesn't look changed", () => {
    const saved = tagged(netflix.id, [tagId]);
    const draft = startDraft(savedWork as SubscriptionList, [saved], now);
    const { drafts } = withTagMerged(tagId, into, [], [draft], now);
    const [entry] = drafts[0].items;
    expect(entry.item.tagIds).toEqual([into]);
    expect(entry.saved?.tagIds).toEqual([into]);
    expect(draftChanged(drafts[0])).toBe(false);
  });
});
