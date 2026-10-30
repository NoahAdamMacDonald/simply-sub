import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  calendarEvents,
  chargeDates,
  repeatRule,
  type Billing,
  type IsoDate,
  type ResolvedItem,
} from '../../src';
import { context, crave, disney, familyList, format, mullvad, netflix, workList } from './fixtures';

// The .ics file's events (BLUEPRINT §11.2, M7.5, M7.12): a repeating event for each run of an ongoing subscription's
// charges at one amount, written with the schedule's own repeat rule, so it goes on past the first year. The rules keep
// to the forms Proton Calendar takes (M10.2).

describe('calendarEvents', () => {
  const events = calendarEvents([workList, familyList], context, format);
  const of = (itemId: string) => events.filter((event) => event.uid.startsWith(itemId));

  it('is a repeating all-day event for each ongoing subscription, titled with what it is and costs as charged', () => {
    expect(events).toHaveLength(4);
    expect(of(netflix.item.id)).toEqual([
      {
        uid: `${netflix.item.id}-from-2026-11-12-CAD@sub.simplely.ca`,
        start: [2026, 11, 12],
        end: [2026, 11, 13],
        title: 'Netflix: $19.94',
        // Its live tags, not the one deleted since (M7.9).
        description:
          'Netflix Standard\nList: Work Related\n$19.94, with $0.95 tax\nRenews automatically\nTags: Family',
        categories: ['Family'],
        recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12',
      },
    ]);
  });

  it('repeats a plan billed on the 31st on each month’s last day', () => {
    const [event] = of(crave.item.id);
    expect(event.start).toEqual([2026, 10, 31]);
    expect(event.recurrenceRule).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
  });

  it('gives a plan billed on the 29th or 30th an event per charge in the next 12 months', () => {
    const on30th: ResolvedItem = {
      ...netflix,
      item: {
        ...netflix.item,
        billing: { ...(netflix.item.billing as Recurring), anchorDate: '2026-11-30' },
      },
    };
    const charges = calendarEvents([{ ...workList, resolved: [on30th] }], context, format);
    // From the fixtures' today, Oct 28, 2026: the charge a month before the anchor is in the window.
    expect(charges.map((event) => event.start)).toEqual([
      [2026, 10, 30],
      [2026, 11, 30],
      [2026, 12, 30],
      [2027, 1, 30],
      [2027, 2, 28],
      ...[3, 4, 5, 6, 7, 8, 9].map((month) => [2027, month, 30]),
    ]);
    expect(charges.every((event) => event.recurrenceRule === undefined)).toBe(true);
    expect(charges[0].uid).toBe(`${netflix.item.id}-2026-10-30-CAD@sub.simplely.ca`);
  });

  it('asks for a manual renewal every year, and ends a run on the day before the plan does', () => {
    expect(of(mullvad.item.id)).toEqual([
      {
        uid: `${mullvad.item.id}-from-2027-01-20-CAD@sub.simplely.ca`,
        start: [2027, 1, 20],
        end: [2027, 1, 21],
        title: 'Renew Mullvad VPN: ≈ $94.16',
        description: 'Mullvad VPN\nList: Family\n≈ $94.16\nRenew manually',
        recurrenceRule: 'FREQ=YEARLY;INTERVAL=1;BYMONTH=1;BYMONTHDAY=20',
      },
    ]);
    const [kids] = of(disney.item.id);
    expect(kids.recurrenceRule).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=5;UNTIL=20270131');
    expect(kids.description).toContain('Ends Feb 1, 2027');
  });

  it('starts another run where a price of the user’s own ends', () => {
    const own: ResolvedItem = {
      ...netflix,
      item: {
        ...netflix.item,
        priceOverride: { amount: 9.99, currency: 'CAD', until: '2027-02-12' },
      },
      overridePrice: { ...netflix.price, amount: 9.99, monthlyEquivalent: 9.99 },
    };
    const runs = calendarEvents([{ ...workList, resolved: [own] }], context, format);
    expect(runs.map((event) => [event.start, event.recurrenceRule, event.title])).toEqual([
      [[2026, 11, 12], 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12;UNTIL=20270211', 'Netflix: $10.49'],
      [[2027, 2, 12], 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12', 'Netflix: $19.94'],
    ]);
    expect(runs[0].description).toContain('At this price until Feb 11, 2027');
  });

  it('gives each run a UID of its own, the same in every export', () => {
    expect(new Set(events.map((event) => event.uid)).size).toBe(events.length);
    expect(calendarEvents([workList, familyList], context, format)).toEqual(events);
  });
});

type Recurring = Extract<Billing, { mode: 'recurring' }>;

describe('repeatRule', () => {
  const billing = (anchorDate: string, extra: Partial<Recurring> = {}): Recurring => ({
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate,
    autoRenew: true,
    ...extra,
  });

  it('writes the schedule’s days: a month’s last day, a billing day, a leap day, and plain counts', () => {
    expect(repeatRule(billing('2027-01-31'))).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1');
    expect(repeatRule(billing('2027-02-28', { billingDay: 31 }))).toBe(
      'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1',
    );
    expect(repeatRule(billing('2028-02-29', { interval: 'year' }))).toBe(
      'FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=-1',
    );
    expect(repeatRule(billing('2027-04-30', { interval: 'year', billingDay: 31 }))).toBe(
      'FREQ=YEARLY;INTERVAL=1;BYMONTH=4;BYMONTHDAY=30',
    );
    expect(
      repeatRule(billing('2026-11-01', { interval: 'day', intervalCount: 30 }), '2027-06-30'),
    ).toBe('FREQ=DAILY;INTERVAL=30;UNTIL=20270630');
    expect(repeatRule(billing('2026-11-01', { intervalCount: 3 }))).toBe(
      'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1',
    );
  });

  it('has no rule for a monthly plan billed on the 29th or 30th, which February can’t follow', () => {
    expect(repeatRule(billing('2026-01-30'))).toBeUndefined();
    expect(repeatRule(billing('2027-01-29'))).toBeUndefined();
    expect(repeatRule(billing('2027-02-28', { billingDay: 30 }))).toBeUndefined();
  });

  // Every anchor of a common and a leap year, monthly and yearly, every 1 to 3 periods, with each billing day a
  // shorter month's last day can have: the rule must be one Proton takes, and give the schedule's own dates.
  const billings = [2027, 2028].flatMap((year) =>
    Array.from({ length: year === 2028 ? 366 : 365 }, (_, day) =>
      addDays(`${year}-01-01`, day),
    ).flatMap((anchorDate) => {
      const day = Number(anchorDate.slice(8));
      const lastOfMonth = addDays(anchorDate, 1).endsWith('-01');
      const billingDays = lastOfMonth
        ? ([29, 30, 31] as const).filter((billingDay) => billingDay > day)
        : [];
      return (['month', 'year'] as const).flatMap((interval) =>
        [1, 2, 3].flatMap((intervalCount) =>
          [undefined, ...billingDays].map((billingDay) =>
            billing(anchorDate, {
              interval,
              intervalCount,
              ...(billingDay !== undefined && { billingDay }),
            }),
          ),
        ),
      );
    }),
  );

  it('writes only rules Proton Calendar takes', () => {
    expect(protonTakes('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30,31;BYSETPOS=-1')).toBe(false);
    const refused = billings
      .map((each) => repeatRule(each, '2030-01-31'))
      .filter((rule) => rule !== undefined && !protonTakes(rule));
    expect(refused).toEqual([]);
  });

  it('gives the schedule’s own dates, five years on', () => {
    const wrong = billings.filter((each) => {
      const rule = repeatRule(each);
      if (rule === undefined) return false;
      const range = { from: each.anchorDate, to: addMonths(each.anchorDate, 60) };
      return (
        JSON.stringify(expand(rule, each.anchorDate, range.to)) !==
        JSON.stringify(chargeDates(each, range))
      );
    });
    expect(wrong.map((each) => `${each.anchorDate} ${repeatRule(each)}`)).toEqual([]);
  });
});

/**
 * Whether Proton Calendar takes `rule` for an event that isn't an invitation: its web client's getIsRruleSupported
 * (packages/shared/lib/calendar/recurrence/rrule.ts and its calendar constants, read 2026-10-29). The parts each
 * frequency takes, intervals within its limits, one value a part, BYSETPOS only with a weekday, a year's BYMONTHDAY only
 * with BYMONTH, and UNTIL by the end of 2037.
 */
function protonTakes(rule: string): boolean {
  const parts = new Map(rule.split(';').map((part) => part.split('=') as [string, string]));
  const shared = ['FREQ', 'COUNT', 'INTERVAL', 'UNTIL', 'WKST', 'BYYEARDAY'];
  const frequencies: Record<string, { parts: string[]; maxInterval: number }> = {
    DAILY: { parts: shared, maxInterval: 999 },
    WEEKLY: { parts: [...shared, 'BYDAY'], maxInterval: 4999 },
    MONTHLY: { parts: [...shared, 'BYMONTHDAY', 'BYDAY', 'BYSETPOS'], maxInterval: 999 },
    YEARLY: { parts: [...shared, 'BYMONTHDAY', 'BYMONTH'], maxInterval: 99 },
  };
  const frequency = frequencies[parts.get('FREQ') ?? ''];
  const many = (part: string) => (parts.get(part) ?? '').includes(',');
  if (
    frequency === undefined ||
    [...parts.keys()].some((part) => !frequency.parts.includes(part))
  ) {
    return false;
  }
  if (Number(parts.get('INTERVAL') ?? 1) > frequency.maxInterval) return false;
  if ((parts.get('UNTIL') ?? '') > '20371231') return false;
  if (parts.get('FREQ') === 'MONTHLY') {
    if (many('BYDAY') || many('BYSETPOS') || many('BYMONTHDAY')) return false;
    if (parts.has('BYSETPOS') && (!parts.has('BYDAY') || parts.has('BYMONTHDAY'))) return false;
  }
  if (parts.get('FREQ') === 'YEARLY') {
    if (many('BYMONTHDAY') || many('BYMONTH')) return false;
    if (parts.has('BYMONTHDAY') && !parts.has('BYMONTH')) return false;
  }
  return true;
}

/** The dates a rule of repeatRule's forms gives from `start`, before `to`, as RFC 5545 expands it. */
function expand(rule: string, start: IsoDate, to: IsoDate): IsoDate[] {
  const parts = new Map(rule.split(';').map((part) => part.split('=') as [string, string]));
  const every = Number(parts.get('INTERVAL'));
  const dates: IsoDate[] = [];
  for (let step = 0; ; step += every) {
    let date: IsoDate | undefined;
    if (parts.get('FREQ') === 'DAILY' || parts.get('FREQ') === 'WEEKLY') {
      date = addDays(start, step * (parts.get('FREQ') === 'DAILY' ? 1 : 7));
    } else {
      const month =
        parts.get('FREQ') === 'MONTHLY'
          ? addMonths(`${start.slice(0, 7)}-01`, step)
          : `${Number(start.slice(0, 4)) + step}-${parts.get('BYMONTH')?.padStart(2, '0')}-01`;
      const last = addDays(addMonths(month, 1), -1);
      const day = Number(parts.get('BYMONTHDAY'));
      // RFC 5545 skips a day the month doesn't have.
      date =
        day === -1
          ? last
          : day <= Number(last.slice(8))
            ? `${month.slice(0, 8)}${String(day).padStart(2, '0')}`
            : undefined;
    }
    if (date !== undefined && date >= to) return dates;
    if (date !== undefined && date >= start) dates.push(date);
  }
}
