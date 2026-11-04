import { describe, expect, it } from 'vitest';
import {
  accountConditions,
  accountFactsAsked,
  conditionMet,
  type Account,
  type AccountCondition,
  type ItemAccount,
} from '../../src';
import { chequing, fintech, rates } from '../catalog/finance-files';

// An account item's facts against its plan's conditions (M11.11): what the item dialog asks, and what a fact meets.

const savings = fintech.plans[1].account;
const today = '2026-11-04';

/** A chequing account whose fee three ways waive, with a bonus rate and an age to open it. */
const everyCondition: Account = {
  ...chequing,
  waivers: [{ minBalance: 4000 }, { directDeposit: true }, { minAssets: 100_000 }],
  rates: { ...rates({ from: 0, rate: 0.5 }), bonus: { rate: 2, when: { monthlyDeposits: 1000 } } },
  eligibility: { maxAge: 24, student: true },
};

const facts = (changes: Partial<ItemAccount> = {}): ItemAccount => ({
  balance: { amount: 2500, currency: 'CAD' },
  asOf: '2026-11-01',
  ...changes,
});

const met = (condition: AccountCondition, changes: Partial<ItemAccount> = {}) =>
  conditionMet(condition, facts(changes), today);

describe('accountConditions', () => {
  it('lists the waivers, then the bonus rate’s condition, then the eligibility', () => {
    expect(accountConditions(everyCondition)).toEqual([
      { minBalance: 4000 },
      { directDeposit: true },
      { minAssets: 100_000 },
      { monthlyDeposits: 1000 },
      { maxAge: 24, student: true },
    ]);
  });

  it('is empty for an account with none', () => {
    expect(accountConditions(savings)).toEqual([]);
  });
});

describe('accountFactsAsked', () => {
  it('asks for each fact a condition needs, in the dialog’s order', () => {
    expect(accountFactsAsked(everyCondition)).toEqual([
      'directDeposit',
      'monthlyDeposits',
      'assetsHeld',
      'born',
      'student',
    ]);
  });

  it('asks for nothing beside the balance when the conditions name only a balance, or there are none', () => {
    expect(accountFactsAsked(chequing)).toEqual([]);
    expect(accountFactsAsked(savings)).toEqual([]);
  });

  it.each([
    [{ minAge: 60 }, ['born']],
    [{ maxAge: 24 }, ['born']],
    [{ minAge: 18, maxAge: 24 }, ['born']],
    [{ newcomer: true as const }, ['newcomer']],
    [{ directDeposit: 2000, monthlyDeposits: 500 }, ['directDeposit', 'monthlyDeposits']],
  ])('asks %j for its fact once', (waiver, asked) => {
    expect(accountFactsAsked({ ...chequing, waivers: [waiver, waiver] })).toEqual(asked);
  });
});

describe('conditionMet', () => {
  it('compares the balance with a minimum', () => {
    expect(met({ minBalance: 4000 }, { balance: { amount: 4000, currency: 'CAD' } })).toBe(true);
    expect(met({ minBalance: 4000 }, { balance: { amount: 3999.99, currency: 'CAD' } })).toBe(
      false,
    );
  });

  it('meets any direct deposit with an amount above 0', () => {
    expect(met({ directDeposit: true }, { directDeposit: 1 })).toBe(true);
    expect(met({ directDeposit: true }, { directDeposit: 0 })).toBe(false);
    expect(met({ directDeposit: true })).toBeUndefined();
  });

  it('compares the amounts a month and the assets held with their minimums', () => {
    expect(met({ directDeposit: 2000 }, { directDeposit: 2000 })).toBe(true);
    expect(met({ directDeposit: 2000 }, { directDeposit: 1999 })).toBe(false);
    expect(met({ monthlyDeposits: 1000 }, { monthlyDeposits: 1000 })).toBe(true);
    expect(met({ monthlyDeposits: 1000 }, { monthlyDeposits: 999 })).toBe(false);
    expect(met({ minAssets: 100_000 }, { assetsHeld: 100_000 })).toBe(true);
    expect(met({ minAssets: 100_000 }, { assetsHeld: 99_999 })).toBe(false);
  });

  it('is undefined when a fact it needs isn’t given', () => {
    expect(met({ directDeposit: 2000 })).toBeUndefined();
    expect(met({ monthlyDeposits: 1000 })).toBeUndefined();
    expect(met({ minAssets: 100_000 })).toBeUndefined();
    expect(met({ minAge: 60 })).toBeUndefined();
    expect(met({ maxAge: 24 })).toBeUndefined();
  });

  it('counts an age from the first of the month someone was born', () => {
    // 60 on 2026-11-01, so on the 4th; born in December, 59 until 2026-12-01.
    expect(met({ minAge: 60 }, { born: '1966-11' })).toBe(true);
    expect(met({ minAge: 60 }, { born: '1966-12' })).toBe(false);
    expect(met({ maxAge: 24 }, { born: '2002-11' })).toBe(true);
    expect(met({ maxAge: 24 }, { born: '2001-11' })).toBe(false);
    expect(met({ maxAge: 24 }, { born: '2001-12' })).toBe(true);
  });

  it('takes a student or a newcomer the user didn’t say they are as not one', () => {
    expect(met({ student: true }, { student: true })).toBe(true);
    expect(met({ student: true })).toBe(false);
    expect(met({ newcomer: true }, { newcomer: true })).toBe(true);
    expect(met({ newcomer: true })).toBe(false);
  });

  it('needs every part: one that fails outweighs one it can’t tell', () => {
    const condition = { maxAge: 24, student: true as const };
    expect(met(condition, { born: '2003-05', student: true })).toBe(true);
    expect(met(condition, { born: '2003-05' })).toBe(false);
    expect(met(condition, { student: true })).toBeUndefined();
    expect(met({ maxAge: 24, minBalance: 4000 })).toBe(false);
  });
});
