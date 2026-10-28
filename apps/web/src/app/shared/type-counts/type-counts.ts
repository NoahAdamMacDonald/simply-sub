import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import type { TypeCount } from '@simply-sub/core';

/**
 * How many subscriptions of each type a list has, "Streaming video: 3", with the type's icon (P3, P4; the feedback
 * after M6.8). Core's typeCounts counts and orders them.
 */
@Component({
  selector: 'ss-type-counts',
  imports: [MatIcon],
  templateUrl: './type-counts.html',
  styleUrl: './type-counts.scss',
})
export class TypeCounts {
  readonly types = input.required<readonly TypeCount[]>();
}
