import { Component, computed, inject, input } from '@angular/core';
import {
  planFeatureRows,
  type Plan,
  type PlanFeatureRow,
  type Rank,
  type RankKey,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FeatureLines, type FeatureLine } from './feature-lines';

/**
 * A plan's features, each under its parent group, with the user's rank beside each key it provides that's ranked
 * (Search's and List view's expanded cards, P4 and P8). Core's planFeatureRows picks the rows, from the catalog's
 * registry; `ranks` are the item's effective ranks or the profile's, and an unranked key shows nothing.
 */
@Component({
  selector: 'ss-feature-list',
  imports: [FeatureLines],
  templateUrl: './feature-list.html',
  styleUrl: './feature-list.scss',
})
export class FeatureList {
  private readonly catalog = inject(CatalogStore);

  readonly plan = input.required<Plan>();
  readonly ranks = input<Readonly<Partial<Record<RankKey, Rank>>>>({});

  protected readonly lines = computed(() => {
    const ranks = this.ranks();
    const line = (row: PlanFeatureRow): FeatureLine => ({
      id: row.feature.id,
      name: row.feature.name,
      ...(row.value !== undefined && { value: row.value }),
      ranks: row.keys.flatMap(({ key, option }) => {
        const rank = ranks[key];
        if (rank === undefined || rank === 'not-ranked') return [];
        // A feature with one key (a boolean) needs no option name: the rank is the feature's.
        return [{ key, rank, ...(row.keys.length > 1 && option !== undefined && { option }) }];
      }),
      children: row.children.map(line),
    });
    return planFeatureRows(this.plan().features, this.catalog.catalog()?.features ?? []).map(line);
  });
}
