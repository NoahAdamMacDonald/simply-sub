import { Service, inject } from '@angular/core';
import {
  softDeleted,
  withChanges,
  type CustomSubFields,
  type CustomSubscription,
  type ListItem,
} from '@simply-sub/core';
import { RecordRepository } from './record-repository';
import { StorageService } from './storage-service';

/** Services that aren't in the catalog, with their own plans (P12). */
@Service()
export class CustomSubsRepository extends RecordRepository<'customSubs'> {
  private readonly service = inject(StorageService);

  constructor() {
    super('customSubs');
  }

  /** A new plan's id: a UUID v7, as a record's. */
  newPlanId(): string {
    return this.service.newId(this.service.now());
  }

  /**
   * Saves the editor's custom subscription (P12): a new one, or the changes to `id`'s. The list items of a plan it no
   * longer has are soft-deleted in the same transaction, so no item is left naming a plan that's gone. A link left out
   * is cleared. Fails if `id` names no custom subscription, or a deleted one.
   */
  async save(id: string | undefined, fields: CustomSubFields): Promise<CustomSubscription> {
    const now = this.service.now();
    const engine = await this.service.engine();
    return engine.transaction(['customSubs', 'items'], async (transaction) => {
      let record: CustomSubscription;
      if (id === undefined) {
        record = { ...fields, id: this.service.newId(now), createdAt: now, updatedAt: now };
      } else {
        const current = await transaction.get('customSubs', id);
        if (current === undefined || current.deletedAt !== undefined) {
          throw new Error(`There's no custom subscription ${id} to change`);
        }
        record = withChanges<CustomSubscription>(
          current,
          { link: undefined, cancelUrl: undefined, ...fields },
          now,
        );
        const plans = new Set(fields.plans.map((plan) => plan.id));
        for (const item of await transaction.getAll('items')) {
          const { source } = item;
          if (usesSub(item, id) && source.kind === 'custom' && !plans.has(source.customPlanId)) {
            await transaction.put('items', softDeleted(item, now));
          }
        }
      }
      await transaction.put('customSubs', record);
      return record;
    });
  }

  /**
   * Deletes a custom subscription and the list items that use it, together ("Also remove it from 1 list", P12). Both
   * are soft-deleted, so a sync can pass the deletion on. Nothing happens to one already deleted.
   */
  async removeWithItems(id: string): Promise<void> {
    const now = this.service.now();
    const engine = await this.service.engine();
    await engine.transaction(['customSubs', 'items'], async (transaction) => {
      const sub = await transaction.get('customSubs', id);
      if (sub === undefined || sub.deletedAt !== undefined) return;
      await transaction.put('customSubs', softDeleted(sub, now));
      for (const item of await transaction.getAll('items')) {
        if (usesSub(item, id)) await transaction.put('items', softDeleted(item, now));
      }
    });
  }
}

/** Whether `item` is in a list and a plan of the custom subscription `subId`. */
function usesSub(item: ListItem, subId: string): boolean {
  return (
    item.deletedAt === undefined &&
    item.source.kind === 'custom' &&
    item.source.customSubId === subId
  );
}
