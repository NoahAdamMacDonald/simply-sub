import {
  DOCUMENT,
  DestroyRef,
  Injector,
  Service,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { ClockService } from '../clock/clock-service';
import { SettingsStore } from '../settings/settings-store';
import { StorageService } from '../storage/storage-service';

/** What counts as using the app: a key, a click or tap, a scroll. Moving the pointer alone doesn't. */
const activity = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

/**
 * Locks the app again (PROJECT-PLAN P13, P15; BLUEPRINT §11.5): after Lock after's time with no key, click, tap or
 * scroll, and when the page is left, closed or kept in the back-forward cache, so Back doesn't bring it back unlocked.
 * Timers in a hidden tab can run late, so coming back to the tab checks the time too. Locking closes the dialogs and the
 * snackbar, which can show the user's data, and the lock screen takes the app's place. Nothing here loads the storage
 * engine or the crypto module: StorageService.lockNow locks one that's open.
 */
@Service()
export class AutoLock {
  private readonly storage = inject(StorageService);
  private readonly clock = inject(ClockService);
  private readonly injector = inject(Injector);

  constructor() {
    const settings = inject(SettingsStore);
    const document = inject(DOCUMENT);
    const idleMs = computed(() => {
      const minutes = settings.saved()?.appLock?.idleMinutes;
      return this.storage.lock() === 'unlocked' && minutes !== undefined
        ? minutes * 60_000
        : undefined;
    });

    effect((onCleanup) => {
      const ms = idleMs();
      if (ms === undefined) return;
      let lastActive = this.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = () => {
        clearTimeout(timer);
        const idle = this.now() - lastActive;
        if (idle >= ms) this.storage.lockNow();
        else timer = setTimeout(check, ms - idle);
      };
      const active = () => (lastActive = this.now());
      const shown = () => {
        if (document.visibilityState === 'visible') check();
      };
      timer = setTimeout(check, ms);
      for (const type of activity) {
        document.addEventListener(type, active, { capture: true, passive: true });
      }
      document.addEventListener('visibilitychange', shown);
      onCleanup(() => {
        clearTimeout(timer);
        for (const type of activity) document.removeEventListener(type, active, { capture: true });
        document.removeEventListener('visibilitychange', shown);
      });
    });

    const left = () => this.storage.lockNow();
    document.defaultView?.addEventListener('pagehide', left);
    inject(DestroyRef).onDestroy(() => document.defaultView?.removeEventListener('pagehide', left));

    let wasUnlocked = false;
    effect(() => {
      const state = this.storage.lock();
      if (state === 'locked' && wasUnlocked) untracked(() => void this.closeOverlays());
      wasUnlocked = state === 'unlocked';
    });
  }

  private now(): number {
    return Date.parse(this.clock.now());
  }

  /** Closes what's open over the app. Their chunks load only now: nothing is open if they never loaded. */
  private async closeOverlays(): Promise<void> {
    const [{ MatDialog }, { MatSnackBar }] = await Promise.all([
      import('@angular/material/dialog'),
      import('@angular/material/snack-bar'),
    ]);
    this.injector.get(MatDialog).closeAll();
    this.injector.get(MatSnackBar).dismiss();
  }
}
