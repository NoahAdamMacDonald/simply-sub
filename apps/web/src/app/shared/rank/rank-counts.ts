import { Component, computed, input } from '@angular/core';
import { countedRanks, type RankCounts as Counts } from '@simply-sub/core';
import { RankDot } from './rank-dot';
import { rankNames } from './rank-text';

/**
 * A list's rank counts, in two columns as on the Lists wireframe (P3): all eight ranks from Essential to Unwanted, in
 * their text shades, with zero counts in grey (PROJECT-PLAN §3.2).
 */
@Component({
  selector: 'ss-rank-counts',
  imports: [RankDot],
  templateUrl: './rank-counts.html',
  styleUrl: './rank-counts.scss',
})
export class RankCounts {
  readonly counts = input.required<Counts>();

  protected readonly rows = computed(() =>
    countedRanks.map((rank) => {
      const count = this.counts()[rank];
      return {
        rank,
        count,
        name: rankNames[rank],
        shown: count > 0 ? rank : ('not-ranked' as const),
      };
    }),
  );
}
