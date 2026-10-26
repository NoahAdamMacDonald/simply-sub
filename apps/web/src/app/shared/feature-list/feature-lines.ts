import { Component, input } from '@angular/core';
import type { Rank, RankKey } from '@simply-sub/core';
import { RankChip } from '../rank/rank-chip';

/** A row as the list shows it: the feature, its value, the user's ranks among the keys it provides, its children. */
export interface FeatureLine {
  id: string;
  name: string;
  value?: string;
  ranks: { key: RankKey; rank: Rank; option?: string }[];
  children: FeatureLine[];
}

/** One level of ss-feature-list, with each group's features in a nested level of its own. */
@Component({
  selector: 'ss-feature-lines',
  imports: [RankChip],
  templateUrl: './feature-lines.html',
  styleUrl: './feature-lines.scss',
})
export class FeatureLines {
  readonly lines = input.required<readonly FeatureLine[]>();
}
