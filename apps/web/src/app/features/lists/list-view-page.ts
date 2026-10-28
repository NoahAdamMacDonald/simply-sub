import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatFormField, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  listFilterCount,
  listFilterOptions,
  listView,
  typeCounts,
  type ResolvedItem,
  type Tag,
} from '@simply-sub/core';
import { filter, firstValueFrom, map } from 'rxjs';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import { BudgetTotals } from '../../shared/budget-totals/budget-totals';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { FeatureSummary } from '../../shared/feature-summary/feature-summary';
import { PageHeader } from '../../shared/page-header/page-header';
import { ItemCard } from '../../shared/sub-card/item-card';
import { TypeCounts } from '../../shared/type-counts/type-counts';
import { CustomSubEditor } from '../custom-subs/custom-sub-editor';
import { averageText } from './average-text';
import { editRow } from './edit-rows';
import { ListFilters, listQuery, noListFilters, type ListFilterState } from './list-filters';

/**
 * List view (PROJECT-PLAN P4, M6.8): one list's subscriptions as cards (ss-item-card), pinned ones first, with what the
 * list costs a month on average and how many it has, a search box and the Sort menu (core's listView), 📌 saved
 * straight to the item, each card's Edit and the list's, and on the side this month's and this year's totals against
 * the budgets, with each card's share of the list (M7.2), then its types and feature summary (§3.2). M7.4 adds the
 * mini calendar, M7.5 Export and M8 the optimizations button.
 */
