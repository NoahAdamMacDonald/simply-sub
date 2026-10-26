import { DestroyRef, InjectionToken, Service, inject, signal } from '@angular/core';
import type { Timestamp, UserRecords, UserTable } from '@simply-sub/core';
import { from, switchMap, type Observable } from 'rxjs';
import { v7 } from 'uuid';
import { ClockService } from '../clock/clock-service';
import { RejectedRecords } from './rejected-records';
import type { IndexedDbDependencies, StorageEngine } from './storage-engine';

/** Where IndexedDB comes from, when it isn't the browser's: tests provide a fresh fake-indexeddb for each test. */
export const INDEXED_DB = new InjectionToken<IndexedDbDependencies>('INDEXED_DB');

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
  private readonly currentMode = signal<StorageMode>('browser');
  private opening?: Promise<StorageEngine>;
  private persistenceAsked = false;
  private lastIdTime = 0;
  private idCounter = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.opening?.then((engine) => engine.close()).catch(() => undefined);
    });
  }

  /** Where the data is kept. The repositories load their records again when it changes. */
  readonly mode = this.currentMode.asReadonly();

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
      return await openStorageEngine({
        dependencies,
        onRejected: (rejected) => this.rejectedRecords.report(rejected),
        onWrite: () => {
          if (mode === 'browser') this.askForPersistence();
        },
      });
    } catch (error) {
      console.error('The saved data could not be opened:', error);
      throw error;
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
