import { Location } from '@angular/common';
import { Component, booleanAttribute, inject, input } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink } from '@angular/router';

/**
 * A page's title row (PROJECT-PLAN §4.3): a back button above it on every page the sidebar doesn't list ("← Lists",
 * the feedback after M6.9), the page's <h1>, and its actions, projected. A line under the title (List view's
 * "≈ $62 / mo average") goes in an element marked `subtitle`.
 */
@Component({
  selector: 'ss-page-header',
  imports: [MatButton, MatIcon, RouterLink],
  templateUrl: './page-header.html',
  styleUrl: './page-header.scss',
})
export class PageHeader {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  readonly heading = input.required<string>();
  /** Where the back button goes, as a routerLink takes it. */
  readonly backLink = input<string | readonly unknown[]>();
  /** The back button's text: the page it goes to. */
  readonly backLabel = input('Back');
  /**
   * Back where the user came from instead, and to `backLink` only when this was the first page opened: Settings, which
   * the sidebar opens from any page.
   */
  readonly backInHistory = input(false, { transform: booleanAttribute });

  protected goBack(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) {
      this.location.back();
    } else {
      const link = this.backLink() ?? '/';
      void (typeof link === 'string'
        ? this.router.navigateByUrl(link)
        : this.router.navigate([...link]));
    }
  }
}
