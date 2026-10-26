import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/**
 * What a page shows when it has nothing to show yet (PROJECT-PLAN §4.3): an icon, a heading, a line of text
 * (projected) and the actions that fill it, projected in an element marked `actions`.
 */
@Component({
  selector: 'ss-empty-state',
  imports: [MatIcon],
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.scss',
})
export class EmptyState {
  /** A Material Symbols name. */
  readonly icon = input.required<string>();
  readonly heading = input.required<string>();
}
