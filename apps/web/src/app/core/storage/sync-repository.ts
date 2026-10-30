import { Service, computed, inject } from '@angular/core';
import { rxResource, toObservable } from '@angular/core/rxjs-interop';
import {
  joinedSettings,
  nextUpdatedAt,
  sharedSettings,
  syncTables,
  withChanges,
  withSharedSettings,
  type LocalSync,
  type Settings,
  type SharedSettings,
  type SyncData,
  type SyncRecord,
  type UserRecords,
  type UserTable,
} from '@simply-sub/core';
import { EMPTY, distinctUntilChanged, map, merge, skip, switchMap, type Observable } from 'rxjs';
import { storageStatus } from './record-repository';
import type { StorageTransaction } from './storage-engine';
import { StorageService } from './storage-service';

/** What the app writes of the sync record: all but its key and stamp. */
export type SyncFields = Omit<SyncRecord, 'key' | 'updatedAt'>;

/** What a merge reads and writes: the synced tables and the settings. */
const mergedTables: readonly UserTable[] = [...syncTables, 'settings'];

/**
 * Sync on this device (PROJECT-PLAN P13, M10.9; BLUEPRINT §11.4): its record, under the key `sync`, which the app lock
 * seals and backups leave out, deleted outright when sync is turned off, since it was this device's alone; and the
 * synced tables, which SyncService reads and writes here in one transaction each, so a merge is all or nothing.
 */
@Service()
export class SyncRepository {
  private readonly storage = inject(StorageService);
  private readonly stored = rxResource({
    params: () => this.storage.access(),
    stream: () => this.storage.watch('sync'),
  });
  private readonly access = toObservable(this.storage.access);

  /** Sync on this device, while it's on. */
  readonly record = computed<SyncRecord | undefined>(() =>
    this.stored.hasValue() ? this.stored.value().find((row) => row.key === 'sync') : undefined,
  );
  readonly status = computed(() => storageStatus(this.stored));

  /** The record as stored now, read once: for Delete all data and Import, which may come before it has loaded. */
  async readOnce(): Promise<SyncRecord | undefined> {
    const engine = await this.storage.engine();
    return (await engine.read('sync')).find((row) => row.key === 'sync');
  }

  /** Stores sync's record in place of any before it: sync turned on, joined, or started over. */
  async save(fields: SyncFields): Promise<SyncRecord> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    const saved = await engine.modify(
      'sync',
      'sync',
      (current) => ({
        ...fields,
        key: 'sync',
        updatedAt: current ? nextUpdatedAt(current.updatedAt, now) : now,
      }),
      { invalid: 'replace' },
    );
    return saved as SyncRecord;
  }

  /** Changes the record; a field set to undefined is cleared. Nothing is written while sync is off. */
  async update(changes: Partial<SyncFields>): Promise<SyncRecord | undefined> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    return engine.modify('sync', 'sync', (current) =>
      current ? withChanges<SyncRecord>(current, changes, now) : undefined,
    );
  }

  /** Turns sync off on this device: the record goes, the data stays. */
  async remove(): Promise<void> {
    const engine = await this.storage.engine();
    await engine.transaction(['sync'], (transaction) => transaction.delete('sync', 'sync'));
  }

  /**
   * Emits after each change to a synced record, and to the settings only when a shared one changed (their
   * `sharedUpdatedAt` moved, as `sharedSettings` reads it), so the theme, the Calendar's shown lists, Home's seen price changes and the app lock start
   * no sync (M10.26). A write that moves no record's `updatedAt`, as the lock sealing them, emits nothing. The app
   * locking ends the tables' watches, so they start again once it's unlocked.
   */
  changes(): Observable<void> {
    const synced = syncTables.map((table) =>
      this.storage.watch(table).pipe(map((rows) => rows.map((row) => row.updatedAt).join())),
    );
    // As the copy has it: settings from before there was a sharedUpdatedAt have their updatedAt.
    const shared = this.storage.watch('settings').pipe(
      map((rows) => rows.find((row) => row.key === 'settings')),
      map((settings) => settings && (settings.sharedUpdatedAt ?? settings.updatedAt)),
    );
    return this.access.pipe(
      switchMap((access) =>
        access === undefined
          ? EMPTY
          : merge(
              ...[...synced, shared].map((stamps) =>
                stamps.pipe(distinctUntilChanged<string | undefined>(), skip(1)),
              ),
            ),
      ),
      map(() => undefined),
    );
  }

  /** This device's side of a merge: its shared settings and its synced records, soft-deleted ones included. */
  async readLocal(): Promise<LocalSync | undefined> {
    const engine = await this.storage.engine();
    return engine.transaction(mergedTables, async (transaction) => {
      const settings = await transaction.get('settings', 'settings');
      if (!settings) return undefined;
      const data: Partial<Record<UserTable, unknown[]>> = {};
      for (const table of syncTables) data[table] = await transaction.getAll(table);
      return { settings: sharedSettings(settings), data: data as SyncData };
    });
  }

  /**
   * What a merge took from the chain, written in one transaction: the records, and the shared settings. A new device
   * in its first run, which has no settings yet, starts them from the shared ones and its `theme` (M10.15).
   */
  async applyMerge(
    writes: Partial<SyncData>,
    settings: SharedSettings | undefined,
    theme?: Settings['theme'],
  ): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.transaction(mergedTables, async (transaction) => {
      await putAll(transaction, writes);
      if (settings) await takeSettings(transaction, settings, now, theme);
    });
  }

  /**
   * Join's Replace: this device's synced records and list drafts cleared, the chain's written, and its shared settings
   * taken, in one transaction. This device's own settings (the theme…) stay, or start from `theme` (applyMerge).
   */
  async replaceLocal(
    data: SyncData,
    settings: SharedSettings | undefined,
    theme?: Settings['theme'],
  ): Promise<void> {
    const now = this.storage.now();
    const engine = await this.storage.engine();
    await engine.transaction([...mergedTables, 'drafts'], async (transaction) => {
      for (const table of [...syncTables, 'drafts'] as const) await transaction.clear(table);
      await putAll(transaction, data);
      if (settings) await takeSettings(transaction, settings, now, theme);
    });
  }
}

async function putAll(transaction: StorageTransaction, data: Partial<SyncData>): Promise<void> {
  for (const table of syncTables) {
    for (const record of data[table] ?? []) {
      await transaction.put(table, record as UserRecords[typeof table]);
    }
  }
}

async function takeSettings(
  transaction: StorageTransaction,
  settings: SharedSettings,
  now: string,
  theme: Settings['theme'] | undefined,
): Promise<void> {
  const current = await transaction.get('settings', 'settings');
  if (current) await transaction.put('settings', withSharedSettings(current, settings, now));
  else if (theme) await transaction.put('settings', joinedSettings(settings, theme, now));
}
