import type { IsoDate } from '../dates/iso-date';
import { addMonthsToMonth, type IsoMonth } from '../dates/iso-month';
import { itemCharges, type Charge } from '../schedule/charges';
import type { PaymentCard } from '../user/payment-card';
import type { ResolvedItem } from '../user/resolved';
import { cardCost } from './card-cost';
import { itemOnCard, type ItemLedger, type RewardsContext } from './card-ledger';

// A card's monthly limit (BLUEPRINT §9.3): a debit limit, or a credit limit paid in full each month. What's posted to
// it in a calendar month, its charges and their FX fees in its currency, counts against it, an annual plan in the month
// it's charged. A month over the limit flags the card's tile and the calendar days that take it over (P10, P11).

/** What's posted to each card in each of limitMonths, in its own currency, by card id. */
export type CardLoads = ReadonlyMap<string, readonly number[]>;

/** What's posted to each card by the items paid with it now (`item.cardId`), by card id: zeros for a card with none. */
export function cardLoads(
  ledgers: readonly ItemLedger[],
  cards: readonly PaymentCard[],
  context: RewardsContext,
): Map<string, number[]> {
  const loads = new Map(cards.map((card) => [card.id, Array<number>(12).fill(0)]));
  const byId = new Map(cards.map((card) => [card.id, card]));
  for (const ledger of ledgers) {
    const card = byId.get(ledger.resolved.item.cardId ?? '');
    const load = card && loads.get(card.id);
    if (!card || !load) continue;
    itemOnCard(ledger, card, context).posted.forEach((amount, index) => (load[index] += amount));
  }
  return loads;
}

/** Whether a month's `posted` fits under the card's limit: always, with no limit. */
export function fits(card: Pick<PaymentCard, 'monthlyLimit'>, posted: number): boolean {
  // A cent over isn't over: amounts keep full precision.
  return card.monthlyLimit === undefined || posted <= card.monthlyLimit + 0.005;
}

/** A month a card's charges go over its limit. */
export interface OverLimit {
  cardId: string;
  month: IsoMonth;
  /** What's posted that month, in the card's currency, and its limit. */
  posted: number;
  limit: number;
  /** The days of its charges past the limit: the one that goes over, and the ones after it that month. */
  days: IsoDate[];
  /** A converted amount is in it, so it's an estimate. */
  converted: boolean;
}

/**
 * The months in `months` that the items paid with each card now take over its limit, a card at a time in `cards`'
 * order, months in order. A charge with no rate to put it in the card's currency isn't counted.
 */
export function overLimits(
  items: readonly ResolvedItem[],
  cards: readonly PaymentCard[],
  months: readonly IsoMonth[],
  context: RewardsContext,
): OverLimit[] {
  if (months.length === 0) return [];
  const sorted = [...months].sort();
  const range = {
    from: `${sorted[0]}-01`,
    to: `${addMonthsToMonth(sorted[sorted.length - 1], 1)}-01`,
  };
  const found: OverLimit[] = [];
  for (const card of cards) {
    const limit = card.monthlyLimit;
    if (limit === undefined) continue;
    const charges: Charge[] = items
      .filter((resolved) => resolved.item.cardId === card.id)
      .flatMap((resolved) => itemCharges(resolved, range, context.place))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const month of sorted) {
      let posted = 0;
      let converted = false;
      const days: IsoDate[] = [];
      for (const charge of charges) {
        if (!charge.date.startsWith(month)) continue;
        const cost = cardCost(charge.charged, card, context.fx);
        if (!cost) continue;
        posted += cost.posted;
        converted ||= cost.converted || charge.converted;
        if (!fits(card, posted) && !days.includes(charge.date)) days.push(charge.date);
      }
      if (days.length > 0) found.push({ cardId: card.id, month, posted, limit, days, converted });
    }
  }
  return found;
}
