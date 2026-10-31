import type { Feature } from '../catalog/feature';
import { addMonths, type IsoDate } from '../dates/iso-date';
import { addMonthsToMonth, monthOf, type IsoMonth } from '../dates/iso-month';
import { featureSummary, rankCounts } from '../ranking/rank-summaries';
import type { TaxPlace } from '../tax/sales-tax-rate';
import type { RankCounts } from '../user/rank';
import type { FeatureSummaryRow, ResolvedItem } from '../user/resolved';
import type { DateRange } from './charge-dates';
import { itemCharges, type Charge } from './charges';

// Totals and budget checks (PROJECT-PLAN §3.1, M7.1): this month, this year and the next 12 months, each the sum of
// charges dated in it, sales tax included, in the user's currency; and the checks behind the budget warnings (M7.6).

/** What every total needs: the date, the user's currency, and where they pay tax. */
export interface MoneyContext {
  today: IsoDate;
  currency: string;
  /** Settings' country, province and own rate. */
  place: TaxPlace;
}

export interface MetricsContext extends MoneyContext {
  /** The feature registry, for the feature summary. */
  registry: readonly Feature[];
  monthlyBudget?: number;
  annualBudget?: number;
}

/** The calendar month `month`, its 1st up to the next month's. */
export function monthRange(month: IsoMonth): DateRange {
  return { from: `${month}-01`, to: `${addMonthsToMonth(month, 1)}-01` };
}

/** The calendar year `today` is in, Jan 1 up to the next Jan 1. */
export function yearRange(today: IsoDate): DateRange {
  const year = Number(today.slice(0, 4));
  return { from: `${today.slice(0, 4)}-01-01`, to: `${String(year + 1).padStart(4, '0')}-01-01` };
}

/** The next 12 months: from today up to, not including, the same day next year, so a yearly charge counts once. */
export function next12Range(today: IsoDate): DateRange {
  return { from: today, to: addMonths(today, 12) };
}

