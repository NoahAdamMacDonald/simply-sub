import type { Timestamp } from './record';

// How a stored record's timestamps change. This file imports no Zod, so the app's repositories can use it without
// loading the record schemas (BLUEPRINT §11.1).

/** The timestamps every stored record has. */
export interface Stamped {
  updatedAt: Timestamp;
  deletedAt?: Timestamp;
}

/**
 * The `updatedAt` of a change made at `now` to a record last changed at `previous`: `now`, or a millisecond after
 * `previous` when the device clock has gone back since. It only moves forward, so the latest change wins a merge.
 */
export function nextUpdatedAt(previous: Timestamp, now: Timestamp): Timestamp {
  return now > previous ? now : new Date(Date.parse(previous) + 1).toISOString();
}

/** `record` with `changes` made at `now`. A key set to undefined is removed, which clears an optional field. */
export function withChanges<T extends Stamped>(record: T, changes: Partial<T>, now: Timestamp): T {
  const changed: Partial<T> = { ...record };
  for (const key of Object.keys(changes) as (keyof T)[]) {
    if (changes[key] === undefined) {
      delete changed[key];
    } else {
      changed[key] = changes[key];
    }
  }
  return { ...changed, updatedAt: nextUpdatedAt(record.updatedAt, now) } as T;
}

/** `record` deleted at `now`. It stays stored with `deletedAt`, so a sync can pass the deletion on. */
export function softDeleted<T extends Stamped>(record: T, now: Timestamp): T {
  const at = nextUpdatedAt(record.updatedAt, now);
  return { ...record, updatedAt: at, deletedAt: at };
}
