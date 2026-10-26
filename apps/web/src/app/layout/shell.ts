import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSidenav, MatSidenavContainer, MatSidenavContent } from '@angular/material/sidenav';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { StorageService } from '../core/storage/storage-service';
import { Logo } from './logo';
import { Sidebar } from './sidebar';

/** Under 960 px the sidebar becomes a drawer, opened from a top bar (PROJECT-PLAN P1). */
export const DRAWER_BREAKPOINT = '(max-width: 959.98px)';

/** The app frame: skip link, sidebar (or drawer and top bar), and the <main> landmark. */
@Component({
  selector: 'ss-shell',
  imports: [
    MatIcon,
    MatIconButton,
    MatSidenav,
    MatSidenavContainer,
    MatSidenavContent,
    RouterOutlet,
    Logo,
    Sidebar,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  // The drawer is the only record of whether it's open. The template binds `opened` to the
  // breakpoint alone; mirroring its async openedChange into a signal made the two chase each other.
  private readonly drawer = viewChild.required(MatSidenav);
  private readonly menuButton = viewChild<MatIconButton>('menuButton');
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  private readonly storage = inject(StorageService);

  /** IndexedDB is blocked and the user chose to carry on, so nothing is saved (P15). */
  protected readonly inMemory = computed(() => this.storage.mode() === 'memory');

  protected readonly narrow = toSignal(
    inject(BreakpointObserver)
      .observe(DRAWER_BREAKPOINT)
      .pipe(map((state) => state.matches)),
    { requireSync: true },
  );

  constructor() {
    // Covers back/forward too, e.g. Android's back gesture while the drawer is open.
    inject(Router)
      .events.pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.closeDrawer());
  }

  /** After a navigation, closes the drawer and puts focus back on ☰. */
  protected closeDrawer(): void {
    const drawer = this.drawer();
    if (!this.narrow() || !drawer.opened) return;
    drawer.close();
    this.menuButton()?.focus();
  }

  /**
   * A bare href="#main" resolves against <base href> and would reload the app on its home page,
   * so the skip link moves focus itself.
   */
  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}
