import { describe, expect, it } from 'vitest';
import {
  actionTitle,
  dependentChanges,
  draftItems,
  listDraftSchema,
  startDraft,
  suggestionEdits,
  withDraftEdits,
  withoutApplied,
  type ListDraft,
} from '../../src';
import { item, listId, run } from './fixtures';

// Review changes (M8.6): each suggestion applied to a draft is recorded with what it changed, so it can be undone on
// its own, with the later ones that build on it.

const now = '2026-10-28T12:00:00.000Z';
let nextId = 0;
const newId = () => `0192f1c5-1c2d-7e3f-8a4b-${String(800 + ++nextId).padStart(12, '0')}`;

/** `draft` with the suggestion whose title matches applied, as Optimizations' Apply does. */
function apply(draft: ListDraft, title: RegExp): ListDraft {
  const items = draftItems(draft);
  const suggestion = run(items).suggestions.find((candidate) =>
    candidate.actions.some((action) => title.test(actionTitle(action))),
  );
  if (!suggestion) throw new Error(`No suggestion matches ${title}`);
  const edits = suggestionEdits(suggestion, new Map(items.map((entry) => [entry.id, entry])));
  if (!edits) throw new Error('The suggestion no longer fits');
  const ids = edits.map((edit) => (edit.kind === 'add' ? newId() : undefined));
  return withDraftEdits(draft, edits, ids, now, {
    title: suggestion.actions.map(actionTitle).join('; '),
    savings: suggestion.savings,
    currency: 'CAD',
  });
}

describe('applied changes', () => {
  const crave = item('crave.premium', { anchorDate: '2026-11-05' });
  const disney = item('disney-plus.premium', { anchorDate: '2026-11-15' });
  const mine = item('netflix.standard', {}, { nickname: 'Mine' });
  const sams = item('netflix.standard', { anchorDate: '2026-11-20' }, { nickname: "Sam's" });
  const list = { id: listId, name: 'Family', createdAt: now, updatedAt: now };
  const start = startDraft(list, [crave, disney, mine, sams], now);

  it('records each suggestion applied, with the items as they were and what it added', () => {
    const draft = apply(start, /Bundle$/);
    expect(listDraftSchema.safeParse(draft).success).toBe(true);
    const [change] = draft.applied ?? [];
    expect(change.title).toBe(
      'Replace Disney+ Premium and Crave Premium with Disney+ and Crave Premium Bundle',
    );
    expect(change.savings).toBeGreaterThan(0);
    expect(change.before.map((entry) => entry.id).sort()).toEqual([crave.id, disney.id].sort());
    expect(
      change.before.every((entry) => entry.billing.mode === 'recurring' && !entry.billing.endDate),
    ).toBe(true);
    expect(change.added).toHaveLength(1);
    expect(draft.items.find((entry) => entry.item.id === change.added[0])?.item.source).toEqual({
      kind: 'bundle',
      bundleId: 'bundle.disney-crave-premium',
    });
  });

  it('undoes one change on its own, putting its items back and taking out what it added', () => {
    const both = apply(apply(start, /Bundle$/), /extra member/);
    expect(both.applied).toHaveLength(2);
    const undone = withoutApplied(both, 0);
    expect(listDraftSchema.safeParse(undone).success).toBe(true);
    const byId = new Map(undone.items.map((entry) => [entry.item.id, entry.item]));
    expect(byId.get(crave.id)).toEqual(crave);
    expect(byId.get(disney.id)).toEqual(disney);
    expect(undone.items.some((entry) => entry.item.source.kind === 'bundle')).toBe(false);
    // The extra member stays applied.
    expect(undone.applied?.map((change) => change.title)).toEqual([both.applied?.[1].title]);
    expect(byId.get(mine.id)?.source).toMatchObject({ addOns: [{ since: '2026-11-20' }] });
    // Undoing the last one leaves a draft with nothing applied.
    const none = withoutApplied(undone, 0);
    expect(none.applied).toBeUndefined();
    expect(draftItems(none)).toEqual([crave, disney, mine, sams]);
  });

  it('takes back the later changes that build on the one undone', () => {
    const bundled = apply(start, /Bundle$/);
    const bundleId = bundled.applied?.[0].added[0] ?? '';
    // A later change to the bundle the first one added: a card for it, say.
    const carded = withDraftEdits(
      bundled,
      [
        {
          kind: 'change',
          itemId: bundleId,
          changes: { cardId: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e' },
        },
      ],
      [undefined],
      now,
      {
        title: 'Pay Disney+ and Crave Premium Bundle with Cash Back Mastercard',
        savings: 5,
        currency: 'CAD',
      },
    );
    const extra = apply(carded, /extra member/);
    expect(dependentChanges(extra.applied ?? [], 0)).toEqual([0, 1]);
    expect(dependentChanges(extra.applied ?? [], 2)).toEqual([2]);
    const undone = withoutApplied(extra, 0);
    expect(undone.applied?.map((change) => change.title)).toEqual([extra.applied?.[2].title]);
    expect(undone.items.some((entry) => entry.item.id === bundleId)).toBe(false);
  });
});
