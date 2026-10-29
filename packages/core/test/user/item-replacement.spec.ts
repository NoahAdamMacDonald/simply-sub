import { describe, expect, it } from 'vitest';
import { itemReplacements, type ListItem } from '../../src';
import { catalog, item } from '../optimizer/fixtures';

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
