import { describe, expect, it } from 'vitest';
import {
  deviceRefreshMs,
  maxSyncDevices,
  mergeSync,
  readSyncCopy,
  sharedSettings,
  syncSchemaVersion,
  syncTables,
  touchesSharedSettings,
  withSharedSettings,
  type LocalSync,
  type Settings,
  type SyncCopy,
  type SyncData,
  type SyncTable,
} from '../../src';
import {
  card,
  customSub,
  dismissedSuggestion,
  item,
  list,
  ranking,
  settings,
  tag,
} from './fixtures';

// Device sync (M10.7, BLUEPRINT §11.4): a copy's records merge by key, the later updatedAt winning, a deletion
// included and a tie decided alike on both devices; the shared settings merge by their own time and the per-device ones
// never leave the device; a copy is read record by record, and one from a newer app refused.

const device = { id: '0192f1d0-0000-7000-8000-00000000000a', name: 'Edge on Windows' };
const otherDevice = { id: '0192f1d0-0000-7000-8000-00000000000b', name: 'Phone' };
const now = '2026-10-29T18:00:00.000Z';
const later = '2026-10-21T10:00:00.000Z';
const earlier = '2026-10-19T10:00:00.000Z';

const liveCalendar = {
  key: 'liveCalendar',
  setId: 'Qx3Lm8Rt5Vw2Yz7Bd4Gh1J',
  manageKey: 'Jd8f2LqP0zXn5Vt7Bc3HyA',
  calendars: [{ holds: 'all', token: 'k7Qm2Zp9XvT4bN8cR1sW0a' }],
  titles: 'name-amount',
  sentAt: '2026-10-20T09:15:00.000Z',
  updatedAt: '2026-10-20T09:15:00.000Z',
};

const allData = {
  tags: [tag],
  customSubs: [customSub],
  lists: [list],
  items: [item],
  rankings: [ranking],
  cards: [card],
  dismissedSuggestions: [dismissedSuggestion],
  liveCalendar: [liveCalendar],
} as unknown as SyncData;

const empty = Object.fromEntries(syncTables.map((table) => [table, []])) as unknown as SyncData;
const shared = sharedSettings(settings as Settings);

/** Some tables' records, as the fixtures' plain objects. */
type Tables = Partial<Record<SyncTable, readonly object[]>>;

function local(data: Tables = {}, own: Settings = settings as Settings): LocalSync {
  return { settings: sharedSettings(own), data: { ...empty, ...data } as SyncData };
}

function copy(data: Tables = {}, extra: Partial<SyncCopy> = {}): SyncCopy {
  return {
    schemaVersion: syncSchemaVersion,
    settings: shared,
    data: { ...empty, ...data } as SyncData,
    devices: [{ ...device, syncedAt: '2026-10-29T12:00:00.000Z' }],
    ...extra,
  };
}

