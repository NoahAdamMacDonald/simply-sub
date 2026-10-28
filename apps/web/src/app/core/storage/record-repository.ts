import { Resource, Signal, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { softDeleted, withChanges, type UserRecords } from '@simply-sub/core';
import { StorageService } from './storage-service';

/** Whether a repository's records have loaded. `error`: storage couldn't be opened or read. */
export type StorageStatus = 'loading' | 'ready' | 'error';

/** The status of a repository's live records. */
export function storageStatus(records: Resource<unknown>): StorageStatus {
  if (records.hasValue()) return 'ready';
  return records.error() === undefined ? 'loading' : 'error';
}

/** The user tables whose records have a UUID v7 id. */
export type IdTable = 'lists' | 'items' | 'customSubs' | 'cards' | 'tags';

type RecordMeta = 'id' | 'createdAt' | 'updatedAt' | 'deletedAt';

/** A new record's own fields: the repository adds its id and timestamps. */
export type NewRecord<T extends IdTable> = Omit<UserRecords[T], RecordMeta>;

/** Fields to change. One set to undefined is cleared. */
export type RecordChanges<T extends IdTable> = Partial<NewRecord<T>>;

/**
 * A user table whose records have ids, as signals, with create, update and soft delete. Repositories are the only
 * code that reaches Dexie (BLUEPRINT §11.1). Each one holds its whole table: a user has a few hundred records at
 * most, so pages filter them with computed() rather than querying.
 */
export abstract class RecordRepository<T extends IdTable> {
  private readonly storage = inject(StorageService);
  private readonly stored;

  /**
   * The valid records that aren't deleted, oldest first (ids sort by creation time). They follow every write, in
   * this tab or another one.
   */
  readonly records: Signal<readonly UserRecords[T][]>;
  readonly byId: Signal<ReadonlyMap<string, UserRecords[T]>>;
  readonly status: Signal<StorageStatus>;

  protected constructor(private readonly table: T) {
    this.stored = rxResource({
      params: () => this.storage.access(),
      stream: () => this.storage.watch(table),
    });
    this.records = computed(() =>
      this.stored.hasValue()
        ? this.stored.value().filter((record) => record.deletedAt === undefined)
        : [],
    );
    this.byId = computed(() => new Map(this.records().map((record) => [record.id, record])));
    this.status = computed(() => storageStatus(this.stored));
  }

  /** Stores a new record, with a new id and the time now. */
  async create(fields: NewRecord<T>): Promise<UserRecords[T]> {
    const now = this.storage.now();
    const record = { ...fields, id: this.storage.newId(now), createdAt: now, updatedAt: now };
    const engine = await this.storage.engine();
    return engine.add(this.table, record as UserRecords[T]);
  }

  /** Changes a record. Fails if there's no such record, it's deleted, or it can't be read. */
  async update(id: string, changes: RecordChanges<T>): Promise<UserRecords[T]> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    const updated = await engine.modify(this.table, id, (current) => {
      if (current === undefined || current.deletedAt !== undefined) {
        throw new Error(`There's no ${this.table} record ${id} to change`);
      }
      return withChanges(current, changes as Partial<UserRecords[T]>, now);
    });
    return updated as UserRecords[T];
  }

  /**
   * Soft-deletes a record: it stays stored with `deletedAt`, so a sync can pass the deletion on, and it leaves
   * `records`. Nothing happens when it's already deleted or isn't there.
   */
  async remove(id: string): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.modify(this.table, id, (current) =>
      current !== undefined && current.deletedAt === undefined
        ? softDeleted(current, now)
        : undefined,
    );
  }
}
