import { describe, expect, it } from 'vitest';
import {
  actionTitle,
  listItemSchema,
  suggestionEdits,
  type DraftEdit,
  type ListItem,
  type OptimizerResult,
  type ProfileRank,
} from '../../src';
import { item, run } from './fixtures';

// Apply (P14): a suggestion's changes as edits to the list's draft, each taking effect on the item's next charge.

function editsFor(
  items: ListItem[],
  title: RegExp,
  ranks: Record<string, ProfileRank> = {},
): { edits: DraftEdit[]; result: OptimizerResult } {
  const result = run(items, ranks);
  const suggestion = result.suggestions.find((candidate) =>
    candidate.actions.some((action) => title.test(actionTitle(action))),
  );
  if (!suggestion) throw new Error(`No suggestion matches ${title}`);
  const edits = suggestionEdits(
    suggestion,
    new Map(items.map((listItem) => [listItem.id, listItem])),
  );
  if (!edits) throw new Error('The suggestion no longer fits');
  return { edits, result };
}

/** The draft's items after the edits, each checked like a stored record. */
function applied(items: readonly ListItem[], edits: readonly DraftEdit[]): ListItem[] {
  const removed = new Set(edits.flatMap((edit) => (edit.kind === 'remove' ? [edit.itemId] : [])));
  const changed = items
    .filter((listItem) => !removed.has(listItem.id))
    .map((listItem) => {
      const edit = edits.find(
        (candidate) => candidate.kind === 'change' && candidate.itemId === listItem.id,
      );
      const next = edit?.kind === 'change' ? { ...listItem, ...edit.changes } : listItem;
      if (next.priceOverride === undefined) delete next.priceOverride;
      return next;
    });
  const added = edits.flatMap((edit, index) =>
    edit.kind === 'add'
      ? [
          {
            ...edit.fields,
            id: `0192f1c5-1c2d-7e3f-8a4b-${String(900 + index).padStart(12, '0')}`,
            listId: items[0].listId,
            createdAt: '2026-10-28T12:00:00.000Z',
            updatedAt: '2026-10-28T12:00:00.000Z',
          },
        ]
      : [],
  );
  const all = [...changed, ...added];
  for (const listItem of all) expect(listItemSchema.safeParse(listItem).success).toBe(true);
  return all;
}

