import { Component, input } from '@angular/core';
import type { Tag } from '@simply-sub/core';

/**
 * A tag: a dot in its colour and its name in the normal text colour, so a colour the user picked never decides the
 * name's contrast (PROJECT-PLAN §4.3).
 */
@Component({
  selector: 'ss-tag-chip',
  templateUrl: './tag-chip.html',
  styleUrl: './tag-chip.scss',
})
export class TagChip {
  readonly tag = input.required<Tag>();
}
