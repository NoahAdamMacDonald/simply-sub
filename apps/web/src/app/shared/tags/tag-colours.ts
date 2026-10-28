import { Component, input, model } from '@angular/core';
import { tagColorPresets } from '@simply-sub/core';

let nextId = 0;

/**
 * A tag's colour as one of core's 12 presets (P6's Create tag, P13's Custom tags): radio buttons drawn as swatches,
 * so the arrow keys move between them, each named for screen readers. A colour that's no preset (typed in Settings'
 * hex field) leaves none checked.
 */
@Component({
  selector: 'ss-tag-colours',
  templateUrl: './tag-colours.html',
  styleUrl: './tag-colours.scss',
})
export class TagColours {
  /** The colour, `#rrggbb`. */
  readonly color = model.required<string>();
  readonly legend = input('Colour');

  protected readonly presets = tagColorPresets;
  protected readonly name = `ss-tag-colours-${nextId++}`;
}
