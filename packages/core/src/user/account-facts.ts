import type { Account, AccountCondition } from '../catalog/account';
import type { IsoDate } from '../dates/iso-date';
import type { ItemAccount } from './list-item';

// An account item's facts against its plan's conditions (M11.11, BLUEPRINT §4.11): which facts the item dialog asks
// for, and whether a condition is met. The user gives facts, never the waivers they meet, so a plan whose terms change
// is judged again from the same facts.

/** A fact an account item can hold about its user, beside its balance. */
export type AccountFact =
  'directDeposit' | 'monthlyDeposits' | 'assetsHeld' | 'born' | 'student' | 'newcomer';

/** Each fact, in the order the item dialog asks for them, and the parts of a condition that need it. */
const factsFor: readonly (readonly [AccountFact, readonly (keyof AccountCondition)[]])[] = [
  ['directDeposit', ['directDeposit']],
  ['monthlyDeposits', ['monthlyDeposits']],
  ['assetsHeld', ['minAssets']],
  ['born', ['minAge', 'maxAge']],
  ['student', ['student']],
  ['newcomer', ['newcomer']],
];

/** Every condition a plan's account names: its waivers', its bonus rate's and its eligibility. */
export function accountConditions(account: Account): AccountCondition[] {
  return [
    ...(account.waivers ?? []),
    ...(account.rates?.bonus ? [account.rates.bonus.when] : []),
    ...(account.eligibility ? [account.eligibility] : []),
  ];
}

/**
 * The facts the item dialog asks for an account, beside its balance, which every account has: those its conditions
 * need, in factsFor's order. None for an account whose conditions name only a balance, or that has none.
 */
export function accountFactsAsked(account: Account): AccountFact[] {
  const named = new Set(accountConditions(account).flatMap((condition) => Object.keys(condition)));
  return factsFor.flatMap(([fact, parts]) => (parts.some((part) => named.has(part)) ? [fact] : []));
}

/**
 * Whether an account item's facts meet a condition, every part of it: false when a part fails, else undefined when a
 * part needs a fact the item doesn't give, else true. Amounts are in the account's currency. A student or a newcomer
 * the user didn't say they are isn't one. An age counts from the first of the month they were born.
 */
export function conditionMet(
  condition: AccountCondition,
  account: ItemAccount,
  today: IsoDate,
): boolean | undefined {
  const age = account.born === undefined ? undefined : ageOn(account.born, today);
  const parts = [
    atLeast(account.balance.amount, condition.minBalance),
    condition.directDeposit === true
      ? compare(account.directDeposit, 0, (amount) => amount > 0)
      : atLeast(account.directDeposit, condition.directDeposit),
    atLeast(account.monthlyDeposits, condition.monthlyDeposits),
    atLeast(account.assetsHeld, condition.minAssets),
    atLeast(age, condition.minAge),
    compare(age, condition.maxAge, (years, most) => years <= most),
    condition.student === undefined || account.student === true,
    condition.newcomer === undefined || account.newcomer === true,
  ];
  if (parts.includes(false)) return false;
  return parts.includes(undefined) ? undefined : true;
}

/** One part of a condition: met when the condition sets no `limit`, unknown without the user's figure. */
function compare(
  have: number | undefined,
  limit: number | undefined,
  meets: (have: number, limit: number) => boolean,
): boolean | undefined {
  return limit === undefined ? true : have === undefined ? undefined : meets(have, limit);
}

const atLeast = (have: number | undefined, least: number | undefined) =>
  compare(have, least, (amount, limit) => amount >= limit);

/** How old someone born in `born` (YYYY-MM) is on `today`, counting from the first of that month. */
function ageOn(born: string, today: IsoDate): number {
  const [year, month] = born.split('-').map(Number);
  const [nowYear, nowMonth] = today.split('-').map(Number);
  return nowYear - year - (nowMonth < month ? 1 : 0);
}
