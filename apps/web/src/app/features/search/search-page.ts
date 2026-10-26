import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { searchCatalog, type ProviderSort } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import { EmptyState } from '../../shared/empty-state/empty-state';
import { SubCard } from '../../shared/sub-card/sub-card';

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
 * Search (PROJECT-PLAN P8): the catalog for the user's country, searched on the device by core's searchCatalog, one
 * card per provider (ss-sub-card). The text and the sort live in the page for now: the filter panel and the URL
 * state come with M5.3, and clicking a price to add it to a list with M5.4.
 */
@Component({
  selector: 'ss-search-page',
  imports: [
    EmptyState,
    MatButton,
    MatFormField,
    MatIcon,
    MatIconButton,
    MatInput,
    MatLabel,
    MatOption,
    MatPrefix,
    MatSelect,
    MatSuffix,
    RouterLink,
    SubCard,
  ],
  templateUrl: './search-page.html',
  styleUrl: './search-page.scss',
})
export class SearchPage {
  private readonly catalog = inject(CatalogStore);
  private readonly settings = inject(SettingsStore);
  private readonly fx = inject(FxStore);
  private readonly items = inject(ItemsRepository);
  private readonly rankings = inject(RankingsRepository);
  private readonly today = inject(ClockService).today;

  /** What's in the search box. */
  protected readonly text = signal('');
  /** The text searched for: the box's, once typing pauses. */
  private readonly query = signal('');
  /** The sort the user picked, if any. */
  protected readonly chosenSort = signal<ProviderSort | undefined>(undefined);
  private timer?: ReturnType<typeof setTimeout>;

  private readonly hasText = computed(() => this.query().trim() !== '');
  /** Best match needs text: without it, the default is the cheapest first. */
  protected readonly sort = computed<ProviderSort>(() => {
    const chosen = this.chosenSort();
    if (chosen !== undefined && (chosen !== 'relevance' || this.hasText())) return chosen;
    return this.hasText() ? 'relevance' : 'price_asc';
  });
  protected readonly sorts = computed(() =>
    sortChoices.filter((choice) => choice.value !== 'relevance' || this.hasText()),
  );

  /** The results, or undefined until the settings and the catalog have loaded. */
  protected readonly results = computed(() => {
    const saved = this.settings.saved();
    const data = this.catalog.catalog();
    if (!saved || !data) return undefined;
    const fx = this.fx.rates();
    return searchCatalog(
      { q: this.query(), sort: this.sort() },
      {
        catalog: data,
        settings: saved,
        ...(fx && { fx }),
        items: this.items.records(),
        today: this.today(),
      },
    );
  });
  protected readonly ranks = computed(() => Object.fromEntries(this.rankings.ranks()));
  protected readonly count = computed(() => {
    const results = this.results();
    if (!results) return 'Loading the catalog…';
    if (results.length === 0) return 'No services match';
    return results.length === 1 ? '1 service' : `${results.length} services`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected typed(value: string): void {
    this.text.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.query.set(value), searchDelayMs);
  }

  protected clear(): void {
    clearTimeout(this.timer);
    this.text.set('');
    this.query.set('');
  }
}
