import { describe, expect, it } from 'vitest';
import { assignCards, type PaymentCard } from '../../src';
import {
  canadian,
  debitCard,
  discoverCard,
  ontario,
  otherListId,
  resolved,
  cashBack,
  today,
} from './fixtures';

// Assign best cards (P11, BLUEPRINT §9.3): the most cash back less FX fees over the next 12 months, within each card's
// monthly limit and the networks each seller takes, in Ontario on Oct 26, 2026.

const context = { today, currency: 'CAD', place: ontario, fx: canadian.fx };
const netflixYear = 12 * 18.99 * 1.13;

/** A CAD Mastercard with 1% back and no limit. */
const rewardsCard: PaymentCard = {
  ...cashBack,
  id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d43',
  name: 'Rewards Mastercard',
  cashbackPercent: 1,
  monthlyLimit: undefined,
};

describe('assignCards', () => {
  it('gives each item its best card that its seller takes', () => {
    // Netflix in Canada takes neither Interac nor Discover.
    const netflix = resolved('netflix.standard');
    const { changes, savings } = assignCards({
      items: [netflix],
      cards: [debitCard, discoverCard, rewardsCard, cashBack],
      context,
    });
    expect(changes).toEqual([
      {
        itemId: netflix.item.id,
        listId: netflix.listId,
        title: 'Netflix Standard',
        to: cashBack.id,
        savings: expect.closeTo(netflixYear * 0.015, 6),
        estimated: false,
      },
    ]);
    expect(savings).toBeCloseTo(netflixYear * 0.015);
  });

  it('keeps within each card’s limit: the next best card takes what doesn’t fit', () => {
    const tight = { ...cashBack, monthlyLimit: 30 };
    const mine = resolved('netflix.standard');
    const sams = resolved('netflix.standard', { listId: otherListId });
    const { changes } = assignCards({ items: [mine, sams], cards: [rewardsCard, tight], context });
    expect(changes.map((change) => [change.itemId, change.to])).toEqual([
      [mine.item.id, tight.id],
      [sams.item.id, rewardsCard.id],
    ]);
  });

  it('leaves a fixed item on its card, counting its charges against the limit', () => {
    const tight = { ...cashBack, monthlyLimit: 30 };
    const kept = resolved('netflix.standard', { cardId: tight.id });
    const free = resolved('netflix.standard', { listId: otherListId });
    const { changes } = assignCards({
      items: [kept, free],
      cards: [rewardsCard, tight],
      fixed: new Set([kept.item.id]),
      context,
    });
    expect(changes.map((change) => [change.itemId, change.to])).toEqual([
      [free.item.id, rewardsCard.id],
    ]);
  });

  it('moves an item off a card its seller doesn’t take, and leaves one on its best card', () => {
    const onDebit = resolved('netflix.standard', { cardId: debitCard.id });
    const onCashBack = resolved('crave.standard', { cardId: cashBack.id });
    const { changes } = assignCards({
      items: [onDebit, onCashBack],
      cards: [debitCard, rewardsCard, cashBack],
      context,
    });
    expect(changes).toMatchObject([
      { itemId: onDebit.item.id, from: debitCard.id, to: cashBack.id },
    ]);
  });

  it('gives no card to an item every card would cost more in FX fees than it pays back', () => {
    // Bought in the US: charged in US dollars, and every card here is in CAD with a 2.5% fee.
    const american = resolved('netflix.standard', { region: 'US' });
    const { changes } = assignCards({
      items: [american],
      cards: [discoverCard, cashBack],
      context,
    });
    expect(changes).toEqual([]);
    // With a card already, it moves to the one that costs the least.
    const paid = resolved('netflix.standard', { region: 'US', cardId: cashBack.id });
    const moved = assignCards({ items: [paid], cards: [discoverCard, cashBack], context });
    expect(moved.changes).toMatchObject([
      { from: cashBack.id, to: discoverCard.id, estimated: true },
    ]);
    expect(moved.changes[0].savings).toBeGreaterThan(0);
  });
});
