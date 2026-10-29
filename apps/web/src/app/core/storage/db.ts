import Dexie, { type DexieOptions } from 'dexie';

/** The IndexedDB database. One per origin, which Simply Sub has to itself (BLUEPRINT §7.3). */
export const databaseName = 'simply-sub';

/**
 * The user database (BLUEPRINT §4.6). Dexie keeps only each table's primary key and indexes; the records' shapes are
 * core's schemas (`userRecordSchemas`). Only non-sensitive fields are indexed (§11.1), so the app lock (M6.10) can
 * seal everything else.
 *
 * A new table or index needs a new version. A change to the shape of stored records needs a new version with an
 * upgrade function, and the backup import (M6.9) has to migrate older files the same way.
 *
 * A plain Dexie rather than a subclass: TypeScript gives up on Dexie's transaction types for a subclass.
 */
export function createUserDatabase(options?: DexieOptions): Dexie {
  const db = new Dexie(databaseName, options);
  db.version(1).stores({
    lists: 'id, updatedAt',
    items: 'id, listId, updatedAt',
    customSubs: 'id, updatedAt',
    rankings: 'rankKey',
    cards: 'id',
    tags: 'id',
    settings: 'key',
    // Their record schemas came with their tasks: the catalog snapshot (M4.3), unsaved list edits (P5, M6.3) and
    // dismissed optimizer suggestions (P14, M8.2, version 3).
    catalogCache: 'key',
    drafts: 'listId',
    dismissedSuggestions: 'fingerprint',
  });
  // The last exchange rates fetched (M4.4). A new table needs no upgrade function.
  db.version(2).stores({ fxRates: 'key' });
  // Dismissed optimizer suggestions get their record schema (M8.2), and an index of their list. Until now the table had
  // no schema and nothing wrote to it, so whatever is there wasn't written by the app: the upgrade empties it.
  db.version(3)
    .stores({ dismissedSuggestions: 'fingerprint, listId' })
    .upgrade((transaction) => transaction.table('dismissedSuggestions').clear());
  // The live calendar's feed set (M10.3): one record, under the key `liveCalendar`. A new table needs no upgrade.
  db.version(4).stores({ liveCalendar: 'key' });
  return db;
}
