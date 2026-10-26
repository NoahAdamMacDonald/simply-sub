import { Component, computed, input } from '@angular/core';
import type { Rank } from '@simply-sub/core';
import { RankDot } from './rank-dot';
import { rankNames } from './rank-text';

/** A rank as a dot and its name, in the normal text colour, which reads in every rank and both themes (BLUEPRINT §8.1). */
@Component({
  selector: 'ss-rank-chip',
  imports: [RankDot],
  templateUrl: './rank-chip.html',
  styleUrl: './rank-chip.scss',
})
export class RankChip {
  readonly rank = input.required<Rank>();

  protected readonly name = computed(() => rankNames[this.rank()]);
}
