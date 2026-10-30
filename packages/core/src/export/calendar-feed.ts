import * as z from 'zod';
import { isoDateSchema } from '../catalog/formats';
import { addDays, type IsoDate } from '../dates/iso-date';
import { feedSecretSchema, maxFeeds } from './feed-secret';

// The live calendar (BLUEPRINT §11.3, M10.2): a feed set holds a calendar for everything, one for each tag chosen and
// one for payments without a tag, each served at a URL of its own that calendar apps subscribe to. The app sends the
// set to POST /cal (a new set) and PUT /cal/:id (the same set, changed), and the Worker checks it with
// calendarFeedsSchema and writes each feed's file with feedIcs. Only what's needed is sent: each payment's title (its
// name and amount, or its name alone), day and repeat rule, and each calendar's name and colour. No list, note or record
// id: each event's UID is a hash the app makes.

/** The events of a whole feed set: about 400 kB of calendar files, under D1's 2 MB a row. */
export const maxFeedEvents = 2_000;

/**
 * A repeat rule of the forms core's repeatRule writes, all of which Proton Calendar takes: every few days or weeks, a
 * month's day (-1 its last), a year's month and day, each with an optional UNTIL date. Nothing else reaches a feed.
 */
export const feedRulePattern = new RegExp(
  '^(?:FREQ=(?:DAILY|WEEKLY);INTERVAL=[1-9]\\d{0,2}' +
    '|FREQ=MONTHLY;INTERVAL=[1-9]\\d{0,2};BYMONTHDAY=(?:-1|[1-9]|1\\d|2[0-8])' +
    '|FREQ=YEARLY;INTERVAL=[1-9]\\d?;BYMONTH=(?:[1-9]|1[0-2]);BYMONTHDAY=(?:-1|[1-9]|[12]\\d|3[01]))' +
    '(?:;UNTIL=\\d{8})?$',
);

/** Text of one line: no control characters, line or paragraph separators. */
const lineText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u, 'Use one line of text');

/** One payment, all day on its day, repeating by its rule if it has one. */
export const feedEventSchema = z.strictObject({
  /** The same in every update, so a calendar app changes the event rather than adding one: a hash the app makes. */
  uid: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Use 8 to 64 letters, digits, - or _'),
  date: isoDateSchema,
  /** "Netflix: $19.94", or the name alone. */
  title: lineText(120),
  rule: z
    .string()
    .regex(feedRulePattern, 'Use a repeat rule of the forms the app writes')
    .optional(),
});
export type FeedEvent = z.infer<typeof feedEventSchema>;

/** One calendar of a set: a new one, or with its token one the set has, whose link stays. */
export const calendarFeedSchema = z
  .strictObject({
    token: feedSecretSchema.optional(),
    /** "Simply Sub", "Simply Sub: Family". */
    name: lineText(60),
    /** The tag's colour, for the apps that read one. */
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour written #rrggbb')
      .optional(),
    events: z.array(feedEventSchema).max(maxFeedEvents),
  })
  .superRefine(({ events }, ctx) => {
    const seen = new Set<string>();
    events.forEach(({ uid }, index) => {
      if (seen.has(uid)) {
        ctx.addIssue({ code: 'custom', message: 'Already used', path: ['events', index, 'uid'] });
      }
      seen.add(uid);
    });
  });
export type CalendarFeed = z.infer<typeof calendarFeedSchema>;

/** What POST /cal and PUT /cal/:id take: a set's calendars, up to 2,000 events in all. */
export const calendarFeedsSchema = z
  .strictObject({ feeds: z.array(calendarFeedSchema).min(1).max(maxFeeds) })
  .superRefine(({ feeds }, ctx) => {
    const events = feeds.reduce((sum, feed) => sum + feed.events.length, 0);
    if (events > maxFeedEvents) {
      ctx.addIssue({
        code: 'custom',
        message: `Send at most ${maxFeedEvents} events in all, not ${events}`,
        path: ['feeds'],
      });
    }
    const tokens = new Set<string>();
    feeds.forEach(({ token }, index) => {
      if (token !== undefined && tokens.has(token)) {
        ctx.addIssue({ code: 'custom', message: 'Already used', path: ['feeds', index, 'token'] });
      }
      if (token !== undefined) tokens.add(token);
    });
  });
