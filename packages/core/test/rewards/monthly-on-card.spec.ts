import { describe, expect, it } from 'vitest';
import { bestCard, cardChoices, monthlyOnCard } from '../../src';
import {
  canadian,
  debitCard,
  discoverCard,
  dollarCard,
  noRates,
  ontario,
  resolved,
  simplii,
  today,
  yearly,
} from './fixtures';

// A month of an item on a card (P4, P6): today's monthly equivalent with tax, and the same after the card's cash back
// and FX fees. P11's acceptance: net = gross + FX fee − cash back.

const context = { today, currency: 'CAD', place: ontario, fx: canadian.fx };

describe('monthlyOnCard', () => {
  it('is the monthly equivalent with tax, less the cash back on the card', () => {
    const month = monthlyOnCard(resolved('netflix.standard'), simplii, context);
    expect(month?.gross).toBeCloseTo(18.99 * 1.13);
    expect(month?.fxFee).toBe(0);
    expect(month?.cashback).toBeCloseTo(18.99 * 1.13 * 0.015);
    expect(month?.net).toBeCloseTo(18.99 * 1.13 * 0.985);
    expect(month?.converted).toBe(false);
  });

  it('adds the FX fee on a charge in another currency, and net = gross + FX fee − cash back', () => {
    const mullvad = resolved('mullvad.vpn', { billing: yearly });
    const month = monthlyOnCard(mullvad, simplii, context);
    // €60 a year with Ontario's tax, a month: what's charged, in CAD at the ECB's rate.
    const gross = (60 * 1.13) / 0.664 / 12;
    expect(month?.gross).toBeCloseTo(gross);
    expect(month?.fxFee).toBeCloseTo(gross * 0.025);
    expect(month?.cashback).toBeCloseTo(gross * 1.025 * 0.015);
    expect(month?.net).toBeCloseTo(
      (month?.gross ?? 0) + (month?.fxFee ?? 0) - (month?.cashback ?? 0),
    );
    expect(month?.converted).toBe(true);
  });

  it('is the gross with no card, in another currency’s card converted back, and undefined for want of a rate', () => {
    const netflix = resolved('netflix.standard');
    const bare = monthlyOnCard(netflix, undefined, context);
    expect(bare?.net).toBe(bare?.gross);
    // 1% back on a USD card, which a CAD charge reaches at the ECB's rate, with no fee on this card.
    const dollars = monthlyOnCard(netflix, dollarCard, context);
    expect(dollars?.cashback).toBeCloseTo(18.99 * 1.13 * 0.01);
    expect(dollars?.converted).toBe(true);
    const mullvad = resolved('mullvad.vpn', { billing: yearly }, noRates);
    expect(monthlyOnCard(mullvad, simplii, { ...context, fx: undefined })).toBeUndefined();
  });
});

describe('cardChoices and bestCard', () => {
  const netflix = resolved('netflix.standard');
  const choices = cardChoices(netflix, [debitCard, discoverCard, dollarCard, simplii], context);

  it('offer the cards its seller takes, each with its month there', () => {
    expect(choices.map(({ card, acceptance }) => [card.name, acceptance])).toEqual([
      ['US Dollar Visa', 'accepted'],
      ['Simplii Cashback Mastercard', 'accepted'],
    ]);
    expect(choices[1].monthly?.net).toBeCloseTo(18.99 * 1.13 * 0.985);
  });

  it('name the best card and what it saves a month over the one chosen, or none', () => {
    const best = bestCard(choices, undefined, netflix, context);
    expect(best?.choice.card).toBe(simplii);
    expect(best?.saving).toBeCloseTo(18.99 * 1.13 * 0.015);
    expect(bestCard(choices, dollarCard.id, netflix, context)?.saving).toBeCloseTo(
      18.99 * 1.13 * 0.005,
    );
    expect(bestCard(choices, simplii.id, netflix, context)).toBeUndefined();
  });
});