describe('mergeSync', () => {
  it('starts a chain with everything this device has, and itself as its first device', () => {
    const merge = mergeSync(local(allData), undefined, device, now);
    expect(merge.send).toBe(true);
    expect(merge.writes).toEqual({});
    expect(merge.copy).toEqual({
      schemaVersion: syncSchemaVersion,
      settings: shared,
      data: allData,
      devices: [{ ...device, syncedAt: now }],
    });
  });

  it('takes the newer of each record: the copy’s are written here, this device’s are sent', () => {
    const renamedThere = { ...list, name: 'Work', updatedAt: later };
    const editedHere = { ...item, note: 'Shared with Sam', updatedAt: later };
    const merge = mergeSync(
      local({ lists: [list], items: [editedHere] }),
      copy({ lists: [renamedThere], items: [item] }),
      device,
      now,
    );
    expect(merge.writes).toEqual({ lists: [renamedThere] });
    expect(merge.copy.data.lists).toEqual([renamedThere]);
    expect(merge.copy.data.items).toEqual([editedHere]);
    expect(merge.send).toBe(true);
  });

  it('keeps a record only one side has', () => {
    const merge = mergeSync(local({ tags: [tag] }), copy({ cards: [card] }), device, now);
    expect(merge.writes).toEqual({ cards: [card] });
    expect(merge.copy.data.tags).toEqual([tag]);
    expect(merge.copy.data.cards).toEqual([card]);
    expect(merge.send).toBe(true);
  });

  it('carries a deletion either way, as the later change', () => {
    const deletedThere = { ...list, updatedAt: later, deletedAt: later };
    const fromThere = mergeSync(
      local({ lists: [list] }),
      copy({ lists: [deletedThere] }),
      device,
      now,
    );
    expect(fromThere.writes).toEqual({ lists: [deletedThere] });

    const deletedHere = { ...tag, updatedAt: later, deletedAt: later };
    const fromHere = mergeSync(local({ tags: [deletedHere] }), copy({ tags: [tag] }), device, now);
    expect(fromHere.copy.data.tags).toEqual([deletedHere]);
    expect(fromHere.writes).toEqual({});
    expect(fromHere.send).toBe(true);

    // A change made after the deletion brings the record back.
    const restoredThere = { ...list, name: 'Back', updatedAt: '2026-10-22T10:00:00.000Z' };
    const restored = mergeSync(
      local({ lists: [deletedThere] }),
      copy({ lists: [restoredThere] }),
      device,
      now,
    );
    expect(restored.writes).toEqual({ lists: [restoredThere] });
  });

  it('decides a tie the same way on both devices', () => {
    const here = { ...list, name: 'Here', updatedAt: later };
    const there = { ...list, name: 'There', updatedAt: later };
    const onThis = mergeSync(local({ lists: [here] }), copy({ lists: [there] }), device, now);
    const onOther = mergeSync(local({ lists: [there] }), copy({ lists: [here] }), otherDevice, now);
    expect(onThis.copy.data.lists).toEqual(onOther.copy.data.lists);
    expect(onThis.copy.data.lists).toEqual([there]);
    expect(onThis.writes).toEqual({ lists: [there] });
    expect(onOther.writes).toEqual({});
  });

  it('agrees on a record whose fields are stored in another order', () => {
    const reordered = Object.fromEntries(Object.entries(list).reverse()) as typeof list;
    const merge = mergeSync(local({ lists: [list] }), copy({ lists: [reordered] }), device, now);
    expect(merge.writes).toEqual({});
    expect(merge.send).toBe(false);
  });

  it('sends nothing when both sides agree and this device synced today, and refreshes its entry after a day', () => {
    const synced = copy(allData);
    expect(mergeSync(local(allData), synced, device, now).send).toBe(false);

    const dayLater = new Date(
      Date.parse('2026-10-29T12:00:00.000Z') + deviceRefreshMs,
    ).toISOString();
    const refreshed = mergeSync(local(allData), synced, device, dayLater);
    expect(refreshed.send).toBe(true);
    expect(refreshed.copy.devices).toEqual([{ ...device, syncedAt: dayLater }]);

    const renamed = mergeSync(local(allData), synced, { ...device, name: 'Work laptop' }, now);
    expect(renamed.send).toBe(true);
    expect(renamed.copy.devices[0].name).toBe('Work laptop');
  });

  it('lists the devices that synced last first, up to the most it keeps', () => {
    const others = Array.from({ length: maxSyncDevices + 3 }, (_, index) => ({
      id: `0192f1d0-0000-7000-8000-${String(100 + index).padStart(12, '0')}`,
      name: `Device ${index}`,
      syncedAt: new Date(Date.parse('2026-10-01T00:00:00.000Z') + index * 3_600_000).toISOString(),
    }));
    const merge = mergeSync(local(), copy({}, { devices: others }), device, now);
    expect(merge.copy.devices).toHaveLength(maxSyncDevices);
    expect(merge.copy.devices[0]).toEqual({ ...device, syncedAt: now });
    expect(merge.copy.devices[1].name).toBe(`Device ${maxSyncDevices + 2}`);
  });

  describe('the shared settings', () => {
    it('take another device’s when they changed later, keeping this device’s own', () => {
      const own = { ...settings, theme: 'dark', calendarHiddenLists: [list.id] } as Settings;
      const budgetThere = { ...shared, monthlyBudget: 300, updatedAt: later };
      const merge = mergeSync(local({}, own), copy({}, { settings: budgetThere }), device, now);
      expect(merge.settings).toEqual(budgetThere);
      const taken = withSharedSettings(own, budgetThere, now);
      expect(taken).toMatchObject({
        monthlyBudget: 300,
        theme: 'dark',
        calendarHiddenLists: [list.id],
        sharedUpdatedAt: later,
        updatedAt: now,
      });
    });

    it('go by their own time: a theme changed here later doesn’t outweigh a budget set there', () => {
      const themeLater = {
        ...settings,
        theme: 'dark',
        sharedUpdatedAt: earlier,
        updatedAt: '2026-10-28T10:00:00.000Z',
      } as Settings;
      const budgetThere = { ...shared, monthlyBudget: 300, updatedAt: later };
      const merge = mergeSync(
        local({}, themeLater),
        copy({}, { settings: budgetThere }),
        device,
        now,
      );
      expect(merge.settings).toEqual(budgetThere);
    });

    it('are sent when this device changed them later', () => {
      const own = { ...settings, annualBudget: 1200, sharedUpdatedAt: later } as Settings;
      const merge = mergeSync(local({}, own), copy(), device, now);
      expect(merge.settings).toBeUndefined();
      expect(merge.copy.settings).toEqual(sharedSettings(own));
      expect(merge.send).toBe(true);
    });

    it('never hold what stays on the device: the theme, the Calendar’s lists, price changes, the app lock', () => {
      const own = {
        ...settings,
        theme: 'dark',
        calendarHiddenLists: [list.id],
        appLock: {
          salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
          iterations: 600_000,
          check: { iv: 'aXZpdml2aXZpdml2', ciphertext: 'Y2hlY2s=' },
        },
      } as unknown as Settings;
      expect(Object.keys(sharedSettings(own)).sort()).toEqual([
        'annualBudget',
        'country',
        'currency',
        'monthlyBudget',
        'salesTaxPercent',
        'subdivision',
        'updatedAt',
      ]);
      // A copy whose settings carry one of them is refused that part: each device keeps its own.
      const reading = readSyncCopy({ ...copy(), settings: { ...shared, theme: 'dark' } });
      expect(reading.kind === 'copy' && reading.copy.settings).toBeUndefined();
    });

    it('say which changes touch them', () => {
      expect(touchesSharedSettings({ monthlyBudget: 250 })).toBe(true);
      expect(touchesSharedSettings({ theme: 'light' })).toBe(false);
      expect(touchesSharedSettings({ theme: 'light', currency: 'USD' })).toBe(true);
    });
  });
});

