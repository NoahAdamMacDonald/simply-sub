import { monthOf } from '../dates/iso-month';
import { chargesIn, monthRange } from '../schedule/list-metrics';
import { itemTitle } from '../user/item-text';
import type { PaymentCard } from '../user/payment-card';
import type { ResolvedItem } from '../user/resolved';
import { cardCost } from './card-cost';
import { limitMonths, type RewardsContext } from './card-ledger';
import { overLimits, type OverLimit } from './card-limits';
import { monthlyOnCard } from './monthly-on-card';

// What a card's tile on the Payment page shows (PROJECT-PLAN P11, M9.1, M9.3): the subscriptions paid with it, each with
// what it costs a month with sales tax, their total and what it comes to after the card's cash back and FX fees; this
// month's charges posted to it against its monthly limit; and the months of the next 12 its charges go over it.

/** A subscription paid with the card. */
export interface CardSubscription {
  itemId: string;
  listId: string;
  /** itemTitle: "Netflix Standard", "Mom's (Netflix Standard)". */
  title: string;
  /** What it costs a month today with sales tax (monthlyWithTax), in the user's currency; none for want of a rate. */
  monthly?: number;
  /** The same after the card's cash back and FX fees. */
  net?: number;
  converted: boolean;
}

export interface CardSummary {
  /** The items paid with it, in the order they were added. */
  subscriptions: CardSubscription[];
  /** Their monthly costs added up, in the user's currency; `notCounted` are left out, for want of a rate. */
  monthly: number;
  /** The same after the card's cash back and FX fees. */
  net: number;
  monthlyApprox: boolean;
  notCounted: number;
  /**
   * This month's charges paid with it as posted to it, in the card's currency, FX fees included: what counts against
   * its limit (BLUEPRINT §9.3). One with no rate to put it in the card's currency is left out and counted in
   * `thisMonthLeftOut`.
   */
  thisMonth: number;
  thisMonthApprox: boolean;
  thisMonthLeftOut: number;
  /** The months of the 12 from this one that its charges go over its limit. */
  overLimit: OverLimit[];
}

/** What a card's figures need: today, the user's currency and tax place, and the rates. */
export type CardSummaryContext = RewardsContext;

/** The tile's figures for `card`, from every list's resolved items (the ones paid with it are picked out). */
export function cardSummary(
  card: PaymentCard,
  items: readonly ResolvedItem[],
  context: CardSummaryContext,
): CardSummary {
  const paid = items.filter((resolved) => resolved.item.cardId === card.id);
  const subscriptions = paid.map((resolved): CardSubscription => {
    const month = monthlyOnCard(resolved, card, context);
    const gross = month ?? monthlyOnCard(resolved, undefined, context);
    return {
      itemId: resolved.item.id,
      listId: resolved.listId,
      title: itemTitle(resolved),
      ...(gross && { monthly: gross.gross }),
      ...(month && { net: month.net }),
      converted: gross?.converted ?? false,
    };
  });
  let monthly = 0;
  let net = 0;
  let notCounted = 0;
  for (const subscription of subscriptions) {
    if (subscription.monthly === undefined || subscription.net === undefined) {
      notCounted++;
      continue;
    }
    monthly += subscription.monthly;
    net += subscription.net;
  }

  let thisMonth = 0;
  let thisMonthApprox = false;
  let thisMonthLeftOut = 0;
  for (const charge of chargesIn(paid, monthRange(monthOf(context.today)), context.place)) {
    const cost = cardCost(charge.charged, card, context.fx);
    if (!cost) {
      thisMonthLeftOut++;
      continue;
    }
    thisMonth += cost.posted;
    thisMonthApprox ||= charge.converted || cost.converted;
  }
  return {
    subscriptions,
    monthly,
    net,
    monthlyApprox: subscriptions.some((subscription) => subscription.converted),
    notCounted,
    thisMonth,
    thisMonthApprox,
    thisMonthLeftOut,
    overLimit: overLimits(paid, [card], limitMonths(context.today), context),
  };
}
