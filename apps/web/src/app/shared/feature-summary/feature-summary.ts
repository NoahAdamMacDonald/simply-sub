import { Component, computed, input, signal } from '@angular/core';
import type { FeatureSummaryRow } from '@simply-sub/core';

let nextId = 0;

/**
 * A feature summary, "VPN: 2 / 3" (PROJECT-PLAN §3.2): for each key, the active items that provide it out of all the
 * items that do. Core's featureSummary (M6.1) chooses and orders the rows. With a `limit`, it shows that many and a
 * button that shows the rest.
 */
@Component({
  selector: 'ss-feature-summary',
  templateUrl: './feature-summary.html',
  styleUrl: './feature-summary.scss',
})
export class FeatureSummary {
  readonly rows = input.required<readonly FeatureSummaryRow[]>();
  /** How many rows show until Show all; all of them without one. */
  readonly limit = input<number>();

  protected readonly id = `ss-feature-summary-${nextId++}`;
  protected readonly expanded = signal(false);
  /** Whether there are rows past the limit. */
  protected readonly folds = computed(() => {
    const limit = this.limit();
    return limit !== undefined && this.rows().length > limit;
  });
  protected readonly shown = computed(() =>
    this.folds() && !this.expanded() ? this.rows().slice(0, this.limit()) : this.rows(),
  );
}
