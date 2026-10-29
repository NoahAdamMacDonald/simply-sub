import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  calendarFeedsSchema,
  chargeDates,
  feedIcs,
  repeatRule,
  type Billing,
  type CalendarFeed,
} from '../../src';
import { issues } from '../catalog/helpers';

// The live calendar's feeds (BLUEPRINT §11.3, M10.2): what POST /cal and PUT /cal/:id take, and the calendar file each
// feed serves, which ical.js (a test-only parser) reads back with its events and expands as calendar apps do.

// ical.js leaves a property it doesn't know as it's written; the calendar apps read X-WR-CALNAME as text, RFC 5545's
// default for an X- property, so its escapes come off.
ICAL.design.defaultSet.property['x-wr-calname'] = { defaultType: 'text' };

type Recurring = Extract<Billing, { mode: 'recurring' }>;

const recurring = (anchorDate: string, extra: Partial<Recurring> = {}): Recurring => ({
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate,
  autoRenew: true,
  ...extra,
});

const feed: CalendarFeed = {
  name: 'Simply Sub: Work, Family; Home',
  color: '#1e88e5',
  events: [
    {
      uid: 'a1b2c3d4e5f60718',
      date: '2026-11-12',
      title: 'Netflix: $19.94',
      rule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12',
    },
    { uid: 'f6e5d4c3b2a10918', date: '2026-11-30', title: 'Renew Mullvad VPN: €60.00' },
  ],
};

describe('feedIcs', () => {
  it('writes the calendar as RFC 5545 has it, all day, named, coloured and checked again every 12 hours', () => {
    expect(feedIcs(feed, '2026-10-29T12:34:56.789Z').split('\r\n')).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//sub.simplely.ca//Simply Sub//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Simply Sub: Work\\, Family\\; Home',
      'NAME:Simply Sub: Work\\, Family\\; Home',
      'X-APPLE-CALENDAR-COLOR:#1E88E5',
      'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
      'X-PUBLISHED-TTL:PT12H',
      'BEGIN:VEVENT',
      'UID:a1b2c3d4e5f60718@sub.simplely.ca',
      'DTSTAMP:20261029T123456Z',
      'DTSTART;VALUE=DATE:20261112',
      'DTEND;VALUE=DATE:20261113',
      'SUMMARY:Netflix: $19.94',
      'RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:f6e5d4c3b2a10918@sub.simplely.ca',
      'DTSTAMP:20261029T123456Z',
      'DTSTART;VALUE=DATE:20261130',
      'DTEND;VALUE=DATE:20261201',
      'SUMMARY:Renew Mullvad VPN: €60.00',
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
  });

  it('folds a long line at 75 octets, never inside a character', () => {
    const title = `${'é'.repeat(59)}🎬${'a'.repeat(59)}`;
    const text = feedIcs(
      { name: 'Simply Sub', events: [{ ...feed.events[1], title }] },
      '2026-10-29T00:00:00Z',
    );
    const lines = text.split('\r\n');

    for (const line of lines) {
      // Its size in UTF-8. encodeURIComponent throws on half a character (a lone surrogate), so each line is whole.
      const octets = encodeURIComponent(line).replace(/%[0-9A-F]{2}/g, '-').length;
      expect(octets).toBeLessThanOrEqual(75);
    }
    expect(text.replaceAll('\r\n ', '').split('\r\n')).toContain(`SUMMARY:${title}`);
  });

  it('reads back as a calendar: its name, colour and events', () => {
    const calendar = new ICAL.Component(ICAL.parse(feedIcs(feed, '2026-10-29T12:34:56Z')));
    const events = calendar.getAllSubcomponents('vevent').map((vevent) => new ICAL.Event(vevent));

    expect(calendar.getFirstPropertyValue('x-wr-calname')).toBe(feed.name);
    expect(calendar.getFirstPropertyValue('x-apple-calendar-color')).toBe('#1E88E5');
    expect(
      events.map((event) => [
        event.uid,
        event.summary,
        event.startDate.toString(),
        event.isRecurring(),
      ]),
    ).toEqual([
      ['a1b2c3d4e5f60718@sub.simplely.ca', 'Netflix: $19.94', '2026-11-12', true],
      ['f6e5d4c3b2a10918@sub.simplely.ca', 'Renew Mullvad VPN: €60.00', '2026-11-30', false],
    ]);
    expect(events.every((event) => event.startDate.isDate)).toBe(true);
  });

  it.each([
    ['the 31st, on each month’s last day', recurring('2027-01-31')],
    ['a billing day of 31 from a shorter month', recurring('2027-02-28', { billingDay: 31 })],
    ['every 3 months on the 31st', recurring('2026-08-31', { intervalCount: 3 })],
    ['a leap day, yearly', recurring('2028-02-29', { interval: 'year' })],
    ['every 30 days', recurring('2026-11-01', { interval: 'day', intervalCount: 30 })],
    ['every 2 weeks', recurring('2026-11-03', { interval: 'week', intervalCount: 2 })],
  ])('repeats %s on the schedule’s own dates, as a calendar app expands it', (_name, billing) => {
    const until = addMonths(billing.anchorDate, 48);
    const event = {
      uid: 'abcdef0123456789',
      date: billing.anchorDate,
      title: 'Plan',
      rule: repeatRule(billing),
    };
    const [vevent] = new ICAL.Component(
      ICAL.parse(feedIcs({ name: 'Simply Sub', events: [event] }, '2026-10-29T00:00:00Z')),
    ).getAllSubcomponents('vevent');
    const iterator = new ICAL.Event(vevent).iterator();
    const expanded: string[] = [];
    for (let next = iterator.next(); next && next.toString() < until; next = iterator.next()) {
      expanded.push(next.toString());
    }

    expect(expanded).toEqual(chargeDates(billing, { from: billing.anchorDate, to: until }));
  });
});

