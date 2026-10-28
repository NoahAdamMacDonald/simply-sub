import { describe, expect, it } from 'vitest';
import {
  optimize,
  suggestionEdits,
  type ListItem,
  type OptimizerResult,
  type PaymentCard,
} from '../../src';
import { catalog, cards, fx, item, resolveAll, today } from './fixtures';

// The optimizer's 7th action (BLUEPRINT §10.3, §9.3, M9.3): a better card is a free saving, for any item, an
// Essential plan's too, within each card's limit with what the list's other items and the other lists' put on it.
// The fixtures' providers name no networks, so every card can pay for anything. Alberta's 5% GST.

const stamps = { createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-20T09:15:00.000Z' };
const simplii: PaymentCard = {
  id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
  name: 'Simplii Cashback Mastercard',
  nickname: 'Everyday',
  type: 'credit',
  network: 'mastercard',
  currency: 'CAD',
  cashbackPercent: 1.5,
  fxFeePercent: 2.5,
  monthlyLimit: 30,
  ...stamps,
};
const tangerine: PaymentCard = {
  id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d43',
  name: 'Tangerine Money-Back',
  type: 'credit',
  network: 'mastercard',
  currency: 'CAD',
  cashbackPercent: 1,
  fxFeePercent: 2.5,
  ...stamps,
};

/** Netflix Premium's next 12 months in Alberta: 12 charges of $23.99 and 5%. */
const premiumYear = 12 * 23.99 * 1.05;

/** The card suggestions alone: an item that isn't Essential gets plan changes too. */
function byCard(result: OptimizerResult) {
  return result.suggestions.filter((suggestion) => suggestion.actions[0].kind === 'card');
}

function run(
  items: readonly ListItem[],
  options: { cards: PaymentCard[]; loads?: Map<string, number[]> },
): OptimizerResult {
  return optimize({
    items: resolveAll(items),
    catalogs: new Map([['CA', catalog]]),
    context: {
      today,
      country: 'CA',
      currency: 'CAD',
      fx,
      place: { country: 'CA', subdivision: 'CA-AB' },
      profileRanks: new Map(),
    },
    cards: options.cards,
    ...(options.loads && { cardLoads: options.loads }),
  });
}

describe('optimize: a better card', () => {
  it('is a free saving, for an Essential plan too', () => {
    const essential = item(
      'netflix.premium',
      {},
      { rankOverrides: { 'video.quality=4k': 'essential' } },
    );
    const result = run([essential], { cards: [tangerine, simplii] });
    expect(cards(result)).toEqual([
      'free | Pay for Netflix Premium with a better card | save 4.53',
    ]);
    const [suggestion] = result.suggestions;
    expect(suggestion.savings).toBeCloseTo(premiumYear * 0.015);
    expect(suggestion.actions).toEqual([
      {
        kind: 'card',
        item: expect.objectContaining({ itemId: essential.id, title: 'Netflix Premium' }),
        cardId: simplii.id,
        cardTitle: 'Everyday',
      },
    ]);
    // "Save up to" counts it: the best plan keeps the item.
    expect(result.bestSavings).toBeCloseTo(premiumYear * 0.015);
  });

  it('moves an item only to a card that does better than its own', () => {
    const onTangerine = item('netflix.premium', {}, { cardId: tangerine.id });
    const [suggestion] = byCard(run([onTangerine], { cards: [tangerine, simplii] }));
    expect(suggestion.actions).toMatchObject([
      { kind: 'card', cardId: simplii.id, fromCardTitle: 'Tangerine Money-Back' },
    ]);
    expect(suggestion.savings).toBeCloseTo(premiumYear * 0.005);
    const onSimplii = item('netflix.premium', {}, { cardId: simplii.id });
    expect(byCard(run([onSimplii], { cards: [tangerine, simplii] }))).toEqual([]);
  });

  it('fits each card’s limit, with what’s on it already, and the suggestions fit together', () => {
    // $25.19 a month each: Simplii's $30 takes one.
    const mine = item('netflix.premium');
    const sams = item('netflix.premium');
    const both = run([mine, sams], { cards: [tangerine, simplii] });
    expect(byCard(both).map((suggestion) => suggestion.actions[0])).toMatchObject([
      { kind: 'card', cardId: simplii.id },
      { kind: 'card', cardId: tangerine.id },
    ]);
    // Another list's items fill Simplii in one of the 12 months: Tangerine it is.
    const loads = new Map([[simplii.id, [0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0]]]);
    const outside = run([mine], { cards: [tangerine, simplii], loads });
    expect(byCard(outside)[0].actions).toMatchObject([{ cardId: tangerine.id }]);
  });

  it('gives a new fingerprint once the item’s card changes', () => {
    const plain = item('netflix.premium');
    const first = byCard(run([plain], { cards: [tangerine, simplii] }))[0].fingerprint;
    const again = byCard(run([plain], { cards: [tangerine, simplii] }))[0].fingerprint;
    const onTangerine = run([{ ...plain, cardId: tangerine.id }], { cards: [tangerine, simplii] });
    expect(again).toBe(first);
    expect(byCard(onTangerine)[0].fingerprint).not.toBe(first);
  });

  it('applies as the item’s card in the draft, changing nothing else', () => {
    const premium = item('netflix.premium');
    const [suggestion] = byCard(run([premium], { cards: [simplii] }));
    expect(suggestionEdits(suggestion, new Map([[premium.id, premium]]))).toEqual([
      {
        kind: 'change',
        itemId: premium.id,
        changes: {
          source: premium.source,
          billing: premium.billing,
          priceOverride: undefined,
          cardId: simplii.id,
        },
      },
    ]);
  });
});