@Component({
  selector: 'ss-list-view-page',
  imports: [
    BudgetTotals,
    EmptyState,
    FeatureSummary,
    ItemCard,
    ListFilters,
    MatButton,
    MatDivider,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatPrefix,
    MatSuffix,
    PageHeader,
    RouterLink,
    TypeCounts,
  ],
  templateUrl: './list-view-page.html',
  styleUrl: './list-view-page.scss',
})
export class ListViewPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly lists = inject(ListsRepository);
  private readonly items = inject(ItemsRepository);
  private readonly tags = inject(TagsRepository);
  private readonly drafts = inject(ListDraftService);
  private readonly metrics = inject(MetricsService);
  private readonly catalog = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly customSubEditor = inject(CustomSubEditor);
  private readonly today = inject(ClockService).today;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly customSubs = inject(CustomSubsRepository);

  protected readonly listId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('listId') ?? undefined)),
  );
  protected readonly list = computed(() => {
    const listId = this.listId();
    return listId === undefined ? undefined : this.lists.byId().get(listId);
  });
  protected readonly state = computed<'loading' | 'error' | 'missing' | 'ready'>(() => {
    const statuses = [this.lists.status(), this.metrics.status(), this.tags.status()];
    if (statuses.includes('error')) return 'error';
    if (!statuses.every((status) => status === 'ready')) return 'loading';
    return this.list() ? 'ready' : 'missing';
  });

  /** The list's items, priced, and the ones that can't be. */
  private readonly listItems = computed(() => {
    const listId = this.listId();
    return listId === undefined ? { resolved: [], unresolved: [] } : this.metrics.list(listId);
  });
  protected readonly total = computed(
    () => this.listItems().resolved.length + this.listItems().unresolved.length,
  );
  /** "≈ $62 / mo average · 12 subscriptions", until M7.2's bars. */
  protected readonly summary = computed(() => {
    const saved = this.settings.saved();
    const total = this.total();
    return {
      ...(saved && total > 0 && { average: averageText(this.listItems(), saved) }),
      count: total === 1 ? '1 subscription' : `${total} subscriptions`,
    };
  });
  /** The list has changes in the editor that weren't saved: the cards show it as saved. */
  protected readonly unsaved = computed(() => {
    const listId = this.listId();
    return listId !== undefined && this.drafts.hasChanges(listId);
  });

  /** The search box's text and the Sort menu's choices. */
  protected readonly text = signal('');
  protected readonly filters = signal<ListFilterState>(noListFilters);
  protected readonly filtersOpen = signal(false);
  /** The search box and the Sort menu's choices, leaving out a tag deleted meanwhile (M6.11). */
  private readonly query = computed(() => {
    const filters = this.filters();
    const byId = this.tags.byId();
    return listQuery(this.text(), { ...filters, tags: filters.tags.filter((id) => byId.has(id)) });
  });
  protected readonly filterCount = computed(() => listFilterCount(this.query()));
  protected readonly context = computed(() => ({
    tags: this.tags.byId(),
    registry: this.catalog.catalog()?.features ?? [],
    currency: this.settings.saved()?.currency ?? '',
    today: this.today(),
  }));
  /** The feature categories, which group the Features box's suggestions, and the user's country, for the slider. */
  protected readonly featureCategories = computed(
    () => this.catalog.catalog()?.categories.feature ?? [],
  );
  protected readonly country = computed(() => this.settings.saved()?.country);
  protected readonly view = computed(() =>
    listView(this.listItems(), this.query(), this.context()),
  );
  protected readonly options = computed(() =>
    listFilterOptions(this.listItems().resolved, this.context()),
  );
  /** "2 of 12 shown" while the text or a filter hides some. */
  protected readonly shownText = computed(() => {
    const { shown, total } = this.view();
    return shown === total ? '' : `${shown} of ${total} shown`;
  });
  /** The items it can't price or name, as the list editor's rows say why. */
  protected readonly unresolvedRows = computed(() =>
    this.view().unresolved.map((unresolved) =>
      editRow({ ok: false, unresolved }, this.tags.byId(), this.today()),
    ),
  );
  /** How many of each type it has: "Streaming video: 3". */
  protected readonly types = computed(() =>
    typeCounts(this.listItems().resolved, this.catalog.catalog()?.categories.service ?? []),
  );
  /** This list's totals, its cards' shares and its feature summary (§3.1, §3.2: core's listMetrics). */
  protected readonly totals = computed(() => {
    const listId = this.listId();
    return listId === undefined ? undefined : this.metrics.metrics(listId);
  });
  /** "VPN: 2 / 3" for this list's items (§3.2). */
  protected readonly features = computed(() => this.totals()?.featureSummary ?? []);

  /** The item whose 📌 was pressed: focus goes back to it once its card has moved. */
  private readonly pinned = signal<{ itemId: string; pinned: boolean } | undefined>(undefined);

  constructor() {
    effect(() => {
      const pending = this.pinned();
      if (!pending) return;
      const moved = [...this.view().pinned, ...this.view().others].some(
        ({ item }) => item.id === pending.itemId && item.pinned === pending.pinned,
      );
      if (!moved) return;
      this.pinned.set(undefined);
      afterNextRender(
        () =>
          // Item ids are UUIDs, which need no escaping.
          this.host.nativeElement
            .querySelector<HTMLElement>(`[data-item="${pending.itemId}"] .pin`)
            ?.focus(),
        { injector: this.injector },
      );
    });
  }

  protected tagsOf({ item }: ResolvedItem): Tag[] {
    const byId = this.tags.byId();
    return item.tagIds.flatMap((id) => byId.get(id) ?? []);
  }

  /** 📌: saved straight to the item, with no draft (P4). Its card moves, and focus follows it. */
  protected pin({ item }: ResolvedItem, pinned: boolean): void {
    this.pinned.set({ itemId: item.id, pinned });
    void this.items.update(item.id, { pinned });
  }

  protected clearSearch(box: HTMLInputElement): void {
    this.text.set('');
    box.focus();
  }

  /** No match: the text and the filters go, the sort stays. */
  protected clearAll(): void {
    this.text.set('');
    this.filters.update(({ sort }) => ({ ...noListFilters, sort }));
  }

  /** An empty list's Add custom subscription: the list editor, with the item dialog for it (flow F3). */
  protected addCustom(customSubId: string): void {
    void this.router.navigate(['/lists', this.listId(), 'edit'], {
      queryParams: { addCustom: customSubId },
    });
  }

  /** Create new…: the custom subscription editor (P12), then the list editor with what it made. */
  protected async createCustom(): Promise<void> {
    const created = await this.customSubEditor.open();
    if (!created || this.destroyRef.destroyed) return;
    // The editor reads it from the repository, whose live query has it a moment after the save.
    await firstValueFrom(
      toObservable(this.customSubs.byId, { injector: this.injector }).pipe(
        filter((byId) => byId.has(created.id)),
      ),
    );
    this.addCustom(created.id);
  }
}
