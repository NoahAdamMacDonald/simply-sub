import { monthlyParts } from '../user/monthly-average';
import type { PaymentCard } from '../user/payment-card';
import type { ResolvedItem } from '../user/resolved';
import { cardCost, type CardTerms } from './card-cost';
import { inUserCurrency, type RewardsContext } from './card-ledger';
import { eligibleCards, type EligibleCard } from './eligibility';

// What an item costs a month on a card (PROJECT-PLAN P4, P6, P11): today's monthly equivalent with sales tax, the
// figure P4 shows beside the before-tax average (the user's choice for M9), and the same after the card's cash back and
// FX fees (BLUEPRINT §9.3), so net = gross + FX fee − cash back.

/** A month of an item on a card, in the user's currency. */
export interface MonthlyOnCard {
  /** What it costs a month with tax: monthlyWithTax. */
  gross: number;
  fxFee: number;
  cashback: number;
  /** gross + fxFee − cashback; the gross with no card. */
  net: number;
  /** A converted amount is in it, so it's an estimate. */
  converted: boolean;
}

/** `resolved` a month on `card`, or with none; undefined for want of a rate. */
export function monthlyOnCard(
  resolved: ResolvedItem,
  card: CardTerms | undefined,
  context: RewardsContext,
): MonthlyOnCard | undefined {
  const parts = monthlyParts(resolved, context.currency, context.place);
  if (!parts) return undefined;
  let gross = 0;
  let fxFee = 0;
  let cashback = 0;
  let converted = false;
  for (const part of parts) {
    gross += part.amount;
    converted ||= part.converted;
    if (!card || part.charged.amount === 0) continue;
    const cost = cardCost(part.charged, card, context.fx);
    if (!cost) return undefined;
    // What the card adds and gives back, in the user's currency: the charge itself is the part's amount.
    const fee = inUserCurrency(cost.fxFee, card.currency, context);
    const back = inUserCurrency(cost.cashback, card.currency, context);
    if (fee === undefined || back === undefined) return undefined;
    fxFee += fee;
    cashback += back;
    converted ||= cost.converted || card.currency !== context.currency;
  }
  return { gross, fxFee, cashback, net: gross + fxFee - cashback, converted };
}

/** A card the item dialog offers for an item (P6): one its seller takes, or might, and its month there. */
export interface CardChoice<C extends PaymentCard = PaymentCard> extends EligibleCard<C> {
  /** Undefined for want of a rate. */
  monthly?: MonthlyOnCard;
}

/** The cards that can pay for the item, in `cards`' order, each with its month there. */
export function cardChoices<C extends PaymentCard>(
  resolved: ResolvedItem,
  cards: readonly C[],
  context: RewardsContext,
): CardChoice<C>[] {
  return eligibleCards(cards, resolved).map((eligible) => {
    const monthly = monthlyOnCard(resolved, eligible.card, context);
    return { ...eligible, ...(monthly && { monthly }) };
  });
}

/** The best card for an item, and what it saves a month over the one chosen. */
export interface BestCard<C extends PaymentCard = PaymentCard> {
  choice: CardChoice<C>;
  /** A month, in the user's currency. */
  saving: number;
  estimated: boolean;
}

/**
 * The card among `choices` with the lowest net a month, when it saves at least a cent a month over `chosen` (a card
 * id, or none): its gross with no card. Undefined when `chosen` is the best already, or nothing can be compared.
 */
export function bestCard<C extends PaymentCard>(
  choices: readonly CardChoice<C>[],
  chosen: string | undefined,
  resolved: ResolvedItem,
  context: RewardsContext,
): BestCard<C> | undefined {
  const current =
    chosen === undefined
      ? monthlyOnCard(resolved, undefined, context)
      : choices.find((choice) => choice.card.id === chosen)?.monthly;
  if (!current) return undefined;
  let best: CardChoice<C> | undefined;
  for (const choice of choices) {
    if (choice.monthly && (!best?.monthly || choice.monthly.net < best.monthly.net - 1e-9)) {
      best = choice;
    }
  }
  if (!best?.monthly || best.card.id === chosen) return undefined;
  const saving = current.net - best.monthly.net;
  return saving >= 0.01
    ? { choice: best, saving, estimated: current.converted || best.monthly.converted }
    : undefined;
}
