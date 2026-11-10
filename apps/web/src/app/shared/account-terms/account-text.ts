import {
  daysBetween,
  type Account,
  type AccountCondition,
  type AccountKind,
  type FollowedChange,
} from '@simply-sub/core';
import { dateText } from '../date-text';
import { amountText, wholeAmountText } from '../price-tag/price-text';

// How a finance account's terms read on a card (M11.10, BLUEPRINT §4.11): plain sentences built from its account
// block, money in the user's country's way, as price tags write it.

export const accountKindNames: Record<AccountKind, string> = {
  chequing: 'Chequing account',
  savings: 'Savings account',
  usd: 'US dollar account',
  tfsa: 'TFSA',
  rrsp: 'RRSP',
  fhsa: 'FHSA',
  resp: 'RESP',
  rdsp: 'RDSP',
  rrif: 'RRIF',
  lira: 'LIRA',
  gic: 'GIC',
  investing: 'Investing account',
};

const insurerNames: Record<Account['protection']['insurer'], string> = {
  cdic: 'CDIC',
  provincial: 'a provincial deposit insurer',
  cipf: 'CIPF, if the dealer fails',
  none: 'No deposit insurance',
};

const heldNames: Record<Account['protection']['held'], string> = {
  'own-name': 'in your name',
  trust: 'held in trust for you',
  company: 'in the company’s own name',
};

/** "A, B and C" (or "or"). */
function listText(items: readonly string[], conjunction: 'and' | 'or'): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
    : (items[0] ?? '');
}

/** "2.25%". */
export function rateText(rate: number): string {
  return `${rate.toFixed(2)}%`;
}

/** What a condition takes, as the end of "if …": "you keep $4,000 in it and you’re a student". */
export function conditionText(
  condition: AccountCondition,
  currency: string,
  country: string | undefined,
): string {
  const money = (amount: number) => wholeAmountText(amount, currency, country);
  const parts = [
    condition.minBalance !== undefined && `you keep ${money(condition.minBalance)} in it`,
    condition.directDeposit === true && 'you have a direct deposit',
    typeof condition.directDeposit === 'number' &&
      `you have ${money(condition.directDeposit)} of direct deposits a month`,
    condition.monthlyDeposits !== undefined &&
      `you add ${money(condition.monthlyDeposits)} a month`,
    condition.minAssets !== undefined && `you hold ${money(condition.minAssets)} with it`,
    condition.maxAge !== undefined && `you’re ${condition.maxAge} or under`,
    condition.minAge !== undefined && `you’re ${condition.minAge} or over`,
    condition.student && 'you’re a student',
    condition.newcomer && 'you’re new to Canada',
  ].filter((part): part is string => typeof part === 'string');
  return listText(parts, 'and');
}

/** The posted interest: "2.00% a year, on the whole balance" or by tier, with what it moves with and its bonus. */
export function ratesText(
  rates: NonNullable<Account['rates']>,
  currency: string,
  country: string | undefined,
): string {
  const [first, ...higher] = rates.tiers;
  const tiers = [
    `${rateText(first?.rate ?? 0)} a year`,
    ...higher.map(
      (tier) => `${rateText(tier.rate)} from ${wholeAmountText(tier.from, currency, country)}`,
    ),
  ].join(', ');
  const applies =
    higher.length === 0
      ? ''
      : rates.applies === 'whole'
        ? ', on the whole balance'
        : ', on each part of the balance';
  const follows =
    rates.follows === 'prime'
      ? '. It moves with the prime rate'
      : rates.follows === 'boc-overnight'
        ? '. It moves with the Bank of Canada’s rate'
        : '';
  const bonus = rates.bonus
    ? `. ${rateText(rates.bonus.rate)} instead if ${conditionText(rates.bonus.when, currency, country)}`
    : '';
  return `${tiers}${applies}${follows}${bonus}`;
}

