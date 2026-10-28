import { itemTitle } from '../user/item-text';
import type { PaymentCard } from '../user/payment-card';
import type { ResolvedItem } from '../user/resolved';
import {
  itemLedger,
  itemOnCard,
  type ItemLedger,
  type ItemOnCard,
  type RewardsContext,
} from './card-ledger';
import { fits } from './card-limits';
import { eligibleCards } from './eligibility';

// Assign best cards (PROJECT-PLAN P11, BLUEPRINT §9.3): a card for each subscription, in every list, that makes the most
// of the cards' cash back less their FX fees over the next 12 months, within each card's monthly limit in each of the
// 12 calendar months from this one, and only with cards the seller takes. Greedy, then a pass of moves and swaps:
// - the items with the most to lose go first: the biggest difference between their best card and the next (an item
//   with one card possible goes before them all);
// - each takes its best card that still has room in every month;
// - then an item moves to a better card with room, or two swap cards, while that saves more.
// An item with a card always keeps one: it moves only to a card that's better for it, or that it can use at all. One
// with no card gets one only when it pays more back than it costs in FX fees. One whose card can't change (its list has
// unsaved edits, P11) keeps it, and its charges count against that card's limit.

/** What the assignment works on. */
export interface CardAssignmentInput {
  /** Every list's saved items, priced: each one's own card is its `item.cardId`. */
  items: readonly ResolvedItem[];
  cards: readonly PaymentCard[];
  /** The items whose card stays as it is: the ones in lists with unsaved edits. */
  fixed?: ReadonlySet<string>;
  context: RewardsContext;
}

/** A card an item moves to, and what that saves. */
export interface CardChange {
  itemId: string;
  listId: string;
  /** itemTitle: "Netflix Standard", "Mom's (Netflix Standard)". */
  title: string;
  /** Its card now, if it has one, and the one it moves to. */
  from?: string;
  to: string;
  /** What the move saves over the next 12 months, in the user's currency: cash back less FX fees, both ways. */
  savings: number;
  /** Converted amounts are in it. */
  estimated: boolean;
}

export interface CardAssignment {
  /** The items whose card changes, in `items`' order. */
  changes: CardChange[];
  /** What the changes save over the next 12 months together, in the user's currency. */
  savings: number;
  estimated: boolean;
}

/** An item the assignment can move, with each card it can take and what it comes to there. */
interface Movable {
  index: number;
  /** Its card now: a card id, or undefined. */
  current: string | undefined;
  /** Its card in the assignment so far. */
  assigned: string | undefined;
  /** The cards it can take, best first: what each saves on the next 12 months with no card. */
  options: { cardId: string; on: ItemOnCard; saving: number }[];
  /** With no card. */
  bare: ItemOnCard;
  /** On its card now, when it has one. */
  own?: ItemOnCard;
}

const epsilon = 0.005;

