import { Component, computed, input } from '@angular/core';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';

/** One of the user's lists, as "· 2 lists" names it. */
export interface NamedList {
  id: string;
  name: string;
}

/**
 * "2 lists" after a Search card's status (P8, the feedback after M6.9): a button that names the lists on hover or
 * focus and opens a menu of links to them. Only words when it isn't given their names.
 */
@Component({
  selector: 'ss-in-lists',
  imports: [MatMenu, MatMenuItem, MatMenuTrigger, MatTooltip, RouterLink],
  templateUrl: './in-lists.html',
  styleUrl: './in-lists.scss',
})
export class InLists {
  /** How many lists have it. */
  readonly count = input.required<number>();
  /** Those lists, by name. */
  readonly lists = input<readonly NamedList[]>([]);
  /** Its provider's name, for the menu's: "Lists with Netflix". */
  readonly provider = input.required<string>();

  protected readonly text = computed(
    () => `${this.count()} ${this.count() === 1 ? 'list' : 'lists'}`,
  );
  /** "In Work Related and Family". */
  protected readonly names = computed(() => {
    const names = this.lists().map((list) => list.name);
    const last = names.pop();
    return `In ${names.length > 0 ? `${names.join(', ')} and ` : ''}${last ?? ''}`;
  });
}