/**
 * How soon the rate followed the Bank of Canada's last changes (M11.14), newest first: "1 day after Jun 4, 2026; the
 * same day as Mar 12, 2026; not after Jan 29, 2026". Each change is the Bank's, to the rate it names.
 */
export function followedText(followed: readonly FollowedChange[]): string {
  return followed
    .map(({ change, rate, on, pending }) => {
      const when = `${dateText(change)} (to ${rateText(rate)})`;
      if (on === undefined) return pending ? `not yet after ${when}` : `not after ${when}`;
      const days = daysBetween(change, on);
      return days === 0
        ? `the same day as ${when}`
        : `${days === 1 ? '1 day' : `${days} days`} after ${when}`;
    })
    .join('; ');
}

/** "No monthly fee if you keep $4,000 in it, or you’re a student". */
export function waiversText(
  waivers: readonly AccountCondition[],
  currency: string,
  country: string | undefined,
): string {
  return `No monthly fee if ${listText(
    waivers.map((waiver) => conditionText(waiver, currency, country)),
    'or',
  )}`;
}

/** Each limit as a line: "e-Transfers: up to $3,000 a day, $10,000 a week". */
export function limitLines(
  limits: NonNullable<Account['limits']>,
  currency: string,
  country: string | undefined,
): string[] {
  const money = (amount: number) => wholeAmountText(amount, currency, country);
  const period = (name: string, values: NonNullable<typeof limits.eTransfer>) =>
    `${name}: up to ${[
      values.transaction !== undefined && `${money(values.transaction)} at once`,
      values.day !== undefined && `${money(values.day)} a day`,
      values.week !== undefined && `${money(values.week)} a week`,
      values.month !== undefined && `${money(values.month)} a month`,
      values.year !== undefined && `${money(values.year)} a year`,
    ]
      .filter((part): part is string => typeof part === 'string')
      .join(', ')}`;
  return [
    ...(limits.debits !== undefined ? [`${limits.debits} transactions a month included`] : []),
    ...(limits.eTransfer ? [period('e-Transfers', limits.eTransfer)] : []),
    ...(limits.atmWithdrawal ? [period('ATM withdrawals', limits.atmWithdrawal)] : []),
    ...(limits.purchases ? [period('Card purchases', limits.purchases)] : []),
  ];
}

/** "CDIC, up to $100,000, held in trust for you, through Peoples Trust Company". */
export function protectionText(
  protection: Account['protection'],
  currency: string,
  country: string | undefined,
): string {
  if (protection.insurer === 'none') return `${insurerNames.none}, ${heldNames[protection.held]}`;
  const limit =
    protection.limit === undefined
      ? ''
      : `, up to ${wholeAmountText(protection.limit, currency, country)}`;
  // Whose cover it is, when another institution holds the money (2026-11-10).
  const through = protection.through ? `, through ${listText(protection.through, 'and')}` : '';
  return `${insurerNames[protection.insurer]}${limit}, ${heldNames[protection.held]}${through}`;
}

const feePeriods: Record<NonNullable<Account['fees']>['items'][number]['per'], string> = {
  use: 'each',
  month: 'a month',
  year: 'a year',
};

/**
 * Its fees beyond the monthly one (2026-11-10), in a line: "Interac e-Transfer $1.50 each; Foreign exchange 2.50% of the
 * amount; Paper statements $2.00 a month".
 */
export function feesText(
  fees: NonNullable<Account['fees']>,
  currency: string,
  country: string | undefined,
): string {
  return fees.items
    .map((fee) => {
      const parts = [
        fee.amount !== undefined && amountText(fee.amount, currency, country),
        fee.percent !== undefined && `${rateText(fee.percent)} of the amount`,
      ].filter((part): part is string => typeof part === 'string');
      const per = fee.amount !== undefined ? ` ${feePeriods[fee.per]}` : '';
      return `${fee.name} ${parts.join(' plus ')}${per}`;
    })
    .join('; ');
}