describe('suggestionEdits', () => {
  it('moves an item to annual billing on its next charge, dropping its price override', () => {
    const disney = item(
      'disney-plus.premium',
      { anchorDate: '2026-09-30', billingDay: 31 },
      { priceOverride: { amount: 15, currency: 'CAD' } },
    );
    const { edits } = editsFor([disney], /annual billing$/);
    const [changed] = applied([disney], edits);
    expect(changed.billing).toEqual({
      mode: 'recurring',
      interval: 'year',
      intervalCount: 1,
      anchorDate: '2026-10-31',
      autoRenew: true,
    });
    expect(changed.priceOverride).toBeUndefined();
    expect(changed.source).toEqual({ kind: 'catalog', planId: 'disney-plus.premium' });
  });

  it('downgrades a plan on its next charge, keeping the add-ons the new plan allows', () => {
    const netflix = item(
      'netflix.premium',
      {},
      {
        source: {
          kind: 'catalog',
          planId: 'netflix.premium',
          addOns: [{ id: 'netflix.extra-member', quantity: 2 }],
        },
      },
    );
    const { edits } = editsFor([netflix], /→ Standard$/, {
      'video.quality=4k': 'unwanted',
      'video.hdr': 'unwanted',
      'streaming.ad-free': 'wanted',
    });
    const [changed] = applied([netflix], edits);
    // Standard allows one extra member.
    expect(changed.source).toEqual({
      kind: 'catalog',
      planId: 'netflix.standard',
      addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
    });
    expect(changed.billing).toMatchObject({ anchorDate: '2026-11-10', interval: 'month' });
  });

  it('ends a removed item on its next charge, so what is paid for is used up', () => {
    const mullvad = item('mullvad.vpn', { anchorDate: '2026-11-21' });
    const ivpn = item('ivpn.pro');
    const { edits } = editsFor([mullvad, ivpn], /^Remove Mullvad/, {
      'vpn.included': 'needed',
      'vpn.multi-hop': 'needed',
    });
    expect(edits).toEqual([
      {
        kind: 'change',
        itemId: mullvad.id,
        changes: {
          source: mullvad.source,
          billing: { ...mullvad.billing, endDate: '2026-11-21' },
          priceOverride: undefined,
        },
      },
    ]);
  });

  it('takes a removed window plan out of the draft, since Specific dates have no end date', () => {
    const netflix = item('netflix.premium');
    const disney = item('disney-plus.premium', {
      mode: 'limited',
      windows: [{ start: '2026-09-01', end: '2026-10-31', repeatYearly: true }],
    } as Partial<ListItem['billing']>);
    const { edits } = editsFor([netflix, disney], /^Remove Disney/, {
      'video.quality=4k': 'needed',
    });
    expect(edits).toEqual([{ kind: 'remove', itemId: disney.id }]);
  });

  it('adds an extra member to the host and ends the item it replaces', () => {
    const mine = item('netflix.standard', {}, { nickname: 'Mine' });
    const sams = item('netflix.standard', { anchorDate: '2026-11-20' }, { nickname: "Sam's" });
    const { edits } = editsFor([mine, sams], /extra member/, { 'streaming.ad-free': 'wanted' });
    const [host, member] = applied([mine, sams], edits);
    expect(host.source).toEqual({
      kind: 'catalog',
      planId: 'netflix.standard',
      addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
    });
    expect(member.billing).toMatchObject({ endDate: '2026-11-20' });
  });

  it('adds a bundle on the earliest next charge, with the items’ tags and ranks, and ends them each on theirs', () => {
    const disney = item(
      'disney-plus.premium',
      { anchorDate: '2026-11-15' },
      {
        tagIds: ['0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d'],
        rankOverrides: { 'video.hdr': 'wanted' },
      },
    );
    const crave = item(
      'crave.premium',
      { anchorDate: '2026-11-05' },
      { pinned: true, rankOverrides: { 'video.hdr': 'needed' } },
    );
    const { edits } = editsFor([disney, crave], /Bundle$/);
    const [endedDisney, endedCrave, bundle] = applied([disney, crave], edits);
    expect(endedDisney.billing).toMatchObject({ endDate: '2026-11-15' });
    expect(endedCrave.billing).toMatchObject({ endDate: '2026-11-05' });
    expect(bundle).toMatchObject({
      source: { kind: 'bundle', bundleId: 'bundle.disney-crave-premium' },
      billing: { mode: 'recurring', interval: 'month', anchorDate: '2026-11-05', autoRenew: true },
      tagIds: ['0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d'],
      rankOverrides: { 'video.hdr': 'needed' },
      pinned: true,
    });
  });

  it('takes out an item that would only start after its replacement starts', () => {
    const later = item('proton.mail-plus', {
      anchorDate: '2026-12-01',
      startDate: '2026-12-01',
    });
    const now = item('proton.vpn-plus', { anchorDate: '2026-11-01' });
    const pass = item('proton.pass-plus', { anchorDate: '2026-11-02' });
    const { edits } = editsFor([later, now, pass], /Unlimited$/);
    expect(edits.filter((edit) => edit.kind === 'remove')).toEqual([
      { kind: 'remove', itemId: later.id },
    ]);
  });

  it('gives undefined when the draft no longer has an item the suggestion changes', () => {
    const disney = item('disney-plus.premium');
    const [suggestion] = run([disney]).suggestions;
    expect(suggestionEdits(suggestion, new Map())).toBeUndefined();
  });
});
