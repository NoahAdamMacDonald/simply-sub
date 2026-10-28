import { Service, inject } from '@angular/core';
import { cardUsage, softDeleted, withChanges, withoutCard } from '@simply-sub/core';
import { RecordRepository } from './record-repository';
import { StorageService } from './storage-service';

/** An item's card: a card id, or none. */
export interface ItemCard {
  itemId: string;
  cardId?: string;
}

/**
 * The user's payment cards (PROJECT-PLAN P11, BLUEPRINT §9.2): a name, network, cash back, FX fee and limit, never a
 * card number. Every record is checked against its schema on the way in and out, the app lock seals them and backups
 * carry them, like every user table's.
 */
@Service()
export class CardsRepository extends RecordRepository<'cards'> {
  private readonly service = inject(StorageService);

  constructor() {
    super('cards');
  }

  /**
   * How many subscriptions are paid with the card: the items in lists and in lists' unsaved edits (core's cardUsage).
   * Read afresh, so it's right before the repositories have loaded the items and drafts.
   */
  async usage(id: string): Promise<number> {
    const engine = await this.service.engine();
    const [items, drafts] = await Promise.all([engine.read('items'), engine.read('drafts')]);
    return cardUsage(id, items, drafts);
  }

  /**
   * Deletes a card (P11): soft-deleted, and taken off every item and every list's draft (core's withoutCard), in one
   * transaction, so the subscriptions it paid for have no card. Nothing happens to one already deleted.
   */
  async removeWithItems(id: string): Promise<void> {
    const now = this.service.now();
    const engine = await this.service.engine();
    await engine.transaction(['cards', 'items', 'drafts'], async (transaction) => {
      const card = await transaction.get('cards', id);
      if (card === undefined || card.deletedAt !== undefined) return;
      await transaction.put('cards', softDeleted(card, now));
      const { items, drafts } = withoutCard(
        id,
        await transaction.getAll('items'),
        await transaction.getAll('drafts'),
        now,
      );
      for (const item of items) await transaction.put('items', item);
      for (const draft of drafts) await transaction.put('drafts', draft);
    });
  }

  /**
   * Gives each item its card, or none (P11's Assign best cards, and its Undo), in one transaction, and gives back the
   * card each one had. An item deleted since is left as it is. Here rather than in ItemsRepository, which the app
   * starts with, so it stays out of the initial bundle.
   */
  async assign(cards: readonly ItemCard[]): Promise<ItemCard[]> {
    const now = this.service.now();
    const engine = await this.service.engine();
    return engine.transaction(['items'], async (transaction) => {
      const before: ItemCard[] = [];
      for (const { itemId, cardId } of cards) {
        const item = await transaction.get('items', itemId);
        if (item === undefined || item.deletedAt !== undefined) continue;
        before.push({ itemId, ...(item.cardId !== undefined && { cardId: item.cardId }) });
        await transaction.put('items', withChanges(item, { cardId }, now));
      }
      return before;
    });
  }
}
