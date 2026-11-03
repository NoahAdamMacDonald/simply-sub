import { Service, inject } from '@angular/core';
import {
  checkRecord,
  policyFilePath,
  sharedPolicyFilePath,
  type Policies,
  type PolicyCache,
  type PolicySet,
} from '@simply-sub/core';
import { ClockService } from '../clock/clock-service';
import { PolicyCacheRepository } from '../storage/policy-cache-repository';
import { getJson, Unreachable } from './catalog-download';
import { CatalogStore } from './catalog-store';

/** What opening a provider's Terms and policies found (M11.8). */
export type PoliciesLoad =
  | { status: 'ready'; policies: Policies; sets: PolicySet[] }
  /** Never downloaded, and the server can't be reached: they need a connection the first time. */
  | { status: 'offline' }
  /** Something else went wrong (a file that fails its schema), which went to the console. */
  | { status: 'failed' };

/**
 * A provider's Terms and policies (M11.8, BLUEPRINT §4.10): a file of their own under /data/policies/, which a card
 * downloads when it opens them, with the shared documents they name, and keeps in catalogCache (one record per file).
 * A file read under the catalog's version is used as it is; after a new version it's read again, online, and the
 * browser revalidates it with its ETag, so an unchanged one costs a 304. Offline, the card shows what it has.
 */
@Service()
export class PolicyFiles {
  private readonly repository = inject(PolicyCacheRepository);
  private readonly catalog = inject(CatalogStore);
  private readonly clock = inject(ClockService);

  async load(providerId: string): Promise<PoliciesLoad> {
    try {
      const own = await this.file(`policies/${providerId}`, policyFilePath(providerId));
      if (!own) return { status: 'offline' };
      if (!('policies' in own.file)) throw new Error(`${own.key} isn't a provider's policies`);
      const sets: PolicySet[] = [];
      for (const id of own.file.policies.shared ?? []) {
        const set = await this.file(`policies/shared/${id}`, sharedPolicyFilePath(id));
        if (!set) return { status: 'offline' };
        if ('policies' in set.file) throw new Error(`${set.key} isn't a shared document`);
        sets.push(set.file);
      }
      return { status: 'ready', policies: own.file.policies, sets };
    } catch (error) {
      console.error(`${providerId}'s Terms and policies couldn't be loaded:`, error);
      return { status: 'failed' };
    }
  }

  /**
   * The file at `path`, kept under `key`: the kept one when it was read under the catalog's version, else downloaded
   * and kept; out of reach, the kept one whatever its version, or undefined when there's none.
   */
  private async file(key: string, path: string): Promise<PolicyCache | undefined> {
    const version = this.catalog.version();
    const kept = await this.repository.get(key).catch(() => undefined);
    if (kept && kept.catalogVersion === version) return kept;
    if (version === undefined) return kept;
    let file: unknown;
    try {
      file = await getJson(path);
    } catch (error) {
      if (error instanceof Unreachable) return kept;
      throw error;
    }
    const record = checkRecord('catalogCache', {
      key,
      file,
      catalogVersion: version,
      fetchedAt: this.clock.now(),
    });
    if (!('file' in record)) throw new Error(`${path} isn't a Terms and policies file`);
    // Shown even when it can't be kept (in-memory mode, a full disk).
    await this.repository
      .put(record)
      .catch((error: unknown) => console.error(`${path} couldn't be kept:`, error));
    return record;
  }
}
