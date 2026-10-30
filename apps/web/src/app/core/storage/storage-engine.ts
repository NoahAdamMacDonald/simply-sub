import {
  InvalidRecordError,
  appLockSchema,
  checkRecord,
  isLockedTable,
  lockCheck,
  lockedTables,
  readRecords,
  rowSeal,
  unopenedRecord,
  userRecordKeys,
  type AppLock,
  type CacheTable,
  type LockIdleMinutes,
  type RejectedRecord,
  type UserRecords,
  type UserTable,
} from '@simply-sub/core';
import { liveQuery, type Dexie, type Table, type Transaction } from 'dexie';
import {
  BehaviorSubject,
  combineLatest,
  filter,
  from,
  map,
  skip,
  switchMap,
  takeUntil,
  type Observable,
  type Subscription,
} from 'rxjs';
import {
  WrongPassphraseError,
  deriveKey,
  fromBase64,
  kdfIterations,
  newSalt,
  openText,
  sealText,
  toBase64,
} from '../crypto/passphrase-crypto';
import { createUserDatabase } from './db';
import { RowCipher, unopened } from './row-cipher';

// Loaded on first use (StorageService), as a chunk of its own with Dexie, the record schemas and the crypto module,
// which keeps them out of the initial bundle.

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
  /** Told when the app lock turns on or off, locks or unlocks, in this tab or another one. */
  onLockChange?(state: LockState): void;
  /** PBKDF2's iterations for a new lock. Left out, kdfIterations: tests use fewer, since 600,000 take half a second. */
  lockIterations?: number;
}

/**
 * The app lock (BLUEPRINT §11.5): off; on and locked, so the locked tables can't be read or written; or on and
 * unlocked, with the key in memory.
 */
export type LockState = 'off' | 'locked' | 'unlocked';

/** Thrown when a locked table is read or written while the app lock is locked. */
export class AppLockedError extends Error {
  constructor() {
    super('The app is locked');
    this.name = 'AppLockedError';
  }
}

export interface ModifyOptions {
  /**
   * What to do when the stored record fails its schema: by default the change is refused (an InvalidRecordError),
   * since it would build on data that can't be read. `replace` hands `change` undefined instead, for records that
   * are replaced whole when the user sets them again (settings, a ranking).
   */
  invalid?: 'refuse' | 'replace';
}

/**
 * The tables whose records are deleted outright rather than soft-deleted: the caches, drafts, which are edits not
 * saved yet, and sync's own record (M10.9), this device's: a sync has no deletion of theirs to pass on.
 */
export type TransientTable = CacheTable | 'drafts' | 'sync';

/** What a StorageEngine.transaction reads and writes, every record checked on the way in and out. */
export interface StorageTransaction {
  /**
   * The record stored under `key`, if there's one. One that fails its schema is refused (an InvalidRecordError), or
   * read as undefined with `invalid: 'replace'`, for a record that's then replaced whole.
   */
  get<T extends UserTable>(
    table: T,
    key: string,
    options?: ModifyOptions,
  ): Promise<UserRecords[T] | undefined>;
  /** Every valid record in `table`, soft-deleted ones included. */
  getAll<T extends UserTable>(table: T): Promise<UserRecords[T][]>;
  /** Stores `record` in place of any with its key. Throws an InvalidRecordError if it fails its schema. */
  put<T extends UserTable>(table: T, record: UserRecords[T]): Promise<void>;
  /** Deletes a record outright. */
  delete(table: TransientTable, key: string): Promise<void>;
  /**
   * Deletes every record in `table` outright, any that fail their schema too: a backup's Replace and Delete all data
   * (P13), which leave nothing behind for a sync to pass on. Clearing the settings turns the app lock off, so what
   * the transaction writes after it is plain.
   */
  clear(table: UserTable): Promise<void>;
}

/**
 * Where a step reads and writes: a transaction's tables, or the database's outside one. Inside a transaction every
 * table comes from the transaction itself, since Dexie's zone, which otherwise finds it, is lost a couple of awaits
 * deep; and a promise that isn't IndexedDB's (WebCrypto's) goes through the transaction's waitFor, as Dexie.waitFor
 * does, which keeps it open meanwhile: IndexedDB commits a transaction that has nothing to do when a task ends.
 */
