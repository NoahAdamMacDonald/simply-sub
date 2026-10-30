import * as z from 'zod';
import { backupSchemaVersion, migrateBackupPayload } from './backup';
import { recordIdSchema, timestampSchema, type Timestamp } from './record';
import {
  describeRejected,
  readRecords,
  userRecordKeys,
  type RejectedRecord,
  type UserRecords,
} from './records';
import { addSubdivisionIssue, settingsSchema, type Settings } from './settings';
import { sharedSettingsFields } from './shared-settings';
import { nextUpdatedAt } from './stamps';
import { maxDeviceNameLength } from './sync-record';

// Device sync (PROJECT-PLAN M10.7–M10.9, BLUEPRINT §11.4): the copy of the user's data a sync chain keeps, which each
// device seals with a key only the chain's devices have, and how a device merges it with its own. A record merges by
// its key: the later `updatedAt` wins, a deletion included (a soft delete moves it on), a tie goes the same way on every
// device, and a record only one side has is kept. The settings every device shares merge as one, by when one of them
// last changed. The rest of the settings (the theme, the Calendar's shown lists, Home's price changes, the app lock), the
// drafts and the caches never leave the device.

/** The tables a copy holds: the backup's, the settings aside, and the live calendar's links (M10.3). */
export const syncTables = [
  'tags',
  'customSubs',
  'lists',
  'items',
  'rankings',
  'cards',
  'dismissedSuggestions',
  'liveCalendar',
] as const;
export type SyncTable = (typeof syncTables)[number];
export type SyncData = { [T in SyncTable]: UserRecords[T][] };

/** The version of a copy's shape: the backup's, so a copy from an older app is migrated as a backup is. */
export const syncSchemaVersion = backupSchemaVersion;

const settingsShape = settingsSchema.shape;

/** A copy's shared settings, with when one of them last changed. */
export const sharedSettingsSchema = z
  .strictObject({
    country: settingsShape.country,
    subdivision: settingsShape.subdivision,
    currency: settingsShape.currency,
    salesTaxPercent: settingsShape.salesTaxPercent,
    monthlyBudget: settingsShape.monthlyBudget,
    annualBudget: settingsShape.annualBudget,
    searchSoldOnly: settingsShape.searchSoldOnly,
    searchAllResellers: settingsShape.searchAllResellers,
    dismissedBudgetWarnings: settingsShape.dismissedBudgetWarnings,
    updatedAt: timestampSchema,
  })
  .superRefine(addSubdivisionIssue);
export type SharedSettings = z.infer<typeof sharedSettingsSchema>;

/** A device on a chain: its id, the name its user gave it, and when it last synced. */
export const syncDeviceSchema = z.strictObject({
  id: recordIdSchema,
  name: z.string().trim().min(1).max(maxDeviceNameLength),
  syncedAt: timestampSchema,
});
export type SyncDevice = z.infer<typeof syncDeviceSchema>;

/** The most devices a copy lists, the ones that synced last. One left off still syncs, and is listed again when it does. */
export const maxSyncDevices = 20;

/**
 * How long a device with nothing new goes before it writes anyway, to move its "last synced" on: the devices' list says
 * when each one last synced to the day, and the server keeps a chain 180 days after its last write.
 */
export const deviceRefreshMs = 24 * 60 * 60 * 1000;

/** A copy: what a device seals and sends, and, read back, what it holds that passed its schemas. */
export interface SyncCopy {
  schemaVersion: number;
  /** Left out when a copy's own failed their schema: each device then keeps its own. */
  settings?: SharedSettings;
  data: SyncData;
  devices: SyncDevice[];
}

/** What reading a copy found: its records that passed, and the ones that didn't; or why it can't be used here. */
export type SyncReading =
  | { kind: 'copy'; copy: SyncCopy; rejected: RejectedRecord[] }
  /** Written by a newer version of the app, which this one can't merge: sync stops on this device until it updates. */
  | { kind: 'newer' }
  | { kind: 'unreadable' };

/** This device's side of a merge: its shared settings and its records, soft-deleted ones included. */
export interface LocalSync {
  settings: SharedSettings;
  data: SyncData;
}

