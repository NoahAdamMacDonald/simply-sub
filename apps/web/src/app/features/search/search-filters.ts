import { Component, computed, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  filterCount,
  type ActivityFilter,
  type CatalogData,
  type CatalogQuery,
  type SearchFilterOptions,
} from '@simply-sub/core';
import { ChoiceField, type Choice } from '../../shared/choice-field/choice-field';
import { countryName } from '../../shared/country-name';
import { ChipChoices, type ChipChoice } from '../../shared/filters/chip-choices';
import { FeatureFilter } from '../../shared/filters/feature-filter';
import { PriceRangeFilter, type PriceLimits } from '../../shared/filters/price-range-filter';

let nextId = 0;

const activityChoices: readonly (ChipChoice & { value: ActivityFilter })[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'not-listed', label: 'Not listed' },
];

/**
 * Search's filter panel (PROJECT-PLAN P8, M5.3): the price per month, Category (a menu you can type in, M5.14),
 * Features (rank keys, each a chip; a plan needs them all), Activity, Native pricing only, Sold in (M5.6) and Clear
 * all, which goes back to the user's defaults. The price, Features and Activity are the shared filters List view's
 * Sort menu has too (shared/filters, the feedback after M6.9). It shows the query it's given and emits the next one,
 * which the page puts in the URL: a price once the slider is let go (priceChange, so a run of them makes one history
 * entry), anything else at once (queryChange). Search's page shows it beside the results, or in a drawer under 960 px.
 */
@Component({
  selector: 'ss-search-filters',
  imports: [ChipChoices, ChoiceField, FeatureFilter, MatButton, MatCheckbox, PriceRangeFilter],
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
  /** Whether Sold in starts on: Settings' searchSoldOnly. */
  readonly soldByDefault = input(false);

  /** Any filter but a price, at once. */
  readonly queryChange = output<CatalogQuery>();
  /** A price, once the slider is let go. */
  readonly priceChange = output<CatalogQuery>();

  protected readonly id = `ss-search-filters-${nextId++}`;
  protected readonly activityChoices = activityChoices;

  /** The service categories something sold here is in, and the one chosen. */
  protected readonly categories = computed(() => {
    const { categories } = this.options();
    const chosen = this.query().category;
    return this.catalog().categories.service.filter(
      (category) => categories.has(category.id) || category.id === chosen,
    );
  });
  /** Category's menu: All, then those categories. */
  protected readonly categoryChoices = computed<Choice[]>(() => [
    { value: '', label: 'All' },
    ...this.categories().map(({ id, name }) => ({ value: id, label: name })),
  ]);

  protected readonly active = computed(
    () => filterCount(this.query(), { soldOnly: this.soldByDefault() }) > 0,
  );
  /** The user's country, by name: Sold in Canada. */
  protected readonly countryName = computed(() => countryName(this.country() ?? ''));

  /** A thumb let go: the new limits, as one history entry for a run of moves. */
  protected choosePrice({ min, max }: PriceLimits): void {
    this.priceChange.emit({ ...this.query(), minPrice: min, maxPrice: max });
  }

  protected chooseCategory(category: string): void {
    this.change({ category: category === '' ? undefined : category });
  }

  protected chooseActivity(activity: readonly string[]): void {
    this.change({ activity: activity as ActivityFilter[] });
  }

  protected chooseNative(on: boolean): void {
    this.change({ nativeOnly: on || undefined });
  }

  protected chooseSold(on: boolean): void {
    this.change({ soldOnly: on || undefined });
  }

  /** Every filter back as the user's defaults have it; the text and the sort stay. */
  protected clearAll(): void {
    if (!this.active()) return;
    const { q, sort } = this.query();
    this.queryChange.emit({
      ...(q !== undefined && { q }),
      ...(sort !== undefined && { sort }),
      ...(this.soldByDefault() && { soldOnly: true }),
    });
  }

  protected change(patch: Partial<CatalogQuery>): void {
    this.queryChange.emit({ ...this.query(), ...patch });
  }
}
