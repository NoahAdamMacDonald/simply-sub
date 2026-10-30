import { Service, inject } from '@angular/core';
import { softDeleted, tagUsage, withTagMerged, withoutTag } from '@simply-sub/core';
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

  /**
   * Merges the tag `fromId` into `intoId` (M10.24, two tags of one name): every item and draft that had it has `intoId`
   * instead (core's withTagMerged), and `fromId` is soft-deleted, in one transaction. Nothing happens unless both are
   * live.
   */
  async mergeInto(fromId: string, intoId: string): Promise<void> {
    const now = this.service.now();
    const engine = await this.service.engine();
    await engine.transaction(['tags', 'items', 'drafts'], async (transaction) => {
      const from = await transaction.get('tags', fromId);
      const into = await transaction.get('tags', intoId);
      if (from?.deletedAt !== undefined || into?.deletedAt !== undefined || !from || !into) return;
      await transaction.put('tags', softDeleted(from, now));
      const { items, drafts } = withTagMerged(
        fromId,
        intoId,
        await transaction.getAll('items'),
        await transaction.getAll('drafts'),
        now,
      );
      for (const item of items) await transaction.put('items', item);
      for (const draft of drafts) await transaction.put('drafts', draft);
    });
  }
}
