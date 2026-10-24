import type { Price } from './price';

/**
 * A price per month (PROJECT-PLAN §3.1): year ÷ 12, week × 52 ÷ 12, day × 365 ÷ 12, each ÷ intervalCount. Kept at
 * full precision; only the UI rounds.
 */
export function monthlyEquivalent(
  price: Pick<Price, 'amount' | 'interval' | 'intervalCount'>,
): number {
  const { amount, interval, intervalCount } = price;
  switch (interval) {
    case 'day':
      return (amount * 365) / 12 / intervalCount;
    case 'week':
      return (amount * 52) / 12 / intervalCount;
    case 'month':
      return amount / intervalCount;
    case 'year':
      return amount / 12 / intervalCount;
  }
}
