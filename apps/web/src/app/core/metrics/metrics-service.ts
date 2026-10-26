import { Service, computed, inject } from '@angular/core';
import {
  resolveItem,
  type ItemResolution,
  type ResolvedItem,
  type UnresolvedItem,
} from '@simply-sub/core';
import { CatalogStore } from '../catalog/catalog-store';
import { ClockService } from '../clock/clock-service';
import { FxStore } from '../fx/fx-store';
import { SettingsStore } from '../settings/settings-store';
import { CustomSubsRepository } from '../storage/custom-subs-repository';
import { ItemsRepository } from '../storage/items-repository';

/** A list's items: the resolved ones pages show, and the ones they can't show yet or any more, with why. */
export interface ListItems {
  resolved: readonly ResolvedItem[];
  unresolved: readonly UnresolvedItem[];
}

const noItems: ListItems = { resolved: [], unresolved: [] };

/**
 * The view models pages show (PROJECT-PLAN §3.4), as signals built from the repositories, CatalogStore, FxStore and
 * SettingsStore with core's resolveItem, so components never price or join anything themselves. Each item is
 * priced with the catalog file of the region it was bought in. M4.6 resolves items; M7.1 adds their status, next
 * charge and the totals (ListMetrics), and M6.1 their effective ranks.
 */
@Service()
export class MetricsService {
  private readonly items = inject(ItemsRepository);
  private readonly customSubs = inject(CustomSubsRepository);
  private readonly catalog = inject(CatalogStore);
  private readonly fx = inject(FxStore);
  private readonly settings = inject(SettingsStore);
  private readonly clock = inject(ClockService);

  /** Whether the items have loaded: until then every list is empty. */
  readonly status = this.items.status;

  /** Every item's resolution, by item id. None before the first run has saved the settings. */
  readonly resolutions = computed<ReadonlyMap<string, ItemResolution>>(() => {
    const saved = this.settings.saved();
    if (!saved) return new Map();
    const fx = this.fx.rates();
    const context = {
      customSubs: this.customSubs.status() === 'ready' ? this.customSubs.byId() : undefined,
      country: saved.country,
      currency: saved.currency,
      ...(fx && { fx }),
      today: this.clock.today(),
    };
    return new Map(
      this.items.records().map((item) => [
        item.id,
        resolveItem(item, {
          ...context,
          catalog: this.catalog.catalogFor(item.region ?? saved.country),
        }),
      ]),
    );
  });

  /** Each list's items, by list id, in the order they were added. A list with no items isn't there. */
  readonly byList = computed<ReadonlyMap<string, ListItems>>(() => {
    const byList = new Map<string, { resolved: ResolvedItem[]; unresolved: UnresolvedItem[] }>();
    for (const resolution of this.resolutions().values()) {
      const listId = resolution.ok ? resolution.resolved.listId : resolution.unresolved.listId;
      let list = byList.get(listId);
      if (!list) byList.set(listId, (list = { resolved: [], unresolved: [] }));
      if (resolution.ok) list.resolved.push(resolution.resolved);
      else list.unresolved.push(resolution.unresolved);
    }
    return byList;
  });

  /** One list's items: none for a list without any (or one that doesn't exist). */
  list(listId: string): ListItems {
    return this.byList().get(listId) ?? noItems;
  }
}
