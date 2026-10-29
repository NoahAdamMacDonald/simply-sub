import { Component, input, linkedSignal, model } from '@angular/core';
import { parseTagColor } from '@simply-sub/core';

/**
 * Any colour, from the device's own colour picker (P6's New tag, P13's Custom tags, M6.15): a native colour input drawn
 * as a swatch of the colour chosen, which opens the picker on a click, a tap, Enter or Space, on desktops, Android and
 * iOS alike. It and the hex field beside it follow each other: what's typed shows here once it's a colour, and a colour
 * picked here is typed there. No library, so nothing for the CSP to stop.
 */
@Component({
  selector: 'ss-colour-picker',
  templateUrl: './colour-picker.html',
  styleUrl: './colour-picker.scss',
})
export class ColourPicker {
  /** The colour as typed beside it; it shows the last one that was a colour. */
  readonly color = model.required<string>();
  readonly label = input('Choose any colour');

  /** The colour shown: what's typed when it's `#rrggbb`, else the last that was. */
  protected readonly shown = linkedSignal<string, string>({
    source: () => this.color(),
    computation: (color, previous) => parseTagColor(color) ?? previous?.value ?? '#000000',
  });

  protected picked(event: Event): void {
    const color = parseTagColor((event.target as HTMLInputElement).value);
    if (color !== undefined) this.color.set(color);
  }
}
