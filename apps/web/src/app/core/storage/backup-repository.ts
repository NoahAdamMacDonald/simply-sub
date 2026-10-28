import { Service, inject } from '@angular/core';
import {
  backupTables,
  mergedRecords,
  userRecordSchemas,
  type BackupData,
  type BackupTable,
  type UserRecords,
  type UserTable,
} from '@simply-sub/core';
import type { StorageTransaction } from './storage-engine';
import { StorageService } from './storage-service';

/** How many records an import wrote to each table. */
export type ImportCounts = Record<BackupTable, number>;

/** Every table: Delete all data clears them all, the caches and the drafts too. */
const allTables = Object.keys(userRecordSchemas) as UserTable[];

/**
 * Backups' way into the database (PROJECT-PLAN P13's Your data, M6.9): the backed-up tables read in one transaction,
 * and written back in one, so an import is all or nothing. Every record is checked on the way in, as any write is.
 */
@Service()
export class BackupRepository {
  private readonly storage = inject(StorageService);

  /**
   * The backed-up tables' records, soft-deleted ones included, so a restore gives back the data as it was. Undefined
   * before the first run has saved the settings.
   */
  async read(): Promise<BackupData | undefined> {
    const engine = await this.storage.engine();
    return engine.transaction(backupTables, async (transaction) => {
      const settings = await transaction.get('settings', 'settings');
      if (!settings) return undefined;
      return {
        settings,
        lists: await transaction.getAll('lists'),
        items: await transaction.getAll('items'),
        customSubs: await transaction.getAll('customSubs'),
        rankings: await transaction.getAll('rankings'),
        cards: await transaction.getAll('cards'),
        tags: await transaction.getAll('tags'),
      };
    });
  }

  /**
   * Replace (P13): the backed-up tables cleared and filled with the backup's records, and the list drafts dropped,
   * since they're edits of lists that may not be there any more. One transaction.
   */
  async replace(data: BackupData): Promise<ImportCounts> {
    const engine = await this.storage.engine();
    return engine.transaction([...backupTables, 'drafts'], async (transaction) => {
      for (const table of [...backupTables, 'drafts'] as const) await transaction.clear(table);
      return writeAll(transaction, data, () => true);
    });
  }

  /**
   * Merge (P13): each of the backup's records that's newer than the stored one, or isn't stored, in one transaction.
   * Drafts stay. Says how many of each it wrote.
   */
  async merge(data: BackupData): Promise<ImportCounts> {
    const engine = await this.storage.engine();
    return engine.transaction(backupTables, async (transaction) => {
      const merged = new Map<BackupTable, ReadonlySet<unknown>>();
      for (const table of backupTables) {
        const stored = await transaction.getAll(table);
        merged.set(table, new Set(mergedRecords(table, stored, records(data, table))));
      }
      return writeAll(
        transaction,
        data,
        (table, record) => merged.get(table)?.has(record) ?? false,
      );
    });
  }

  /** Delete all data (P13): every table cleared, in one transaction. The first-run dialog then shows. */
  async deleteAll(): Promise<void> {
    const engine = await this.storage.engine();
    await engine.transaction(allTables, async (transaction) => {
      for (const table of allTables) await transaction.clear(table);
    });
  }
}

/** A table's records in a backup: its settings as one. */
function records<T extends BackupTable>(data: BackupData, table: T): UserRecords[T][] {
  return (table === 'settings' ? [data.settings] : data[table]) as UserRecords[T][];
}

/** Writes the backup's records that `take` keeps, table by table; how many of each it wrote. */
async function writeAll(
  transaction: StorageTransaction,
  data: BackupData,
  take: (table: BackupTable, record: unknown) => boolean,
): Promise<ImportCounts> {
  const counts = Object.fromEntries(backupTables.map((table) => [table, 0])) as ImportCounts;
  for (const table of backupTables) {
    for (const record of records(data, table)) {
      if (!take(table, record)) continue;
      await transaction.put(table, record);
      counts[table]++;
    }
  }
  return counts;
}
