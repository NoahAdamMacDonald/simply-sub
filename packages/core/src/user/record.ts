import * as z from 'zod';
import { isoRegions } from '../catalog/regions';

// What the stored user records share (BLUEPRINT §4.6, §11.1). The schemas check a record's own structure, never its
// links to the catalog or to other records: an item whose plan has left the catalog is still the user's data, and
// resolving it (M4.6) is what says the plan is gone.

/** A record id: a UUID v7, which the app makes when it creates the record (apps/web core/storage). */
export const recordIdSchema = z.uuid({ version: 'v7', error: 'Use a UUID v7' });

/**
 * A moment in UTC with milliseconds, as `Date.prototype.toISOString` writes it (`2026-10-22T18:30:00.000Z`). One
 * fixed form, so timestamps sort as strings, which is how the `updatedAt` index orders them.
 */
export const timestampSchema = z.iso.datetime({
  precision: 3,
  error: 'Use a UTC timestamp with milliseconds, as toISOString writes it',
});
export type Timestamp = z.infer<typeof timestampSchema>;

/**
 * The fields of every record that has an id, spread into its schema. `deletedAt` is a soft delete: the record stays
 * stored, so a future sync can pass the deletion on (BLUEPRINT §11.4).
 */
export const recordMetaShape = {
  id: recordIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.optional(),
};

/** Where someone lives or bought something: an ISO 3166-1 alpha-2 code, never a group (EU) or GLOBAL. */
export const countrySchema = z
  .string()
  .refine(
    (code) => isoRegions.has(code),
    'Use a two-letter ISO 3166-1 country code in capitals (CA, GB)',
  );
