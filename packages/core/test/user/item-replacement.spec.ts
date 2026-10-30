import { describe, expect, it } from 'vitest';
import {
  draftItems,
  itemReplacements,
  releasedItems,
  startDraft,
  withEndsRestored,
  withReleasedItems,
  type ListDraft,
  type ListItem,
} from '../../src';
import { catalog, item, listId } from '../optimizer/fixtures';

// What takes over from an item that ends (M7.11): a bundle, a suite, or an extra member on another account.

const ending = (planId: string, endDate: string, extra: Partial<ListItem> = {}) =>
  item(planId, { anchorDate: endDate, endDate }, extra);

describe('itemReplacements', () => {
  it('finds the bundle that has started by an item’s end and includes its plan', () => {
    const crave = ending('crave.premium', '2026-11-05');
    const disney = ending('disney-plus.premium', '2026-11-15');
    const bundle = item('bundle.disney-crave-premium', {
      anchorDate: '2026-11-05',
      startDate: '2026-11-05',
    });
    const found = itemReplacements([crave, disney, bundle], catalog);
    expect(found.get(crave.id)).toEqual({ kind: 'bundle', itemId: bundle.id, on: '2026-11-05' });
    expect(found.get(disney.id)).toEqual({ kind: 'bundle', itemId: bundle.id, on: '2026-11-15' });
    expect(found.has(bundle.id)).toBe(false);
  });

  it('finds the account an extra member joins on the day another one ends', () => {
    const mine = item(
      'netflix.standard',
      {},
      {
        source: {
          kind: 'catalog',
          planId: 'netflix.standard',
          addOns: [{ id: 'netflix.extra-member', quantity: 1, since: '2026-11-20' }],
        },
      },
    );
    const sams = ending('netflix.standard', '2026-11-20');
    expect(itemReplacements([mine, sams], catalog).get(sams.id)).toEqual({
      kind: 'extra-member',
      itemId: mine.id,
      on: '2026-11-20',
    });
  });

  it('finds a suite that includes the plan, and nothing for an item that just ends', () => {
    const vpn = ending('proton.vpn-plus', '2026-11-01');
    const unlimited = item('proton.unlimited', {
      anchorDate: '2026-11-01',
      startDate: '2026-11-01',
    });
    const alone = ending('crave.premium', '2026-12-01');
    const found = itemReplacements([vpn, unlimited, alone], catalog);
    expect(found.get(vpn.id)).toEqual({ kind: 'suite', itemId: unlimited.id, on: '2026-11-01' });
    expect(found.has(alone.id)).toBe(false);
  });

  it('never takes a bundle that starts after the end, or one in another list', () => {
    const crave = ending('crave.premium', '2026-11-05');
    const late = item('bundle.disney-crave-premium', {
      anchorDate: '2026-12-05',
      startDate: '2026-12-05',
    });
    const elsewhere = item(
      'bundle.disney-crave-premium',
      { anchorDate: '2026-11-05', startDate: '2026-11-05' },
      { listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c99' },
    );
    expect(itemReplacements([crave, late, elsewhere], catalog).size).toBe(0);
  });
});

// What an edit lets go on (the feedback after M10): an item that ended for what took over from it, which the edit
// took away.
describe('releasedItems', () => {
  const hosting = (addOns: { id: string; quantity: number; since?: string }[] | undefined) =>
    item(
      'netflix.standard',
      {},
      {
        id: '0192f1c5-1c2d-7e3f-8a4b-00000000a001',
        nickname: 'Mine',
        source: { kind: 'catalog', planId: 'netflix.standard', ...(addOns && { addOns }) },
      },
    );
  const extraMember = [{ id: 'netflix.extra-member', quantity: 1, since: '2026-11-20' }];
  const sams = ending('netflix.standard', '2026-11-20', { nickname: "Sam's" });

  it('lets an account go on once the extra member it was to become is taken off its host', () => {
    expect(
      releasedItems([hosting(extraMember), sams], [hosting(undefined), sams], catalog),
    ).toEqual([sams]);
    // Or the host is taken out.
    expect(releasedItems([hosting(extraMember), sams], [sams], catalog)).toEqual([sams]);
  });

  it('lets a bundle’s items go on once it’s taken out, and keeps what still takes over', () => {
    const crave = ending('crave.premium', '2026-11-05');
    const disney = ending('disney-plus.premium', '2026-11-15');
    const bundle = item('bundle.disney-crave-premium', {
      anchorDate: '2026-11-05',
      startDate: '2026-11-05',
    });
    expect(releasedItems([crave, disney, bundle], [crave, disney], catalog)).toEqual([
      crave,
      disney,
    ]);
    // A change to the bundle that keeps it starting by then lets nothing go.
    const yearly = { ...bundle, billing: { ...bundle.billing, interval: 'year' as const } };
    expect(releasedItems([crave, disney, bundle], [crave, disney, yearly], catalog)).toEqual([]);
  });

  it('keeps an end date the edit changed, or one another account now takes over', () => {
    const later = { ...sams, billing: { ...sams.billing, endDate: '2026-12-20' } };
    expect(
      releasedItems([hosting(extraMember), sams], [hosting(undefined), later], catalog),
    ).toEqual([]);
    const dads = item(
      'netflix.premium',
      {},
      {
        source: { kind: 'catalog', planId: 'netflix.premium', addOns: extraMember },
      },
    );
    expect(
      releasedItems([hosting(extraMember), sams], [hosting(undefined), sams, dads], catalog),
    ).toEqual([]);
  });

  it('clears the end date in the draft in the same change, and Undo puts it back', () => {
    const now = '2026-10-28T12:00:00.000Z';
    const list = { id: listId, name: 'Family', createdAt: now, updatedAt: now };
    const before = startDraft(list, [hosting(extraMember), sams], now);
    const changed: ListDraft = {
      ...before,
      items: before.items.map((entry) =>
        entry.item.id === hosting(undefined).id ? { ...entry, item: hosting(undefined) } : entry,
      ),
    };
    const { draft, released } = withReleasedItems(before, changed, catalog, now);
    expect(released).toEqual([sams]);
    const going = draftItems(draft).find((entry) => entry.id === sams.id);
    expect(going?.billing).not.toHaveProperty('endDate');
    expect(going?.updatedAt).toBe(now);
    const undone = withEndsRestored(draft, released, now);
    expect(draftItems(undone).find((entry) => entry.id === sams.id)?.billing).toMatchObject({
      endDate: '2026-11-20',
    });
    // An edit that releases nothing changes nothing more.
    expect(withReleasedItems(before, before, catalog, now)).toEqual({
      draft: before,
      released: [],
    });
  });
});
