import { DestroyRef, InjectionToken, Service, computed, inject, signal } from '@angular/core';
import type { Timestamp, UserRecords, UserTable } from '@simply-sub/core';
import { from, switchMap, type Observable } from 'rxjs';
import { v7 } from 'uuid';
import { ClockService } from '../clock/clock-service';
import { RejectedRecords } from './rejected-records';
import type { IndexedDbDependencies, LockState, StorageEngine } from './storage-engine';

/** Where IndexedDB comes from, when it isn't the browser's: tests provide a fresh fake-indexeddb for each test. */
export const INDEXED_DB = new InjectionToken<IndexedDbDependencies>('INDEXED_DB');

/** PBKDF2's iterations for a new app lock, when they aren't 600,000: tests use fewer, since those take half a second. */
export const LOCK_ITERATIONS = new InjectionToken<number>('LOCK_ITERATIONS');

/**
 * localStorage key: the app lock was on at the last visit, so the lock screen shows before the database has opened
 * (P15). It's no secret: the stored settings say so too.
 */
export const LOCK_HINT_STORAGE_KEY = 'ss-lock';

/**
 * Where the user's data is kept: the browser's IndexedDB, or memory when that's blocked and the user carries on anyway
 * (PROJECT-PLAN P15). Kept in memory, it's gone when the tab closes.
 */
export type StorageMode = 'browser' | 'memory';

/**
 * Opens the user database on first use, for the repositories, which are the only code that use it. Dexie, Zod and
 * the record schemas then load as a chunk of their own (216 kB), which keeps them out of the initial bundle.
 */
