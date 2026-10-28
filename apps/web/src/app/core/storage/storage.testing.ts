import { Provider, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { IsoDate, Timestamp, UserTable } from '@simply-sub/core';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { ClockService } from '../clock/clock-service';
import { createUserDatabase } from './db';
import { INDEXED_DB, LOCK_ITERATIONS } from './storage-service';

// Helpers for specs that use the repositories: an IndexedDB of the test's own, and a clock the test sets.
// *.testing.ts files are left out of the app build (tsconfig.app.json).

/** A ClockService whose time the test sets. */
export class FakeClock implements Pick<ClockService, 'today' | 'now'> {
  readonly today = signal<IsoDate>('2026-10-25').asReadonly();
  time: Timestamp = '2026-10-25T12:00:00.000Z';

  now(): Timestamp {
    return this.time;
  }
}

export interface TestStorage {
  clock: FakeClock;
  indexedDB: IDBFactory;
  /** For TestBed: the fake clock, an empty fake IndexedDB that no other test shares, and a fast app lock. */
  providers: Provider[];
}

export function testStorage(): TestStorage {
  const clock = new FakeClock();
  const indexedDB = new IDBFactory();
  return {
    clock,
    indexedDB,
    providers: [
      { provide: ClockService, useValue: clock },
      { provide: INDEXED_DB, useValue: { indexedDB, IDBKeyRange } },
      // 600,000 take half a second a key.
      { provide: LOCK_ITERATIONS, useValue: 1_000 },
    ],
  };
}

/** Writes rows straight into IndexedDB, past the repositories' checks: what tampering or a bug could leave. */
export async function plantRows(
  indexedDB: IDBFactory,
  table: UserTable,
  rows: readonly unknown[],
): Promise<void> {
  const db = createUserDatabase({ indexedDB, IDBKeyRange });
  await db.table(table).bulkPut([...rows]);
  db.close();
}

/** Every row of a table as it's stored, deleted and malformed ones included. */
export async function storedRows(indexedDB: IDBFactory, table: UserTable): Promise<unknown[]> {
  const db = createUserDatabase({ indexedDB, IDBKeyRange });
  const rows = await db.table(table).toArray();
  db.close();
  return rows;
}

/**
 * Runs change detection until `condition` holds, since live queries answer asynchronously. It waits a second, or
 * `timeout` ms after work that takes longer when the suite is busy (the app lock's key and transaction).
 */
export async function until(condition: () => boolean, timeout = 1000): Promise<void> {
  await vi.waitFor(
    () => {
      TestBed.tick();
      if (!condition()) throw new Error('Not yet');
    },
    { timeout },
  );
}
