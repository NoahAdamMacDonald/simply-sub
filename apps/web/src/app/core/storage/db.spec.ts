import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createUserDatabase, databaseName } from './db';

describe('createUserDatabase', () => {
  it("upgrades a version 1 database to version 2 and keeps what's stored", async () => {
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
    v1.close();

    const db = createUserDatabase({ indexedDB, IDBKeyRange });
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.table('settings').get('settings')).toEqual({ key: 'settings', theme: 'dark' });
    await db.table('fxRates').put({ key: 'fx' });
    expect(await db.table('fxRates').count()).toBe(1);
    db.close();
  });
});
