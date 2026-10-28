import * as z from 'zod';
import { addDuplicateIssues } from '../catalog/checks';
import type { IsoDate } from '../dates/iso-date';
import type { FormIssue } from './item-form';
import { customSubscriptionSchema } from './custom-subscription';
import { listItemSchema } from './list-item';
import { paymentCardSchema } from './payment-card';
import { profileRankingSchema } from './profile-ranking';
import { timestampSchema, type Timestamp } from './record';
import { userRecordKeys, type UserRecords } from './records';
import { settingsSchema } from './settings';
import { subscriptionListSchema } from './subscription-list';
import { tagSchema } from './tag';

// Backups (PROJECT-PLAN P13's Your data, BLUEPRINT §11.2 and §11.5, M6.9): the user's records as one JSON file, which
// Import checks whole before anything is written. A plain file holds the records in `data`; an encrypted one holds them
// in `encrypted`, which the app's crypto module (apps/web core/crypto) opens with the passphrase. The caches and the
// list drafts aren't backed up: the catalog and the rates download again, and a draft is edits not saved.

/** What every backup file says it is. */
export const backupApp = 'simply-sub';

/** This version of the file's shape. A file from an older version is migrated as it's read (migrateBackupData). */
export const backupSchemaVersion = 1;

/** The tables a backup holds, in the order they're written back. */
export const backupTables = [
  'settings',
  'tags',
  'customSubs',
  'lists',
  'items',
  'rankings',
  'cards',
] as const;
export type BackupTable = (typeof backupTables)[number];

/** Each table's records, soft-deleted ones included, so a restore gives back the data as it was. */
export const backupDataSchema = z
  .strictObject({
    settings: settingsSchema,
    lists: z.array(subscriptionListSchema),
    items: z.array(listItemSchema),
    customSubs: z.array(customSubscriptionSchema),
    rankings: z.array(profileRankingSchema),
    cards: z.array(paymentCardSchema),
    tags: z.array(tagSchema),
  })
  .superRefine((data, ctx) => {
    for (const table of backupTables) {
      if (table === 'settings') continue;
      const key = userRecordKeys[table];
      const records = data[table] as readonly Record<string, unknown>[];
      addDuplicateIssues(
        ctx,
        records.map((record) => String(record[key])),
        (index) => [table, index, key],
      );
    }
  });
export type BackupData = z.infer<typeof backupDataSchema>;

/** What an encrypted file opens to, and what a plain one holds beside its header. */
export const backupPayloadSchema = z.strictObject({
  exportedAt: timestampSchema,
  /** The catalog version the app had then: what the items' plans were priced from. */
  catalogVersion: z.string().min(1).optional(),
  data: backupDataSchema,
});
export type BackupPayload = z.infer<typeof backupPayloadSchema>;

const headerShape = {
  app: z.literal(backupApp),
  schemaVersion: z.int().positive(),
};

/** A plain backup file. */
export const plainBackupSchema = z.strictObject({ ...headerShape, ...backupPayloadSchema.shape });
export type PlainBackup = z.infer<typeof plainBackupSchema>;

/** Base64, as the crypto module writes it. */
const base64Schema = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Use base64');

/**
 * An encrypted backup file (BLUEPRINT §11.5): AES-256-GCM with a key derived by PBKDF2-HMAC-SHA256 from the
 * passphrase and the salt. The header (app, schemaVersion) is bound to the ciphertext, so changing it fails the check.
 */
export const encryptedBackupSchema = z.strictObject({
  ...headerShape,
  encrypted: z.strictObject({
    kdf: z.literal('PBKDF2-SHA256'),
    iterations: z.int().min(1).max(10_000_000),
    salt: base64Schema,
    iv: base64Schema,
    ciphertext: base64Schema,
  }),
});
export type EncryptedBackup = z.infer<typeof encryptedBackupSchema>;
export type BackupEnvelope = EncryptedBackup['encrypted'];

/** A file Import read: its records, checked and migrated; or one that needs its passphrase; or why it can't be used. */
export type BackupReading =
  | { kind: 'backup'; backup: BackupPayload }
  | { kind: 'encrypted'; file: EncryptedBackup }
  | { kind: 'refused'; reason: string };

/** Why a file is refused. None quotes the file: it could hold anything. */
export const backupRefusals = {
  tooBig: 'This file is too big to be a Simply Sub backup.',
  notJson: 'This file isn’t a Simply Sub backup.',
  notBackup: 'This file isn’t a Simply Sub backup.',
  newer: 'This backup is from a newer version of Simply Sub. Update the app, then try again.',
  invalid: 'This backup has data the app can’t read, so nothing was imported.',
  wrongPassphrase: 'That passphrase doesn’t open this backup, or the file was changed.',
} as const;

/** The largest file Import reads: a backup of a few hundred records is a few hundred kB. */
export const maxBackupBytes = 10 * 1024 * 1024;

/** The shortest passphrase Export takes (P13). */
export const minPassphraseLength = 8;

/** The export dialog's passphrase, typed twice. */
export interface PassphraseForm {
  passphrase: string;
  confirm: string;
}

