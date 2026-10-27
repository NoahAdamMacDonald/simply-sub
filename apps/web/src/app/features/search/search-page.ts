import { BreakpointObserver } from '@angular/cdk/layout';
import { Location, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatIconButton } from '@angular/material/button';
import {
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
  type MatDialogRef,
} from '@angular/material/dialog';
import { MatFormField, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { ActivatedRoute, NavigationStart, Router, RouterLink } from '@angular/router';
import {
  filterCount,
  listsWithDrafts,
  readSearchParams,
  sameSearchParams,
  searchCatalog,
  searchFilterOptions,
  searchText,
  writeSearchParams,
  type CatalogQuery,
  type ProviderSort,
  type SearchDefaults,
} from '@simply-sub/core';
import { filter, map } from 'rxjs';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { DraftsRepository } from '../../core/storage/drafts-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import { DRAWER_BREAKPOINT } from '../../layout/shell';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { SubCard } from '../../shared/sub-card/sub-card';
import { SearchFilters } from './search-filters';

/** How long typing pauses before the results follow it (P8). */
export const searchDelayMs = 150;

const sortChoices: readonly { value: ProviderSort; label: string }[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name: A to Z' },
  { value: 'features', label: 'Most features' },
];

/**
 * How a change goes into the browser's history: typing replaces the current entry, a run of price changes makes one
 * entry, and anything else adds one, so Back undoes the last filter.
 */
type HistoryEntry = 'replace' | 'price' | 'push';

/** The history state that marks an entry a price change made. */
const priceState = 'ssSearchPrice';

/**
 * Search (PROJECT-PLAN P8): the catalog for the user's country, searched on the device by core's searchCatalog, one
 * card per provider (ss-sub-card), with the filter panel (ss-search-filters) beside the results, or in a drawer under
 * 960 px. The URL holds the text, the filters and the sort (M5.3), so a reload and back/forward restore them, and the
 * page rewrites a URL with anything the catalog doesn't have. The search bar and the panel stay in place while the
 * results scroll (M5.7). In pick mode, ?addTo=<list id> (P7, flow F2, M5.5), a banner above the search bar names the
 * list, and a price adds to it at once; the URL keeps it through every change, until its ✕ goes back to the list.
 */
@Component({
  selector: 'ss-search-page',
  host: {
    '[style.--ss-pinned-height]': "pinnedHeight() + 'px'",
    '[style.--ss-panel-height]': "panelHeight() + 'px'",
  },
  imports: [
    EmptyState,
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatOption,
    MatPrefix,
    MatSelect,
    MatSuffix,
    NgTemplateOutlet,
    RouterLink,
    SearchFilters,
    SubCard,
  ],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
})
export class SearchPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly dialog = inject(MatDialog);
  private readonly catalog = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly fx = inject(FxStore);
  private readonly items = inject(ItemsRepository);
  private readonly lists = inject(ListsRepository);
  private readonly drafts = inject(DraftsRepository);
  private readonly rankings = inject(RankingsRepository);
  private readonly today = inject(ClockService).today;

  private readonly drawerTemplate = viewChild.required<TemplateRef<unknown>>('drawer');
  private readonly pinned = viewChild.required<ElementRef<HTMLElement>>('pinned');
  private readonly panelSection = viewChild<ElementRef<HTMLElement>>('panelSection');
  private drawer?: MatDialogRef<unknown>;
  private timer?: ReturnType<typeof setTimeout>;

  /** The pinned bar's height, for the panel pinned below it and the cards that scroll into view under it. */
  protected readonly pinnedHeight = signal(0);
  /** The filter panel's height (from 960 px), so a panel taller than the window pins by its foot. */
  protected readonly panelHeight = signal(0);

  private readonly params = toSignal(this.route.queryParams, { requireSync: true });
  /** Under 960 px the filters are in a drawer, as the sidebar is (P1). */
  protected readonly narrow = toSignal(
    inject(BreakpointObserver)
      .observe(DRAWER_BREAKPOINT)
      .pipe(map((state) => state.matches)),
    { requireSync: true },
  );

  /** What's in the search box: the URL's text, unless what's typed differs from it only in spaces. */
  protected readonly text = linkedSignal<string, string>({
    source: () => {
      const q = this.params()['q'];
      return (Array.isArray(q) ? q[0] : q) ?? '';
    },
    computation: (q, previous) =>
      previous !== undefined && searchText(previous.value) === searchText(q) ? previous.value : q,
  });

  /** What a filter is when the URL doesn't say: Sold in as Settings has it (M5.6). */
  private readonly defaults = computed<SearchDefaults>(() => ({
    soldOnly: this.settings.saved()?.searchSoldOnly === true,
  }));

  /**
   * The lists pick mode adds to: the user's, as their drafts name them, and new lists, which have only a draft until
   * the editor saves them (M6.3).
   */
  private readonly editableLists = computed(() =>
    listsWithDrafts(this.lists.records(), this.drafts.drafts()),
  );

  /**
   * The URL's text, filters and sort, as far as the catalog has them, and pick mode's list while it's one of the
   * user's; undefined until the catalog, the settings, whose defaults the URL leaves out, the lists and the drafts
   * have loaded.
   */
  protected readonly query = computed(() => {
    const data = this.catalog.catalog();
    return data &&
      this.settings.saved() &&
      this.lists.status() !== 'loading' &&
      this.drafts.status() !== 'loading'
      ? readSearchParams(this.params(), data, this.defaults(), this.editableLists())
      : undefined;
  });
  /** Pick mode's list (P7, flow F2): the banner names it, and a price adds to it with no menu. */
  protected readonly pickList = computed(() => {
    const id = this.query()?.addTo;
    return id === undefined ? undefined : this.editableLists().find((list) => list.id === id);
  });
  private readonly hasText = computed(() => this.query()?.q !== undefined);
  /** Best match needs text: without it, the default is the cheapest first. */
  protected readonly sort = computed<ProviderSort>(
    () => this.query()?.sort ?? (this.hasText() ? 'relevance' : 'price_asc'),
  );
  protected readonly sorts = computed(() =>
    sortChoices.filter((choice) => choice.value !== 'relevance' || this.hasText()),
  );

  /** What the filter panel shows, once the settings and the catalog have loaded. */
  protected readonly filterPanel = computed(() => {
    const settings = this.settings.saved();
    const catalog = this.catalog.catalog();
    const query = this.query();
    if (!settings || !catalog || !query) return undefined;
    const fx = this.fx.rates();
    const options = searchFilterOptions({
      catalog,
      settings,
      ...(fx && { fx }),
      today: this.today(),
    });
    return { query, options, catalog, settings };
  });
  protected readonly filters = computed(() => filterCount(this.query() ?? {}, this.defaults()));

  /** The results, or undefined until the settings and the catalog have loaded. */
  protected readonly results = computed(() => {
    const saved = this.settings.saved();
    const data = this.catalog.catalog();
    const query = this.query();
    if (!saved || !data || !query) return undefined;
    const fx = this.fx.rates();
    return searchCatalog(query, {
      catalog: data,
      settings: saved,
      ...(fx && { fx }),
      items: this.items.records(),
      today: this.today(),
    });
  });
  protected readonly ranks = computed(() => Object.fromEntries(this.rankings.ranks()));
  protected readonly count = computed(() => {
    const results = this.results();
    if (!results) return 'Loading the catalog…';
    if (results.length === 0) return 'No services match';
    return results.length === 1 ? '1 service' : `${results.length} services`;
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      clearTimeout(this.timer);
      this.drawer?.close();
    });
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) =>
        this.pinnedHeight.set(Math.ceil(entry.target.getBoundingClientRect().height)),
      );
      observer.observe(this.pinned().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    // The panel comes and goes with the width, and grows with the Features chosen.
    effect((onCleanup) => {
      const panel = this.panelSection()?.nativeElement;
      if (!panel || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) =>
        this.panelHeight.set(Math.ceil(entry.target.getBoundingClientRect().height)),
      );
      observer.observe(panel);
      onCleanup(() => observer.disconnect());
    });
    // Back or forward overrides text still waiting for the typing pause.
    this.router.events
      .pipe(
        filter(
          (event) => event instanceof NavigationStart && event.navigationTrigger === 'popstate',
        ),
        takeUntilDestroyed(),
      )
      .subscribe(() => clearTimeout(this.timer));
    // The URL shows only what's applied: anything the catalog doesn't have is dropped from it.
    effect(() => {
      const query = this.query();
      if (query && !sameSearchParams(this.params(), writeSearchParams(query, this.defaults()))) {
        this.navigate(query, 'replace');
      }
    });
    effect(() => {
      if (!this.narrow()) this.drawer?.close();
    });
  }

  protected typed(value: string): void {
    this.text.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.change({ q: value }, 'replace'), searchDelayMs);
  }

  protected clear(): void {
    clearTimeout(this.timer);
    this.text.set('');
    this.change({ q: undefined }, 'push');
  }

  protected chooseSort(sort: ProviderSort): void {
    this.change({ sort }, 'push');
  }

  /** Every filter back as the user's defaults have it; the text and the sort stay. */
  protected clearFilters(): void {
    const { q, sort } = this.query() ?? {};
    this.navigate(
      {
        ...(q !== undefined && { q }),
        ...(sort !== undefined && { sort }),
        ...(this.defaults().soldOnly && { soldOnly: true }),
      },
      'push',
    );
  }

  protected filtered(query: CatalogQuery, entry: HistoryEntry): void {
    this.navigate(query, entry);
  }

  protected openFilters(): void {
    this.drawer = this.dialog.open(this.drawerTemplate(), {
      panelClass: 'ss-filter-drawer',
      position: { top: '0', right: '0' },
      width: 'min(360px, 100vw)',
      maxWidth: '100vw',
      height: '100%',
      maxHeight: '100%',
      ariaLabelledBy: 'ss-filters-drawer-title',
    });
    this.drawer.afterClosed().subscribe(() => (this.drawer = undefined));
  }

  /**
   * Changes the text or the sort. Before the catalog has loaded there's no query to change, so the text joins the
   * URL as it is.
   */
  private change(patch: Pick<CatalogQuery, 'q' | 'sort'>, entry: HistoryEntry): void {
    const query = this.query();
    if (query) {
      this.navigate({ ...query, ...patch }, entry);
      return;
    }
    const q = searchText(patch.q ?? '');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: q === '' ? null : q },
      queryParamsHandling: 'merge',
      replaceUrl: entry === 'replace',
      scroll: 'manual',
    });
  }

  /**
   * Puts `query` in the URL, without scrolling, with pick mode's list, which only its ✕ leaves: a price change after
   * another one replaces its entry.
   */
  private navigate(query: CatalogQuery, entry: HistoryEntry): void {
    const addTo = this.query()?.addTo;
    const queryParams = writeSearchParams(
      { ...query, ...(addTo !== undefined && { addTo }) },
      this.defaults(),
    );
    if (sameSearchParams(this.params(), queryParams)) return;
    const state = this.location.getState() as Record<string, unknown> | null;
    const priceRun = entry === 'price' && state?.[priceState] === true;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: entry === 'replace' || priceRun,
      scroll: 'manual',
      ...(entry === 'price' && { state: { [priceState]: true } }),
    });
  }
}
