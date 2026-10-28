import { describe, expect, it } from 'vitest';
import { hiddenLists, readCalendarParams, settingsSchema, writeCalendarParams } from '../../src';
import { issues } from '../catalog/helpers';
import { settings } from './fixtures';

// The Calendar's URL (P10, M7.4): ?month=2026-10&lists=<id>,<id>.

const today = '2026-10-28';
const work = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const family = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const gym = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4f';
const gone = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c50';
const lists = [work, family, gym];

describe('readCalendarParams', () => {
  it('shows this month and every list with nothing in the URL', () => {
    expect(readCalendarParams({}, today, lists)).toEqual({
      query: { month: '2026-10', lists },
      rewrite: false,
    });
  });

  it('takes a month and the lists named, in the lists’ own order', () => {
    expect(readCalendarParams({ month: '2027-02', lists: `${gym},${work}` }, today, lists)).toEqual(
      {
        query: { month: '2027-02', lists: [work, gym] },
        rewrite: false,
      },
    );
  });

  it('leaves out the lists Settings remembers hiding, when the URL names none', () => {
    expect(readCalendarParams({}, today, lists, [family]).query.lists).toEqual([work, gym]);
    // The URL wins.
    expect(readCalendarParams({ lists: family }, today, lists, [family]).query.lists).toEqual([
      family,
    ]);
  });

  it('rewrites a month that isn’t one, a list that’s gone, every list named, and anything else', () => {
    for (const [params, query] of [
      [{ month: '2026-13' }, { month: '2026-10', lists }],
      [{ month: 'october' }, { month: '2026-10', lists }],
      [{ lists: `${work},${gone}` }, { month: '2026-10', lists: [work] }],
      [{ lists: gone }, { month: '2026-10', lists }],
      [{ lists: `${work},${family},${gym}` }, { month: '2026-10', lists }],
      [
        { month: '2026-10', page: '2' },
        { month: '2026-10', lists },
      ],
    ] as const) {
      expect(readCalendarParams(params, today, lists)).toEqual({ query, rewrite: true });
    }
  });

  it('takes the first of a repeated parameter', () => {
    expect(readCalendarParams({ month: ['2027-01', '2027-02'] }, today, lists).query.month).toBe(
      '2027-01',
    );
  });
});

describe('writeCalendarParams and hiddenLists', () => {
  it('writes the month, and the lists only when they aren’t all of them', () => {
    expect(writeCalendarParams({ month: '2026-10', lists }, lists)).toEqual({ month: '2026-10' });
    expect(writeCalendarParams({ month: '2026-11', lists: [work, gym] }, lists)).toEqual({
      month: '2026-11',
      lists: `${work},${gym}`,
    });
  });

  it('reads back what it writes', () => {
    const query = { month: '2026-11', lists: [family] };
    expect(readCalendarParams(writeCalendarParams(query, lists), today, lists)).toEqual({
      query,
      rewrite: false,
    });
  });

  it('remembers the lists left out', () => {
    expect(hiddenLists([work], lists)).toEqual([family, gym]);
    expect(hiddenLists(lists, lists)).toEqual([]);
  });
});

describe('settings.calendarHiddenLists', () => {
  it('keeps the lists the Calendar leaves out, and stays optional', () => {
    expect(issues(settingsSchema, { ...settings, calendarHiddenLists: [work] })).toEqual([]);
    expect(issues(settingsSchema, settings)).toEqual([]);
    expect(issues(settingsSchema, { ...settings, calendarHiddenLists: [] }).length).toBeGreaterThan(
      0,
    );
    expect(
      issues(settingsSchema, { ...settings, calendarHiddenLists: ['nope'] }).length,
    ).toBeGreaterThan(0);
  });
});
