import { describe, expect, it } from 'vitest';
import { itemActivity, type ListItem } from '../../src';

function item(billing: ListItem['billing']): ListItem {
  return {
    id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c60',
    listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
    source: { kind: 'catalog', planId: 'netflix.standard' },
    billing,
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
}

function recurring(dates: { startDate?: string; endDate?: string }): ListItem {
  return item({
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-09-10',
    autoRenew: true,
    ...dates,
  });
}

function limited(...windows: [string, string, boolean][]): ListItem {
  return item({
    mode: 'limited',
    windows: windows.map(([start, end, repeatYearly]) => ({ start, end, repeatYearly })),
    interval: 'month',
    intervalCount: 1,
  });
}

describe('itemActivity', () => {
  describe('ongoing billing', () => {
    it('is active without dates: it has been all along', () => {
      expect(itemActivity(recurring({}), '2026-10-26')).toEqual({ kind: 'active' });
    });

    it('is active from its start date, and inactive until then', () => {
      const item = recurring({ startDate: '2026-11-10' });

      expect(itemActivity(item, '2026-11-09')).toEqual({
        kind: 'inactive',
        activeFrom: '2026-11-10',
      });
      expect(itemActivity(item, '2026-11-10')).toEqual({ kind: 'active' });
    });

    it('is inactive from its end date on', () => {
      const item = recurring({ startDate: '2026-01-10', endDate: '2026-11-10' });

      expect(itemActivity(item, '2026-11-09')).toEqual({ kind: 'active' });
      expect(itemActivity(item, '2026-11-10')).toEqual({ kind: 'inactive' });
    });
  });

  describe('specific dates', () => {
    it('is active from a window’s start through its end, both included', () => {
      const item = limited(['2026-09-02', '2026-11-01', false]);

      expect(itemActivity(item, '2026-09-01')).toEqual({
        kind: 'inactive',
        activeFrom: '2026-09-02',
      });
      expect(itemActivity(item, '2026-09-02')).toEqual({ kind: 'active' });
      expect(itemActivity(item, '2026-11-01')).toEqual({ kind: 'active' });
      expect(itemActivity(item, '2026-11-02')).toEqual({ kind: 'inactive' });
    });

    it('gives the soonest window to come', () => {
      const item = limited(
        ['2027-03-01', '2027-04-01', false],
        ['2026-12-01', '2027-01-01', false],
      );

      expect(itemActivity(item, '2026-10-26')).toEqual({
        kind: 'inactive',
        activeFrom: '2026-12-01',
      });
      expect(itemActivity(item, '2027-02-01')).toEqual({
        kind: 'inactive',
        activeFrom: '2027-03-01',
      });
    });

    it('copies a yearly window into each later year, and never into earlier ones', () => {
      const item = limited(['2026-09-02', '2026-11-01', true]);

      expect(itemActivity(item, '2025-10-01')).toEqual({
        kind: 'inactive',
        activeFrom: '2026-09-02',
      });
      expect(itemActivity(item, '2028-10-01')).toEqual({ kind: 'active' });
      expect(itemActivity(item, '2028-11-02')).toEqual({
        kind: 'inactive',
        activeFrom: '2029-09-02',
      });
    });

    it('copies a yearly window across New Year, and Feb 29 onto Feb 28', () => {
      const winter = limited(['2026-12-15', '2027-01-15', true]);

      expect(itemActivity(winter, '2029-01-10')).toEqual({ kind: 'active' });
      expect(itemActivity(winter, '2029-01-16')).toEqual({
        kind: 'inactive',
        activeFrom: '2029-12-15',
      });

      const leap = limited(['2028-02-29', '2028-03-10', true]);
      expect(itemActivity(leap, '2029-02-27')).toEqual({
        kind: 'inactive',
        activeFrom: '2029-02-28',
      });
      expect(itemActivity(leap, '2029-02-28')).toEqual({ kind: 'active' });
    });
  });
});
