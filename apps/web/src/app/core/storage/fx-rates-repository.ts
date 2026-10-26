import { Service, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { FxCache } from '@simply-sub/core';
import { storageStatus } from './record-repository';
import { StorageService } from './storage-service';

/**
 * The last exchange rates fetched (BLUEPRINT §4.7): one record, under the key `fx`. FxStore (M4.4) builds on it. A
 * record that fails its schema is left out, and the next fetch replaces it.
 */
@Service()
export class FxRatesRepository {
  private readonly storage = inject(StorageService);
  private readonly stored = rxResource({
    params: () => this.storage.mode(),
    stream: () => this.storage.watch('fxRates'),
  });

  /** The stored rates, following every write in any tab. */
  readonly rates = computed<FxCache | undefined>(() =>
    this.stored.hasValue() ? this.stored.value().find((row) => row.key === 'fx') : undefined,
  );
  readonly status = computed(() => storageStatus(this.stored));

  /** Stores `rates` in place of the stored ones. */
  async save(rates: FxCache): Promise<void> {
    const engine = await this.storage.engine();
    await engine.replace('fxRates', [rates], []);
  }
}
