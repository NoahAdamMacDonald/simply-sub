import { Component, ViewContainerRef, computed, effect, inject, viewChild } from '@angular/core';
import { SettingsStore } from './core/settings/settings-store';
import { StorageService } from './core/storage/storage-service';
import { Shell } from './layout/shell';
import { StorageBlocked } from './layout/storage-blocked';

@Component({
  selector: 'ss-root',
  imports: [Shell, StorageBlocked],
  templateUrl: './app.html',
})
export class App {
  private readonly storage = inject(StorageService);
  private readonly settings = inject(SettingsStore);
  private readonly lockScreenHost = viewChild('lockScreen', { read: ViewContainerRef });

  /** IndexedDB couldn't be opened, and the user hasn't chosen to carry on without it (P15). */
  protected readonly storageBlocked = computed(
    () => this.storage.mode() === 'browser' && this.settings.status() === 'error',
  );

  /** The app lock is on and locked: the lock screen shows in place of the app, before anything with data (P15). */
  protected readonly locked = this.storage.locked;

  constructor() {
    // The lock screen loads only when the lock is on, from a dynamic import rather than @defer, whose runtime would
    // add 7.6 kB to the initial bundle. It goes with its host when the app unlocks.
    effect(() => {
      const host = this.lockScreenHost();
      if (!host) return;
      void import('./layout/lock-screen').then(({ LockScreen }) => {
        if (this.lockScreenHost() === host && host.length === 0) host.createComponent(LockScreen);
      });
    });
  }
}