export type CalendarFeeds = z.infer<typeof calendarFeedsSchema>;

/** A calendar's links, as POST and PUT answer them. */
export const feedLinkSchema = z.strictObject({
  token: feedSecretSchema,
  /** `https://…/api/v1/cal/<token>.ics`: what Google and Proton take. */
  url: z.url({ protocol: /^https?$/ }),
  /** The same as `webcal://`, which opens Apple Calendar's subscribe sheet. */
  webcalUrl: z.string().regex(/^webcal:\/\/\S+\.ics$/),
  eventCount: z.int().min(0).max(maxFeedEvents),
});
export type FeedLink = z.infer<typeof feedLinkSchema>;

/** POST /cal's 201: the new set's id, its manage key (shown this once) and each calendar's links, in the order sent. */
export const calendarSetBodySchema = z.strictObject({
  data: z.strictObject({
    id: feedSecretSchema,
    manageKey: feedSecretSchema,
    feeds: z.array(feedLinkSchema).min(1).max(maxFeeds),
  }),
  meta: z.strictObject({}),
});
export type CalendarSetBody = z.infer<typeof calendarSetBodySchema>;

/** PUT /cal/:id's 200: each calendar's links, in the order sent, and when the set was written. */
export const calendarSetUpdateBodySchema = z.strictObject({
  data: z.strictObject({
    id: feedSecretSchema,
    feeds: z.array(feedLinkSchema).min(1).max(maxFeeds),
    updatedAt: z.iso.datetime(),
  }),
  meta: z.strictObject({}),
});
export type CalendarSetUpdateBody = z.infer<typeof calendarSetUpdateBodySchema>;

/** GET /cal/:token.ics answers with a calendar file, not JSON. */
export const calendarBody = 'text/calendar';

/** The product a calendar file names, as the app's .ics download does. */
const productId = '-//sub.simplely.ca//Simply Sub//EN';

/**
 * The calendar file GET /cal/:token.ics serves for `feed` (RFC 5545), written when its set is, at `stamp` (an ISO
 * timestamp): the calendar's name (X-WR-CALNAME, and RFC 7986's NAME), its colour where an app reads one (Apple's
 * X-APPLE-CALENDAR-COLOR; RFC 7986's COLOR takes only a CSS colour name), a hint to check again every 12 hours, and an
 * all-day event per payment that doesn't block time. Lines end with CRLF and fold at 75 octets.
 */
export function feedIcs(feed: CalendarFeed, stamp: string): string {
  const dtstamp = `${stamp.slice(0, 19).replace(/[-:]/g, '')}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(feed.name)}`,
    `NAME:${icsText(feed.name)}`,
    ...(feed.color === undefined ? [] : [`X-APPLE-CALENDAR-COLOR:${feed.color.toUpperCase()}`]),
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...feed.events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${event.uid}@sub.simplely.ca`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icsDate(event.date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(event.date, 1))}`,
      `SUMMARY:${icsText(event.title)}`,
      ...(event.rule === undefined ? [] : [`RRULE:${event.rule}`]),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** TEXT as RFC 5545 escapes it: a backslash, semicolon or comma behind a backslash. */
function icsText(text: string): string {
  return text.replace(/[\\;,]/g, (character) => `\\${character}`);
}

function icsDate(date: IsoDate): string {
  return date.replaceAll('-', '');
}

/** A content line folded at 75 octets, a continuation line starting with a space, never inside a character. */
function foldLine(line: string): string {
  const parts: string[] = [];
  let part = '';
  let octets = 0;
  for (const character of line) {
    // Its size in UTF-8.
    const code = character.codePointAt(0) ?? 0;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    // The first line has 75 octets; each continuation line's space takes one of its 75.
    if (octets + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(part);
      part = '';
      octets = 0;
    }
    part += character;
    octets += size;
  }
  parts.push(part);
  return parts.join('\r\n ');
}
