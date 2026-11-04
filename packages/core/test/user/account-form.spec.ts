import { describe, expect, it } from 'vitest';
import {
  accountFormFor,
  accountFormIssues,
  accountFromForm,
  emptyAccountForm,
  itemAccountSchema,
  type AccountForm,
  type AccountRules,
  type ItemAccount,
} from '../../src';
import { itemAccount } from './fixtures';

// The item dialog's Account section (M11.11): an account plan's balance and the facts it asks for.

const today = '2026-11-04';
const stored = itemAccount as ItemAccount;
const everyFact: AccountRules = {
  currency: 'CAD',
  asked: ['directDeposit', 'monthlyDeposits', 'assetsHeld', 'born', 'student', 'newcomer'],
};
const balanceOnly: AccountRules = { currency: 'CAD', asked: [] };

const form = (changes: Partial<AccountForm> = {}): AccountForm => ({
  ...emptyAccountForm(),
  ...changes,
});

describe('accountFormFor and accountFromForm', () => {
  it('start empty, and save nothing without a balance', () => {
    expect(accountFormFor(undefined)).toEqual({
      balance: null,
      directDeposit: null,
      monthlyDeposits: null,
      assetsHeld: null,
      born: '',
      student: false,
      newcomer: false,
    });
    expect(accountFromForm(form({ directDeposit: 2000, student: true }), everyFact, today)).toBe(
      undefined,
    );
  });

  it('give back the block an item had, its date too, when nothing changes', () => {
    const own = accountFormFor(stored);
    expect(own).toEqual({
      balance: 4250.5,
      directDeposit: 2000,
      monthlyDeposits: 2500,
      assetsHeld: 12_000,
      born: '1990-06',
      student: true,
      newcomer: true,
    });
    expect(accountFromForm(own, everyFact, today, stored)).toEqual(stored);
  });

  it('date a new or changed balance today', () => {
    expect(accountFromForm(form({ balance: 0 }), balanceOnly, today)).toEqual({
      balance: { amount: 0, currency: 'CAD' },
      asOf: today,
    });
    const changed = { ...accountFormFor(stored), balance: 5000 };
    expect(accountFromForm(changed, everyFact, today, stored)?.asOf).toBe(today);
    // Another account's currency: the same amount is another balance.
    const inUsd = { ...everyFact, currency: 'USD' };
    expect(accountFromForm(accountFormFor(stored), inUsd, today, stored)).toMatchObject({
      balance: { amount: 4250.5, currency: 'USD' },
      asOf: today,
    });
  });

  it('keep only the facts the plan asks for, and only the ones given', () => {
    const born: AccountRules = { currency: 'CAD', asked: ['born', 'student'] };
    expect(accountFromForm(accountFormFor(stored), born, today, stored)).toEqual({
      balance: stored.balance,
      asOf: stored.asOf,
      born: '1990-06',
      student: true,
    });
    expect(accountFromForm(form({ balance: 10, student: false }), born, today)).toEqual({
      balance: { amount: 10, currency: 'CAD' },
      asOf: today,
    });
  });

  it('save what the schema takes', () => {
    const saved = accountFromForm(accountFormFor(stored), everyFact, today);
    expect(itemAccountSchema.safeParse(saved).success).toBe(true);
  });
});

describe('accountFormIssues', () => {
  it('finds nothing in an empty section, or in one with every fact', () => {
    expect(accountFormIssues(form(), everyFact)).toEqual([]);
    expect(accountFormIssues(accountFormFor(stored), everyFact)).toEqual([]);
  });

  it('refuses an amount below 0, or a month of birth that isn’t one', () => {
    const wrong = form({
      balance: -1,
      directDeposit: -1,
      monthlyDeposits: Number.NaN,
      assetsHeld: -0.5,
      born: '1990-13',
    });
    expect(accountFormIssues(wrong, everyFact)).toEqual([
      { path: ['account', 'balance'], message: 'Enter an amount of 0 or more' },
      { path: ['account', 'directDeposit'], message: 'Enter an amount of 0 or more' },
      { path: ['account', 'monthlyDeposits'], message: 'Enter an amount of 0 or more' },
      { path: ['account', 'assetsHeld'], message: 'Enter an amount of 0 or more' },
      { path: ['account', 'born'], message: 'Enter the year and month, like 1990-06' },
    ]);
  });

  it('asks for the balance that facts are kept with', () => {
    expect(accountFormIssues(form({ student: true }), everyFact)).toEqual([
      { path: ['account', 'balance'], message: 'Enter the balance too, which these are kept with' },
    ]);
  });

  it('checks only the facts the plan asks for', () => {
    const unasked = form({ directDeposit: -1, born: 'June', student: true });
    expect(accountFormIssues(unasked, balanceOnly)).toEqual([]);
  });
});
