import { convert, type FxRates } from '../catalog/convert';
import { monthOf } from '../dates/iso-month';
import { chargesIn, monthRange, type MoneyContext } from '../schedule/list-metrics';
import { itemTitle } from '../user/item-text';
import { monthlyWithTax } from '../user/monthly-average';
import type { PaymentCard } from '../user/payment-card';
import type { ResolvedItem } from '../user/resolved';

// What a card's tile on the Payment page shows (PROJECT-PLAN P11, M9.1): the subscriptions paid with it, each with what
// it costs a month with sales tax, their total, and this month's charges paid with it against its monthly limit.

/** A subscription paid with the card. */
export interface CardSubscription {
  itemId: string;
  listId: string;
  /** itemTitle: "Netflix Standard", "Mom's (Netflix Standard)". */
  title: string;
  /** What it costs a month today with sales tax (monthlyWithTax), in the user's currency; none for want of a rate. */
  monthly?: number;
  converted: boolean;
}

export interface CardSummary {
  /** The items paid with it, in the order they were added. */
  subscriptions: CardSubscription[];
  /** Their monthly costs added up, in the user's currency; `notCounted` are left out, for want of a rate. */
  monthly: number;
  monthlyApprox: boolean;
  notCounted: number;
  /**
   * This month's charges paid with it, in the card's currency: what counts against its monthly limit. Charges in
   * another currency are converted at the ECB rate; one with no rate is left out and counted in `thisMonthLeftOut`.
   */
  thisMonth: number;
  thisMonthApprox: boolean;
  thisMonthLeftOut: number;
}

/** What a card's figures need: today, the user's currency and tax place, and the rates. */
export interface CardSummaryContext extends MoneyContext {
  fx?: FxRates;
}

/** The tile's figures for `card`, from every list's resolved items (the ones paid with it are picked out). */
export function cardSummary(
  card: Pick<PaymentCard, 'id' | 'currency'>,
  items: readonly ResolvedItem[],
  context: CardSummaryContext,
): CardSummary {
  const paid = items.filter((resolved) => resolved.item.cardId === card.id);
  const subscriptions = paid.map((resolved): CardSubscription => {
    const monthly = monthlyWithTax(resolved, context.currency, context.place);
    return {
      itemId: resolved.item.id,
      listId: resolved.listId,
      title: itemTitle(resolved),
      ...(monthly && { monthly: monthly.amount }),
      converted: monthly?.converted ?? false,
    };
  });
  let monthly = 0;
  let notCounted = 0;
  for (const subscription of subscriptions) {
    if (subscription.monthly === undefined) notCounted++;
    else monthly += subscription.monthly;
  }

  let thisMonth = 0;
  let thisMonthApprox = false;
  let thisMonthLeftOut = 0;
  for (const charge of chargesIn(paid, monthRange(monthOf(context.today)), context.place)) {
    const same = charge.currency === card.currency;
    const amount = same
      ? charge.amount
      : context.fx && convert(charge.amount, charge.currency, card.currency, context.fx);
    if (amount === undefined) {
      thisMonthLeftOut++;
      continue;
    }
    thisMonth += amount;
    thisMonthApprox ||= charge.converted || !same;
  }
  return {
    subscriptions,
    monthly,
    monthlyApprox: subscriptions.some((subscription) => subscription.converted),
    notCounted,
    thisMonth,
    thisMonthApprox,
    thisMonthLeftOut,
  };
}