export function assignCards(input: CardAssignmentInput): CardAssignment {
  const { cards, context } = input;
  const byId = new Map(cards.map((card) => [card.id, card]));
  const ledgers: ItemLedger[] = input.items.map((resolved) => itemLedger(resolved, context));
  const loads = new Map(cards.map((card) => [card.id, Array<number>(12).fill(0)]));
  const addLoad = (cardId: string | undefined, posted: readonly number[], sign: 1 | -1) => {
    const load = cardId === undefined ? undefined : loads.get(cardId);
    if (load) posted.forEach((amount, month) => (load[month] += sign * amount));
  };
  const hasRoom = (cardId: string, posted: readonly number[], minus?: readonly number[]) => {
    const card = byId.get(cardId);
    const load = loads.get(cardId);
    return (
      card !== undefined &&
      load !== undefined &&
      posted.every((amount, month) => fits(card, load[month] + amount - (minus?.[month] ?? 0)))
    );
  };

  const movable: Movable[] = [];
  ledgers.forEach((ledger, index) => {
    const { item } = ledger.resolved;
    const current = item.cardId !== undefined && byId.has(item.cardId) ? item.cardId : undefined;
    const bare = itemOnCard(ledger, undefined, context);
    // In the cards' order where they save the same (the sort is stable).
    const options = eligibleCards(cards, ledger.resolved)
      .map(({ card }) => {
        const on = itemOnCard(ledger, card, context);
        return { cardId: card.id, on, saving: bare.gross - on.net };
      })
      .filter(({ on }) => on.leftOut === 0)
      .sort((a, b) => b.saving - a.saving);
    const own =
      current === undefined
        ? undefined
        : (options.find((option) => option.cardId === current)?.on ??
          itemOnCard(ledger, byId.get(current), context));
    // With no card now, only a card that pays back more than its fees is worth taking.
    const worth =
      current === undefined ? options.filter((option) => option.saving > epsilon) : options;
    if (input.fixed?.has(item.id) === true || bare.leftOut > 0 || worth.length === 0) {
      // Its card stays, and so does its load on it.
      if (own) addLoad(current, own.posted, 1);
      return;
    }
    movable.push({
      index,
      current,
      assigned: undefined,
      options: worth,
      bare,
      ...(own && { own }),
    });
  });

  // Greedy: the most to lose first.
  const regret = (item: Movable) => {
    const [best, next] = item.options;
    const fallback = next?.saving ?? (item.current === undefined ? 0 : -Infinity);
    return best.saving - fallback;
  };
  const order = [...movable].sort(
    (a, b) =>
      regret(b) - regret(a) || b.options[0].saving - a.options[0].saving || a.index - b.index,
  );
  for (const item of order) {
    const choice = item.options.find((option) => hasRoom(option.cardId, option.on.posted));
    // No card with room: it keeps its own (over the limit, if that's where it was).
    const cardId = choice?.cardId ?? item.current;
    const posted = choice?.on.posted ?? postedOn(item, cardId);
    item.assigned = cardId;
    addLoad(cardId, posted, 1);
  }

  // Moves and swaps while they save more, a few rounds at most. A card the seller doesn't take is the worst there is.
  const savingOf = (item: Movable, cardId: string | undefined) =>
    cardId === undefined
      ? 0
      : (item.options.find((option) => option.cardId === cardId)?.saving ?? -Infinity);
  for (let round = 0; round < 4; round++) {
    let improved = false;
    for (const item of movable) {
      for (const option of item.options) {
        if (option.cardId === item.assigned) break;
        if (option.saving <= savingOf(item, item.assigned) + epsilon) break;
        if (!hasRoom(option.cardId, option.on.posted)) continue;
        addLoad(item.assigned, postedOn(item, item.assigned), -1);
        addLoad(option.cardId, option.on.posted, 1);
        item.assigned = option.cardId;
        improved = true;
        break;
      }
    }
    for (const a of movable) {
      for (const b of movable) {
        if (a === b || a.assigned === undefined || b.assigned === undefined) continue;
        if (a.assigned === b.assigned) continue;
        const aOnB = a.options.find((option) => option.cardId === b.assigned);
        const bOnA = b.options.find((option) => option.cardId === a.assigned);
        if (!aOnB || !bOnA) continue;
        const gain = aOnB.saving + bOnA.saving - savingOf(a, a.assigned) - savingOf(b, b.assigned);
        if (gain <= epsilon) continue;
        const aPosted = postedOn(a, a.assigned);
        const bPosted = postedOn(b, b.assigned);
        if (
          !hasRoom(b.assigned, aOnB.on.posted, bPosted) ||
          !hasRoom(a.assigned, bOnA.on.posted, aPosted)
        ) {
          continue;
        }
        addLoad(a.assigned, aPosted, -1);
        addLoad(b.assigned, bPosted, -1);
        addLoad(b.assigned, aOnB.on.posted, 1);
        addLoad(a.assigned, bOnA.on.posted, 1);
        [a.assigned, b.assigned] = [b.assigned, a.assigned];
        improved = true;
      }
    }
    if (!improved) break;
  }

  const changes: CardChange[] = [];
  for (const item of movable) {
    if (item.assigned === undefined || item.assigned === item.current) continue;
    const resolved = ledgers[item.index].resolved;
    const to = item.options.find((option) => option.cardId === item.assigned);
    if (!to) continue;
    const before = item.own ?? item.bare;
    changes.push({
      itemId: resolved.item.id,
      listId: resolved.listId,
      title: itemTitle(resolved),
      ...(item.current !== undefined && { from: item.current }),
      to: item.assigned,
      savings: before.net - to.on.net,
      estimated: before.converted || to.on.converted,
    });
  }
  changes.sort(
    (a, b) =>
      input.items.findIndex((resolved) => resolved.item.id === a.itemId) -
      input.items.findIndex((resolved) => resolved.item.id === b.itemId),
  );
  return {
    changes,
    savings: changes.reduce((total, change) => total + change.savings, 0),
    estimated: changes.some((change) => change.estimated),
  };
}

/** What an item posts to `cardId` each month: as one of its options, or on its own card (one its seller may not take). */
function postedOn(item: Movable, cardId: string | undefined): readonly number[] {
  if (cardId === undefined) return [];
  const option = item.options.find((candidate) => candidate.cardId === cardId);
  if (option) return option.on.posted;
  return cardId === item.current && item.own ? item.own.posted : [];
}
