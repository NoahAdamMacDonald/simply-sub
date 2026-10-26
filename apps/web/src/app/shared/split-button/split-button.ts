import { Component, computed, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';

export interface SplitButtonItem {
  id: string;
  label: string;
  /** A Material Symbols name. */
  icon?: string;
}

/**
 * A main action and a menu of related ones (the Calendar's [Export to file ▾] and [Sync calendar ▾], P10). The main
 * button does the first item, and the menu lists every item. Both emit the chosen item's id.
 */
@Component({
  selector: 'ss-split-button',
  imports: [MatButton, MatIcon, MatMenu, MatMenuItem, MatMenuTrigger],
  templateUrl: './split-button.html',
  styleUrl: './split-button.scss',
})
export class SplitButton {
  readonly label = input.required<string>();
  readonly items = input.required<readonly SplitButtonItem[]>();
  readonly action = output<string>();

  protected readonly main = computed(() => this.items()[0]);
}