interface Access {
  table<T = unknown>(name: UserTable): Table<T, string>;
  wait<T>(promise: Promise<T>): Promise<T>;
}

/** Dexie's transaction, with the method Dexie.waitFor calls. */
type WaitingTransaction = Transaction & { waitFor<T>(promise: PromiseLike<T>): PromiseLike<T> };

function inTransaction(transaction: Transaction): Access {
  return {
    table: (name) => transaction.table(name),
    wait: async (promise) => (transaction as WaitingTransaction).waitFor(promise),
  };
}

/**
 * How a transaction writes the locked tables, from the lock its stored settings hold: plain while it's off, sealed
 * with the key while it's on and this tab is unlocked.
 */
interface Sealing {
  /** The stored settings' appLock, as it's stored: a settings write keeps it. */
  lock: unknown;
  cipher?: RowCipher;
}

/**
 * The repositories' way into Dexie. Every record is checked against its schema on the way in and out.
 *
 * With the app lock on (BLUEPRINT §11.5), the locked tables' rows keep their keys and indexes in plain text and the
 * rest sealed. Every write reads the lock its stored settings hold, in its own transaction, and seals with the key in
 * memory, so a tab that hasn't yet heard of a change made in another one never writes plain rows, or rows it can't
 * seal. While locked, the locked tables show nothing, and reading or writing them throws an AppLockedError.
 */
export class StorageEngine {
  /** The stored settings' appLock as last seen: undefined while the lock is off. */
  private storedLock: unknown;
  /** The key, while this tab is unlocked. */
  private cipher?: RowCipher;
  /** The key of a lock being turned on here: it's this tab's once the lock it was made for is stored. */
  private enabling?: RowCipher;
  private readonly lockStates: BehaviorSubject<LockState>;
  private readonly following: Subscription;
  private readonly outside: Access;

  constructor(
    private readonly db: Dexie,
    private readonly options: StorageEngineOptions,
    storedLock?: unknown,
  ) {
    this.outside = { table: (name) => db.table(name), wait: (promise) => promise };
    this.storedLock = storedLock;
    this.lockStates = new BehaviorSubject(this.lockState());
    // Another tab can turn the lock on or off, or change its passphrase.
    this.following = from(
      liveQuery(() => db.table<unknown, string>('settings').get('settings')),
    ).subscribe({
      next: (row) => this.follow(lockOf(row)),
      error: () => undefined,
    });
  }

  /** The app lock's state in this tab. */
  lockState(): LockState {
    if (this.storedLock === undefined) return 'off';
    return this.cipher !== undefined && this.cipher.salt === saltOf(this.storedLock)
      ? 'unlocked'
      : 'locked';
  }

  /**
   * Every valid record in `table`, soft-deleted ones included, and again after each change to it in any tab. A locked
   * table emits nothing while the app is locked, and its records once it's unlocked. Its watch ends when the app locks,
   * so whoever holds its records lets them go, and the next one starts once it's unlocked.
   */
  watch<T extends UserTable>(table: T): Observable<UserRecords[T][]> {
    const rows = from(liveQuery(() => this.db.table<unknown>(table).toArray()));
    const locks = this.lockStates.pipe(
      skip(1),
      filter((state) => state === 'locked'),
    );
    const opened = isLockedTable(table)
      ? combineLatest([rows, this.lockStates]).pipe(
          switchMap(([stored]) => this.openRows(this.outside, table, stored)),
          filter((records) => records !== undefined),
          takeUntil(locks),
        )
      : rows;
    return opened.pipe(map((records) => this.checked(table, records)));
  }

  /** Every valid record in `table` as stored now, read once: what another tab just wrote is there too. */
  read<T extends UserTable>(table: T): Promise<UserRecords[T][]> {
    return this.readFrom(this.outside, table);
  }

