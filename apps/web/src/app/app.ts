import { Component, computed, inject } from '@angular/core';
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

  /** IndexedDB couldn't be opened, and the user hasn't chosen to carry on without it (P15). */
  protected readonly storageBlocked = computed(
    () => this.storage.mode() === 'browser' && this.settings.status() === 'error',
  );
}
