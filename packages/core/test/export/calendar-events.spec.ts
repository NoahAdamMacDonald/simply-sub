import { describe, expect, it } from 'vitest';
import { calendarEvents } from '../../src';
import { context, crave, disney, familyList, format, mullvad, netflix, workList } from './fixtures';

// The .ics file's events (BLUEPRINT §11.2, M7.5): one all-day event per charge in the next 12 months.

describe('calendarEvents', () => {
  const events = calendarEvents([workList, familyList], context, format);
  const of = (itemId: string) => events.filter((event) => event.uid.startsWith(itemId));

  it('is an all-day event for each charge, titled with what it is and costs as charged', () => {
    expect(events).toHaveLength(28);
    expect(of(netflix.item.id)[0]).toEqual({
      uid: `${netflix.item.id}-2026-11-12-CAD@sub.simplely.ca`,
      start: [2026, 11, 12],
      end: [2026, 11, 13],
      title: 'Netflix: $19.94',
      // Its live tags, not the one deleted since (M7.9).
      description:
        'Netflix Standard\nList: Work Related\n$19.94, with $0.95 tax\nRenews automatically\nTags: Family',
      categories: ['Family'],
    });
  });

  it('has a charge in every month for a plan billed on the 31st, each ending the next day', () => {
    const craves = of(crave.item.id);
    expect(craves.map((event) => event.start)).toEqual([
      [2026, 10, 31],
      [2026, 11, 30],
      [2026, 12, 31],
      [2027, 1, 31],
      [2027, 2, 28],
      [2027, 3, 31],
      [2027, 4, 30],
      [2027, 5, 31],
      [2027, 6, 30],
      [2027, 7, 31],
      [2027, 8, 31],
      [2027, 9, 30],
    ]);
    expect(craves[2].end).toEqual([2027, 1, 1]);
    expect(craves[4].end).toEqual([2027, 3, 1]);
  });

  it('asks for a manual renewal, and marks a converted amount and the last charge', () => {
    expect(of(mullvad.item.id)).toEqual([
      {
        uid: `${mullvad.item.id}-2027-01-20-CAD@sub.simplely.ca`,
        start: [2027, 1, 20],
        end: [2027, 1, 21],
        title: 'Renew Mullvad VPN: ≈ $94.16',
        description: 'Mullvad VPN\nList: Family\n≈ $94.16\nRenew manually',
      },
    ]);
    const last = of(disney.item.id).at(-1);
    expect(last?.title).toBe("Kids': $12.59");
    expect(last?.description).toBe(
      "Kids' (Disney+ Standard)\nList: Family\n$12.59, with $0.60 tax\nRenews automatically\n" +
        'Its last charge before it ends',
    );
  });

  it('gives each charge a UID of its own, the same in every export', () => {
    expect(new Set(events.map((event) => event.uid)).size).toBe(events.length);
    expect(calendarEvents([workList, familyList], context, format)).toEqual(events);
  });
});
