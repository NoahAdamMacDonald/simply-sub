import { Service, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { nextUpdatedAt, softDeleted, withChanges, type LiveCalendar } from '@simply-sub/core';
import { storageStatus } from './record-repository';
import { StorageService } from './storage-service';

/** What the app writes of the live calendar's record: all but its key and stamps. */
export type LiveCalendarFields = Omit<LiveCalendar, 'key' | 'updatedAt' | 'deletedAt'>;

/**
 * The live calendar's feed set (PROJECT-PLAN P10, M10.3; BLUEPRINT §11.3): one record, under the key `liveCalendar`.
 * The app lock seals it, since its manage key changes and revokes the links; a revoke soft-deletes it, so a sync passes
 * that on (M10.9). LiveCalendarService builds on it.
 */
@Service()
export class LiveCalendarRepository {
  private readonly storage = inject(StorageService);
  private readonly stored = rxResource({
    params: () => this.storage.access(),
    stream: () => this.storage.watch('liveCalendar'),
  });

  /** The feed set, while there is one. */
  readonly record = computed<LiveCalendar | undefined>(() => {
    const record = this.stored.hasValue()
      ? this.stored.value().find((row) => row.key === 'liveCalendar')
      : undefined;
    return record?.deletedAt === undefined ? record : undefined;
  });
  readonly status = computed(() => storageStatus(this.stored));

  /** The feed set as stored now, read once: for Delete all data, which may come before the record has loaded. */
  async readOnce(): Promise<LiveCalendar | undefined> {
    const engine = await this.storage.engine();
    const record = (await engine.read('liveCalendar')).find((row) => row.key === 'liveCalendar');
    return record?.deletedAt === undefined ? record : undefined;
  }

  /** Stores a new feed set in place of any before it, a revoked one included. */
  async save(fields: LiveCalendarFields): Promise<LiveCalendar> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    const saved = await engine.modify(
      'liveCalendar',
      'liveCalendar',
      (current) => ({
        ...fields,
        key: 'liveCalendar',
        updatedAt: current ? nextUpdatedAt(current.updatedAt, now) : now,
      }),
      { invalid: 'replace' },
    );
    return saved as LiveCalendar;
  }

  /** Changes the feed set; a field set to undefined is cleared. Nothing is written when there's none. */
  async update(changes: Partial<LiveCalendarFields>): Promise<LiveCalendar | undefined> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    return engine.modify('liveCalendar', 'liveCalendar', (current) =>
      current && current.deletedAt === undefined
        ? withChanges<LiveCalendar>(current, changes, now)
        : undefined,
    );
  }

  /** Marks the feed set revoked: deleted, but kept so a sync passes that on. */
  async remove(): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.modify('liveCalendar', 'liveCalendar', (current) =>
      current && current.deletedAt === undefined ? softDeleted(current, now) : undefined,
    );
  }
}
