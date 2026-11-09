import {
  Component,
  ViewContainerRef,
  computed,
  effect,
  inject,
  viewChild,
  type Signal,
  type Type,
} from '@angular/core';
import { SettingsStore } from './core/settings/settings-store';
import { StorageService } from './core/storage/storage-service';
import { Shell } from './layout/shell';

@Component({
  selector: 'ss-root',
  imports: [Shell],
  templateUrl: './app.html',
})
export class App {
  private readonly storage = inject(StorageService);
  private readonly settings = inject(SettingsStore);
  private readonly lockScreenHost = viewChild('lockScreen', { read: ViewContainerRef });
  private readonly storageBlockedHost = viewChild('storageBlocked', { read: ViewContainerRef });

  /** IndexedDB couldn't be opened, and the user hasn't chosen to carry on without it (P15). */
  protected readonly storageBlocked = computed(
    () => this.storage.mode() === 'browser' && this.settings.status() === 'error',
  );

  /** The app lock is on and locked: the lock screen shows in place of the app, before anything with data (P15). */
  protected readonly locked = this.storage.locked;

  constructor() {
    // The lock screen and the storage notice load only when they're shown, from a dynamic import rather than @defer,
    // whose runtime would add 7.6 kB to the initial bundle.
    showIn(this.lockScreenHost, () =>
      import('./layout/lock-screen').then(({ LockScreen }) => LockScreen),
    );
    showIn(this.storageBlockedHost, () =>
      import('./layout/storage-blocked').then(({ StorageBlocked }) => StorageBlocked),
    );
  }
}

/** Shows the component `load` gives in `host` while the host is there. It goes with its host. */
function showIn(
  host: Signal<ViewContainerRef | undefined>,
  load: () => Promise<Type<unknown>>,
): void {
  effect(() => {
    const container = host();
    if (!container) return;
    void load().then((component) => {
      if (host() === container && container.length === 0) container.createComponent(component);
    });
  });
}
