import { Component, input, model } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/** One chip: what it stands for, its name, and a tag's colour for a dot before the name. */
export interface ChipChoice {
  value: string;
  label: string;
  color?: string;
}

/**
 * A filter of choices drawn as chips, any number on (Search's Activity, P8; List view's Status and Tags, P4): native
 * checkboxes under a legend, each its own tab stop, Space turning it on or off. None on keeps everything.
 */
@Component({
  selector: 'ss-chip-choices',
  imports: [MatIcon],
  templateUrl: './chip-choices.html',
  styleUrl: './chip-choices.scss',
})
export class ChipChoices {
  readonly legend = input.required<string>();
  readonly choices = input.required<readonly ChipChoice[]>();
  /** The values on, in the order they were turned on. */
  readonly value = model<readonly string[]>([]);

  protected toggle(choice: string, on: boolean): void {
    this.value.update((value) =>
      on
        ? [...value.filter((chosen) => chosen !== choice), choice]
        : value.filter((chosen) => chosen !== choice),
    );
  }
}
