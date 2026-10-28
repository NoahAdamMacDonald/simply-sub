import * as z from 'zod';
import { base64Schema } from './record';
import { lockIdleMinuteChoices } from './lock-idle';
import type { UserTable } from './records';

// The app lock (PROJECT-PLAN P13, P15; BLUEPRINT §11.5, M6.10): a passphrase the user types encrypts their tables at
// rest. Core has its rules: what the settings keep, and which tables and fields are sealed (Lock after's choices are
// lock-idle.ts's). The app's crypto module (apps/web core/crypto) derives the key and seals the rows, since core has
// no WebCrypto.

/** A text sealed with the lock's key: AES-256-GCM's IV and output, in base64. */
export const sealedTextSchema = z.strictObject({ iv: base64Schema, ciphertext: base64Schema });
export type SealedText = z.infer<typeof sealedTextSchema>;

/**
 * The app lock in the settings (BLUEPRINT §4.6, §11.5): how the key comes from the passphrase (PBKDF2-HMAC-SHA256 with
 * this salt and these iterations), and a check value sealed with it, which tells a wrong passphrase. Nothing here
 * opens the data without the passphrase. It's this device's, so backups leave it out.
 */
export const appLockSchema = z.strictObject({
  salt: base64Schema,
  iterations: z.int().min(1).max(10_000_000),
  check: sealedTextSchema,
  /** Lock after, in minutes. Left out: never, so it locks only when the tab closes. */
  idleMinutes: z.literal(lockIdleMinuteChoices).optional(),
});
export type AppLock = z.infer<typeof appLockSchema>;

/** What the check value holds, and what it's bound to (GCM's additional data). */
export const lockCheck = { text: 'simply-sub app lock', boundTo: 'simply-sub:lock:check' } as const;

/** The tables the lock seals: every user table but the caches, which are public (BLUEPRINT §11.5). */
export const lockedTables = [
  'settings',
  'lists',
  'items',
  'customSubs',
  'rankings',
  'cards',
  'tags',
  'drafts',
  'dismissedSuggestions',
] as const satisfies readonly UserTable[];
export type LockedTable = (typeof lockedTables)[number];

export function isLockedTable(table: UserTable): table is LockedTable {
  return (lockedTables as readonly UserTable[]).includes(table);
}

/**
 * What a locked table's rows keep in plain text: their key and indexes, which IndexedDB needs, and the settings needed
 * before unlocking (the theme, and the lock itself). These are the fields BLUEPRINT §11.1 calls non-sensitive; the
 * rest of the record is sealed.
 */
export const lockPlainFields = {
  settings: ['key', 'theme', 'appLock'],
  lists: ['id', 'updatedAt'],
  items: ['id', 'listId', 'updatedAt'],
  customSubs: ['id', 'updatedAt'],
  rankings: ['rankKey'],
  cards: ['id'],
  tags: ['id'],
  drafts: ['listId'],
  dismissedSuggestions: ['fingerprint', 'listId'],
} as const satisfies Record<LockedTable, readonly string[]>;

/** The fields kept in plain text only, never sealed: the lock's own settings, so Lock after changes with no key. */
const plainOnlyFields: Partial<Record<LockedTable, readonly string[]>> = { settings: ['appLock'] };

/** What a sealed row's value is bound to: its table and key, so it can't be moved to another row. */
export function lockBinding(table: LockedTable, key: unknown): string {
  return `simply-sub:lock:${table}:${String(key)}`;
}

/** The text to seal for a record: all of it, the plain-only fields left out. */
export function sealedRecordText(table: LockedTable, record: object): string {
  const omitted = plainOnlyFields[table] ?? [];
  return JSON.stringify(
    Object.fromEntries(Object.entries(record).filter(([field]) => !omitted.includes(field))),
  );
}

/** A record's row once sealed: its plain fields, and `sealed`, which holds the rest. */
export function sealedRow(
  table: LockedTable,
  record: object,
  sealed: SealedText,
): Record<string, unknown> {
  const plain = Object.entries(record).filter(
    ([field, value]) =>
      (lockPlainFields[table] as readonly string[]).includes(field) && value !== undefined,
  );
  return { ...Object.fromEntries(plain), sealed };
}

/** The sealed value of a stored row; undefined when the row is plain. */
export function rowSeal(row: unknown): SealedText | undefined {
  if (typeof row !== 'object' || row === null || !('sealed' in row)) return undefined;
  const sealed = sealedTextSchema.safeParse(row.sealed);
  return sealed.success ? sealed.data : undefined;
}

/** The record a sealed row holds, from the text it opened to and its plain-only fields. */
export function openedRecord(table: LockedTable, row: object, text: string): unknown {
  const record: unknown = JSON.parse(text);
  if (typeof record !== 'object' || record === null) return record;
  const plain = Object.entries(row).filter(([field]) =>
    (plainOnlyFields[table] ?? []).includes(field),
  );
  return { ...record, ...Object.fromEntries(plain) };
}
