import { Service, inject } from '@angular/core';
import type { PolicyCache } from '@simply-sub/core';
import { StorageService } from './storage-service';

/**
 * The Terms and policies files cards have opened (M11.8, BLUEPRINT §6.3): `catalogCache` records keyed `policies/<id>`
 * and `policies/shared/<id>`, beside the catalog files CatalogCacheRepository keeps. Only PolicyFiles uses it, so it
 * stays out of the initial bundle.
 */
@Service()
export class PolicyCacheRepository {
  private readonly storage = inject(StorageService);

  /** The valid kept file keyed `key`: undefined when there's none, or it fails its schema. */
  async get(key: string): Promise<PolicyCache | undefined> {
    const engine = await this.storage.engine();
    const record = await engine.transaction(['catalogCache'], (transaction) =>
      transaction.get('catalogCache', key, { invalid: 'replace' }),
    );
    return record && 'file' in record ? record : undefined;
  }

  /** Keeps `file` in place of the one with its key. */
  async put(file: PolicyCache): Promise<void> {
    const engine = await this.storage.engine();
    await engine.replace('catalogCache', [file], []);
  }
}
