import { Component, input } from '@angular/core';
import type { Rank } from '@simply-sub/core';

/**
 * A rank's colour dot (BLUEPRINT §8.1). It's decorative: the rank's name always goes beside it, for colour-blind
 * users and screen readers (ss-rank-chip, or the dropdown's text).
 */
@Component({
  selector: 'ss-rank-dot',
  templateUrl: './rank-dot.html',
  styleUrl: './rank-dot.scss',
  host: { 'aria-hidden': 'true' },
})
export class RankDot {
  readonly rank = input.required<Rank>();
}
