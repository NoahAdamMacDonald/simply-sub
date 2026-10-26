import { Service, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import type { CatalogCache } from '@simply-sub/core';
import { storageStatus } from './record-repository';
import { StorageService } from './storage-service';

/**
 * The downloaded catalog files (BLUEPRINT §4.6): one record per file, keyed by the region it serves, or `catalog` for
 * the full catalog.json. CatalogStore (M4.3) builds on it. A file that fails its schema is left out, and the next
 * check downloads it again.
 */
@Service()
export class CatalogCacheRepository {
  private readonly storage = inject(StorageService);
  private readonly stored = rxResource({
    params: () => this.storage.mode(),
    stream: () => this.storage.watch('catalogCache'),
  });

  /** The valid cached files, by key, following every write in any tab. */
  readonly files = computed<ReadonlyMap<string, CatalogCache>>(
    () =>
      new Map(this.stored.hasValue() ? this.stored.value().map((file) => [file.key, file]) : []),
  );
  readonly status = computed(() => storageStatus(this.stored));

  /** The valid cached files as stored now, which the live query can lag behind after another tab's write. */
  async read(): Promise<CatalogCache[]> {
    const engine = await this.storage.engine();
    return engine.read('catalogCache');
  }

  /** Stores downloaded files in place of the ones with their keys, and deletes the ones keyed `remove`, at once. */
  async replace(files: readonly CatalogCache[], remove: readonly string[]): Promise<void> {
    const engine = await this.storage.engine();
    await engine.replace('catalogCache', files, remove);
  }
}
