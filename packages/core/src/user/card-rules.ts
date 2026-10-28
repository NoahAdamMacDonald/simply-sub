import type { ListDraft } from './list-draft';
import type { ListItem } from './list-item';
import type { PaymentCard } from './payment-card';
import type { Timestamp } from './record';
import { withChanges } from './stamps';

// The rules for the user's payment cards (PROJECT-PLAN P11, M9.1): what a card is called, what uses one and what
// deleting one changes, and the card number check its fields share with the schema. This file imports no Zod, so
// the Payment page can use it without loading the record schemas.

/** 12 or more digits in a row, even with spaces or dashes between them: what a card number looks like. */
const cardNumberLike = /\d(?:[ -]?\d){11,}/;

/** Whether `text` could hold a card number (BLUEPRINT §9.2), which no field ever takes. */
export function looksLikeCardNumber(text: string): boolean {
  return cardNumberLike.test(text);
}

/** The most cash back and FX fee a card can have, in percent (P11). */
export const maxCashbackPercent = 20;
export const maxFxFeePercent = 10;

/** The largest monthly limit a card can have: 12 digits could be a card number. */
export const maxMonthlyLimit = 99_999_999_999;

/** What a card is called: its nickname when it has one, else its name. */
export function cardTitle(card: Pick<PaymentCard, 'name' | 'nickname'>): string {
  return card.nickname ?? card.name;
}

/**
 * How many subscriptions are paid with the card `cardId`: the items in lists and the ones in lists' unsaved edits
 * (drafts), each once, leaving out deleted ones and ones removed in a draft. Deleting a card says how many lose it.
 */
export function cardUsage(
  cardId: string,
  items: readonly ListItem[],
  drafts: readonly ListDraft[],
): number {
  const using = new Set<string>();
  for (const item of items) {
    if (item.deletedAt === undefined && item.cardId === cardId) using.add(item.id);
  }
  for (const draft of drafts) {
    for (const { item, removed } of draft.items) {
      if (removed === undefined && item.cardId === cardId) using.add(item.id);
    }
  }
  return using.size;
}

/** The records deleting a card changes. */
export interface CardRemoval {
  /** Every item paid with it, soft-deleted ones too, with no card and changed at `now`. */
  items: ListItem[];
  /**
   * Every draft with an item paid with it, with no card in the item as edited and in its saved copy, so the draft
   * doesn't look changed. A draft's items keep their timestamps: Save sets them.
   */
  drafts: ListDraft[];
}

/**
 * What deleting the card `cardId` changes besides the card (P11): the items paid with it have no card, in lists and in
 * their drafts, so nothing names a card that's gone.
 */
export function withoutCard(
  cardId: string,
  items: readonly ListItem[],
  drafts: readonly ListDraft[],
  now: Timestamp,
): CardRemoval {
  const has = (item: ListItem | undefined) => item?.cardId === cardId;
  const dropped = (item: ListItem): ListItem => {
    if (!has(item)) return item;
    const unpaid = { ...item };
    delete unpaid.cardId;
    return unpaid;
  };
  return {
    items: items
      .filter((item) => has(item))
      .map((item) => withChanges(item, { cardId: undefined }, now)),
    drafts: drafts
      .filter((draft) => draft.items.some(({ item, saved }) => has(item) || has(saved)))
      .map((draft) => ({
        ...draft,
        items: draft.items.map((entry) => ({
          ...entry,
          item: dropped(entry.item),
          ...(entry.saved && { saved: dropped(entry.saved) }),
        })),
      })),
  };
}