describe('calendarFeedsSchema', () => {
  const valid = { feeds: [feed, { name: 'Simply Sub', events: [] }] };

  it('takes a set of calendars', () => {
    expect(issues(calendarFeedsSchema, valid)).toEqual([]);
  });

  it.each([
    [
      'a title on two lines',
      { feeds: [{ ...feed, events: [{ ...feed.events[1], title: 'Netflix\nSUMMARY:x' }] }] },
    ],
    [
      'a rule carrying another line',
      {
        feeds: [
          {
            ...feed,
            events: [{ ...feed.events[0], rule: 'FREQ=DAILY;INTERVAL=1\r\nATTACH:https://x' }],
          },
        ],
      },
    ],
    [
      'a rule Proton drops',
      {
        feeds: [
          {
            ...feed,
            events: [
              {
                ...feed.events[0],
                rule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30,31;BYSETPOS=-1',
              },
            ],
          },
        ],
      },
    ],
    ['an event used twice', { feeds: [{ ...feed, events: [feed.events[0], feed.events[0]] }] }],
    [
      'a UID that isn’t a hash',
      { feeds: [{ ...feed, events: [{ ...feed.events[1], uid: 'a@b.example' }] }] },
    ],
    ['a colour by name', { feeds: [{ ...feed, color: 'blue' }] }],
    ['a field it doesn’t know', { feeds: [{ ...feed, description: 'Hi' }] }],
    ['no calendars', { feeds: [] }],
    [
      '27 calendars',
      { feeds: Array.from({ length: 27 }, () => ({ name: 'Simply Sub', events: [] })) },
    ],
    [
      'a token used twice',
      {
        feeds: [
          { ...feed, token: 'k7Qm2Zp9XvT4bN8cR1sW0a' },
          { ...feed, token: 'k7Qm2Zp9XvT4bN8cR1sW0a' },
        ],
      },
    ],
    [
      '2,001 events in all',
      {
        feeds: [1000, 1001].map((count) => ({
          name: 'Simply Sub',
          events: Array.from({ length: count }, (_, index) => ({
            uid: `event${String(index).padStart(5, '0')}`,
            date: '2026-11-12',
            title: 'Plan',
          })),
        })),
      },
    ],
  ])('refuses %s', (_name, body) => {
    expect(issues(calendarFeedsSchema, body)).not.toEqual([]);
  });
});
