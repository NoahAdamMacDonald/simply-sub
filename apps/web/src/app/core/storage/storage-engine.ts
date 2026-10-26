import {
  InvalidRecordError,
  checkRecord,
  readRecords,
  userRecordKeys,
  type RejectedRecord,
  type UserRecords,
  type UserTable,
} from '@simply-sub/core';
import { liveQuery, type Dexie } from 'dexie';
import { from, map, type Observable } from 'rxjs';
import { createUserDatabase } from './db';

// Loaded on first use (StorageService), as a chunk of its own with Dexie and the record schemas, which keeps them
// out of the initial bundle.

/** Where IndexedDB comes from, when it isn't the browser's: fake-indexeddb, in tests. */
export interface IndexedDbDependencies {
  indexedDB: IDBFactory;
  IDBKeyRange: typeof IDBKeyRange;
}

export interface StorageEngineOptions {
  /** Left out, Dexie uses the browser's. */
  dependencies?: IndexedDbDependencies;
  /** Told about stored records that fail their schema. They're left out, and left as they are. */
  onRejected(rejected: readonly RejectedRecord[]): void;
  /** Told after each write. */
  onWrite(): void;
}

/**
 * The tables that cache what can be downloaded again, whose records are replaced and deleted outright. The user's
 * own records are soft-deleted instead (BLUEPRINT §4.6).
 */
export type CacheTable = 'catalogCache';

export interface ModifyOptions {
  /**
   * What to do when the stored record fails its schema: by default the change is refused (an InvalidRecordError),
   * since it would build on data that can't be read. `replace` hands `change` undefined instead, for records that
   * are replaced whole when the user sets them again (settings, a ranking).
   */
  invalid?: 'refuse' | 'replace';
}

/** The repositories' way into Dexie. Every record is checked against its schema on the way in and out. */
export class StorageEngine {
  constructor(
    private readonly db: Dexie,
    private readonly options: StorageEngineOptions,
  ) {}

  /** Every valid record in `table`, soft-deleted ones included, and again after each change to it in any tab. */
  watch<T extends UserTable>(table: T): Observable<UserRecords[T][]> {
    return from(liveQuery(() => this.db.table<unknown>(table).toArray())).pipe(
      map((rows) => {
        const { records, rejected } = readRecords(table, rows);
        if (rejected.length > 0) this.options.onRejected(rejected);
        return records;
      }),
    );
  }

  /** Every valid record in `table` as stored now, read once: what another tab just wrote is there too. */
  async read<T extends UserTable>(table: T): Promise<UserRecords[T][]> {
    const { records, rejected } = readRecords(table, await this.db.table<unknown>(table).toArray());
    if (rejected.length > 0) this.options.onRejected(rejected);
    return records;
  }

  /** Stores a new record. Fails if a record with its key exists. */
  async add<T extends UserTable>(table: T, record: UserRecords[T]): Promise<UserRecords[T]> {
    const checked = checkRecord(table, record);
    await this.db.table(table).add(checked);
    this.options.onWrite();
    return checked;
  }

  /**
   * Changes one record in a transaction. `change` gets the stored record (undefined if there's none) and returns
   * the record to store, or undefined to leave it as it is. Returns what's stored afterwards.
   */
  async modify<T extends UserTable>(
    table: T,
    key: string,
    change: (current: UserRecords[T] | undefined) => UserRecords[T] | undefined,
    { invalid = 'refuse' }: ModifyOptions = {},
  ): Promise<UserRecords[T] | undefined> {
    const rows = this.db.table<unknown, string>(table);
    let written = false;
    const stored = await this.db.transaction('rw', rows, async () => {
      const row = await rows.get(key);
      const current = row === undefined ? undefined : this.readOne(table, row, invalid);
      const next = change(current);
      if (next === undefined) return current;
      const checked = checkRecord(table, next);
      if ((checked as Record<string, unknown>)[userRecordKeys[table]] !== key) {
        throw new Error(`A ${table} change can't change the record's key`);
      }
      await rows.put(checked);
      written = true;
      return checked;
    });
    if (written) this.options.onWrite();
    return stored;
  }

  /**
   * Stores `records` in a cache table, in place of any with the same keys, and deletes the records keyed `remove`,
   * in one transaction. Nothing is written if a record fails its schema.
   */
  async replace<T extends CacheTable>(
    table: T,
    records: readonly UserRecords[T][],
    remove: readonly string[],
  ): Promise<void> {
    const checked = records.map((record) => checkRecord(table, record));
    const rows = this.db.table<unknown, string>(table);
    await this.db.transaction('rw', rows, async () => {
      await rows.bulkDelete([...remove]);
      await rows.bulkPut(checked);
    });
    this.options.onWrite();
  }

  close(): void {
    this.db.close();
  }

  private readOne<T extends UserTable>(
    table: T,
    row: unknown,
    invalid: ModifyOptions['invalid'],
  ): UserRecords[T] | undefined {
    const { records, rejected } = readRecords(table, [row]);
    if (rejected.length === 0) return records[0];
    this.options.onRejected(rejected);
    if (invalid === 'replace') return undefined;
    throw new InvalidRecordError(rejected[0]);
  }
}

/** Opens the user database. Fails where IndexedDB is blocked (some private browsing modes). */
export async function openStorageEngine(options: StorageEngineOptions): Promise<StorageEngine> {
  // Only when given: an `indexedDB: undefined` would replace Dexie's default, the browser's, and nothing opens.
  const db = createUserDatabase(options.dependencies);
  await db.open();
  return new StorageEngine(db, options);
}
