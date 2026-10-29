import { describe, expect, it } from 'vitest';
import { cardCost, networkRate } from '../../src';
import { canadian, dollarCard, cashBack } from './fixtures';

// BLUEPRINT §9.3's formula: the charge with tax, in the card's currency at the network's rate (the ECB's), the FX fee
// when the currencies differ, and cash back on the full posted amount.

const fx = canadian.fx;
const eurToCad = 1 / 0.664;

describe('networkRate', () => {
  it('is 1 for the same currency, else the ECB’s cross rate, for every network', () => {
    expect(networkRate('visa', 'CAD', 'CAD', undefined)).toBe(1);
    expect(networkRate('mastercard', 'EUR', 'CAD', fx)).toBeCloseTo(eurToCad);
    expect(networkRate('amex', 'EUR', 'USD', fx)).toBeCloseTo(0.7243 / 0.664);
    expect(networkRate('visa', 'EUR', 'CAD', undefined)).toBeUndefined();
  });
});

describe('cardCost', () => {
  it('has no FX fee in the card’s own currency, and cash back on the charge', () => {
    const cost = cardCost({ amount: 21.4587, currency: 'CAD' }, cashBack, fx);
    expect(cost).toMatchObject({ inCardCurrency: 21.4587, fxFee: 0, posted: 21.4587 });
    expect(cost?.cashback).toBeCloseTo(21.4587 * 0.015);
    expect(cost?.net).toBeCloseTo(21.4587 * 0.985);
    expect(cost?.converted).toBe(false);
  });

  it('adds the FX fee to a charge in another currency, and pays cash back on both (Mullvad’s euros)', () => {
    // Mullvad charges in euros, whatever card pays (the user's choice for open question 1).
    const cost = cardCost({ amount: 60, currency: 'EUR' }, cashBack, fx);
    const inCad = 60 * eurToCad;
    expect(cost?.inCardCurrency).toBeCloseTo(inCad);
    expect(cost?.fxFee).toBeCloseTo(inCad * 0.025);
    expect(cost?.posted).toBeCloseTo(inCad * 1.025);
    expect(cost?.cashback).toBeCloseTo(inCad * 1.025 * 0.015);
    expect(cost?.net).toBeCloseTo(inCad * 1.025 * 0.985);
    expect(cost?.converted).toBe(true);
  });

  it('works in the card’s currency: a CAD charge on a USD card with no FX fee', () => {
    const cost = cardCost({ amount: 100, currency: 'CAD' }, dollarCard, fx);
    expect(cost?.inCardCurrency).toBeCloseTo(72.43);
    expect(cost?.fxFee).toBe(0);
    expect(cost?.cashback).toBeCloseTo(0.7243);
  });

  it('is undefined for want of a rate', () => {
    expect(cardCost({ amount: 60, currency: 'EUR' }, cashBack, undefined)).toBeUndefined();
  });
});
