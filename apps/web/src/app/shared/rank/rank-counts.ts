import { Component, booleanAttribute, computed, input } from '@angular/core';
import { countedRanks, type RankCounts as Counts } from '@simply-sub/core';
import { RankDot } from './rank-dot';
import { rankNames } from './rank-text';

/**
 * A list's rank counts, in two columns as on the Lists wireframe (P3): all eight ranks from Essential to Unwanted, in
 * their text shades, with zero counts in grey (PROJECT-PLAN §3.2). Compact, only the ranks counted, in a row that
 * wraps, and nothing when none is: a Search card's "2 Needed · 1 Wanted" (P8, the feedback after M6.9).
 */
@Component({
  selector: 'ss-rank-counts',
  imports: [RankDot],
  templateUrl: './rank-counts.html',
  styleUrl: './rank-counts.scss',
})
export class RankCounts {
  readonly counts = input.required<Counts>();
  readonly compact = input(false, { transform: booleanAttribute });

  protected readonly rows = computed(() =>
    countedRanks
      .map((rank) => {
        const count = this.counts()[rank];
        return {
          rank,
          count,
          name: rankNames[rank],
          shown: count > 0 ? rank : ('not-ranked' as const),
        };
      })
      .filter((row) => !this.compact() || row.count > 0),
  );
}
