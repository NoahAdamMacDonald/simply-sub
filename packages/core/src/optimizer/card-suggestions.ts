import {
  itemLedger,
  itemOnCard,
  type ItemLedger,
  type RewardsContext,
} from '../rewards/card-ledger';
import { fits, type CardLoads } from '../rewards/card-limits';
import { eligibleCards } from '../rewards/eligibility';
import { cardTitle } from '../user/card-rules';
import type { PaymentCard } from '../user/payment-card';
import { fingerprintOf } from './fingerprint';
import { savingEpsilon, type OptimizerModel } from './model';
import type { Suggestion } from './suggestion';

// The optimizer's 7th action (BLUEPRINT §10.3, §9.3): paying for an item with a better card, which loses nothing, so
// it's a free saving, for any item, an Essential plan's too (§10.2 allows it). Each item's best card is the one its
// seller takes that leaves the least to pay over the next 12 months after cash back and FX fees, and that has room for
// its charges in every one of the 12 calendar months from this one, on top of what's on it now (other lists' items
// and this list's). The items it saves the most for choose first, and each suggestion's charges count against the
// cards the ones after it look at, never freeing room, so every suggestion fits alone and all of them together.

/**
 * The user's cards and the room on them: what's posted to each in each of the 12 calendar months from this one, by the
 * other lists' items and this list's, which the suggestions add theirs to as they're made, so they all fit together.
 */
export interface CardRoom {
  cards: readonly PaymentCard[];
  byId: ReadonlyMap<string, PaymentCard>;
  /** Each item's charges, by its index in the model. */
  ledgers: readonly ItemLedger[];
  loads: Map<string, number[]>;
}

export function cardRoom(
  model: OptimizerModel,
  cards: readonly PaymentCard[],
  outside: CardLoads | undefined,
  context: RewardsContext,
): CardRoom {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const loads = new Map(
    cards.map((card) => [card.id, [...(outside?.get(card.id) ?? Array<number>(12).fill(0))]]),
  );
  const ledgers = model.items.map((item) => itemLedger(item.resolved, context));
  ledgers.forEach((ledger) => {
    const card = byId.get(ledger.resolved.item.cardId ?? '');
    const load = card && loads.get(card.id);
    if (card && load) {
      itemOnCard(ledger, card, context).posted.forEach((amount, month) => (load[month] += amount));
    }
  });
  return { cards, byId, ledgers, loads };
}

export function cardSuggestions(
  model: OptimizerModel,
  { cards, byId, ledgers, loads }: CardRoom,
  context: RewardsContext,
  list: string,
): Suggestion[] {
  const moves = model.items
    .flatMap((item, index) => {
      const ledger = ledgers[index];
      const current = byId.get(item.resolved.item.cardId ?? '');
      const now = itemOnCard(ledger, current, context);
      // Nothing to pay in the next 12 months, or a charge it can't compare for want of a rate.
      if (now.leftOut > 0 || now.gross <= 0) return [];
      const better = eligibleCards(cards, item.resolved)
        .filter(({ card }) => card.id !== current?.id)
        .map(({ card }) => ({ card, on: itemOnCard(ledger, card, context) }))
        .filter(({ on }) => on.leftOut === 0 && now.net - on.net >= savingEpsilon)
        .sort((a, b) => a.on.net - b.on.net);
      return better.length > 0 ? [{ item, current, now, better }] : [];
    })
    .sort(
      (a, b) =>
        b.now.net - b.better[0].on.net - (a.now.net - a.better[0].on.net) ||
        a.item.index - b.item.index,
    );

  const suggestions: Suggestion[] = [];
  for (const { item, current, now, better } of moves) {
    const choice = better.find(({ card, on }) => {
      const load = loads.get(card.id) ?? [];
      return on.posted.every((amount, month) => fits(card, (load[month] ?? 0) + amount));
    });
    if (!choice) continue;
    const load = loads.get(choice.card.id);
    if (load) choice.on.posted.forEach((amount, month) => (load[month] += amount));
    const savings = now.net - choice.on.net;
    const next12 = model.baseline - savings;
    suggestions.push({
      fingerprint: fingerprintOf(
        list,
        `card ${item.resolved.item.id} ${current?.id ?? '-'} ${choice.card.id}`,
      ),
      severity: 'free',
      actions: [
        {
          kind: 'card',
          item: item.suggested,
          cardId: choice.card.id,
          cardTitle: cardTitle(choice.card),
          ...(current && { fromCardTitle: cardTitle(current) }),
        },
      ],
      savings,
      next12,
      monthly: next12 / 12,
      estimated: now.converted || choice.on.converted,
      lost: [],
      lostServices: [],
      gained: [],
    });
  }
  return suggestions;
}
