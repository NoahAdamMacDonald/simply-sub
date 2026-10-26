import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { IndexedDbDependencies } from './storage-engine';

/**
 * An empty IndexedDB in memory, for when the browser's is blocked (PROJECT-PLAN P15). Dexie runs on it as on the
 * browser's, so every repository works unchanged, and everything in it is gone when the tab closes. Loaded only in that
 * case, as a chunk of its own.
 */
export function memoryIndexedDb(): IndexedDbDependencies {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}
