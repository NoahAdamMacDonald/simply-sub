import * as z from 'zod';
import { recordIdSchema, timestampSchema } from './record';

/** A suggestion's fingerprint (optimizer/fingerprint.ts): 16 lowercase hex digits. */
export const suggestionFingerprintSchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, 'Use 16 lowercase hex digits');

/**
 * An optimizer suggestion the user dismissed (PROJECT-PLAN P14, M8.2), keyed by its fingerprint. It stays hidden while
 * the list is the same: a change to the list gives its suggestions new fingerprints, so it comes back. Showing it
 * again soft-deletes the record, which a sync can pass on. `listId` lets a list's dismissals be found.
 */
export const dismissedSuggestionSchema = z.strictObject({
  fingerprint: suggestionFingerprintSchema,
  listId: recordIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.optional(),
});
export type DismissedSuggestion = z.infer<typeof dismissedSuggestionSchema>;
