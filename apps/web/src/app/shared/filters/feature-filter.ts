import {
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { MatAutocomplete, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatChipGrid, MatChipInput, MatChipRemove, MatChipRow } from '@angular/material/chips';
import { MatOptgroup, MatOption } from '@angular/material/core';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import {
  featureSuggestions,
  rankKeyLabel,
  rankKeyOptions,
  type Category,
  type Feature,
  type RankKey,
  type RankKeyOption,
} from '@simply-sub/core';

/**
 * Features, as a filter (Search's panel, P8; List view's Sort menu, P4): the rank keys chosen, each a chip that a click
 * anywhere removes (M5.9), and a box that suggests the rest by what's typed (core's featureSuggestions), grouped by
 * feature category. Everything shown must have every one chosen.
 */
@Component({
  selector: 'ss-feature-filter',
  imports: [
    MatAutocomplete,
    MatAutocompleteTrigger,
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
  ],
  templateUrl: './feature-filter.html',
  styleUrl: './feature-filter.scss',
})
export class FeatureFilter {
  private readonly injector = inject(Injector);
  private readonly suggestionList = viewChild.required(MatAutocomplete);

  /** The keys there are to suggest: what can be filtered by here. */
  readonly keys = input.required<readonly RankKeyOption[]>();
  /** The registry, which names a chosen key and groups the suggestions by feature category. */
  readonly features = input.required<readonly Feature[]>();
  readonly categories = input.required<readonly Category[]>();
  /** "Plans need every feature chosen", or why there's nothing to suggest. */
  readonly hint = input.required<string>();
  /** The keys chosen, in the order they were picked. */
  readonly value = model<readonly RankKey[]>([]);

  /** The chosen keys, named by the registry. */
  protected readonly picked = computed(() => {
    const options = this.features().flatMap(rankKeyOptions);
    return this.value().flatMap((key) => options.find((option) => option.key === key) ?? []);
  });
  /** Nothing to suggest and nothing chosen: the box is turned off. */
  protected readonly off = computed(() => this.keys().length === 0 && this.value().length === 0);
  /** What's typed in the box. */
  protected readonly text = signal('');
  protected readonly suggestions = computed(() =>
    featureSuggestions(this.text(), {
      keys: this.keys(),
      categories: this.categories(),
      picked: this.value(),
    }),
  );
  protected readonly label = rankKeyLabel;

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

  protected add(key: RankKey, box: HTMLInputElement): void {
    box.value = '';
    this.text.set('');
    this.value.update((value) => [...value, key]);
  }

  protected remove(option: RankKeyOption): void {
    this.value.update((value) => value.filter((key) => key !== option.key));
  }
}
