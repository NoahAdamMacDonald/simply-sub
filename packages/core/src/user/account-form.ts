import type { IsoDate } from '../dates/iso-date';
import type { AccountFact } from './account-facts';
import type { FormIssue } from './item-form';
import type { ItemAccount } from './list-item';

// The item dialog's Account section (M11.11): an account plan's balance and the facts its conditions ask about
// (accountFactsAsked), as the form holds them, what stops them from being saved, and the account block they save.

/** The Account section's fields. Signal Forms models hold no undefined: null is an amount not entered. */
export interface AccountForm {
  balance: number | null;
  directDeposit: number | null;
  monthlyDeposits: number | null;
  assetsHeld: number | null;
  /** The month of birth, YYYY-MM as a month field gives it: '' for none. */
  born: string;
  student: boolean;
  newcomer: boolean;
}

/** What the section depends on: the plan's account's currency, and the facts its conditions need. */
export interface AccountRules {
  currency: string;
  asked: readonly AccountFact[];
}

/** The amounts besides the balance, each a fact of its own name. */
const factAmounts = ['directDeposit', 'monthlyDeposits', 'assetsHeld'] as const;

/** A YYYY-MM month: what born holds. */
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export function emptyAccountForm(): AccountForm {
  return {
    balance: null,
    directDeposit: null,
    monthlyDeposits: null,
    assetsHeld: null,
    born: '',
    student: false,
    newcomer: false,
  };
}

/** The section for an item's account block, or an empty one. */
export function accountFormFor(account: ItemAccount | undefined): AccountForm {
  if (!account) return emptyAccountForm();
  return {
    balance: account.balance.amount,
    directDeposit: account.directDeposit ?? null,
    monthlyDeposits: account.monthlyDeposits ?? null,
    assetsHeld: account.assetsHeld ?? null,
    born: account.born ?? '',
    student: account.student === true,
    newcomer: account.newcomer === true,
  };
}

/**
 * What stops the section from being saved, at its fields under `account`: an amount below 0, a month of birth that
 * isn't one, and facts without a balance, which they're kept with. Only the facts asked count, since the others are
 * neither shown nor saved.
 */
export function accountFormIssues(form: AccountForm, rules: AccountRules): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (field: keyof AccountForm, message: string) =>
    issues.push({ path: ['account', field], message });
  const asked = new Set(rules.asked);
  for (const field of ['balance', ...factAmounts.filter((fact) => asked.has(fact))] as const) {
    const amount = form[field];
    if (amount !== null && !(amount >= 0)) add(field, 'Enter an amount of 0 or more');
  }
  if (asked.has('born') && form.born !== '' && !monthPattern.test(form.born)) {
    add('born', 'Enter the year and month, like 1990-06');
  }
  if (form.balance === null && Object.keys(givenFacts(form, asked)).length > 0) {
    add('balance', 'Enter the balance too, which these are kept with');
  }
  return issues;
}

/**
 * The account block the section saves, once accountFormIssues finds nothing wrong: the balance in the account's
 * currency, dated today unless it's the balance the item had, and the facts asked that are given. Nothing without a
 * balance.
 */
export function accountFromForm(
  form: AccountForm,
  rules: AccountRules,
  today: IsoDate,
  before?: ItemAccount,
): ItemAccount | undefined {
  if (form.balance === null || !(form.balance >= 0)) return undefined;
  const balance = { amount: form.balance, currency: rules.currency };
  const kept =
    before?.balance.amount === balance.amount && before.balance.currency === balance.currency;
  return {
    balance,
    asOf: kept ? before.asOf : today,
    ...givenFacts(form, new Set(rules.asked)),
  };
}

/** The facts asked that the form gives, as the account block holds them. */
function givenFacts(form: AccountForm, asked: ReadonlySet<AccountFact>): Partial<ItemAccount> {
  const facts: Partial<ItemAccount> = {};
  for (const fact of factAmounts) {
    const amount = form[fact];
    if (asked.has(fact) && amount !== null && amount >= 0) facts[fact] = amount;
  }
  if (asked.has('born') && monthPattern.test(form.born)) facts.born = form.born;
  if (asked.has('student') && form.student) facts.student = true;
  if (asked.has('newcomer') && form.newcomer) facts.newcomer = true;
  return facts;
}
