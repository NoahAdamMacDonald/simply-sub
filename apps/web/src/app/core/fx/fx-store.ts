import { DestroyRef, Service, computed, effect, inject, signal, untracked } from '@angular/core';
import type { FxCache, FxRates } from '@simply-sub/core';
import { ClockService } from '../clock/clock-service';
import { oneAtATime } from '../one-at-a-time';
import { SettingsStore } from '../settings/settings-store';
import { FxRatesRepository } from '../storage/fx-rates-repository';

/**
 * Exchange rates (BLUEPRINT §4.7): the ECB's daily rates from GET /fx, kept in Dexie so converted prices show at
 * once on start and with no network. It fetches the rates in the user's currency once the settings have one, again
 * when it changes, when the browser is back online and when a tab is shown again; the browser's cache answers until
 * /fx's max-age runs out, so the Worker sees about one request a day. Stored rates in another base keep converting
 * until the new currency's arrive. The fetch and its schema load as a chunk of their own.
 */
@Service()
export class FxStore {
  private readonly repository = inject(FxRatesRepository);
  private readonly settings = inject(SettingsStore);
  private readonly clock = inject(ClockService);

  /** Rates this tab fetched. They stand in for the stored ones until the live query has them, or if saving failed. */
  private readonly fetched = signal<FxCache | undefined>(undefined);

  private readonly latest = computed(() => {
    const stored = this.repository.rates();
    const fetched = this.fetched();
    return !stored || (fetched && stored.fetchedAt < fetched.fetchedAt) ? fetched : stored;
  });

  private readonly currency = computed(() => this.settings.saved()?.currency);

  /** The latest rates, for pickPrice. Undefined until any have been fetched. */
  readonly rates = computed<FxRates | undefined>(() => this.latest()?.rates);

  /** Fetches the rates in the user's currency now (from the browser's cache while they're fresh). */
  readonly refresh = oneAtATime(() => this.run());

  constructor() {
    effect(() => {
      if (this.currency() !== undefined) untracked(() => void this.refresh());
    });

    const again = () => {
      if (document.visibilityState === 'visible') void this.refresh();
    };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', again);
    });
  }

  private async run(): Promise<void> {
    const currency = this.currency();
    if (currency === undefined) return;
    try {
      const { fetchRates } = await import('./fx-download');
      const rates = await fetchRates(currency, this.latest()?.rates);
      if (!rates) return;
      const record: FxCache = { key: 'fx', rates, fetchedAt: this.clock.now() };
      this.fetched.set(record);
      // Kept in this tab even if this fails.
      await this.repository
        .save(record)
        .catch((error: unknown) => console.error("The exchange rates couldn't be saved:", error));
    } catch (error) {
      console.error("The exchange rates couldn't be fetched:", error);
    }
  }
}
