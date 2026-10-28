import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CatalogData, ListItem, Settings, SubscriptionList } from '@simply-sub/core';
import { of } from 'rxjs';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import { testStorage, until, type TestStorage } from '../../core/storage/storage.testing';
import { alberta, fx, searchCatalogData } from '../../shared/sub-card/search.testing';
import { CalendarPage } from './calendar-page';

// The Calendar (P10, M7.4) on Search's small catalog, for an Albertan, with today Oct 25, 2026 (FakeClock): Netflix
// monthly on the 12th in Work Related, and Mullvad yearly on Jan 20 in Family, renewed by hand.

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

describe('CalendarPage', () => {
  let storage: TestStorage;
  let harness: RouterTestingHarness;
  let saved: ReturnType<typeof signal<Settings | undefined>>;
  let narrow: boolean;
  let work: SubscriptionList;
  let family: SubscriptionList;
  let netflix: ListItem;

  beforeEach(async () => {
    storage = testStorage();
    saved = signal<Settings | undefined>({ ...alberta, monthlyBudget: 15 });
    narrow = false;
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        {
          provide: SettingsStore,
          useValue: {
            saved,
            update: async (changes: Partial<Settings>) => {
              const next = { ...saved(), ...changes } as Settings;
              for (const [key, value] of Object.entries(changes)) {
                if (value === undefined) delete (next as unknown as Record<string, unknown>)[key];
              }
              saved.set(next);
              return next;
            },
          },
        },
        {
          provide: CatalogStore,
          useValue: {
            catalog: signal<CatalogData | undefined>(searchCatalogData),
            catalogFor: () => searchCatalogData,
          },
        },
        { provide: FxStore, useValue: { rates: signal(fx) } },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: narrow }) } },
        provideRouter([
          { path: 'calendar', component: CalendarPage },
          { path: 'lists/:listId', component: Elsewhere },
        ]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    const lists = TestBed.inject(ListsRepository);
    const items = TestBed.inject(ItemsRepository);
    work = await lists.create({ name: 'Work Related' });
    family = await lists.create({ name: 'Family' });
    netflix = await items.create({ ...fields('netflix.standard'), listId: work.id });
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
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  async function open(url = '/calendar'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await until(() => !page().querySelector('.note')?.textContent?.includes('Loading your lists'));
    await harness.fixture.whenStable();
  }

  const page = () => harness.routeNativeElement as HTMLElement;
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const url = () => TestBed.inject(Router).url;
  /** Each day with chips: its date and its chips' amounts. */
  const days = () =>
    Array.from(page().querySelectorAll('.cell')).flatMap((cell) => {
      const chips = Array.from(cell.querySelectorAll('.chip-amount')).map((chip) => text(chip));
      const date = cell.querySelector('.day')?.getAttribute('data-date');
      return chips.length === 0 ? [] : [`${date}: ${chips.join(', ')}`];
    });
  /** The cell of a day: its button and what it shows beside it. */
  const cell = (date: string) =>
    page().querySelector(`.day[data-date="${date}"]`)?.closest('.cell') ?? null;
  const bar = () => page().querySelector('.month-bar ss-budget-bar');

  it('shows this month’s charges for every list, and what’s been paid of its total against the budget', async () => {
    await open();
    await until(() => days().length > 0);
    expect(days()).toEqual(['2026-10-12: 19.94']);
    expect(text(page().querySelector('.month-total [aria-hidden]'))).toBe('$19.94');
    // Paid on the 12th, before today: the whole of it, over the $15 budget.
    expect(bar()?.getAttribute('aria-valuetext')).toBe('$19.94 of $19.94, budget $15.00');
    expect(bar()?.getAttribute('data-level')).toBe('over');
    expect(text(page().querySelector('.day[aria-current="date"]'))).toBe('25');
    // The day's name says its payments.
    expect(page().querySelector('.day[data-date="2026-10-12"]')?.getAttribute('aria-label')).toBe(
      'Monday, October 12, 1 payment, $19.94',
    );
    // Neighbouring months' days are muted numbers, not buttons.
    expect(page().querySelectorAll('td.other button')).toHaveLength(0);
    // As a screen reader hears them: no icons or shown-only words.
    const spoken = (element: Element) => {
      const copy = element.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      return text(copy);
    };
    expect(Array.from(page().querySelectorAll('.upcoming li')).map(spoken)).toEqual([
      'Nov 12 Netflix $19.94',
      'Dec 12 Netflix $19.94',
      'Jan 12, 2027 Netflix $19.94',
      'Jan 20, 2027 Mullvad VPN about $94.16, renew manually',
      'Feb 12, 2027 Netflix $19.94',
    ]);
  });

  it('moves between months, in the URL, with a future month at nothing paid yet', async () => {
    await open();
    page().querySelector<HTMLElement>('button[aria-label="Next month"]')?.click();
    await until(() => url() === '/calendar?month=2026-11');
    await until(() => days().join() === '2026-11-12: 19.94');
    expect(bar()?.getAttribute('aria-valuetext')).toBe('$0.00 of $19.94, budget $15.00');

    await TestBed.inject(Router).navigateByUrl('/calendar?month=2027-01');
    await until(() => days().length === 2);
    // Mullvad's euros are converted, and it renews by hand.
    expect(days()).toEqual(['2027-01-12: 19.94', '2027-01-20: ≈94.16']);
    expect(cell('2027-01-20')?.querySelectorAll('.chip-manual')).toHaveLength(1);

    Array.from(page().querySelectorAll<HTMLElement>('button'))
      .find((button) => text(button) === 'Today')
      ?.click();
    await until(() => url() === '/calendar?month=2026-10');
  });

  it('rewrites a month that isn’t one in place', async () => {
    await open('/calendar?month=2026-13');
    await until(() => url() === '/calendar?month=2026-10');
  });

  it('shows the lists chosen, in the URL, and remembers the ones left out on this device', async () => {
    await open('/calendar?month=2027-01');
    await until(() => days().length === 2);
    (page().querySelector('mat-select') as HTMLElement).click();
    await harness.fixture.whenStable();
    // Untick Work Related.
    Array.from(document.querySelectorAll<HTMLElement>('mat-option'))
      .find((option) => text(option) === 'Work Related')
      ?.click();
    await until(() => url() === `/calendar?month=2027-01&lists=${family.id}`);
    await until(() => days().join() === '2027-01-20: ≈94.16');
    expect(saved()?.calendarHiddenLists).toEqual([work.id]);
    expect(text(page().querySelector('mat-select-trigger'))).toBe('Family');

    // Remembered: a URL with no lists shows the same.
    await TestBed.inject(Router).navigateByUrl('/calendar?month=2027-01');
    await until(() => days().join() === '2027-01-20: ≈94.16');
  });

  it('opens a day’s panel, with each charge’s list, renewal and Wrong date?, and Escape puts focus back', async () => {
    await open('/calendar?month=2026-11');
    await until(() => days().length === 1);
    const day = page().querySelector<HTMLElement>('.day[data-date="2026-11-12"]');
    day?.click();
    await until(() => page().querySelector('ss-day-panel') !== null);
    await harness.fixture.whenStable();
    const panel = page().querySelector('ss-day-panel');
    expect(text(panel?.querySelector('h2'))).toBe('Thursday, November 12');
    expect(text(panel?.querySelector('h3'))).toBe('Netflix Standard');
    expect(text(panel?.querySelector('.amount [aria-hidden]'))).toBe('$19.94, with $0.95 tax');
    expect(text(panel?.querySelector('.renewal'))).toBe('Renews automatically');
    expect(panel?.querySelector('.list a')?.getAttribute('href')).toBe(`/lists/${work.id}`);
    expect(panel?.querySelector('.wrong-date')?.getAttribute('aria-label')).toBe(
      'Wrong date? Netflix Standard',
    );
    expect(document.activeElement).toBe(panel?.querySelector('h2'));

    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => page().querySelector('ss-day-panel') === null);
    await harness.fixture.whenStable();
    expect(document.activeElement).toBe(day);
  });

  it('has no Wrong date? for a charge that’s passed', async () => {
    await open();
    await until(() => days().length === 1);
    page().querySelector<HTMLElement>('.day[data-date="2026-10-12"]')?.click();
    await until(() => page().querySelector('ss-day-panel h3') !== null);
    expect(page().querySelector('ss-day-panel .wrong-date')).toBeNull();
    expect(netflix.billing.mode).toBe('recurring');
  });

  it('moves the grid’s tab stop with the arrow keys, into the next month with Page Down', async () => {
    await open();
    await until(() => days().length === 1);
    const today = page().querySelector<HTMLElement>('.day[tabindex="0"]');
    expect(today?.getAttribute('data-date')).toBe('2026-10-25');
    today?.focus();
    today?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await harness.fixture.whenStable();
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-10-18');

    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }),
    );
    await until(() => url() === '/calendar?month=2026-11');
    await until(() => document.activeElement?.getAttribute('data-date') === '2026-11-18');
  });

  it('lays the month out as an agenda by date on a phone', async () => {
    narrow = true;
    await open('/calendar?month=2027-01');
    await until(() => page().querySelectorAll('.agenda-day').length === 2);
    expect(page().querySelector('.grid')).toBeNull();
    expect(
      Array.from(page().querySelectorAll('.agenda-day h3')).map((heading) => text(heading)),
    ).toEqual(['Tuesday, January 12', 'Wednesday, January 20']);
    expect(text(page().querySelector('.agenda-day .entry .entry-name'))).toBe('Netflix Standard');
  });
});
