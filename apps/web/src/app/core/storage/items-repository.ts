import { Service, computed } from '@angular/core';
import type { ListItem } from '@simply-sub/core';
import { RecordRepository } from './record-repository';

/** The subscriptions in every list (BLUEPRINT §4.6). */
@Service()
export class ItemsRepository extends RecordRepository<'items'> {
  /** Each list's items, by list id. A list with no items isn't there. */
  readonly byList = computed(() => {
    const byList = new Map<string, ListItem[]>();
    for (const item of this.records()) {
      const items = byList.get(item.listId);
      if (items) items.push(item);
      else byList.set(item.listId, [item]);
    }
    return byList as ReadonlyMap<string, readonly ListItem[]>;
  });

  constructor() {
    super('items');
  }
}
