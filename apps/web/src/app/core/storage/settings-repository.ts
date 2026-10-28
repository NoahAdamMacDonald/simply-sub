import { Service, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { nextUpdatedAt, withChanges, type Settings } from '@simply-sub/core';
import { storageStatus } from './record-repository';
import { StorageService } from './storage-service';

/** The user's settings: one record (BLUEPRINT §4.6). SettingsStore (M4.2) builds on it. */
@Service()
export class SettingsRepository {
  private readonly storage = inject(StorageService);
  private readonly stored = rxResource({
    params: () => this.storage.access(),
    stream: () => this.storage.watch('settings'),
  });

  /** The saved settings. Undefined until the first-run dialog (P1) saves them, or when they can't be read. */
  readonly settings = computed<Settings | undefined>(() =>
    this.stored.hasValue() ? this.stored.value().find((row) => row.key === 'settings') : undefined,
  );
  readonly status = computed(() => storageStatus(this.stored));

  /**
   * Saves the settings in place of the saved ones, including saved ones that can't be read. The app lock stays as it
   * is: only its own methods change it.
   */
  async save(settings: Omit<Settings, 'key' | 'updatedAt' | 'appLock'>): Promise<Settings> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    const saved = await engine.modify(
      'settings',
      'settings',
      (current) => ({
        ...settings,
        key: 'settings',
        updatedAt: current ? nextUpdatedAt(current.updatedAt, now) : now,
      }),
      { invalid: 'replace' },
    );
    return saved as Settings;
  }

  /**
   * Changes some of the saved settings; a field set to undefined is cleared. Nothing is written when none are saved, or
   * the saved ones can't be read: the first-run dialog then asks for them. Returns what's saved afterwards.
   */
  async update(
    changes: Partial<Omit<Settings, 'key' | 'updatedAt' | 'appLock'>>,
  ): Promise<Settings | undefined> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    return engine.modify(
      'settings',
      'settings',
      (current) => current && withChanges<Settings>(current, changes, now),
      { invalid: 'replace' },
    );
  }
}
