import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import type { ShownAndSpoken } from '../../shared/charge-text';

/** A payment as Upcoming lists it. */
export interface UpcomingPayment {
  key: string;
  /** "Nov 12", or with its year when it's not this year's. */
  date: string;
  name: string;
  amount: ShownAndSpoken;
  manual: boolean;
}

/**
 * The Calendar's Upcoming (P10): the next payments for the lists shown, one to a line (M7.8), with ↻ for a manual
 * renewal. Beside the grid from 960 px, under it below that; nothing when there are none.
 */
@Component({
  selector: 'ss-upcoming',
  imports: [MatIcon],
  templateUrl: './upcoming.html',
  styleUrl: './upcoming.scss',
})
export class Upcoming {
  readonly payments = input.required<readonly UpcomingPayment[]>();
}
