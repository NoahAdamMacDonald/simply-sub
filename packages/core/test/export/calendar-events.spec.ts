import { describe, expect, it } from 'vitest';
import { calendarEvents, repeatRule, type ResolvedItem } from '../../src';
import { context, crave, disney, familyList, format, mullvad, netflix, workList } from './fixtures';

// The .ics file's events (BLUEPRINT §11.2, M7.5, M7.12): a repeating event for each run of an ongoing subscription's
// charges at one amount, written with the schedule's own repeat rule, so it goes on past the first year.

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

  it('repeats a plan billed on the 31st on each month’s 31st, or its last day', () => {
    const [event] = of(crave.item.id);
    expect(event.start).toEqual([2026, 10, 31]);
    expect(event.recurrenceRule).toBe('FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
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

describe('repeatRule', () => {
  const billing = (anchorDate: string, extra: object = {}) => ({
    mode: 'recurring' as const,
    interval: 'month' as const,
    intervalCount: 1,
    anchorDate,
    autoRenew: true,
    ...extra,
  });

  it('writes the schedule’s days: a short month’s last day, a billing day, a leap day, and plain counts', () => {
    expect(repeatRule(billing('2026-01-30'))).toBe(
      'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30;BYSETPOS=-1',
    );
    expect(repeatRule(billing('2027-02-28', { billingDay: 31 }))).toBe(
      'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=28,29,30,31;BYSETPOS=-1',
    );
    expect(repeatRule(billing('2028-02-29', { interval: 'year' }))).toBe(
      'FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1',
    );
    expect(
      repeatRule(billing('2026-11-01', { interval: 'day', intervalCount: 30 }), '2027-06-30'),
    ).toBe('FREQ=DAILY;INTERVAL=30;UNTIL=20270630');
    expect(repeatRule(billing('2026-11-01', { intervalCount: 3 }))).toBe(
      'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1',
    );
  });
});
