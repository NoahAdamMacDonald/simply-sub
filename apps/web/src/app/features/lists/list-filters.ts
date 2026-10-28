import { Component, computed, input, model } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatOption } from '@angular/material/core';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import {
  defaultListSort,
  type Category,
  type Feature,
  type ItemActivity,
  type ListFilterOptions,
  type ListSort,
  type ListViewQuery,
  type RankKey,
} from '@simply-sub/core';
import { ChipChoices, type ChipChoice } from '../../shared/filters/chip-choices';
import { FeatureFilter } from '../../shared/filters/feature-filter';
import { PriceRangeFilter, type PriceLimits } from '../../shared/filters/price-range-filter';

/** The Sort menu's choices: the sort, and each filter as its control holds it. */
export interface ListFilterState {
  sort: ListSort;
  activity: ItemActivity['kind'][];
  minPrice?: number;
  maxPrice?: number;
  features: RankKey[];
  tags: string[];
}

export const noListFilters: ListFilterState = {
  sort: defaultListSort,
  activity: [],
  features: [],
  tags: [],
};

/** List view's query: the search box's text and the Sort menu's choices. */
export function listQuery(q: string, state: ListFilterState): ListViewQuery {
  return { q, ...state };
}

const statusChoices: readonly ChipChoice[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/**
 * List view's Sort menu (P4): a sort, then the filters Search's panel has too (shared/filters): the price per month,
 * Features (an item needs them all) and Status as chips; and Tags, chips with their colours (an item needs one). Clear
 * all keeps the sort. Its choices are what the list's items have (core's listFilterOptions). The page keeps the state,
 * so it outlives the panel being closed.
 */
@Component({
  selector: 'ss-list-filters',
  imports: [
    ChipChoices,
    FeatureFilter,
    MatButton,
    MatFormField,
    MatLabel,
    MatOption,
    MatSelect,
    PriceRangeFilter,
  ],
  templateUrl: './list-filters.html',
  styleUrl: './list-filters.scss',
})
export class ListFilters {
  readonly state = model<ListFilterState>(noListFilters);
  readonly options = input.required<ListFilterOptions>();
  /** The registry, which names the features and groups their suggestions. */
  readonly features = input.required<readonly Feature[]>();
  readonly categories = input.required<readonly Category[]>();
  /** The user's currency and country, which write the slider's amounts. */
  readonly currency = input.required<string>();
  readonly country = input<string>();
  /** How many filters are set: Clear all is off with none. */
  readonly count = input(0);

  protected readonly sorts: readonly { value: ListSort; label: string }[] = [
    { value: 'price', label: 'Highest price first' },
    { value: 'name', label: 'Name, A to Z' },
    { value: 'active', label: 'Active first' },
    { value: 'interval', label: 'Shortest period first' },
  ];
  protected readonly statusChoices = statusChoices;
  /** The Features box's hint, or why it's off: nothing in the list has a feature to filter by. */
  protected readonly featuresHint = computed(() =>
    this.options().features.length > 0
      ? 'Subscriptions need every feature chosen'
      : 'None of these has a feature to filter by',
  );
  protected readonly tagChoices = computed<ChipChoice[]>(() =>
    this.options().tags.map((tag) => ({ value: tag.id, label: tag.name, color: tag.color })),
  );

  protected set(patch: Partial<ListFilterState>): void {
    this.state.update((state) => ({ ...state, ...patch }));
  }

  /** The slider let go: a limit at its end of the slider is none. */
  protected choosePrice({ min, max }: PriceLimits): void {
    this.state.update((state) => {
      const next: ListFilterState = { ...state, ...(min !== undefined && { minPrice: min }) };
      if (min === undefined) delete next.minPrice;
      if (max === undefined) delete next.maxPrice;
      else next.maxPrice = max;
      return next;
    });
  }

  protected chooseStatus(activity: readonly string[]): void {
    this.set({ activity: activity as ItemActivity['kind'][] });
  }

  /** Clear all: every filter off, the sort kept. */
  protected clearAll(): void {
    this.state.update(({ sort }) => ({ ...noListFilters, sort }));
  }
}
