import { Service, inject } from '@angular/core';
import { softDeleted, tagUsage, withoutTag } from '@simply-sub/core';
import { RecordRepository } from './record-repository';
import { StorageService } from './storage-service';

/** The coloured tags managed in Settings (P13). */
@Service()
export class TagsRepository extends RecordRepository<'tags'> {
  private readonly service = inject(StorageService);

  constructor() {
    super('tags');
  }

  /**
   * How many subscriptions use the tag, as stored now: the items in lists and in lists' unsaved edits (core's
   * tagUsage). Read afresh, so it's right before the repositories have loaded the items and drafts.
   */
  async usage(id: string): Promise<number> {
    const engine = await this.service.engine();
    const [items, drafts] = await Promise.all([engine.read('items'), engine.read('drafts')]);
    return tagUsage(id, items, drafts);
  }

  /**
   * Deletes a tag (P13, P6's picker): soft-deleted, and taken off every item and every list's draft (core's
   * withoutTag), in one transaction, so nothing names it afterwards. Nothing happens to one already deleted.
   */
  async removeWithItems(id: string): Promise<void> {
    const now = this.service.now();
    const engine = await this.service.engine();
    await engine.transaction(['tags', 'items', 'drafts'], async (transaction) => {
      const tag = await transaction.get('tags', id);
      if (tag === undefined || tag.deletedAt !== undefined) return;
      await transaction.put('tags', softDeleted(tag, now));
      const { items, drafts } = withoutTag(
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
