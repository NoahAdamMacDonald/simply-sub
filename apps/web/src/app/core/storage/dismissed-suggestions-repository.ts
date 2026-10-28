import { Service, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { softDeleted, withChanges, type DismissedSuggestion } from '@simply-sub/core';
import { storageStatus } from './record-repository';
import { StorageService } from './storage-service';

/**
 * The optimizer suggestions the user dismissed (PROJECT-PLAN P14, M8.2), keyed by fingerprint. A change to the list
 * gives its suggestions new fingerprints, so a dismissal holds only while the list stays the same. Showing one again
 * soft-deletes its record, which a sync can pass on. Sealed by the app lock and backed up, like the other user tables.
 */
@Service()
export class DismissedSuggestionsRepository {
  private readonly storage = inject(StorageService);
  private readonly stored = rxResource({
    params: () => this.storage.access(),
    stream: () => this.storage.watch('dismissedSuggestions'),
  });

  /** The dismissed suggestions' fingerprints. */
  readonly fingerprints = computed<ReadonlySet<string>>(() => {
    const records: readonly DismissedSuggestion[] = this.stored.hasValue()
      ? this.stored.value()
      : [];
    return new Set(
      records
        .filter((record) => record.deletedAt === undefined)
        .map((record) => record.fingerprint),
    );
  });
  readonly status = computed(() => storageStatus(this.stored));

  /** Dismisses a suggestion of the list. A stored record that can't be read is replaced. */
  async dismiss(fingerprint: string, listId: string): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.modify(
      'dismissedSuggestions',
      fingerprint,
      (current) =>
        current
          ? withChanges(current, { listId, deletedAt: undefined }, now)
          : { fingerprint, listId, createdAt: now, updatedAt: now },
      { invalid: 'replace' },
    );
  }

  /** Shows a dismissed suggestion again: its record is soft-deleted. */
  async restore(fingerprint: string): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.modify('dismissedSuggestions', fingerprint, (current) =>
      current !== undefined && current.deletedAt === undefined
        ? softDeleted(current, now)
        : undefined,
    );
  }
}
