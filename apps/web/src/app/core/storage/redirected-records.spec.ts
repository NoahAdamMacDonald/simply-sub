import { TestBed } from '@angular/core/testing';
import type { CatalogData, ListDraft, ListItem, ProfileRanking, Settings } from '@simply-sub/core';
import { catalogFile } from '../catalog/catalog.testing';
import { DraftsRepository } from './drafts-repository';
import { ItemsRepository } from './items-repository';
import { ListsRepository } from './lists-repository';
import { RankingsRepository } from './rankings-repository';
import { followRedirects } from './redirected-records';
import type { NewRecord } from './record-repository';
import { SettingsRepository } from './settings-repository';
import { StorageService } from './storage-service';
import { storedRows, testStorage, type TestStorage } from './storage.testing';

// Ids that changed (BLUEPRINT §4.3, M10.27): the user's records move to the new ids in one transaction, once.

function itemFields(planId: string, listId: string): NewRecord<'items'> {
  return {
    listId,
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: { 'vpn.no-logs': 'needed' },
    pinned: false,
  };
}

/**
 * The spec catalog's Mullvad, with mullvad.old's id changed to mullvad.vpn, and mullvad.legacy retired, its
 * subscribers moving to mullvad.vpn on `on`; vpn.no-logs is now vpn.audited.
 */
function catalog(on: string): CatalogData {
  const { data } = catalogFile(undefined, '1234567');
  const [mullvad] = data.providers;
  const [vpn] = mullvad.plans;
  return {
    ...data,
    providers: [
      {
        ...mullvad,
        plans: [vpn, { ...vpn, id: 'mullvad.legacy', name: 'Legacy', retired: '2026-09-01' }],
      },
    ],
    redirects: [
      { kind: 'plan', from: 'mullvad.old', to: 'mullvad.vpn', on: '2026-10-01' },
      { kind: 'plan', from: 'mullvad.legacy', to: 'mullvad.vpn', on },
      { kind: 'feature', from: 'vpn.no-logs', to: 'vpn.audited', on: '2026-10-01' },
    ],
  };
}

describe('followRedirects', () => {
  let storage: TestStorage;
  let service: StorageService;
  let old: ListItem;
  let legacy: ListItem;
  let current: ListItem;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({ providers: [storage.providers] });
    service = TestBed.inject(StorageService);
    const list = await TestBed.inject(ListsRepository).create({ name: 'Mine' });
    const items = TestBed.inject(ItemsRepository);
    old = await items.create(itemFields('mullvad.old', list.id));
    legacy = await items.create(itemFields('mullvad.legacy', list.id));
    current = await items.create({ ...itemFields('mullvad.vpn', list.id), rankOverrides: {} });
    await TestBed.inject(RankingsRepository).set('vpn.no-logs', 'wanted');
    await TestBed.inject(SettingsRepository).save({
      country: 'CA',
      currency: 'CAD',
      theme: 'system',
    });
    await TestBed.inject(DraftsRepository).start(list.id);
    storage.clock.time = '2026-10-25T13:00:00.000Z';
  });

  async function stored() {
    return {
      items: (await storedRows(storage.indexedDB, 'items')) as ListItem[],
      rankings: (await storedRows(storage.indexedDB, 'rankings')) as ProfileRanking[],
      drafts: (await storedRows(storage.indexedDB, 'drafts')) as ListDraft[],
      settings: (await storedRows(storage.indexedDB, 'settings')) as Settings[],
    };
  }

  const planIds = (items: readonly ListItem[]) =>
    items.map((item) => (item.source.kind === 'catalog' ? item.source.planId : ''));

  it('moves items, ranks and drafts to the new ids in one go, with Home’s notice of a move', async () => {
    expect(await followRedirects(service, catalog('2026-10-25'), '2026-10-25')).toBe(5);
    const { items, rankings, drafts, settings } = await stored();
    expect(planIds(items)).toEqual(['mullvad.vpn', 'mullvad.vpn', 'mullvad.vpn']);
    expect(items.find((item) => item.id === old.id)).toEqual({
      ...old,
      source: { kind: 'catalog', planId: 'mullvad.vpn' },
      rankOverrides: { 'vpn.audited': 'needed' },
      updatedAt: '2026-10-25T13:00:00.000Z',
    });
    expect(items.find((item) => item.id === current.id)).toEqual(current);
    expect(rankings.map(({ rankKey, rank, deletedAt }) => [rankKey, rank, deletedAt])).toEqual([
      ['vpn.audited', 'wanted', undefined],
      ['vpn.no-logs', 'wanted', '2026-10-25T13:00:00.000Z'],
    ]);
    expect(planIds(drafts[0].items.map((entry) => entry.item))).toEqual(planIds(items));
    expect(planIds(drafts[0].items.flatMap((entry) => entry.saved ?? []))).toEqual(planIds(items));
    expect(settings[0].planNotices).toEqual([
      {
        kind: 'moved',
        planId: 'mullvad.vpn',
        title: 'Mullvad VPN Legacy',
        to: 'Mullvad VPN',
        on: '2026-10-25',
        date: '2026-10-25',
      },
    ]);

    // Once: the records point at the new ids now.
    const before = await stored();
    expect(await followRedirects(service, catalog('2026-10-25'), '2026-10-26')).toBe(0);
    expect(await stored()).toEqual(before);
  });

  it('waits for a move’s date', async () => {
    expect(await followRedirects(service, catalog('2026-12-01'), '2026-10-25')).toBe(5);
    const { items, settings } = await stored();
    expect(items.find((item) => item.id === legacy.id)?.source).toEqual(legacy.source);
    expect(settings[0].planNotices).toBeUndefined();
    expect(await followRedirects(service, catalog('2026-12-01'), '2026-12-01')).toBe(2);
    expect(planIds((await stored()).items)).toEqual(['mullvad.vpn', 'mullvad.vpn', 'mullvad.vpn']);
  });
});
