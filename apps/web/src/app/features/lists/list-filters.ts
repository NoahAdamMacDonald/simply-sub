import { Component, input, model } from '@angular/core';
import { FormField, disabled, form, validateTree, type FieldTree } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatOption } from '@angular/material/core';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import {
  defaultListSort,
  listPriceRange,
  type ListFilterOptions,
  type ListSort,
  type ListViewQuery,
  type RankKey,
} from '@simply-sub/core';
import { issueErrors } from '../../shared/form-issues';

/** The Sort menu's choices, as its fields hold them: '' is All, and the prices are as typed. */
export interface ListFilterState {
  sort: ListSort;
  activity: '' | 'active' | 'inactive';
  min: string;
  max: string;
  features: RankKey[];
  tags: string[];
}

export const noListFilters: ListFilterState = {
  sort: defaultListSort,
  activity: '',
  min: '',
  max: '',
  features: [],
  tags: [],
};

/** List view's query: the search box's text and the Sort menu's choices, with only the prices that read. */
export function listQuery(q: string, state: ListFilterState): ListViewQuery {
  const { minPrice, maxPrice } = listPriceRange(state);
  return {
    q,
    sort: state.sort,
    ...(state.activity !== '' && { activity: state.activity }),
    ...(minPrice !== undefined && { minPrice }),
    ...(maxPrice !== undefined && { maxPrice }),
    features: state.features,
    tags: state.tags,
  };
}

/**
 * List view's Sort menu (P4): a sort, Active only or Inactive only, a price range per month, features an item must
 * all have and tags it needs one of, and Clear all, which keeps the sort. Its choices are what the list's items have
 * (core's listFilterOptions); Features and Tags are there with none, turned off and saying why. The page keeps the
 * state, so it outlives the panel being closed.
 */
@Component({
  selector: 'ss-list-filters',
  imports: [
    FormField,
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
  ],
  templateUrl: './list-filters.html',
  styleUrl: './list-filters.scss',
})
export class ListFilters {
  readonly state = model<ListFilterState>(noListFilters);
  readonly options = input.required<ListFilterOptions>();
  /** How many filters are set: Clear all is off with none. */
  readonly count = input(0);

  protected readonly form = form(this.state, (path) => {
    validateTree(path, ({ value, fieldTree }) =>
      issueErrors(fieldTree, listPriceRange(value()).issues),
    );
    disabled(path.features, { when: () => this.options().features.length === 0 });
    disabled(path.tags, { when: () => this.options().tags.length === 0 });
  });

  protected readonly sorts: readonly { value: ListSort; label: string }[] = [
    { value: 'price', label: 'Highest price first' },
    { value: 'name', label: 'Name, A to Z' },
    { value: 'active', label: 'Active first' },
    { value: 'interval', label: 'Shortest period first' },
  ];

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** Clear all: every filter off, the sort kept. */
  protected clearAll(): void {
    this.state.update(({ sort }) => ({ ...noListFilters, sort }));
  }
}
