import { Service, computed, inject } from '@angular/core';
import {
  chargesIn,
  listMetrics,
  resolveItem,
  type Charge,
  type DateRange,
  type ItemResolution,
  type ListItem,
  type ListMetrics,
  type MetricsContext,
  type ResolvedItem,
  type UnresolvedItem,
} from '@simply-sub/core';
import { CatalogStore } from '../catalog/catalog-store';
import { ClockService } from '../clock/clock-service';
import { FxStore } from '../fx/fx-store';
import { SettingsStore } from '../settings/settings-store';
import { CardsRepository } from '../storage/cards-repository';
import { CustomSubsRepository } from '../storage/custom-subs-repository';
import { ItemsRepository } from '../storage/items-repository';
import { RankingsRepository } from '../storage/rankings-repository';

/** A list's items: the resolved ones pages show, and the ones they can't show yet or any more, with why. */
export interface ListItems {
  resolved: readonly ResolvedItem[];
  unresolved: readonly UnresolvedItem[];
}

const noItems: ListItems = { resolved: [], unresolved: [] };

/**
 * The view models pages show (PROJECT-PLAN §3.4), as signals built from the repositories, CatalogStore, FxStore and
 * SettingsStore with core's resolveItem, so components never price, join or rank anything themselves. Each item is
 * priced with the catalog file of the region it was bought in, its keys ranked by its overrides over the profile's
 * ranks (M6.1), and given its status and next charge, with the user's sales tax (M7.1) and its card's FX fee (M10.29).
 * Each list's totals, and every list's together for Home, are core's listMetrics (M7.2).
 */
@Service()
export class MetricsService {
  private readonly items = inject(ItemsRepository);
  private readonly customSubs = inject(CustomSubsRepository);
  private readonly rankings = inject(RankingsRepository);
  private readonly cards = inject(CardsRepository);
  private readonly catalog = inject(CatalogStore);
  private readonly fx = inject(FxStore);
  private readonly settings = inject(SettingsStore);
  private readonly clock = inject(ClockService);

  /** Whether the items have loaded: until then every list is empty. */
  readonly status = this.items.status;

  /** Every item's resolution, by item id. None before the first run has saved the settings. */
  readonly resolutions = computed<ReadonlyMap<string, ItemResolution>>(
    () => new Map(this.resolve(this.items.records()).map((result) => [itemOf(result).id, result])),
  );

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

  /** What totals need: today, the user's currency, tax place and budgets, and the registry. None before the first run. */
  private readonly context = computed<MetricsContext | undefined>(() => {
    const saved = this.settings.saved();
    if (!saved) return undefined;
    return {
      today: this.clock.today(),
      currency: saved.currency,
      place: saved,
      registry: this.catalog.catalog()?.features ?? [],
      ...(saved.monthlyBudget !== undefined && { monthlyBudget: saved.monthlyBudget }),
      ...(saved.annualBudget !== undefined && { annualBudget: saved.annualBudget }),
    };
  });

  /** Each list's totals and ranks, by list id (§3.4). A list with no items isn't there: it adds up to nothing. */
  private readonly metricsByList = computed<ReadonlyMap<string, ListMetrics>>(() => {
    const context = this.context();
    if (!context) return new Map();
    return new Map(
      [...this.byList()].map(([listId, items]) => [listId, listMetrics(items, context)]),
    );
  });

  /** Every list's items together: Home's totals and budget checks (BLUEPRINT §8.1.1). */
  readonly global = computed<ListMetrics | undefined>(() => {
    const context = this.context();
    return context && listMetrics(this.all(), context);
  });

  /** One list's totals and ranks: zeros for a list with no items. Undefined before the first run. */
  metrics(listId: string): ListMetrics | undefined {
    const context = this.context();
    return context && (this.metricsByList().get(listId) ?? listMetrics(noItems, context));
  }

  /**
   * The totals of items that aren't saved (a draft's, P5's footer), as a saved list's are. Called in a computed(), it
   * follows them. Undefined before the first run.
   */
  metricsOf(items: ListItems): ListMetrics | undefined {
    const context = this.context();
    return context && listMetrics(items, context);
  }

  /**
   * The charges dated in `range` of the lists `listIds` names, or of every list, in date order (the Calendar and the
   * mini calendars). None before the first run.
   */
  charges(range: DateRange, listIds?: ReadonlySet<string>): Charge[] {
    const saved = this.settings.saved();
    if (!saved) return [];
    const items = listIds
      ? [...listIds].flatMap((listId) => this.list(listId).resolved)
      : this.all().resolved;
    return chargesIn(items, range, saved);
  }

  /** Every list's items together. */
  private all(): ListItems {
    const lists = [...this.byList().values()];
    return {
      resolved: lists.flatMap((list) => list.resolved),
      unresolved: lists.flatMap((list) => list.unresolved),
    };
  }

  /**
   * Resolves `items` as the saved ones are, in their order: a list's draft's (P5), which aren't saved yet. Called in a
   * computed(), it follows the catalog, the rates, the settings and the ranks. None before the first run.
   */
  resolve(items: readonly ListItem[]): ItemResolution[] {
    const saved = this.settings.saved();
    if (!saved) return [];
    const fx = this.fx.rates();
    const context = {
      customSubs: this.customSubs.status() === 'ready' ? this.customSubs.byId() : undefined,
      country: saved.country,
      currency: saved.currency,
      ...(fx && { fx }),
      today: this.clock.today(),
      profileRanks: this.rankings.ranks(),
      // Where the user pays sales tax, for each item's next charge (BLUEPRINT §4.8).
      taxPlace: saved,
      // The cards items are paid with: their FX fees count in the totals (M10.29).
      cards: this.cards.byId(),
    };
    return items.map((item) =>
      resolveItem(item, {
        ...context,
        catalog: this.catalog.catalogFor(item.region ?? saved.country),
      }),
    );
  }
}

function itemOf(result: ItemResolution): ListItem {
  return result.ok ? result.resolved.item : result.unresolved.item;
}
