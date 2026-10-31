import type { Charge, Charged } from './charges';

// What a budget bar adds up (PROJECT-PLAN M10.30): its period's charges by subscription, each split into the price before
// tax, the sales tax and the card's FX fee, with what the provider charges and the rate for a converted one.

/** One subscription's charges in the period. */
export interface BreakdownLine {
  itemId: string;
  /** How many charges it has in the period. */
  count: number;
  /** Before tax and fees: the charges' amounts less their tax and FX fees. */
  price: number;
  tax: number;
  fxFee: number;
  /** price + tax + fxFee: what leaves the account. */
  total: number;
  /** A converted amount is in it, so it's an estimate. */
  converted: boolean;
  /**
   * For charges in another currency than the user's: what the provider charges, tax included, and how much of the
   * user's currency one unit of it is worth, at the rate used.
   */
  charged?: Charged & { rate: number };
}

export interface CostBreakdown {
  /** Biggest total first, then by item id. */
  lines: BreakdownLine[];
  price: number;
  tax: number;
  fxFee: number;
  total: number;
  converted: boolean;
}

/**
 * The charges in `currency` (one in another, for want of a rate, can't be added: the totals leave it out too), by
 * subscription, and their sums.
 */
export function costBreakdown(charges: readonly Charge[], currency: string): CostBreakdown {
  const lines = new Map<string, BreakdownLine>();
  for (const charge of charges) {
    if (charge.currency !== currency) continue;
    const fxFee = charge.fxFee ?? 0;
    const line = lines.get(charge.itemId) ?? {
      itemId: charge.itemId,
      count: 0,
      price: 0,
      tax: 0,
      fxFee: 0,
      total: 0,
      converted: false,
    };
    line.count += 1;
    line.price += charge.amount - charge.tax - fxFee;
    line.tax += charge.tax;
    line.fxFee += fxFee;
    line.total += charge.amount;
    line.converted ||= charge.converted;
    if (charge.charged.currency !== currency) {
      const amount = (line.charged?.amount ?? 0) + charge.charged.amount;
      // Both tax included: what it came to here, less the card's fee, over what was charged there.
      const converted =
        (line.charged ? line.charged.amount * line.charged.rate : 0) + charge.amount - fxFee;
      line.charged = { amount, currency: charge.charged.currency, rate: converted / amount };
    }
    lines.set(charge.itemId, line);
  }
  const all = [...lines.values()].sort(
    (a, b) => b.total - a.total || (a.itemId < b.itemId ? -1 : 1),
  );
  const sum = (key: 'price' | 'tax' | 'fxFee' | 'total') =>
    all.reduce((total, line) => total + line[key], 0);
  return {
    lines: all,
    price: sum('price'),
    tax: sum('tax'),
    fxFee: sum('fxFee'),
    total: sum('total'),
    converted: all.some((line) => line.converted),
  };
}
