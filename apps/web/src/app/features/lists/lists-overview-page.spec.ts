import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CatalogData, ListItem, Settings, SubscriptionList } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { ConfirmService, type ConfirmOptions } from '../../shared/confirm/confirm-service';
import { alberta, fx, searchCatalogData } from '../../shared/sub-card/search.testing';
import { ListsOverviewPage } from './lists-overview-page';

// The Lists overview (P3) on a fake IndexedDB, with Search's small catalog for an Albertan: Work Related has Netflix
// Standard (Ad free ranked Essential on it) and Mullvad VPN at €60 a year; the profile ranks 1080p Wanted. Family has
// nothing in it. ConfirmService answers as each test says.

@Component({ template: '<h1>Elsewhere</h1>' })
class Elsewhere {}

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

describe('ListsOverviewPage', () => {
  let storage: TestStorage;
  let harness: RouterTestingHarness;
  let answer: boolean;
  let questions: ConfirmOptions[];
  let work: SubscriptionList;
  let family: SubscriptionList;

  beforeEach(async () => {
    storage = testStorage();
    answer = true;
    questions = [];
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
        {
          provide: ConfirmService,
          useValue: {
            confirm: async (options: ConfirmOptions) => {
              questions.push(options);
              return answer;
            },
          },
        },
        provideRouter([
          { path: 'lists', component: ListsOverviewPage },
          { path: 'lists/new', component: Elsewhere },
          { path: 'lists/:listId', component: Elsewhere },
          { path: 'custom', component: Elsewhere },
          { path: 'features', component: Elsewhere },
        ]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  /** Work Related with its two items, then Family with none, and the profile's rank of 1080p. */
  async function plant(): Promise<void> {
    const lists = TestBed.inject(ListsRepository);
    const items = TestBed.inject(ItemsRepository);
    work = await lists.create({ name: 'Work Related' });
    family = await lists.create({ name: 'Family' });
    await items.create({
      ...fields('netflix.standard'),
      listId: work.id,
      rankOverrides: { 'streaming.ad-free': 'essential' },
    });
    await items.create({
      ...fields('mullvad.vpn'),
      listId: work.id,
      billing: {
        mode: 'recurring',
        interval: 'year',
        intervalCount: 1,
        anchorDate: '2027-01-20',
        autoRenew: false,
      },
    });
    await TestBed.inject(RankingsRepository).set('video.quality=1080p', 'wanted');
  }

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create('/lists');
    await until(() => page().querySelector('.new-list') !== null);
    await harness.fixture.whenStable();
  }

  const page = () => harness.routeNativeElement as HTMLElement;
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const cards = () =>
    Array.from(page().querySelectorAll('li.card')).map((card) => ({
      name: text(card.querySelector('.name')),
      totals: Array.from(card.querySelectorAll('ss-budget-totals .total [aria-hidden]')).map(
        (total) => text(total),
      ),
      count: text(card.querySelector('.count')),
      ranks: Array.from(card.querySelectorAll('ss-rank-counts li'))
        .map((rank) => text(rank))
        .filter((rank) => !rank?.startsWith('0 ')),
    }));
  const features = () =>
    Array.from(page().querySelectorAll('ss-feature-summary li')).map(
      (row) => `${text(row.querySelector('.label'))} ${text(row.querySelector('[aria-hidden]'))}`,
    );
  const button = (label: string) => page().querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const storedLists = async () =>
    (await storedRows(storage.indexedDB, 'lists')) as SubscriptionList[];
  const storedItems = async () => (await storedRows(storage.indexedDB, 'items')) as ListItem[];

  it('shows each list in the order it was made, with what it costs, its rank counts and the summary', async () => {
    await plant();
    await open();
    await until(() => cards()[0]?.count === '2 subscriptions');

    expect(text(page().querySelector('h1'))).toBe('Subscription Lists');
    expect(cards()).toEqual([
      {
        name: 'Work Related',
        // Netflix's $18.99 a month with Alberta's 5%, from Jan 12; Mullvad's €60 on Jan 20, which includes tax.
        totals: ['$19.94 this month', '≈ $333.44 this year'],
        count: '2 subscriptions',
        ranks: ['1 Essential', '1 Wanted'],
      },
      { name: 'Family', totals: [], count: 'No subscriptions yet', ranks: [] },
    ]);
    // Without budgets, the amounts alone: no bars.
    expect(page().querySelector('ss-budget-bar')).toBeNull();
    expect(
      Array.from(page().querySelectorAll('li.card ss-budget-totals .visually-hidden')).map(
        (spoken) => text(spoken),
      ),
    ).toEqual(['$19.94 this month', 'about $333.44 this year']);
    // Every rank's count is there, zeros included, in grey.
    expect(
      page().querySelectorAll('li.card')[1].querySelectorAll('ss-rank-counts li'),
    ).toHaveLength(8);
    expect(
      page()
        .querySelectorAll('li.card')[1]
        .querySelector('ss-rank-counts li')
        ?.getAttribute('data-rank'),
    ).toBe('not-ranked');
    // Ranked, then what an item has itself: Mullvad's VPN.
    expect(features()).toEqual([
      'Ad free: 1 / 1',
      'Video quality: 1080p (Full HD): 1 / 1',
      'VPN: 1 / 1',
    ]);
    expect(
      Array.from(page().querySelectorAll('ss-type-counts li')).map(
        (row) =>
          `${text(row.querySelector('.label'))} ${text(row.querySelector('span:last-child'))}`,
      ),
    ).toEqual(['Streaming video: 1', 'VPN: 1']);
    expect(button('View Work Related')?.getAttribute('href')).toBe(`/lists/${work.id}`);
    expect(page().querySelector('.name a')?.getAttribute('href')).toBe(`/lists/${work.id}`);
    expect(page().querySelector('.new-list')?.getAttribute('href')).toBe('/lists/new');
    // At the top too.
    expect(page().querySelector('.new-list-top')?.getAttribute('href')).toBe('/lists/new');
    expect(
      Array.from(page().querySelectorAll('a'))
        .find((link) => text(link) === 'Custom subscriptions')
        ?.getAttribute('href'),
    ).toBe('/custom');
  });

  it('has only the new list tile and a hint with no lists, and no feature column', async () => {
    await open();
    expect(page().querySelector('li.card')).toBeNull();
    expect(text(page().querySelector('.hint'))).toBe(
      "A list holds the subscriptions you pay for, or the ones you're weighing up. Make your first one.",
    );
    expect(page().querySelector('.features')).toBeNull();
  });

  it('deletes a list and its subscriptions after asking, and Undo puts them back', async () => {
    await plant();
    await open();
    await until(() => cards()[0]?.count === '2 subscriptions');
    storage.clock.time = '2026-10-27T09:00:00.000Z';
    button('Delete Work Related')?.click();

    await until(() => cards().length === 1);
    expect(questions).toEqual([
      {
        title: 'Delete “Work Related”?',
        message: 'Its 2 subscriptions will be removed.',
        confirmText: 'Delete list',
        danger: true,
      },
    ]);
    expect((await storedLists()).find((list) => list.id === work.id)?.deletedAt).toBeDefined();
    expect(
      (await storedItems()).every(
        (item) => item.listId !== work.id || item.deletedAt !== undefined,
      ),
    ).toBe(true);
    await until(() => document.activeElement === button('Delete Family'));
    expect(features()).toEqual([]);

    const snackBar = document.querySelector('.mat-mdc-snack-bar-container');
    expect(snackBar?.textContent).toContain('Deleted Work Related');
    snackBar?.querySelector('button')?.click();
    await until(() => cards().length === 2);
    await until(() => cards()[0]?.count === '2 subscriptions');
    expect((await storedLists()).find((list) => list.id === work.id)?.deletedAt).toBeUndefined();
    expect(
      (await storedItems()).filter((item) => item.listId === work.id && !item.deletedAt),
    ).toHaveLength(2);
    await until(() => document.activeElement === button('Delete Work Related'));
  });

  it('says a list with nothing in it has nothing to remove, and keeps it when told to', async () => {
    await plant();
    await open();
    answer = false;
    button('Delete Family')?.click();
    await vi.waitFor(() => expect(questions).toHaveLength(1));
    expect(questions[0].message).toBe('It has no subscriptions.');
    expect(cards()).toHaveLength(2);
    expect((await storedLists()).find((list) => list.id === family.id)?.deletedAt).toBeUndefined();
  });

  it('moves focus to New Subscription List when the last list goes', async () => {
    family = await TestBed.inject(ListsRepository).create({ name: 'Family' });
    await open();
    await until(() => cards().length === 1);
    button('Delete Family')?.click();
    await until(() => cards().length === 0);
    await until(() => document.activeElement === page().querySelector('.new-list'));
  });
});