@Service()
export class StorageService {
  private readonly clock = inject(ClockService);
  private readonly rejectedRecords = inject(RejectedRecords);
  private readonly indexedDB = inject(INDEXED_DB, { optional: true });
  private readonly lockIterations = inject(LOCK_ITERATIONS, { optional: true });
  private readonly currentMode = signal<StorageMode>('browser');
  private readonly lockState = signal<LockState | undefined>(undefined);
  private readonly lockHint = readLockHint();
  /** The database couldn't be opened (IndexedDB blocked): the repositories then load to find out, and say so. */
  private readonly failed = signal(false);
  private opening?: Promise<StorageEngine>;
  private persistenceAsked = false;
  private lastIdTime = 0;
  private idCounter = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.opening?.then((engine) => engine.close()).catch(() => undefined);
    });
    // Opened at once, so whether the app lock is on is known before any repository reads (access).
    this.engine().catch(() => undefined);
  }

  /** Where the data is kept. The repositories load their records again when it changes. */
  readonly mode = this.currentMode.asReadonly();

  /** The app lock (BLUEPRINT §11.5), in this tab: undefined until the database has opened. */
  readonly lock = this.lockState.asReadonly();

  /**
   * Whether the lock screen shows in place of the app (P15): the app is locked, or it was at the last visit and the
   * database hasn't opened yet to say.
   */
  readonly locked = computed(() => {
    const state = this.lockState();
    return state === 'locked' || (state === undefined && this.lockHint);
  });

  /**
   * What the user's repositories load from: the mode, or undefined until the database has said whether the app lock
   * is on, and while it's locked, which drops the records they hold until it's unlocked. The caches, which the lock
   * leaves plain, load from the mode alone.
   */
  readonly access = computed(() => {
    const lock = this.lockState();
    if (lock === 'locked' || (lock === undefined && !this.failed())) return undefined;
    return this.currentMode();
  });

  /**
   * The storage engine, loaded and opened the first time it's asked for. If that fails (IndexedDB blocked), the
   * reason goes to the console once, and the repositories' status is `error`.
   */
  engine(): Promise<StorageEngine> {
    this.opening ??= this.open(this.currentMode());
    return this.opening;
  }

  /**
   * Keeps the data in memory from now on: IndexedDB is blocked, and the user chose [Continue anyway] (P15). It starts
   * empty, and every repository reloads from it. Nothing is saved, so the first-run dialog asks again on each visit.
   */
  useMemory(): void {
    if (this.currentMode() === 'memory') return;
    this.opening?.then((engine) => engine.close()).catch(() => undefined);
    this.opening = undefined;
    this.currentMode.set('memory');
    // An empty database in memory has no lock.
    this.lockState.set('off');
  }

  /**
   * Locks the app now (the idle timer, leaving the page): the key and what it opened are dropped, and so are the
   * repositories' records. Nothing happens when the lock is off.
   */
  lockNow(): void {
    this.opening?.then((engine) => engine.lock()).catch(() => undefined);
  }

  /** Every valid record in `table`, live (StorageEngine.watch). */
  watch<T extends UserTable>(table: T): Observable<UserRecords[T][]> {
    return from(this.engine()).pipe(switchMap((engine) => engine.watch(table)));
  }

  /** The time of a write, from ClockService. */
  now(): Timestamp {
    return this.clock.now();
  }

  /**
   * A new record id: a UUID v7, which starts with the time it was made, `now`. Ids made in the same millisecond, or
   * after the clock went back, count up from the last one (RFC 9562's counter method), so ids always sort in the
   * order they were made.
   */
  newId(now: Timestamp): string {
    const time = Date.parse(now);
    if (time > this.lastIdTime) {
      this.lastIdTime = time;
      // A random start that leaves room to count up without overflowing.
      this.idCounter = crypto.getRandomValues(new Uint32Array(1))[0] >>> 2;
    } else {
      this.idCounter++;
    }
    return v7({ msecs: this.lastIdTime, seq: this.idCounter });
  }

  private async open(mode: StorageMode): Promise<StorageEngine> {
    try {
      // The in-memory IndexedDB (fake-indexeddb, 57 kB) loads only for that mode, as a chunk of its own.
      const [{ openStorageEngine }, dependencies] = await Promise.all([
        import('./storage-engine'),
        mode === 'memory'
          ? import('./memory-indexed-db').then(({ memoryIndexedDb }) => memoryIndexedDb())
          : (this.indexedDB ?? undefined),
      ]);
      const engine = await openStorageEngine({
        dependencies,
        ...(this.lockIterations !== null && { lockIterations: this.lockIterations }),
        onRejected: (rejected) => this.rejectedRecords.report(rejected),
        onWrite: () => {
          if (mode === 'browser') this.askForPersistence();
        },
        onLockChange: (state) => this.setLock(state, mode),
      });
      this.setLock(engine.lockState(), mode);
      return engine;
    } catch (error) {
      console.error('The saved data could not be opened:', error);
      if (mode === this.currentMode()) this.failed.set(true);
      throw error;
    }
  }

  /** The lock's state, and the hint the next visit starts from. */
  private setLock(state: LockState, mode: StorageMode): void {
    if (mode !== this.currentMode()) return;
    this.lockState.set(state);
    if (mode === 'memory') return;
    try {
      if (state === 'off') localStorage.removeItem(LOCK_HINT_STORAGE_KEY);
      else localStorage.setItem(LOCK_HINT_STORAGE_KEY, 'on');
    } catch {
      // Storage can be blocked: the lock screen then waits for the database.
    }
  }

  /**
   * Asks the browser to keep the data when it runs low on space (BLUEPRINT §11.1). After the first write rather
   * than on load: Firefox asks the user, and the question only makes sense once there's something to keep.
   */
  private askForPersistence(): void {
    if (this.persistenceAsked) return;
    this.persistenceAsked = true;
    const storage = navigator.storage as StorageManager | undefined;
    if (!storage?.persist) return;
    storage
      .persisted()
      .then((persisted) => persisted || storage.persist())
      .catch(() => undefined);
  }
}

function readLockHint(): boolean {
  try {
    return localStorage.getItem(LOCK_HINT_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}
