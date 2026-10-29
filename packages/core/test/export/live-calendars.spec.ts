import { describe, expect, it } from 'vitest';
import {
  calendarEvents,
  calendarFeedsSchema,
  liveCalendars,
  liveCalendarSchema,
  type LiveCalendarChoices,
  type ResolvedItem,
} from '../../src';
import { issues } from '../catalog/helpers';
import {
  context,
  crave,
  familyList,
  familyTag,
  format,
  goneTagId,
  netflix,
  workList,
  workTag,
} from './fixtures';

// The live calendar's calendars (M10.3): everything, a tag's and those with no tag, from every list, in what POST and
// PUT /cal take, with amounts as the provider charges them.

const choices: LiveCalendarChoices = {
  holds: ['all', 'untagged', familyTag.id, workTag.id, goneTagId],
  titles: 'name-amount',
  listNames: false,
};
const lists = [workList, familyList];

describe('liveCalendars', () => {
  const calendars = liveCalendars(lists, context, format, choices);
  const titles = (holds: string) =>
    calendars.find((calendar) => calendar.holds === holds)?.events.map((event) => event.title);

  it('makes a calendar of everything, of each tag there still is, and of the payments with no tag', () => {
    expect(calendars.map(({ holds, name, color }) => ({ holds, name, color }))).toEqual([
      { holds: 'all', name: 'Simply Sub', color: undefined },
      { holds: 'untagged', name: 'Simply Sub: No tag', color: undefined },
      { holds: familyTag.id, name: 'Simply Sub: Family', color: '#1e88e5' },
      { holds: workTag.id, name: 'Simply Sub: Work', color: '#43a047' },
    ]);
    expect(titles('all')).toEqual([
      'Crave: $23.10',
      "Kids': $12.59",
      'Netflix: $19.94',
      'Renew Mullvad VPN: €60.00',
    ]);
    // Netflix keeps a tag (Family) beside the deleted one, so it isn't one with no tag.
    expect(titles('untagged')).toEqual(["Kids': $12.59", 'Renew Mullvad VPN: €60.00']);
    expect(titles(familyTag.id)).toEqual(['Netflix: $19.94']);
    expect(titles(workTag.id)).toEqual(['Crave: $23.10']);
  });

  it('shows amounts as the provider charges them, so an exchange rate never changes a feed', () => {
    const mullvad = calendars[0].events.find((event) => event.title.includes('Mullvad'));
    expect(mullvad).toEqual({
      uid: expect.stringContaining('-from-2027-01-20-EUR@sub.simplely.ca') as string,
      date: '2027-01-20',
      title: 'Renew Mullvad VPN: €60.00',
      rule: 'FREQ=YEARLY;INTERVAL=1;BYMONTH=1;BYMONTHDAY=20',
    });
  });

  it('keeps a run’s start and UID as the days go by, where the download starts from today', () => {
    const later = { ...context, today: '2027-03-01' };
    const event = (today: typeof context) =>
      liveCalendars(lists, today, format, { ...choices, holds: [familyTag.id] })[0].events[0];

    expect(event(later)).toEqual(event(context));
    expect(event(later).date).toBe('2026-11-12');
    expect(
      calendarEvents(lists, later, format).find((one) => one.title.startsWith('Netflix'))?.start,
    ).toEqual([2027, 3, 12]);
  });

  it('titles each payment with its name alone, or adds its list', () => {
    const named = liveCalendars(lists, context, format, {
      holds: ['all'],
      titles: 'name',
      listNames: true,
    });
    expect(named[0].events.map((event) => event.title)).toEqual([
      'Crave (Work Related)',
      "Kids' (Family)",
      'Netflix (Work Related)',
      'Renew Mullvad VPN (Family)',
    ]);
  });

  it('puts a name or title on one line, cut to what a feed takes', () => {
    const long: ResolvedItem = {
      ...netflix,
      item: { ...netflix.item, nickname: `Netflix\nfor ${'the whole family '.repeat(8)}🎬` },
    };
    const tag = { ...workTag, name: `Work\n${'and side projects '.repeat(5)}` };
    const [calendar] = liveCalendars(
      [{ ...workList, resolved: [long, crave] }],
      { ...context, tags: new Map([[tag.id, tag]]) },
      format,
      { holds: [tag.id], titles: 'name-amount', listNames: false },
    );

    expect(calendar.name).toHaveLength(60);
    expect(calendar.name).toMatch(/^Simply Sub: Work and side projects .*…$/);
    const [title] = liveCalendars([{ ...workList, resolved: [long] }], context, format, {
      holds: ['all'],
      titles: 'name-amount',
      listNames: false,
    })[0].events.map((event) => event.title);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title).toMatch(/^Netflix for the whole family .*…$/);
  });

  it('is what POST /cal takes, once the app has hashed the UIDs', () => {
    const feeds = calendars.map(({ name, color, events }) => ({
      name,
      ...(color !== undefined && { color }),
      events: events.map((event, index) => ({
        ...event,
        uid: `hashed${String(index).padStart(10, '0')}`,
      })),
    }));
    expect(issues(calendarFeedsSchema, { feeds })).toEqual([]);
  });
});

describe('liveCalendarSchema', () => {
  const record = {
    key: 'liveCalendar',
    setId: 'Qx3Lm8Rt5Vw2Yz7Bd4Gh1J',
    manageKey: 'Jd8f2LqP0zXn5Vt7Bc3HyA',
    calendars: [
      { holds: 'all', token: 'k7Qm2Zp9XvT4bN8cR1sW0a' },
      { holds: familyTag.id, token: 'p4Ld8Wq2Zr6Ty1Uc5Ve9Xb' },
    ],
    titles: 'name-amount',
    sentAt: '2026-10-29T18:20:00.000Z',
    updatedAt: '2026-10-29T18:20:00.000Z',
  };

  it('takes the feed set a device made', () => {
    expect(issues(liveCalendarSchema, record)).toEqual([]);
  });

  it.each([
    ['a calendar twice', { calendars: [record.calendars[0], record.calendars[0]] }],
    ['a tag that is no id', { calendars: [{ holds: 'Family', token: 'p4Ld8Wq2Zr6Ty1Uc5Ve9Xb' }] }],
    ['a short token', { manageKey: 'short' }],
  ])('refuses %s', (_name, change) => {
    expect(issues(liveCalendarSchema, { ...record, ...change })).not.toEqual([]);
  });
});
