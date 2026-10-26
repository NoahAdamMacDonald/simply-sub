import { Service, computed, inject } from '@angular/core';
import { salesTaxRate, type Settings } from '@simply-sub/core';
import { SettingsRepository } from '../storage/settings-repository';

/** What the user chooses: the settings without the record's key and timestamp. */
export type SettingsValues = Omit<Settings, 'key' | 'updatedAt'>;

/**
 * The user's settings (BLUEPRINT §4.6), on SettingsRepository: the saved ones, whether the first-run dialog has to ask
 * for them, and the sales tax they lead to (§4.8). Pages read the region, currency and budgets here.
 */
@Service()
export class SettingsStore {
  private readonly repository = inject(SettingsRepository);

  /** `error`: storage couldn't be opened (IndexedDB blocked, P15). */
  readonly status = this.repository.status;

  /** The saved settings. Undefined until the first-run dialog saves them, and when they can't be read. */
  readonly saved = this.repository.settings;

  /** Whether the first-run dialog has to ask: the settings have loaded, and none are saved. */
  readonly needsFirstRun = computed(() => this.status() === 'ready' && this.saved() === undefined);

  /** The sales tax added to listed prices, or undefined where none is. */
  readonly salesTax = computed(() => {
    const saved = this.saved();
    return saved && salesTaxRate(saved);
  });

  /** Saves every setting, in place of the saved ones (the first-run and 📍 dialogs). */
  save(values: SettingsValues): Promise<Settings> {
    return this.repository.save(values);
  }

  /** Changes some settings; a field set to undefined is cleared. Nothing is written before the first run. */
  update(changes: Partial<SettingsValues>): Promise<Settings | undefined> {
    return this.repository.update(changes);
  }
}