describe('readSyncCopy', () => {
  it('reads back a copy as it was sent', () => {
    const sent = mergeSync(local(allData), undefined, device, now).copy;
    expect(readSyncCopy(JSON.parse(JSON.stringify(sent)))).toEqual({
      kind: 'copy',
      copy: sent,
      rejected: [],
    });
  });

  it('leaves out a record that fails its schema, described by its table, key and issues, never its values', () => {
    const bad = { ...item, id: '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9aff', billing: { mode: 'never' } };
    const reading = readSyncCopy(copy({ items: [item, bad] }));
    expect(reading.kind).toBe('copy');
    if (reading.kind !== 'copy') return;
    expect(reading.copy.data.items).toEqual([item]);
    expect(reading.rejected).toHaveLength(1);
    expect(reading.rejected[0]).toMatchObject({ table: 'items', key: bad.id });
    expect(JSON.stringify(reading.rejected)).not.toContain('never');
  });

  it('keeps one record per key, the later, should a copy hold two', () => {
    const renamed = { ...list, name: 'Work', updatedAt: later };
    const reading = readSyncCopy(copy({ lists: [list, renamed] }));
    expect(reading.kind === 'copy' && reading.copy.data.lists).toEqual([renamed]);
  });

  it('refuses a copy from a newer version of the app', () => {
    expect(readSyncCopy({ ...copy(), schemaVersion: syncSchemaVersion + 1 })).toEqual({
      kind: 'newer',
    });
  });

  it('migrates a copy from an older version as a backup is', () => {
    // Version 1 had no dismissed suggestions.
    const olderData = Object.fromEntries(
      Object.entries({ ...empty, lists: [list] }).filter(
        ([table]) => table !== 'dismissedSuggestions',
      ),
    );
    const reading = readSyncCopy({ ...copy(), schemaVersion: 1, data: olderData });
    expect(reading.kind === 'copy' && reading.copy.data.dismissedSuggestions).toEqual([]);
    expect(reading.kind === 'copy' && reading.copy.data.lists).toEqual([list]);
  });

  it.each([
    ['not an object', []],
    ['no version', { data: {} }],
    ['no data', { schemaVersion: syncSchemaVersion }],
  ])('can’t read %s', (_, json) => {
    expect(readSyncCopy(json)).toEqual({ kind: 'unreadable' });
  });
});