/** Every item's charges dated within `range`, in date order. */
export function chargesIn(
  items: readonly ResolvedItem[],
  range: DateRange,
  place: TaxPlace,
): Charge[] {
  return items
    .flatMap((item) => itemCharges(item, range, place))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** A sum of charges in the user's currency. */
export interface ChargeTotal {
  amount: number;
  /** It includes a converted amount, so it's shown with ≈. */
  approx: boolean;
}

/**
 * The charges in `currency` added up, at full precision. A charge in another currency, for want of an exchange rate,
 * can't be added and is left out: the totals' `notCounted` says so.
 */
export function chargeTotal(charges: readonly Charge[], currency: string): ChargeTotal {
  let amount = 0;
  let approx = false;
  for (const charge of charges) {
    if (charge.currency !== currency) continue;
    amount += charge.amount;
    approx ||= charge.converted;
  }
  return { amount, approx };
}

/** What a budget check found over budget (M7.6's banners). */
export interface BudgetWarnings {
  /** The first of the next 12 calendar months, this one included, whose charges go over the monthly budget. */
  month?: { month: IsoMonth } & ChargeTotal;
  /** This calendar year's charges, past and projected, when they go over the annual budget. */
  year?: { year: number } & ChargeTotal;
}

/** A list's money and ranks (PROJECT-PLAN §3.4), or every list's together. */
export interface ListMetrics {
  thisMonth: number;
  thisYear: number;
  next12: number;
  /** A total includes a converted amount. */
  approx: boolean;
  /** Which totals include a converted amount, each shown with ≈. */
  converted: { thisMonth: boolean; thisYear: boolean; next12: boolean };
  /**
   * Items the totals leave out: ones that can't be priced (UnresolvedItem), and ones with a charge in another
   * currency, for want of an exchange rate.
   */
  notCounted: number;
  /** Each item's share of `next12`, from 0 to 1, by item id: a card's "31% of list". None when next12 is 0. */
  shares: ReadonlyMap<string, number>;
  rankCounts: RankCounts;
  featureSummary: FeatureSummaryRow[];
  /**
   * The cash back this calendar year's charges earn on the cards they're paid with (M10.29): shown beside the totals,
   * never taken off them, since cards pay it later and not always monthly. 0 with no cash-back card.
   */
  cashback: { thisYear: number; approx: boolean };
  /** thisMonth ÷ the monthly budget, and thisYear ÷ the annual one, when they're set. */
  monthlyBudgetShare?: number;
  annualBudgetShare?: number;
  warnings: BudgetWarnings;
}

/**
 * The totals of `items` (one list's, or every list's for Home), their rank counts and feature summary, and the budget
 * checks (§3.1): a warning names the first of the next 12 calendar months whose charges go over the monthly budget,
 * and the year when this year's charges, past and projected, go over the annual one. Every item counts, duplicates
 * too (BLUEPRINT §8.1.1); `unresolved` ones are counted as left out.
 */
export function listMetrics(
  { resolved, unresolved }: { resolved: readonly ResolvedItem[]; unresolved: readonly unknown[] },
  context: MetricsContext,
): ListMetrics {
  const { today, currency, monthlyBudget, annualBudget } = context;
  const month = monthOf(today);
  const year = yearRange(today);
  const next12 = next12Range(today);
  // Every total and check falls from Jan 1 this year up to the later of the 13th month's 1st (the monthly checks) and
  // the same day next year (the next 12 months).
  const lastMonth = monthRange(addMonthsToMonth(month, 11)).to;
  const charges = chargesIn(
    resolved,
    { from: year.from, to: lastMonth > next12.to ? lastMonth : next12.to },
    context.place,
  );
  const within = ({ from, to }: DateRange) =>
    charges.filter((charge) => charge.date >= from && charge.date < to);
  const thisMonth = chargeTotal(within(monthRange(month)), currency);
  const thisYear = chargeTotal(within(year), currency);
  const cashback = { thisYear: 0, approx: false };
  for (const charge of within(year)) {
    if (charge.currency !== currency || charge.cashback === undefined) continue;
    cashback.thisYear += charge.cashback;
    cashback.approx ||= charge.converted;
  }
  const coming = within(next12);
  const total12 = chargeTotal(coming, currency);

  const shares = new Map<string, number>();
  if (total12.amount > 0) {
    for (const charge of coming) {
      if (charge.currency !== currency) continue;
      shares.set(charge.itemId, (shares.get(charge.itemId) ?? 0) + charge.amount / total12.amount);
    }
  }
  const leftOut = new Set(
    charges.filter((charge) => charge.currency !== currency).map((charge) => charge.itemId),
  );

  const warnings: BudgetWarnings = {};
  if (monthlyBudget !== undefined) {
    for (let offset = 0; offset < 12; offset++) {
      const candidate = addMonthsToMonth(month, offset);
      const total = chargeTotal(within(monthRange(candidate)), currency);
      if (total.amount > monthlyBudget) {
        warnings.month = { month: candidate, ...total };
        break;
      }
    }
  }
  if (annualBudget !== undefined && thisYear.amount > annualBudget) {
    warnings.year = { year: Number(today.slice(0, 4)), ...thisYear };
  }

  return {
    thisMonth: thisMonth.amount,
    thisYear: thisYear.amount,
    next12: total12.amount,
    approx: thisMonth.approx || thisYear.approx || total12.approx,
    converted: { thisMonth: thisMonth.approx, thisYear: thisYear.approx, next12: total12.approx },
    notCounted: unresolved.length + leftOut.size,
    shares,
    rankCounts: rankCounts(resolved),
    featureSummary: featureSummary(resolved, context.registry, today),
    cashback,
    ...(monthlyBudget !== undefined && { monthlyBudgetShare: thisMonth.amount / monthlyBudget }),
    ...(annualBudget !== undefined && { annualBudgetShare: thisYear.amount / annualBudget }),
    warnings,
  };
}