/** What's wrong with a new passphrase: too short, or typed differently the second time. It's never trimmed. */
export function passphraseIssues({ passphrase, confirm }: PassphraseForm): FormIssue[] {
  const issues: FormIssue[] = [];
  if (passphrase.length < minPassphraseLength) {
    issues.push({
      path: ['passphrase'],
      message: `Use at least ${minPassphraseLength} characters`,
    });
  }
  if (confirm !== passphrase) {
    issues.push({ path: ['confirm'], message: 'Type the same passphrase again' });
  }
  return issues;
}

/** The file Export writes: the header and the records. */
export function plainBackup(payload: BackupPayload): PlainBackup {
  return { app: backupApp, schemaVersion: backupSchemaVersion, ...payload };
}

/** An encrypted file, from what the crypto module made of the payload. */
export function encryptedBackup(envelope: BackupEnvelope): EncryptedBackup {
  return { app: backupApp, schemaVersion: backupSchemaVersion, encrypted: envelope };
}

/**
 * What an encrypted file's header binds its ciphertext to (GCM's additional data): changing the app or the version
 * fails the check, as a change to the ciphertext does.
 */
export function backupAssociatedData({
  app,
  schemaVersion,
}: Pick<EncryptedBackup, 'app' | 'schemaVersion'>): string {
  return `${app}:${schemaVersion}`;
}

/** The name Export gives the file: `simply-sub-backup-2026-10-27.json`. */
export function backupFileName(today: IsoDate): string {
  return `${backupApp}-backup-${today}.json`;
}

/**
 * Reads a file's text as Import does: a plain backup, checked whole and migrated; an encrypted one, whose payload
 * readBackupPayload checks once it's opened; or why it's refused. Nothing in a refused file is used.
 */
export function readBackupText(text: string): BackupReading {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return refused('notJson');
  }
  if (!isObject(json) || json['app'] !== backupApp) return refused('notBackup');
  const version = json['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return refused('notBackup');
  }
  if (version > backupSchemaVersion) return refused('newer');
  if ('encrypted' in json) {
    const file = encryptedBackupSchema.safeParse(json);
    return file.success ? { kind: 'encrypted', file: file.data } : refused('notBackup');
  }
  // The rest of the file is its payload, checked whole: an unknown field refuses it.
  const payload = Object.fromEntries(
    Object.entries(json).filter(([key]) => key !== 'app' && key !== 'schemaVersion'),
  );
  return readBackupPayload(payload, version);
}

/** An encrypted file's payload, as the crypto module opened it, checked and migrated from the file's version. */
export function readBackupPayload(payload: unknown, schemaVersion: number): BackupReading {
  if (schemaVersion > backupSchemaVersion) return refused('newer');
  const migrated = migrateBackupPayload(payload, schemaVersion);
  const result = backupPayloadSchema.safeParse(migrated);
  return result.success ? { kind: 'backup', backup: result.data } : refused('invalid');
}

/**
 * Brings a payload from an older version of the file up to this one, a step at a time. Version 1 is the first, so
 * there's nothing to do yet; a change to a record's shape adds a step here and bumps backupSchemaVersion.
 */
export function migrateBackupPayload(payload: unknown, schemaVersion: number): unknown {
  let migrated = payload;
  for (let version = schemaVersion; version < backupSchemaVersion; version++) {
    const step = backupMigrations[version];
    if (step) migrated = step(migrated);
  }
  return migrated;
}

/** From each version to the next. */
const backupMigrations: Record<number, (payload: unknown) => unknown> = {};

/** How many of each kind of record a backup has, the deleted ones left out: Import's preview (P13). */
export interface BackupCounts {
  lists: number;
  items: number;
  customSubs: number;
  rankings: number;
  cards: number;
  tags: number;
}

export function backupCounts(data: BackupData): BackupCounts {
  const live = (records: readonly { deletedAt?: Timestamp }[]) =>
    records.filter((record) => record.deletedAt === undefined).length;
  return {
    lists: live(data.lists),
    items: live(data.items),
    customSubs: live(data.customSubs),
    rankings: data.rankings.length,
    cards: live(data.cards),
    tags: live(data.tags),
  };
}

/**
 * Merge (P13): the records to write so the stored ones take the backup's, by key, where the backup's is newer
 * (`updatedAt`) or the record isn't stored. A deletion merges like any change, so one the backup made later stays made.
 */
export function mergedRecords<T extends BackupTable>(
  table: T,
  stored: readonly UserRecords[T][],
  incoming: readonly UserRecords[T][],
): UserRecords[T][] {
  const key = userRecordKeys[table];
  const byKey = new Map(stored.map((record) => [keyOf(record, key), record]));
  return incoming.filter((record) => {
    const current = byKey.get(keyOf(record, key));
    return current === undefined || record.updatedAt > current.updatedAt;
  });
}

function keyOf(record: object, key: string): string {
  return String((record as Record<string, unknown>)[key]);
}

function refused(reason: keyof typeof backupRefusals): BackupReading {
  return { kind: 'refused', reason: backupRefusals[reason] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
