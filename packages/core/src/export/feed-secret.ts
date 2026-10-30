import * as z from 'zod';

// What the live calendar's record (user/live-calendar.ts) shares with its API (calendar-feed.ts), in a file of its own:
// the record's schema loads at the app's start with the other user records, and the API's schemas mustn't come with it.

/** A feed set holds the everything calendar, the no-tag calendar and up to 24 tags'. */
export const maxFeeds = 26;

/** A feed's token, a set's id or its manage key, as the Worker makes them: 128 random bits in base64url. */
export const feedSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Use a 22-character token');
