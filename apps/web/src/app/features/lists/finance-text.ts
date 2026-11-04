import { planTitle, type FinanceSuggestion } from '@simply-sub/core';
import { rateText } from '../../shared/account-terms/account-text';
import { amountText, wholeAmountText } from '../../shared/price-tag/price-text';

// How the finance optimizer's suggestions read on Optimizations (M11.13, BLUEPRINT §10.6): what would earn more, or
// what isn't insured, then why, from the accounts' rates, fees and balances. The page adds that it's information, not
// financial advice, to every one.

/** One finance card: its first line, why, and where to see an account sold elsewhere. */
export interface FinanceCard {
  key: string;
  warning: boolean;
  heading: string;
  detail: string;
  /** Search's query for a plan the user doesn't have. */
  search?: { q: string; plan: string };
}

const insurerNames: Record<'cdic' | 'provincial' | 'cipf', string> = {
  cdic: 'CDIC',
  provincial: 'its provincial insurer',
  cipf: 'CIPF',
};

/** A finance suggestion's card, its money in the user's currency (`currency`) and country's way. */
export function financeCard(
  suggestion: FinanceSuggestion,
  currency: string,
  country: string | undefined,
): FinanceCard {
  const money = (amount: number) => amountText(amount, currency, country);
  const whole = (amount: number, inCurrency = currency) =>
    wholeAmountText(Math.round(amount), inCurrency, country);
  switch (suggestion.kind) {
    case 'paid-rate': {
      const { item, to, fee, toFee, breakEven, gain } = suggestion;
      const title = planTitle(to.name, to.planName);
      const feeText = (amount: number) =>
        amount > 0 ? `${money(amount)} a month` : 'no monthly fee';
      const why =
        breakEven === undefined
          ? `It pays ${rateText(to.rate)} with ${feeText(toFee)}, against ${rateText(item.rate)} with ${feeText(fee)} in ${item.title}.`
          : toFee > fee
            ? `At ${rateText(to.rate)} instead of ${rateText(item.rate)}, its ${money(toFee - fee)} more a month pays for itself above ${whole(breakEven)}, and ${item.title} has ${whole(item.balance)}.`
            : `${item.title}'s ${rateText(item.rate)} pays for its ${money(fee - toFee)} more a month only above ${whole(breakEven)}, and it has ${whole(item.balance)}.`;
      return {
        key: `paid-rate ${item.itemId}`,
        warning: false,
        heading: `${title} would earn ${money(gain)} more a year than ${item.title}`,
        detail: why,
      };
    }
    case 'pay-fee': {
      const { item, better, minimum, fee, givenUp, gain } = suggestion;
      return {
        key: `pay-fee ${item.itemId}`,
        warning: false,
        heading: `Paying ${item.title}'s fee would earn ${money(gain)} more a year`,
        detail: `Keeping its ${whole(minimum)} minimum there gives up ${money(givenUp)} a year that ${better.title} would pay at ${rateText(better.rate)}, more than its fee's ${money(fee)} a year.`,
      };
    }
    case 'top-up': {
      const { item, better, amount, minimum, fee, givenUp, gain } = suggestion;
      return {
        key: `top-up ${item.itemId}`,
        warning: false,
        heading: `Moving ${whole(amount)} to ${item.title} would save ${money(gain)} a year`,
        detail: `With ${whole(minimum)} in it, its fee of ${money(fee)} a year is waived, and that ${whole(amount)} earns ${money(givenUp)} a year in ${better.title}.`,
      };
    }
    case 'move-savings': {
      const { item, to, gain } = suggestion;
      if ('item' in to) {
        return {
          key: `move-savings ${item.itemId}`,
          warning: false,
          heading: `Moving ${whole(item.balance)} to ${to.item.title} would earn ${money(gain)} more a year`,
          detail: `It pays ${rateText(to.item.rate)}, and ${item.title} ${rateText(item.rate)}.`,
        };
      }
      const { plan } = to;
      const fee = plan.price.monthlyEquivalent;
      return {
        key: `move-savings ${item.itemId}`,
        warning: false,
        heading: `${planTitle(plan.name, plan.planName)} would earn ${money(gain)} more a year than ${item.title}`,
        detail: `On your ${whole(item.balance)}, it pays ${rateText(plan.rate)}${fee > 0 ? ` for ${money(fee)} a month` : ' with no monthly fee'}, against ${rateText(item.rate)}. Opening an account elsewhere takes time: check its terms first.`,
        search: { q: plan.name, plan: plan.planId },
      };
    }
    case 'over-limit': {
      const { items, providerName, insurer, held, limit } = suggestion;
      const own = (amount: number) => whole(amount, suggestion.currency);
      const by = insurer === 'none' ? 'Its insurer' : insurerNames[insurer];
      const accounts = items.map((item) => item.title).join(', ');
      return {
        key: `over-limit ${items.map((item) => item.itemId).join(' ')}`,
        warning: true,
        heading: `${own(held)} at ${providerName} is over ${by}'s ${own(limit)} limit`,
        detail: `${by} covers up to ${own(limit)} of these deposits at one institution, so ${own(held - limit)} isn't covered (${accounts}).`,
      };
    }
    case 'uninsured': {
      const { item, providerName } = suggestion;
      return {
        key: `uninsured ${item.itemId}`,
        warning: true,
        heading: `${whole(item.balance, suggestion.currency)} in ${item.title} has no deposit insurance`,
        detail: `${providerName}'s own page says no insurer covers it.`,
      };
    }
  }
}
