import type { Account, AccountCondition, RateTier } from '../catalog/account';
import type { IsoDate } from '../dates/iso-date';
import { conditionMet } from './account-facts';
import type { ItemAccount } from './list-item';

// A finance account's money terms (PROJECT-PLAN §3.1, M11.12): the fee after waivers, and interest a year, from an
// item's balance and facts (M11.11). A condition that can't be told without a fact isn't met.

/** Interest a year on an account item's balance (§3.1), in its balance's currency. */
export interface AccountInterest {
  amount: number;
  currency: string;
  /** What the whole balance earns, in percent a year: a portion account's tiers come to between their rates. */
  rate: number;
  /** The bonus rate, which the item's facts earn in place of the tiers. */
  bonus?: true;
}

/** The first of the plan's waivers that the item's facts meet: its fee after waivers is then $0. */
export function waiverMet(
  account: Account,
  facts: ItemAccount,
  today: IsoDate,
): AccountCondition | undefined {
  return account.waivers?.find((waiver) => conditionMet(waiver, facts, today) === true);
}

/**
 * Interest a year on the item's balance at the plan's posted rates (§3.1): simple, before tax. `whole` pays the whole
 * balance the rate of the highest tier it reaches; `portion` pays each part its own tier's; a bonus rate the facts earn
 * replaces the tiers. None for an account with no posted rates.
 */
export function interestAYear(
  account: Account,
  facts: ItemAccount,
  today: IsoDate,
): AccountInterest | undefined {
  const { rates } = account;
  if (!rates) return undefined;
  const { amount: balance, currency } = facts.balance;
  const bonus =
    rates.bonus && conditionMet(rates.bonus.when, facts, today) === true
      ? rates.bonus.rate
      : undefined;
  if (bonus !== undefined) {
    return { amount: (balance * bonus) / 100, currency, rate: bonus, bonus: true };
  }
  if (rates.applies === 'whole') {
    const rate = reachedTier(rates.tiers, balance).rate;
    return { amount: (balance * rate) / 100, currency, rate };
  }
  const amount = rates.tiers.reduce((total, tier, index) => {
    const upTo = rates.tiers[index + 1]?.from ?? Infinity;
    return total + (Math.max(0, Math.min(balance, upTo) - tier.from) * tier.rate) / 100;
  }, 0);
  return { amount, currency, rate: balance > 0 ? (amount / balance) * 100 : rates.tiers[0].rate };
}

/** The highest tier `balance` reaches: the first starts at 0, so there's always one. */
function reachedTier(tiers: readonly RateTier[], balance: number): RateTier {
  let reached = tiers[0];
  for (const tier of tiers) if (balance >= tier.from) reached = tier;
  return reached;
}
