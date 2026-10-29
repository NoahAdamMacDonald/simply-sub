import { describe, expect, it } from 'vitest';
import {
  actionTitle,
  chargesIn,
  optimize,
  suggestionEdits,
  yearRange,
  next12Range,
  type ListItem,
  type PaymentCard,
} from '../../src';
import { catalog, fx, item, resolveAll, run, today } from './fixtures';

// What Apply replaces (M8.5, the feedback after M3): a bundle, a suite or an extra member takes over from the items it
// replaces on their next charge, so the list never pays for both, this year's past charges stay as they were, and
// nothing new is charged before it starts.

const place = { country: 'CA', subdivision: 'CA-AB' };

/** The items after a suggestion whose title matches is applied, as the draft has them. */
function applied(items: ListItem[], title: RegExp, cards: PaymentCard[] = []): ListItem[] {
  const result = optimizeWith(items, cards);
  const suggestion = result.suggestions.find((candidate) =>
    candidate.actions.some((action) => title.test(actionTitle(action))),
  );
  if (!suggestion) throw new Error(`No suggestion matches ${title}`);
  const edits = suggestionEdits(suggestion, new Map(items.map((entry) => [entry.id, entry])));
  if (!edits) throw new Error('The suggestion no longer fits');
  let next = items;
  for (const edit of edits) {
    if (edit.kind === 'remove') next = next.filter((entry) => entry.id !== edit.itemId);
    if (edit.kind === 'change') {
      next = next.map((entry) => {
        if (entry.id !== edit.itemId) return entry;
        const changed = { ...entry, ...edit.changes };
        if (changed.priceOverride === undefined) delete changed.priceOverride;
        return changed;
      });
    }
    if (edit.kind === 'add') {
      next = [
        ...next,
        {
          ...edit.fields,
          id: '0192f1c5-1c2d-7e3f-8a4b-000000000999',
          listId: items[0].listId,
          createdAt: '2026-10-28T12:00:00.000Z',
          updatedAt: '2026-10-28T12:00:00.000Z',
        },
      ];
    }
  }
  return next;
}

function optimizeWith(items: readonly ListItem[], cards: PaymentCard[]) {
  return cards.length === 0
    ? run(items)
    : optimize({
        items: resolveAll(items),
        catalogs: new Map([['CA', catalog]]),
        context: {
          today,
          country: 'CA',
          currency: 'CAD',
          fx,
          place,
          profileRanks: new Map(),
        },
        cards,
      });
}

/** The items' charges in a range, added up, rounded to the cent. */
function total(items: readonly ListItem[], range: { from: string; to: string }): number {
  // A charge's amount has its sales tax in it already.
  const sum = chargesIn(resolveAll(items), range, place).reduce(
    (amount, charge) => amount + charge.amount,
    0,
  );
  return Math.round(sum * 100) / 100;
}

describe('Apply replaces what a suggestion replaces', () => {
  it('starts a bundle on its first charge: this year never counts it before then, nor both on one day', () => {
    const crave = item('crave.premium', { anchorDate: '2026-11-05' });
    const disney = item('disney-plus.premium', { anchorDate: '2026-11-15' });
    const before = [crave, disney];
    const after = applied(before, /Bundle$/);
    const bundle = after.find((entry) => entry.source.kind === 'bundle');
    expect(bundle?.billing).toMatchObject({ anchorDate: '2026-11-05', startDate: '2026-11-05' });
    // This year: the same up to Nov 5, then the bundle in place of both, which costs less.
    const year = yearRange(today);
    expect(total(after, year)).toBeLessThan(total(before, year));
    const untilSwitch = { from: year.from, to: '2026-11-05' };
    expect(total(after, untilSwitch)).toBe(total(before, untilSwitch));
    // The next 12 months: what the suggestion said.
    const [suggestion] = run(before).suggestions.filter((candidate) =>
      candidate.actions.some((action) => /Bundle$/.test(actionTitle(action))),
    );
    expect(total(after, next12Range(today))).toBeCloseTo(suggestion.next12, 1);
  });

  it('adds an extra member from the day it takes over, never to the host’s charges before', () => {
    const mine = item('netflix.standard', {}, { nickname: 'Mine' });
    const sams = item('netflix.standard', { anchorDate: '2026-11-20' }, { nickname: "Sam's" });
    const before = [mine, sams];
    const after = applied(before, /extra member/);
    const host = after.find((entry) => entry.id === mine.id);
    expect(host?.source).toEqual({
      kind: 'catalog',
      planId: 'netflix.standard',
      addOns: [{ id: 'netflix.extra-member', quantity: 1, since: '2026-11-20' }],
    });
    const year = yearRange(today);
    // Up to Sam's next charge, nothing changes: no extra member on Mine's charges, Sam's own plan still paid.
    expect(total(after, { from: year.from, to: '2026-11-20' })).toBe(
      total(before, { from: year.from, to: '2026-11-20' }),
    );
    expect(total(after, year)).toBeLessThan(total(before, year));
  });

  it('suggests nothing more for the items a queued bundle replaces, a card included', () => {
    const cashBack: PaymentCard = {
      id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
      name: 'Cash Back Mastercard',
      type: 'credit',
      network: 'mastercard',
      currency: 'CAD',
      cashbackPercent: 2,
      fxFeePercent: 2.5,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:00:00.000Z',
    };
    const crave = item('crave.premium', { anchorDate: '2026-11-05' });
    const disney = item('disney-plus.premium', { anchorDate: '2026-11-15' });
    const first = optimizeWith([crave, disney], [cashBack]);
    const cardFor = (result: typeof first, itemId: string) =>
      result.suggestions.some((suggestion) =>
        suggestion.actions.some(
          (action) => action.kind === 'card' && action.item.itemId === itemId,
        ),
      );
    expect(cardFor(first, crave.id)).toBe(true);
    const after = applied([crave, disney], /Bundle$/, [cashBack]);
    const again = optimizeWith(after, [cashBack]);
    expect(cardFor(again, crave.id)).toBe(false);
    expect(cardFor(again, disney.id)).toBe(false);
    expect(
      again.suggestions.some((suggestion) => /Bundle$/.test(actionTitle(suggestion.actions[0]))),
    ).toBe(false);
  });
});
