import { Component, Injector, computed, effect, inject, untracked } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { catalogDay } from '../core/catalog/catalog-dates';
import { CatalogStore } from '../core/catalog/catalog-store';

/**
 * The catalog's two global messages (PROJECT-PLAN P1): a line at the top of every page while offline, with the date
 * of the catalog the app is using, and a "Catalog updated" toast when a new version replaces the one on screen, in
 * every open tab. A first download isn't announced: there was nothing before it.
 */
@Component({
  selector: 'ss-catalog-status',
  imports: [MatIcon],
  templateUrl: './catalog-status.html',
  styleUrl: './catalog-status.scss',
})
export class CatalogStatus {
  private readonly catalog = inject(CatalogStore);
  private readonly injector = inject(Injector);

  protected readonly notice = computed(() => {
    if (!this.catalog.offline()) return undefined;
    const generatedAt = this.catalog.generatedAt();
    return generatedAt === undefined
      ? "Offline — the catalog will load when you're back online"
      : `Offline — catalog from ${catalogDay(generatedAt)}`;
  });

  constructor() {
    // The version on screen. Undefined while the country's file isn't there (a new country's file downloading).
    let shown: string | undefined;
    effect(() => {
      const version = this.catalog.version();
      if (version === undefined) return;
      if (shown !== undefined && version !== shown) {
        // A toast that can't load (its chunk, offline) isn't worth an error message.
        untracked(() => this.announce().catch(() => undefined));
      }
      shown = version;
    });
  }

  private async announce(): Promise<void> {
    // Loaded on first use, as GlobalErrorHandler does, so the snackbar stays out of the initial bundle.
    const { MatSnackBar } = await import('@angular/material/snack-bar');
    this.injector.get(MatSnackBar).open('Catalog updated', undefined, { duration: 5000 });
  }
}