  /** Stores a new record. Fails if a record with its key exists. */
  async add<T extends UserTable>(table: T, record: UserRecords[T]): Promise<UserRecords[T]> {
    const stored = await this.db.transaction('rw', this.scope([table]), async (transaction) => {
      const access = inTransaction(transaction);
      const { checked, row } = await this.storable(access, table, record, this.sealing(access));
      await access.table(table).add(row);
      return checked;
    });
    this.options.onWrite();
    return stored;
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
    let written = false;
    const stored = await this.db.transaction('rw', this.scope([table]), async (transaction) => {
      const access = inTransaction(transaction);
      const { stored: result, written: put } = await this.change(
        access,
        this.sealing(access),
        table,
        key,
        change,
        invalid,
      );
      written = put;
      return result;
    });
    if (written) this.options.onWrite();
    return stored;
  }

  /**
   * Changes several records of one table in one transaction, each as `modify` changes one: `change` gets each key's
   * stored record and returns the record to store, or undefined to leave it. If any change fails, none is stored.
   * Watchers see the changes together.
   */
  async modifyMany<T extends UserTable>(
    table: T,
    keys: readonly string[],
    change: (key: string, current: UserRecords[T] | undefined) => UserRecords[T] | undefined,
    { invalid = 'refuse' }: ModifyOptions = {},
  ): Promise<void> {
    let written = false;
    await this.db.transaction('rw', this.scope([table]), async (transaction) => {
      const access = inTransaction(transaction);
      const sealing = this.sealing(access);
      for (const key of keys) {
        const { written: put } = await this.change(
          access,
          sealing,
          table,
          key,
          (current) => change(key, current),
          invalid,
        );
        written ||= put;
      }
    });
    if (written) this.options.onWrite();
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

  /**
   * Runs `work` in one transaction on `tables`: everything it writes is stored together, or nothing is if it throws.
   * Watchers see the changes together. `work` may only await the transaction's own reads and writes, since IndexedDB
   * commits a transaction once nothing more is asked of it.
   */
  async transaction<R>(
    tables: readonly UserTable[],
    work: (transaction: StorageTransaction) => Promise<R>,
  ): Promise<R> {
    let written = false;
    let settingsCleared = false;
    const result = await this.db.transaction('rw', this.scope(tables), (transaction) => {
      const access = inTransaction(transaction);
      let sealing = this.sealing(access);
      return work({
        get: async (table, key, { invalid = 'refuse' } = {}) => {
          const row = await access.table(table).get(key);
          return row === undefined ? undefined : this.readRow(access, table, row, invalid);
        },
        getAll: (table) => this.readFrom(access, table),
        put: async (table, record) => {
          const { row } = await this.storable(access, table, record, sealing);
          await access.table(table).put(row);
          written = true;
        },
        delete: async (table, key) => {
          await access.table(table).delete(key);
          written = true;
        },
        clear: async (table) => {
          await access.table(table).clear();
          written = true;
          if (table !== 'settings') return;
          // The lock went with the settings: what the transaction writes from now on is plain.
          settingsCleared = true;
          sealing = () => Promise.resolve({ lock: undefined });
        },
      });
    });
    if (settingsCleared) this.follow(lockOf(await this.settingsRow(this.outside)));
    if (written) this.options.onWrite();
    return result;
  }

  /**
   * Turns the app lock on (P13): a key derived from `passphrase` with a new salt, and every locked table's rows sealed
   * with it in one transaction, beside the lock's settings (no secret: the salt and a sealed check value). The key
   * stays in memory, unlocked. A row sealed already, which there shouldn't be with the lock off, stays as it is.
   */
  async enableLock(passphrase: string, idleMinutes?: LockIdleMinutes): Promise<void> {
    const salt = newSalt();
    const iterations = this.options.lockIterations ?? kdfIterations;
    const key = await deriveKey(passphrase, salt, iterations);
    const appLock: AppLock = {
      salt: toBase64(salt),
      iterations,
      check: await sealText(key, lockCheck.text, lockCheck.boundTo),
      ...(idleMinutes !== undefined && { idleMinutes }),
    };
    const cipher = new RowCipher(key, appLock.salt);
    // A live query can read the sealed rows before this tab has followed the new lock: following it then (openRows)
    // takes this key.
    this.enabling = cipher;
    try {
      await this.sealAll(appLock, cipher);
    } finally {
      this.enabling = undefined;
    }
    this.cipher = cipher;
    this.follow(appLock);
    this.options.onWrite();
  }

  /** Every locked table's plain rows sealed with `cipher`, and the settings with `appLock`, in one transaction. */
  private async sealAll(appLock: AppLock, cipher: RowCipher): Promise<void> {
    await this.db.transaction('rw', this.scope(lockedTables), async (transaction) => {
      const access = inTransaction(transaction);
      const settings = await this.settingsRow(access);
      if (settings === undefined) throw new Error('There are no settings to lock yet');
      if (lockOf(settings) !== undefined) throw new Error('The app lock is on already');
      for (const table of lockedTables) {
        const rows = (await access.table<object>(table).toArray()).filter(
          (row) => rowSeal(row) === undefined,
        );
        const sealed = await access.wait(
          Promise.all(
            rows.map((row) => cipher.seal(table, table === 'settings' ? { ...row, appLock } : row)),
          ),
        );
        await access.table(table).bulkPut(sealed);
      }
    });
  }

  /**
   * Turns the app lock off (P13) if `passphrase` is its own: every sealed row opened and stored plain again, and the
   * lock's settings removed, in one transaction. False when the passphrase is wrong, and nothing changes. A row that
   * doesn't open stays as it is, as a record that fails its schema does.
   */
  async disableLock(passphrase: string): Promise<boolean> {
    const lock = appLockSchema.safeParse(this.storedLock);
    if (!lock.success) return false;
    const key = await keyFor(passphrase, lock.data);
    if (key === undefined) return false;
    const cipher = new RowCipher(key, lock.data.salt);
    await this.db.transaction('rw', this.scope(lockedTables), async (transaction) => {
      const access = inTransaction(transaction);
      if (saltOf(lockOf(await this.settingsRow(access))) !== lock.data.salt) {
        throw new Error('The app lock changed in another tab');
      }
      for (const table of lockedTables) {
        const rows = (await access.table(table).toArray()).filter(
          (row) => rowSeal(row) !== undefined,
        );
        const opened = await access.wait(Promise.resolve(cipher.openAll(table, rows)));
        const plain = opened.filter((record) => record !== unopened) as object[];
        await access
          .table(table)
          .bulkPut(
            table === 'settings' ? plain.map((settings) => withLock(settings, undefined)) : plain,
          );
      }
    });
    this.cipher = undefined;
    this.follow(undefined);
    this.options.onWrite();
    return true;
  }

  /**
   * Unlocks (P15) if `passphrase` is the lock's own: its key is held in memory from now on, and the locked tables show
   * their records again. False when it's wrong, and nothing changes.
   */
  async unlock(passphrase: string): Promise<boolean> {
    const lock = appLockSchema.safeParse(this.storedLock);
    if (!lock.success) return false;
    const key = await keyFor(passphrase, lock.data);
    // Another tab may have changed the lock while the key was derived, and this one opens nothing then.
    if (key === undefined || saltOf(this.storedLock) !== lock.data.salt) return false;
    this.cipher = new RowCipher(key, lock.data.salt);
    this.announce();
    return true;
  }

  /** Locks (P15): the key and what it opened are dropped, and the locked tables show nothing until the next unlock. */
  lock(): void {
    if (this.cipher === undefined) return;
    this.cipher = undefined;
    this.announce();
  }

  /** Lock after (P13): changed in the lock's plain settings, which needs no key. Fails when the lock is off. */
  async setLockIdle(idleMinutes: LockIdleMinutes | undefined): Promise<void> {
    await this.db.transaction('rw', this.scope([]), async (transaction) => {
      const access = inTransaction(transaction);
      const row = await this.settingsRow(access);
      const lock = appLockSchema.safeParse(lockOf(row));
      if (row === undefined || !lock.success) throw new Error('The app lock is off');
      const changed: AppLock = { ...lock.data };
      delete changed.idleMinutes;
      if (idleMinutes !== undefined) changed.idleMinutes = idleMinutes;
      await access.table('settings').put({ ...row, appLock: changed });
    });
    this.options.onWrite();
  }

  close(): void {
    this.following.unsubscribe();
    this.db.close();
  }

  /** One record's change, inside a transaction on its table: what's stored afterwards, and whether it was written. */
  private async change<T extends UserTable>(
    access: Access,
    sealing: () => Promise<Sealing>,
    table: T,
    key: string,
    change: (current: UserRecords[T] | undefined) => UserRecords[T] | undefined,
    invalid: ModifyOptions['invalid'],
  ): Promise<{ stored: UserRecords[T] | undefined; written: boolean }> {
    const rows = access.table(table);
    const row = await rows.get(key);
    const current = row === undefined ? undefined : await this.readRow(access, table, row, invalid);
    const next = change(current);
    if (next === undefined) return { stored: current, written: false };
    const { checked, row: stored } = await this.storable(access, table, next, sealing);
    if ((checked as Record<string, unknown>)[userRecordKeys[table]] !== key) {
      throw new Error(`A ${table} change can't change the record's key`);
    }
    await rows.put(stored);
    return { stored: checked, written: true };
  }

  /**
   * A record checked and ready to store: sealed when the transaction's stored lock is on. A settings write keeps the
   * stored lock, since only the lock's own methods change it. Throws an AppLockedError when the lock is on and this
   * tab is locked, and an InvalidRecordError when the record fails its schema.
   */
  private async storable<T extends UserTable>(
    access: Access,
    table: T,
    record: UserRecords[T],
    sealing: () => Promise<Sealing>,
  ): Promise<{ checked: UserRecords[T]; row: unknown }> {
    if (!isLockedTable(table)) {
      const checked = checkRecord(table, record);
      return { checked, row: checked };
    }
    const { lock, cipher } = await sealing();
    const checked = checkRecord(table, table === 'settings' ? withLock(record, lock) : record);
    return { checked, row: cipher ? await access.wait(cipher.seal(table, checked)) : checked };
  }

  /** How a transaction writes, from the lock its stored settings hold, read the first time it's needed. */
  private sealing(access: Access): () => Promise<Sealing> {
    let sealing: Promise<Sealing> | undefined;
    return () => (sealing ??= this.sealingNow(access));
  }

  private async sealingNow(access: Access): Promise<Sealing> {
    const lock = lockOf(await this.settingsRow(access));
    if (lock === undefined) return { lock };
    if (this.cipher !== undefined && this.cipher.salt === saltOf(lock)) {
      return { lock, cipher: this.cipher };
    }
    // Locked here, or the passphrase changed in another tab since this one unlocked.
    this.follow(lock);
    throw new AppLockedError();
  }

  /** Every valid record in `table`, read where `access` reads. */
  private async readFrom<T extends UserTable>(access: Access, table: T): Promise<UserRecords[T][]> {
    const rows = await access.table(table).toArray();
    return this.checked(table, await this.openedRows(access, table, rows));
  }

  /**
   * The records in a table's rows, the sealed ones opened. Undefined while this tab is locked. A sealed row that
   * doesn't open is reported and left out, as a record that fails its schema is; so is one still sealed once the lock
   * is off.
   */
  private async openRows(
    access: Access,
    table: UserTable,
    rows: readonly unknown[],
  ): Promise<unknown[] | undefined> {
    if (!isLockedTable(table) || !rows.some((row) => rowSeal(row) !== undefined)) return [...rows];
    if (this.storedLock === undefined) {
      // The lock may have just turned on in another tab, before this one heard: it's locked then.
      this.follow(lockOf(await this.settingsRow(access)));
    }
    const cipher = this.cipher;
    if (cipher === undefined && this.storedLock !== undefined) return undefined;
    // With the lock off, the rows may have been read before it went off, and a live query hands them on as it
    // goes: read again, they're plain, and what's still sealed is so.
    const current = cipher ? rows : await this.readAgain(access, table, rows);
    const opening = cipher
      ? cipher.openAll(table, current)
      : current.map((row) => (rowSeal(row) === undefined ? row : unopened));
    const opened = Array.isArray(opening) ? opening : await access.wait(opening);
    const rejected = current.flatMap((row, index) =>
      opened[index] === unopened ? [unopenedRecord(table, row)] : [],
    );
    if (rejected.length > 0) this.options.onRejected(rejected);
    return opened.filter((record) => record !== unopened);
  }

  /** The rows with these rows' keys, as stored now; one deleted since is left out. */
  private async readAgain(
    access: Access,
    table: UserTable,
    rows: readonly unknown[],
  ): Promise<unknown[]> {
    const field = userRecordKeys[table];
    const keys = rows.map((row) => (row as Record<string, string>)[field]);
    return (await access.table(table).bulkGet(keys)).filter((row) => row !== undefined);
  }

  /** As openRows, throwing an AppLockedError while this tab is locked. */
  private async openedRows(
    access: Access,
    table: UserTable,
    rows: readonly unknown[],
  ): Promise<unknown[]> {
    const opened = await this.openRows(access, table, rows);
    if (opened === undefined) throw new AppLockedError();
    return opened;
  }

  /** The valid records among opened rows; the others are reported. */
  private checked<T extends UserTable>(table: T, rows: readonly unknown[]): UserRecords[T][] {
    const { records, rejected } = readRecords(table, rows);
    if (rejected.length > 0) this.options.onRejected(rejected);
    return records;
  }

  /**
   * One stored row as its record. One that doesn't open or fails its schema is refused (an InvalidRecordError), or
   * read as undefined with `invalid: 'replace'`.
   */
  private async readRow<T extends UserTable>(
    access: Access,
    table: T,
    row: unknown,
    invalid: ModifyOptions['invalid'],
  ): Promise<UserRecords[T] | undefined> {
    const [opened] = await this.openedRows(access, table, [row]);
    if (opened !== undefined) return this.readOne(table, opened, invalid);
    if (invalid === 'replace') return undefined;
    throw new InvalidRecordError(unopenedRecord(table, row));
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

  /** The stored lock, as this tab last saw it: the app locks when it changes to one this tab has no key for. */
  private follow(lock: unknown): void {
    this.storedLock = lock;
    const salt = saltOf(lock);
    if (this.cipher !== undefined && this.cipher.salt !== salt) this.cipher = undefined;
    if (this.enabling !== undefined && this.enabling.salt === salt) this.cipher = this.enabling;
    this.announce();
  }

  private announce(): void {
    const state = this.lockState();
    if (state === this.lockStates.value) return;
    this.lockStates.next(state);
    this.options.onLockChange?.(state);
  }

  /** The tables a transaction on `tables` covers: the settings too, whose stored lock says how to write. */
  private scope(tables: readonly UserTable[]): Table[] {
    return [...new Set<UserTable>([...tables, 'settings'])].map((table) => this.db.table(table));
  }

  private settingsRow(access: Access): Promise<Record<string, unknown> | undefined> {
    return access.table<Record<string, unknown>>('settings').get('settings');
  }
}

/** Opens the user database. Fails where IndexedDB is blocked (some private browsing modes). */
export async function openStorageEngine(options: StorageEngineOptions): Promise<StorageEngine> {
  // Only when given: an `indexedDB: undefined` would replace Dexie's default, the browser's, and nothing opens.
  const db = createUserDatabase(options.dependencies);
  await db.open();
  // Whether the lock is on is known before anything is read.
  const settings = await db.table<unknown, string>('settings').get('settings');
  return new StorageEngine(db, options, lockOf(settings));
}

/** A stored settings row's appLock, as it's stored. */
function lockOf(row: unknown): unknown {
  return typeof row === 'object' && row !== null && 'appLock' in row ? row.appLock : undefined;
}

/** A stored lock's salt, which tells one lock from another. */
function saltOf(lock: unknown): unknown {
  return typeof lock === 'object' && lock !== null && 'salt' in lock ? lock.salt : undefined;
}

/** `settings` with `lock` in place of any lock it has: none, when that's undefined. */
function withLock<T extends object>(settings: T, lock: unknown): T {
  const changed: Record<string, unknown> = { ...(settings as Record<string, unknown>) };
  delete changed['appLock'];
  if (lock !== undefined) changed['appLock'] = lock;
  return changed as T;
}

/** The lock's key from `passphrase`, if its check value opens with it. */
async function keyFor(passphrase: string, lock: AppLock): Promise<CryptoKey | undefined> {
  const key = await deriveKey(passphrase, fromBase64(lock.salt), lock.iterations);
  try {
    await openText(key, lock.check, lockCheck.boundTo);
    return key;
  } catch (error) {
    if (error instanceof WrongPassphraseError) return undefined;
    throw error;
  }
}
