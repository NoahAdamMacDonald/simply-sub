import type * as z from 'zod';
import { rankKeySchema } from '../catalog/formats';
import { catalogCacheSchema } from './catalog-cache';
import { customSubscriptionSchema } from './custom-subscription';
import { listItemSchema } from './list-item';
import { paymentCardSchema } from './payment-card';
import { profileRankingSchema } from './profile-ranking';
import { recordIdSchema } from './record';
import { settingsSchema } from './settings';
import { subscriptionListSchema } from './subscription-list';
import { tagSchema } from './tag';

/**
 * The record schemas of the database's tables, by Dexie table name (BLUEPRINT §4.6). The repositories check every
 * record against them on the way in and out (§11.1), and backups (M6.9) use the same ones, except catalogCache's: a
 * cache of the catalog files, not the user's data. drafts and dismissedSuggestions get theirs with M6.3 and M8.2.
 */
export const userRecordSchemas = {
  lists: subscriptionListSchema,
  items: listItemSchema,
  customSubs: customSubscriptionSchema,
  rankings: profileRankingSchema,
  cards: paymentCardSchema,
  tags: tagSchema,
  settings: settingsSchema,
  catalogCache: catalogCacheSchema,
};
export type UserTable = keyof typeof userRecordSchemas;
export type UserRecords = { [T in UserTable]: z.infer<(typeof userRecordSchemas)[T]> };

/** Each table's primary key, as in the Dexie schema. */
export const userRecordKeys = {
  lists: 'id',
  items: 'id',
  customSubs: 'id',
  rankings: 'rankKey',
  cards: 'id',
  tags: 'id',
  settings: 'key',
  catalogCache: 'key',
} as const satisfies Record<UserTable, string>;

/** What each table's well-formed keys look like. */
const keySchemas: Record<UserTable, z.ZodType<string>> = {
  lists: recordIdSchema,
  items: recordIdSchema,
  customSubs: recordIdSchema,
  rankings: rankKeySchema,
  cards: recordIdSchema,
  tags: recordIdSchema,
  settings: settingsSchema.shape.key,
  catalogCache: catalogCacheSchema.shape.key,
};

/** A stored record that failed its schema, described without any of its values. */
export interface RejectedRecord {
  table: UserTable;
  /** Its primary key, when that's well formed: a UUID, a rank key, `settings` or a catalog file's key. */
  key?: string;
  /** Each issue as `path: code` (`billing.anchorDate: invalid_format`). */
  issues: string[];
}

/** A record that can't be stored or read: its description, and none of its values. */
export class InvalidRecordError extends Error {
  constructor(readonly rejected: RejectedRecord) {
    super(`Invalid ${rejected.table} record ${rejected.key ?? ''}: ${rejected.issues.join('; ')}`);
    this.name = 'InvalidRecordError';
  }
}

/** The valid records among `rows`, as their schema returns them, and a description of each one that isn't. */
export function readRecords<T extends UserTable>(
  table: T,
  rows: readonly unknown[],
): { records: UserRecords[T][]; rejected: RejectedRecord[] } {
  const records: UserRecords[T][] = [];
  const rejected: RejectedRecord[] = [];
  for (const row of rows) {
    const result = userRecordSchemas[table].safeParse(row);
    if (result.success) {
      records.push(result.data as UserRecords[T]);
    } else {
      rejected.push(describeRejected(table, row, result.error.issues));
    }
  }
  return { records, rejected };
}

/** `record` as its schema returns it (text trimmed), ready to store. Throws an InvalidRecordError if it fails. */
export function checkRecord<T extends UserTable>(table: T, record: unknown): UserRecords[T] {
  const result = userRecordSchemas[table].safeParse(record);
  if (!result.success) {
    throw new InvalidRecordError(describeRejected(table, record, result.error.issues));
  }
  return result.data as UserRecords[T];
}

/**
 * Describes a record by its key and its issues' paths and codes. Never the messages: Zod's can quote the data
 * ('Unrecognized key: "…"'), and so can a duplicate check's.
 */
function describeRejected(
  table: UserTable,
  row: unknown,
  issues: readonly z.core.$ZodIssue[],
): RejectedRecord {
  const field = userRecordKeys[table];
  const key =
    typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[field] : undefined;
  return {
    table,
    ...(keySchemas[table].safeParse(key).success && { key: key as string }),
    issues: issues.map(
      (issue) => `${issue.path.map(pathSegment).join('.') || '(record)'}: ${issue.code}`,
    ),
  };
}

/**
 * An index, or a camelCase word like the schemas' field names. Anything else shows as `…`: a map's keys (a rank key
 * in rankOverrides) are stored data, and a tampered record could put anything there.
 */
function pathSegment(part: PropertyKey): string {
  if (typeof part === 'number') return String(part);
  return typeof part === 'string' && /^[a-z][a-zA-Z]{0,31}$/.test(part) ? part : '…';
}