/** What a merge found. */
export interface SyncMerge {
  /** The chain's next version: the newer of each record, and this device's entry among the devices. */
  copy: SyncCopy;
  /** The records this device must write: the copy's that are newer than its own, or that it doesn't have. */
  writes: Partial<SyncData>;
  /** The shared settings to take, when the copy's changed later than this device's. */
  settings?: SharedSettings;
  /** Whether the chain needs the new version: this device had something newer, or its entry is due a refresh. */
  send: boolean;
}

/** `settings`' shared part, as a copy holds it: its time is `sharedUpdatedAt`, or `updatedAt` before there was one. */
export function sharedSettings(settings: Settings): SharedSettings {
  const shared: Partial<Record<keyof Settings, unknown>> = {};
  for (const field of sharedSettingsFields) {
    if (settings[field] !== undefined) shared[field] = settings[field];
  }
  return {
    ...shared,
    updatedAt: settings.sharedUpdatedAt ?? settings.updatedAt,
  } as SharedSettings;
}

/** `settings` with the shared ones taken from another device at `now`: this device's own (the theme…) stay. */
export function withSharedSettings(
  settings: Settings,
  shared: SharedSettings,
  now: Timestamp,
): Settings {
  const own = Object.fromEntries(
    Object.entries(settings).filter(
      ([field]) => !(sharedSettingsFields as readonly string[]).includes(field),
    ),
  );
  const { updatedAt, ...fields } = shared;
  return {
    ...own,
    ...fields,
    sharedUpdatedAt: updatedAt,
    updatedAt: nextUpdatedAt(settings.updatedAt, now),
  } as Settings;
}

/**
 * Reads a copy a device opened: each record checked with its schema (one that fails is left out, and described by its
 * table, key and issues, never its values), a copy from an older app migrated as a backup is, one from a newer app
 * refused.
 */
export function readSyncCopy(json: unknown): SyncReading {
  if (!isObject(json)) return { kind: 'unreadable' };
  const version = json['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { kind: 'unreadable' };
  }
  if (version > syncSchemaVersion) return { kind: 'newer' };
  const migrated = migrateBackupPayload({ data: json['data'] }, version);
  const tables = isObject(migrated) ? migrated['data'] : undefined;
  if (!isObject(tables)) return { kind: 'unreadable' };

  const rejected: RejectedRecord[] = [];
  const data = Object.fromEntries(
    syncTables.map((table) => {
      const rows = tables[table];
      const read = readRecords(table, Array.isArray(rows) ? rows : []);
      rejected.push(...read.rejected);
      return [table, newestByKey(table, read.records)];
    }),
  ) as SyncData;
  const settings = sharedSettingsSchema.safeParse(json['settings']);
  if (!settings.success) {
    rejected.push(describeRejected('settings', json['settings'], settings.error.issues));
  }
  const devices = (Array.isArray(json['devices']) ? json['devices'] : []).flatMap((device) => {
    const read = syncDeviceSchema.safeParse(device);
    return read.success ? [read.data] : [];
  });
  return {
    kind: 'copy',
    copy: {
      schemaVersion: syncSchemaVersion,
      ...(settings.success && { settings: settings.data }),
      data,
      devices: newestDevices(devices),
    },
    rejected,
  };
}

/**
 * Merges this device's data with the chain's copy (none when the chain is new): per record, the later `updatedAt`, a
 * tie decided the same way on every device. It says what this device must write and whether to send a new version.
 */
