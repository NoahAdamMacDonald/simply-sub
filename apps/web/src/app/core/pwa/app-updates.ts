import {
  DOCUMENT,
  DestroyRef,
  InjectionToken,
  Injector,
  Service,
  computed,
  inject,
  signal,
} from '@angular/core';
import type { SwUpdate } from '@angular/service-worker';
import { catalogCheckDue, type Timestamp } from '@simply-sub/core';
import { ClockService } from '../clock/clock-service';
import { StorageService } from '../storage/storage-service';

/** What a check for a new version of the app found. */
export type AppCheckOutcome = 'current' | 'ready' | 'offline' | 'failed';

/** Reloads the page, into the new version; tests stand in for it, since their DOM can't navigate. */
export const RELOAD_PAGE = new InjectionToken<() => void>('RELOAD_PAGE', {
  providedIn: 'root',
  factory: () => {
    const location = inject(DOCUMENT).location;
    return () => location.reload();
  },
});

/**
 * New versions of the app (PROJECT-PLAN M10.6). The service worker checks on each page load and downloads a new one in
 * the background; this offers to reload into it, asks the worker again when a tab is shown after an hour (the catalog's
 * rule), and checks from Settings. A page load asks the network for index.html first ('freshness'), so a page can start
 * on a version the worker learns of only afterwards: it's moved onto it with no prompt. It starts with the worker
 * (app.background.ts); in a development build, or a browser that refuses service workers, there's nothing to check with.
 */
@Service()
export class AppUpdates {
  private readonly clock = inject(ClockService);
  private readonly storage = inject(StorageService);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly reload = inject(RELOAD_PAGE);
  private readonly destroyRef = inject(DestroyRef);
  private readonly worker = signal<SwUpdate | undefined>(undefined);
  private lastCheckedAt?: Timestamp;

  /** Whether the app can check for a new version: its worker is running. */
  readonly available = computed(() => this.worker() !== undefined);

  /** Starts with the worker, which has just checked for a new version itself. */
  watch(update: SwUpdate): void {
    this.worker.set(update);
    this.lastCheckedAt = this.clock.now();
    update.versionUpdates.subscribe(async (event) => {
      if (event.type !== 'VERSION_READY') return;
      if (await this.runsLatest()) {
        await update.activateUpdate().catch(() => undefined);
        return;
      }
      // Reloading starts the app afresh: locked, when the lock is on (P15). A list being edited is a draft, kept.
      const locks = this.storage.lock() === 'unlocked' ? ' Reloading locks the app.' : '';
      this.offerReload(`A new version of Simply Sub is ready.${locks}`);
    });
    update.unrecoverable.subscribe(() =>
      this.offerReload('Simply Sub needs to reload to keep working.'),
    );
    const shown = () => {
      if (
        this.document.visibilityState === 'visible' &&
        catalogCheckDue(this.lastCheckedAt, this.clock.now())
      ) {
        void this.check();
      }
    };
    this.document.addEventListener('visibilitychange', shown);
    this.destroyRef.onDestroy(() => this.document.removeEventListener('visibilitychange', shown));
  }

  /** Asks the worker for a new version now; one it finds is downloaded and offered with a reload. */
  async check(): Promise<AppCheckOutcome> {
    const update = this.worker();
    if (!update) return 'failed';
    // The worker counts a check it couldn't make as "no new version".
    if (!navigator.onLine) return 'offline';
    this.lastCheckedAt = this.clock.now();
    try {
      return (await update.checkForUpdate()) ? 'ready' : 'current';
    } catch {
      return 'failed';
    }
  }

  /** Whether this page's main script is one of the latest version's files, read past the worker. */
  private async runsLatest(): Promise<boolean> {
    const main = this.document.querySelector('script[src*="main-"]')?.getAttribute('src');
    if (!main) return false;
    try {
      const response = await fetch('/ngsw.json?ngsw-bypass', { cache: 'no-store' });
      const { hashTable } = (await response.json()) as { hashTable?: Record<string, string> };
      return hashTable?.[new URL(main, this.document.baseURI).pathname] !== undefined;
    } catch {
      return false;
    }
  }

  private offerReload(message: string): void {
    // Loaded on first use, as the catalog's toast is, so the snackbar stays out of the initial bundle.
    import('@angular/material/snack-bar')
      .then(({ MatSnackBar }) =>
        this.injector
          .get(MatSnackBar)
          .open(message, 'Reload')
          .onAction()
          .subscribe(() => this.reload()),
      )
      .catch(() => undefined);
  }
}
