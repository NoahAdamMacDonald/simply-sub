import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createUserDatabase, databaseName } from './db';

describe('createUserDatabase', () => {
  it("upgrades a version 1 database to version 5 and keeps what's stored", async () => {
    const indexedDB = new IDBFactory();
    // Version 1 as M4.1 shipped it.
    const v1 = new Dexie(databaseName, { indexedDB, IDBKeyRange });
    v1.version(1).stores({
      lists: 'id, updatedAt',
      items: 'id, listId, updatedAt',
      customSubs: 'id, updatedAt',
      rankings: 'rankKey',
      cards: 'id',
      tags: 'id',
      settings: 'key',
      catalogCache: 'key',
      drafts: 'listId',
      dismissedSuggestions: 'fingerprint',
    });
    await v1.table('settings').put({ key: 'settings', theme: 'dark' });
    // Nothing wrote here before version 3: a row is what tampering or a bug left.
    await v1.table('dismissedSuggestions').put({ fingerprint: 'planted' });
    v1.close();

    const db = createUserDatabase({ indexedDB, IDBKeyRange });
    await db.open();
    expect(db.verno).toBe(5);
    expect(await db.table('settings').get('settings')).toEqual({ key: 'settings', theme: 'dark' });
    await db.table('fxRates').put({ key: 'fx' });
    expect(await db.table('fxRates').count()).toBe(1);
    // Version 3 empties the dismissals and indexes them by list.
    expect(await db.table('dismissedSuggestions').count()).toBe(0);
    await db.table('dismissedSuggestions').put({ fingerprint: '3f9a0c1d2e4b5a67', listId: 'list' });
    expect(await db.table('dismissedSuggestions').where('listId').equals('list').count()).toBe(1);
    // Version 4 adds the live calendar's table (M10.3).
    await db.table('liveCalendar').put({ key: 'liveCalendar' });
    expect(await db.table('liveCalendar').count()).toBe(1);
    db.close();
  });
});