export function mergeSync(
  local: LocalSync,
  remote: SyncCopy | undefined,
  device: Pick<SyncDevice, 'id' | 'name'>,
  now: Timestamp,
): SyncMerge {
  let newer = remote === undefined;
  const writes: Partial<SyncData> = {};
  const data = {} as Record<SyncTable, unknown[]>;
  for (const table of syncTables) {
    const merged = mergeTable(table, local.data[table], remote?.data[table] ?? []);
    data[table] = merged.records;
    if (merged.writes.length > 0) (writes as Record<SyncTable, unknown[]>)[table] = merged.writes;
    newer ||= merged.localNewer;
  }

  let settings = local.settings;
  let takeSettings: SharedSettings | undefined;
  if (remote?.settings !== undefined && !same(local.settings, remote.settings)) {
    if (later(local.settings, remote.settings) === remote.settings) {
      settings = remote.settings;
      takeSettings = remote.settings;
    } else {
      newer = true;
    }
  } else if (remote?.settings === undefined) {
    newer = true;
  }

  const listed = remote?.devices.find(({ id }) => id === device.id);
  const refresh =
    newer ||
    listed === undefined ||
    listed.name !== device.name ||
    Date.parse(now) - Date.parse(listed.syncedAt) >= deviceRefreshMs;
  const own: SyncDevice = refresh ? { id: device.id, name: device.name, syncedAt: now } : listed;
  const devices = newestDevices([
    own,
    ...(remote?.devices ?? []).filter(({ id }) => id !== device.id),
  ]);

  return {
    copy: { schemaVersion: syncSchemaVersion, settings, data: data as SyncData, devices },
    writes,
    ...(takeSettings !== undefined && { settings: takeSettings }),
    send: refresh,
  };
}

/** One table's merge: the merged records, the ones this device must write, and whether it had any newer. */
function mergeTable(
  table: SyncTable,
  mine: readonly Stamped[],
  theirs: readonly Stamped[],
): { records: Stamped[]; writes: Stamped[]; localNewer: boolean } {
  const key = userRecordKeys[table];
  const merged = new Map(theirs.map((record) => [keyOf(record, key), record]));
  const ownByKey = new Map(mine.map((record) => [keyOf(record, key), record]));
  let localNewer = false;
  for (const record of mine) {
    const other = merged.get(keyOf(record, key));
    if (other === undefined || (!same(record, other) && later(record, other) === record)) {
      merged.set(keyOf(record, key), record);
      localNewer = true;
    }
  }
  const writes = theirs.filter((record) => {
    const own = ownByKey.get(keyOf(record, key));
    return own === undefined || (!same(own, record) && later(own, record) === record);
  });
  return { records: [...merged.values()], writes, localNewer };
}

interface Stamped {
  updatedAt: Timestamp;
}

/** The later of two versions of a record; on the same `updatedAt`, the one whose canonical JSON sorts last. */
function later<T extends Stamped>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return canonical(a) >= canonical(b) ? a : b;
}

/** A table's records with one per key, the latest, should a copy hold two. */
function newestByKey<T extends Stamped>(table: SyncTable, records: readonly T[]): T[] {
  const key = userRecordKeys[table];
  const byKey = new Map<string, T>();
  for (const record of records) {
    const other = byKey.get(keyOf(record, key));
    byKey.set(keyOf(record, key), other === undefined ? record : later(record, other));
  }
  return [...byKey.values()];
}

/** The devices, one per id, those that synced last first, up to maxSyncDevices. */
function newestDevices(devices: readonly SyncDevice[]): SyncDevice[] {
  const byId = new Map<string, SyncDevice>();
  for (const device of devices) {
    const other = byId.get(device.id);
    if (other === undefined || device.syncedAt > other.syncedAt) byId.set(device.id, device);
  }
  return [...byId.values()]
    .sort((a, b) => (a.syncedAt < b.syncedAt ? 1 : a.syncedAt > b.syncedAt ? -1 : 0))
    .slice(0, maxSyncDevices);
}

function keyOf(record: object, key: string): string {
  return String((record as Record<string, unknown>)[key]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The API's side (M10.8): GET, PUT and DELETE /sync/:chain.

/** The largest sealed copy the server keeps: a few hundred records are tens of kB gzipped. */
export const maxSealedCopyBytes = 1024 * 1024;

/** GET /sync/:chain answers with the sealed copy's bytes, not JSON. */
export const syncBody = 'application/octet-stream';

/** PUT /sync/:chain's answer: the chain's new version, also its ETag, and when it was written. */
export const syncWriteBodySchema = z.strictObject({
  data: z.strictObject({
    version: z.string().regex(/^[1-9][0-9]*$/),
    updatedAt: z.iso.datetime(),
  }),
  meta: z.strictObject({}),
});
export type SyncWriteBody = z.infer<typeof syncWriteBodySchema>;

/** Whether two values are the same, whatever order their objects' keys are in. */
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

/** JSON with every object's keys sorted, so two devices that store a record's fields in another order agree on it. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    isObject(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : field,
  );
}
