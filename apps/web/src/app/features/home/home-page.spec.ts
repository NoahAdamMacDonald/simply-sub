import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CatalogData, ListItem, Settings } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import { testStorage, until, type TestStorage } from '../../core/storage/storage.testing';
import { alberta, fx, searchCatalogData } from '../../shared/sub-card/search.testing';
import { HomePage } from './home-page';

// Home (P2, M7.3) on Search's small catalog, for an Albertan, with today Oct 25 (FakeClock).

@Component({ template: '' })
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

describe('HomePage', () => {
  let storage: TestStorage;
  let harness: RouterTestingHarness;
  let saved: ReturnType<typeof signal<Settings | undefined>>;

  beforeEach(() => {
    storage = testStorage();
    saved = signal<Settings | undefined>(alberta);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: SettingsStore, useValue: { saved } },
        {
          provide: CatalogStore,
          useValue: {
            catalog: signal<CatalogData | undefined>(searchCatalogData),
            catalogFor: () => searchCatalogData,
          },
        },
        { provide: FxStore, useValue: { rates: signal(fx) } },
        provideRouter([
          { path: '', component: HomePage },
          { path: 'lists', component: Elsewhere },
          { path: 'lists/new', component: Elsewhere },
          { path: 'search', component: Elsewhere },
          { path: 'settings', component: Elsewhere },
          { path: 'calendar', component: Elsewhere },
        ]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
  });

  /** Two lists: Netflix on the 12th of each month in one, and Mullvad yearly on Jan 20 (renewed by hand) in the other. */
  async function plant(): Promise<ListItem[]> {
    const lists = TestBed.inject(ListsRepository);
    const items = TestBed.inject(ItemsRepository);
    const work = await lists.create({ name: 'Work Related' });
    const family = await lists.create({ name: 'Family' });
    return [
      await items.create({ ...fields('netflix.standard'), listId: work.id }),
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
      }),
    ];
  }

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create('/');
    await until(() => !page().querySelector('.note'));
    await harness.fixture.whenStable();
  }

  const page = () => harness.routeNativeElement as HTMLElement;
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();

  it('offers a list, Search or a backup when there are no lists', async () => {
    await open();
    expect(text(page().querySelector('ss-empty-state h2'))).toBe('Start with a list');
    expect(
      Array.from(
        page().querySelectorAll('ss-empty-state [actions] a, ss-empty-state [actions] button'),
      ).map((action) => [
        text(action)?.replace(/^(add|search|upload) /, ''),
        action.getAttribute('href'),
      ]),
    ).toEqual([
      ['Create a list', '/lists/new'],
      ['Browse services', '/search'],
      ['Import backup', null],
    ]);
    expect(page().querySelector('ss-mini-calendar')).toBeNull();
  });

  it('shows the month’s payment days, every list’s totals, the way into the lists and the next payments', async () => {
    await plant();
    await open();
    await until(() => page().querySelector('ss-mini-calendar .day.paid') !== null);

    // Netflix's Oct 12 charge, $18.99 with Alberta's 5%.
    expect(
      Array.from(page().querySelectorAll('ss-mini-calendar .day.paid')).map((day) =>
        day.getAttribute('data-date'),
      ),
    ).toEqual(['2026-10-12']);
    expect(
      Array.from(page().querySelectorAll('ss-budget-totals .total [aria-hidden]')).map((total) =>
        text(total),
      ),
    ).toEqual(['$19.94 this month', '≈ $333.44 in 2026']);
    // No budgets: the prompts.
    expect(
      Array.from(page().querySelectorAll('a.prompt')).map((link) => [
        text(link),
        link.getAttribute('href'),
      ]),
    ).toEqual([
      ['Set a monthly budget →', '/settings'],
      ['Set an annual budget →', '/settings'],
    ]);
    expect(page().querySelector('.lists-button')?.getAttribute('href')).toBe('/lists');
    // As a screen reader hears them: no icons or shown-only words.
    const spoken = (element: Element) => {
      const copy = element.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      return text(copy);
    };
    expect(Array.from(page().querySelectorAll('.next li')).map(spoken)).toEqual([
      'Nov 12 Netflix $19.94',
      'Dec 12 Netflix $19.94',
      'Jan 12, 2027 Netflix $19.94',
    ]);
  });

  it('shows bars for the budgets that are set', async () => {
    await plant();
    saved.set({ ...alberta, monthlyBudget: 10, annualBudget: 1000 });
    await open();
    await until(() => page().querySelectorAll('ss-budget-bar').length === 2);
    expect(page().querySelector('ss-budget-bar')?.getAttribute('data-level')).toBe('over');
    expect(page().querySelector('a.prompt')).toBeNull();
  });

  it('opens the Calendar on a day’s month, or the month shown', async () => {
    await plant();
    await open();
    await until(() => page().querySelector('ss-mini-calendar .day.paid') !== null);
    page().querySelector<HTMLElement>('ss-mini-calendar .day[data-date="2026-10-12"]')?.click();
    await until(() => TestBed.inject(Router).url === '/calendar?month=2026-10');

    await TestBed.inject(Router).navigateByUrl('/');
    await until(() => page().querySelector('ss-mini-calendar') !== null);
    page().querySelector<HTMLElement>('ss-mini-calendar button[aria-label="Next month"]')?.click();
    await harness.fixture.whenStable();
    page().querySelector<HTMLElement>('ss-mini-calendar .title')?.click();
    await until(() => TestBed.inject(Router).url === '/calendar?month=2026-11');
  });

  it('warns of the first month and of this year over budget, for every list together (M7.6)', async () => {
    saved.set({ ...alberta, monthlyBudget: 100, annualBudget: 200 });
    await plant();
    await open();
    await until(() => page().querySelectorAll('ss-budget-warnings .warning').length === 2);
    const warnings = Array.from(page().querySelectorAll('ss-budget-warnings .warning'));
    // Netflix every month, and in January Mullvad's ≈ $94.16 too; this year, Netflix 12 times and Mullvad on Jan 20.
    expect(
      warnings.map((warning) => text(warning.querySelector('[aria-hidden="true"]:not(mat-icon)'))),
    ).toEqual([
      'Your payments in January 2027 add up to ≈ $114.10, over your $100.00 monthly budget.',
      'Your payments this year, past and to come, add up to ≈ $333.44, over your $200.00 annual budget.',
    ]);
    expect(warnings[0].querySelector('a')?.getAttribute('href')).toBe('/calendar?month=2027-01');
    // Above the calendar and the totals.
    expect(page().querySelector('ss-budget-warnings + .top')).not.toBeNull();
  });

  it('has no warning when every month and the year are within budget', async () => {
    saved.set({ ...alberta, monthlyBudget: 200, annualBudget: 1000 });
    await plant();
    await open();
    await until(() => page().querySelector('ss-budget-totals') !== null);
    expect(page().querySelector('ss-budget-warnings .warning')).toBeNull();
  });
});
