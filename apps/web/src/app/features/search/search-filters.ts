import {
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatChipGrid, MatChipInput, MatChipRemove, MatChipRow } from '@angular/material/chips';
import { MatOptgroup, MatOption } from '@angular/material/core';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatSelect } from '@angular/material/select';
import { MatSlider, MatSliderRangeThumb } from '@angular/material/slider';
import {
  featureSuggestions,
  filterCount,
  rankKeyLabel,
  rankKeyOptions,
  type ActivityFilter,
  type CatalogData,
  type CatalogQuery,
  type RankKey,
  type RankKeyOption,
  type SearchFilterOptions,
} from '@simply-sub/core';
import { wholeAmountText } from '../../shared/price-tag/price-text';

let nextId = 0;

const activityChoices: readonly { value: ActivityFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'not-listed', label: 'Not listed' },
];

/** A range thumb's value as it's being dragged, before the change is let go. */
interface Dragged {
  min?: number;
  max?: number;
}

/**
 * Search's filter panel (PROJECT-PLAN P8, M5.3): the price per month, Category, Features (rank keys, each a chip;
 * a plan needs them all), Activity, Native pricing only and Clear all. It shows the query it's given and emits the
 * next one, which the page puts in the URL: a price once the slider is let go (priceChange, so a run of them makes
 * one history entry), anything else at once (queryChange). Search's page shows it beside the results, or in a drawer
 * under 960 px.
 */
@Component({
  selector: 'ss-search-filters',
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
    MatButton,
    MatCheckbox,
    MatChipGrid,
    MatChipInput,
    MatChipRemove,
    MatChipRow,
    MatFormField,
    MatHint,
    MatIcon,
    MatLabel,
    MatOptgroup,
    MatOption,
    MatSelect,
    MatSlider,
    MatSliderRangeThumb,
  ],
  templateUrl: './search-filters.html',
  styleUrl: './search-filters.scss',
})
export class SearchFilters {
  /** The query on screen, as the URL holds it. */
  readonly query = input.required<CatalogQuery>();
  /** What the catalog for the user's country offers to filter by (searchFilterOptions). */
  readonly options = input.required<SearchFilterOptions>();
  /** The registry: the chips' names and the categories. */
  readonly catalog = input.required<Pick<CatalogData, 'features' | 'categories'>>();
  /** The user's currency and country, which write the amounts. */
  readonly currency = input.required<string>();
  readonly country = input<string>();

  /** Any filter but a price, at once. */
  readonly queryChange = output<CatalogQuery>();
  /** A price, once the slider is let go. */
  readonly priceChange = output<CatalogQuery>();

  private readonly injector = inject(Injector);
  private readonly suggestionList = viewChild.required(MatAutocomplete);

  protected readonly id = `ss-search-filters-${nextId++}`;
  protected readonly activityChoices = activityChoices;

  protected readonly price = computed(() => this.options().price);
  /** The thumbs being dragged, until the query they make arrives. */
  protected readonly dragged = linkedSignal<CatalogQuery, Dragged>({
    source: this.query,
    computation: () => ({}),
  });
  /** The lower thumb: the minimum, or 0. */
  protected readonly low = computed(() =>
    Math.min(this.dragged().min ?? this.query().minPrice ?? 0, this.price().top),
  );
  /** The upper thumb: the maximum, or the top, which is Unlimited. */
  protected readonly high = computed(() =>
    Math.min(this.dragged().max ?? this.query().maxPrice ?? this.price().top, this.price().top),
  );
  protected readonly rangeText = computed(
    () => `${this.priceText(this.low())} – ${this.priceText(this.high())}`,
  );
  /** A thumb's value as it reads, to the eye and to screen readers: the top is Unlimited. */
  protected readonly priceText = (value: number): string =>
    value >= this.price().top
      ? 'Unlimited'
      : wholeAmountText(value, this.currency(), this.country());

  /** The service categories something sold here is in, and the one chosen. */
  protected readonly categories = computed(() => {
    const { categories } = this.options();
    const chosen = this.query().category;
    return this.catalog().categories.service.filter(
      (category) => categories.has(category.id) || category.id === chosen,
    );
  });

  /** The chosen features, in the order they were picked. */
  protected readonly picked = computed(() => {
    const options = this.catalog().features.flatMap(rankKeyOptions);
    return (this.query().features ?? []).flatMap(
      (key) => options.find((option) => option.key === key) ?? [],
    );
  });
  /** What's typed in the Features box. */
  protected readonly featureText = signal('');
  protected readonly suggestions = computed(() =>
    featureSuggestions(this.featureText(), {
      keys: this.options().keys,
      categories: this.catalog().categories.feature,
      picked: this.query().features ?? [],
    }),
  );
  protected readonly label = rankKeyLabel;

  protected readonly active = computed(() => filterCount(this.query()) > 0);

  protected dragging(thumb: keyof Dragged, value: number): void {
    this.dragged.update((dragged) => ({ ...dragged, [thumb]: value }));
  }

  /** A thumb let go: 0 is no minimum, and the top no maximum. */
  protected letGo(thumb: keyof Dragged, value: number): void {
    const { top } = this.price();
    const query = { ...this.query() };
    if (thumb === 'min') {
      query.minPrice = value > 0 ? value : undefined;
    } else {
      query.maxPrice = value < top ? value : undefined;
    }
    this.priceChange.emit(query);
  }

  protected chooseCategory(category: string): void {
    this.change({ category: category === '' ? undefined : category });
  }

  /**
   * Keeps the suggestions out of the Tab order. Chromium makes a scrolling element a tab stop when nothing in it is,
   * and Material puts the list just after the box, so Tab would land on the list and leave it open. The arrow keys
   * move through it from the box.
   */
  protected suggestionsOpened(): void {
    afterNextRender(
      () => this.suggestionList().panel?.nativeElement.setAttribute('tabindex', '-1'),
      { injector: this.injector },
    );
  }

  protected addFeature(key: RankKey, box: HTMLInputElement): void {
    box.value = '';
    this.featureText.set('');
    this.change({ features: [...(this.query().features ?? []), key] });
  }

  protected removeFeature(option: RankKeyOption): void {
    this.change({ features: this.query().features?.filter((key) => key !== option.key) });
  }

  protected toggleActivity(value: ActivityFilter, on: boolean): void {
    const activity = this.query().activity ?? [];
    this.change({
      activity: on ? [...activity, value] : activity.filter((chosen) => chosen !== value),
    });
  }

  protected chooseNative(on: boolean): void {
    this.change({ nativeOnly: on || undefined });
  }

  /** Every filter off; the text and the sort stay. */
  protected clearAll(): void {
    if (!this.active()) return;
    const { q, sort } = this.query();
    this.queryChange.emit({ ...(q !== undefined && { q }), ...(sort !== undefined && { sort }) });
  }

  private change(patch: Partial<CatalogQuery>): void {
    this.queryChange.emit({ ...this.query(), ...patch });
  }
}
