import { Service, inject } from '@angular/core';
import { cardUsage, softDeleted, withoutCard } from '@simply-sub/core';
import { RecordRepository } from './record-repository';
import { StorageService } from './storage-service';

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
}
