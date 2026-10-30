import * as z from 'zod';
import { feedSecretSchema, maxFeeds } from '../export/feed-secret';
import { recordIdSchema, timestampSchema } from './record';

// The live calendar (PROJECT-PLAN P10, P13, M10.3; BLUEPRINT §11.3): the feed set the user made, one record under the
// key `liveCalendar`. Its manage key changes and revokes the set, so the app lock seals the record and backups leave it
// out; sync carries it (M10.9), so any of the user's devices keeps the links current. A revoke soft-deletes it, so a
// sync passes that on too.

/** What a calendar holds: every payment, those of items with no tag, or one tag's (its id). */
export const liveCalendarHoldsSchema = z.union([
  z.literal('all'),
  z.literal('untagged'),
  recordIdSchema,
]);
export type LiveCalendarHolds = z.infer<typeof liveCalendarHoldsSchema>;

/** What each payment's title shows: its name and amount, or its name alone. */
export const liveCalendarTitlesSchema = z.enum(['name-amount', 'name']);
export type LiveCalendarTitles = z.infer<typeof liveCalendarTitlesSchema>;

export const liveCalendarSchema = z
  .strictObject({
    key: z.literal('liveCalendar'),
    setId: feedSecretSchema,
    manageKey: feedSecretSchema,
    /** Each calendar of the set: what it holds, and its token, which its links are made from. */
    calendars: z
      .array(z.strictObject({ holds: liveCalendarHoldsSchema, token: feedSecretSchema }))
      .min(1)
      .max(maxFeeds),
    titles: liveCalendarTitlesSchema,
    /** Each title ends with its list's name. */
    listNames: z.literal(true).optional(),
    /** A SHA-256 of the calendars as last sent, so they're sent again only when they change. */
    sentHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    /** When they were last sent: the server deletes a set 180 days after its last write. */
    sentAt: timestampSchema,
    /** The links stopped working: revoked from another device, or expired. */
    broken: z.literal(true).optional(),
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.optional(),
  })
  .superRefine(({ calendars }, ctx) => {
    const seen = new Set<string>();
    calendars.forEach(({ holds }, index) => {
      if (seen.has(holds)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Already used',
          path: ['calendars', index, 'holds'],
        });
      }
      seen.add(holds);
    });
  });
export type LiveCalendar = z.infer<typeof liveCalendarSchema>;
