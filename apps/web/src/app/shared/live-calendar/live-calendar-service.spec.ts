import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CatalogData, ListItem, Settings, Tag } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { LiveCalendarRepository } from '../../core/storage/live-calendar-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { alberta, fx, searchCatalogData } from '../sub-card/search.testing';
import { LiveCalendarError } from './live-calendar-client';
import { LIVE_CALENDAR_SETTLE_MS, LiveCalendarService } from './live-calendar-service';
import { FakeCalServer } from './live-calendar.testing';

// The live calendar's service (M10.3) on a fake IndexedDB and a stand-in for the Worker's /api/v1/cal, for an Albertan
// on Oct 25, 2026: Work Related has Netflix Standard on the 12th, tagged Family; Family has Mullvad VPN yearly on Jan 20,
// charged in euros and renewed by hand.

function fields(planId: string, extra: Partial<NewRecord<'items'>> = {}): NewRecord<'items'> {
  return {
    listId: '',
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...extra,
  };
}

describe('LiveCalendarService', () => {
  let storage: TestStorage;
  let server: FakeCalServer;
  let familyTag: Tag;
  let netflix: ListItem;

  beforeEach(async () => {
    storage = testStorage();
    server = new FakeCalServer();
    vi.stubGlobal('fetch', server.fetch);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: SettingsStore, useValue: { saved: signal<Settings | undefined>(alberta) } },
        {
          provide: CatalogStore,
          useValue: {
            catalog: signal<CatalogData | undefined>(searchCatalogData),
            catalogFor: () => searchCatalogData,
          },
        },
        { provide: FxStore, useValue: { rates: signal(fx) } },
        { provide: LIVE_CALENDAR_SETTLE_MS, useValue: 0 },
      ],
    });
    const lists = TestBed.inject(ListsRepository);
    const items = TestBed.inject(ItemsRepository);
    const work = await lists.create({ name: 'Work Related' });
    const family = await lists.create({ name: 'Family' });
    familyTag = await TestBed.inject(TagsRepository).create({ name: 'Family', color: '#1e88e5' });
    netflix = await items.create({
      ...fields('netflix.standard'),
      listId: work.id,
      tagIds: [familyTag.id],
    });
    await items.create({
      ...fields('mullvad.vpn'),
      listId: family.id,
      billing: {
        mode: 'recurring',
        interval: 'year',
        intervalCount: 1,
        anchorDate: '2027-01-20',
        autoRenew: false,
      },
    });
    const metrics = TestBed.inject(MetricsService);
    await until(() => metrics.list(work.id).resolved.length === 1);
    await until(() => metrics.list(family.id).resolved.length === 1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const service = () => TestBed.inject(LiveCalendarService);
  const record = () => TestBed.inject(LiveCalendarRepository).record();
  const create = () =>
    service().create({ holds: ['all', familyTag.id], titles: 'name-amount', listNames: false });

  it('makes a calendar of each choice, sending titles, days and rules, and a hash for each record id', async () => {
    await create();

    const [{ method, path, body }] = server.requests;
    expect([method, path]).toEqual(['POST', '/api/v1/cal']);
    expect(body?.feeds.map(({ name, color }) => ({ name, color }))).toEqual([
      { name: 'Simply Sub', color: undefined },
      { name: 'Simply Sub: Family', color: '#1e88e5' },
    ]);
    expect(body?.feeds[0].events.map(({ date, title, rule }) => ({ date, title, rule }))).toEqual([
      {
        date: '2026-11-12',
        title: 'Netflix: $19.94',
        rule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12',
      },
      {
        date: '2027-01-20',
        title: 'Renew Mullvad VPN: €60.00',
        rule: 'FREQ=YEARLY;INTERVAL=1;BYMONTH=1;BYMONTHDAY=20',
      },
    ]);
    for (const event of body?.feeds.flatMap((feed) => feed.events) ?? []) {
      expect(event.uid).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(JSON.stringify(body)).not.toContain(netflix.id);
    await until(() => record() !== undefined);
    expect(record()).toMatchObject({
      setId: 'secret0000000000000000',
      manageKey: 'secret0000000000000001',
      calendars: [
        { holds: 'all', token: 'secret0000000000000002' },
        { holds: familyTag.id, token: 'secret0000000000000003' },
      ],
      titles: 'name-amount',
      sentAt: storage.clock.time,
    });
  });

  it('sends a change that reaches a calendar, keeping each link, and nothing for one that does not', async () => {
    await create();
    await until(() => record() !== undefined);
    const items = TestBed.inject(ItemsRepository);

    await items.update(netflix.id, { note: 'Shared with the family' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.requests.map((request) => request.method)).toEqual(['POST']);

    await items.update(netflix.id, { nickname: 'Movies' });
    await until(() => server.requests.length === 2);
    const put = server.requests[1];
    expect([put.method, put.path, put.key]).toEqual([
      'PUT',
      '/api/v1/cal/secret0000000000000000',
      'secret0000000000000001',
    ]);
    expect(put.body?.feeds.map((feed) => feed.token)).toEqual([
      'secret0000000000000002',
      'secret0000000000000003',
    ]);
    expect(put.body?.feeds[1].events.map((event) => event.title)).toEqual(['Movies: $19.94']);
  });

  it('marks the links broken when the set is gone, revoked elsewhere or expired', async () => {
    await create();
    await until(() => record() !== undefined);
    server.forget('secret0000000000000000');

    await TestBed.inject(ItemsRepository).update(netflix.id, { nickname: 'Movies' });

    await until(() => record()?.broken === true);
    expect(service().problem()).toBe('gone');
  });

  it('waits for the network, then sends what changed', async () => {
    await create();
    await until(() => record() !== undefined);
    server.fail = 'offline';

    await TestBed.inject(ItemsRepository).update(netflix.id, { nickname: 'Movies' });
    await until(() => service().problem() === 'offline');
    server.fail = undefined;
    window.dispatchEvent(new Event('online'));

    await until(() => server.requests.filter((request) => request.method === 'PUT').length === 2);
    await until(() => service().problem() === undefined);
  });

  it('revokes the set, and keeps it deleted so a sync passes that on', async () => {
    await create();
    await until(() => record() !== undefined);

    await service().revoke();

    expect(server.requests.at(-1)).toMatchObject({
      method: 'DELETE',
      path: '/api/v1/cal/secret0000000000000000',
      key: 'secret0000000000000001',
    });
    await until(() => record() === undefined);
    const [row] = (await storedRows(storage.indexedDB, 'liveCalendar')) as { deletedAt?: string }[];
    // A millisecond after the save, as the clock hasn't moved: a deletion always moves updatedAt on.
    expect(row.deletedAt).toBe('2026-10-25T12:00:00.001Z');
  });

  it('makes new links: the old set revoked, a new one made with the same choices', async () => {
    await create();
    await until(() => record() !== undefined);

    await service().renew();

    expect(server.requests.map((request) => request.method)).toEqual(['POST', 'DELETE', 'POST']);
    await until(() => record()?.setId === 'secret0000000000000004');
    expect(record()?.calendars.map((calendar) => calendar.holds)).toEqual(['all', familyTag.id]);
  });

  it('says why a set can’t be made', async () => {
    server.fail = 503;

    await expect(create()).rejects.toEqual(new LiveCalendarError('full'));
    expect(record()).toBeUndefined();
  });
});
