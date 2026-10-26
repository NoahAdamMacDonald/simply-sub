import { Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

/**
 * A page's title row (PROJECT-PLAN §4.3): an optional back link ("‹ Lists"), the page's <h1>, and its actions,
 * projected. A line under the title (List view's "≈ $62 / mo average") goes in an element marked `subtitle`.
 */
@Component({
  selector: 'ss-page-header',
  imports: [MatIcon, RouterLink],
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss',
})
export class PageHeader {
  readonly heading = input.required<string>();
  /** Where the back link goes, as a routerLink takes it. */
  readonly backLink = input<string | readonly unknown[]>();
  /** The back link's text: the page it goes to. */
  readonly backLabel = input('Back');
}
