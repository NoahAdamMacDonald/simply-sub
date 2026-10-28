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
import { CardsRepository } from '../../core/storage/cards-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import { testStorage, until, type TestStorage } from '../../core/storage/storage.testing';
import { captureDownloads, csvText } from '../../shared/export/downloads.testing';
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
        // A phone (under 600 px) when `narrow`, else a wide screen (960 px and up).
        {
          provide: BreakpointObserver,
          useValue: {
            observe: (query: string) =>
              of({ matches: query.includes('max-width') ? narrow : !narrow }),
            // The bottom sheet asks too.
            isMatched: () => narrow,
          },
        },
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
    vi.restoreAllMocks();
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

  it('flags a day that takes a card over its limit, and names the card in the day’s panel (M9.4)', async () => {
    const card = await TestBed.inject(CardsRepository).create({
      name: 'Simplii Cashback Mastercard',
      nickname: 'Everyday',
      type: 'credit',
      network: 'mastercard',
      currency: 'CAD',
      cashbackPercent: 1.5,
      fxFeePercent: 2.5,
      monthlyLimit: 15,
    });
    await TestBed.inject(ItemsRepository).update(netflix.id, { cardId: card.id });
    await open('/calendar?month=2026-11');
    await until(() => cell('2026-11-12')?.querySelector('.over-limit') !== null);
    const day = page().querySelector<HTMLElement>('.day[data-date="2026-11-12"]');
    expect(day?.getAttribute('aria-label')).toBe(
      'Thursday, November 12, 1 payment, $19.94, over a card’s limit',
    );
    day?.click();
    await until(() => page().querySelector('ss-day-panel .over-limit') !== null);
    const panel = page().querySelector('ss-day-panel');
    expect(text(panel?.querySelector('.card'))).toBe('Paid with Everyday');
    expect(text(panel?.querySelector('.over-limit > span'))).toBe(
      'Warning: Everyday goes over its $15.00 limit in November 2026: $19.94',
    );
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

  it('exports the lists shown for the next 12 months, the calendar first (M7.5)', async () => {
    const downloads = captureDownloads();
    await open(`/calendar?month=2027-01&lists=${family.id}`);
    await until(() => days().length === 1);
    const main = page().querySelector<HTMLElement>('ss-split-button .main');
    expect(main?.getAttribute('aria-label')).toBe('Export to file: Calendar (.ics)');
    main?.click();
    // Each library loads with its first file: give it time when every spec runs at once.
    await until(() => downloads.length === 1, 5000);
    expect(downloads[0].name).toBe('simply-sub-payments-2026-10-25.ics');
    const ics = await downloads[0].blob.text();
    // Family's Mullvad only: Work Related isn't shown.
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270120\r\n');

    page().querySelector<HTMLElement>('ss-split-button .more')?.click();
    await harness.fixture.whenStable();
    const choices = Array.from(
      document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel [mat-menu-item]'),
    );
    expect(choices.map((choice) => text(choice.querySelector('span')))).toEqual([
      'Calendar (.ics)',
      'Payment schedule (.csv)',
      'Excel (.xlsx)',
    ]);
    choices[1].click();
    await until(() => downloads.length === 2, 5000);
    expect(downloads[1].name).toBe('simply-sub-payments-2026-10-25.csv');
    expect((await csvText(downloads[1])).split('\r\n')[1]).toBe(
      '2027-01-20,Family,Mullvad VPN,Mullvad VPN,,94.16,0,CAD,yes,Manually,',
    );
  });

  it('syncs a calendar: the .ics downloads, then the app’s import steps', async () => {
    const downloads = captureDownloads();
    await open();
    await until(() => days().length === 1);
    page().querySelector<HTMLElement>('.sync')?.click();
    await harness.fixture.whenStable();
    const apps = Array.from(
      document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel [mat-menu-item]'),
    );
    expect(apps.map((app) => text(app))).toEqual([
      'Google Calendar',
      'Apple Calendar',
      'Proton Calendar',
    ]);
    apps[2].click();
    await until(() => document.querySelector('ss-sync-dialog') !== null, 5000);
    expect(downloads.map((download) => download.name)).toEqual([
      'simply-sub-payments-2026-10-25.ics',
    ]);
    const dialog = document.querySelector('ss-sync-dialog');
    expect(text(dialog?.querySelector('h2'))).toBe('Add your payments to Proton Calendar');
    expect(text(dialog?.querySelector('#sync-file'))).toBe(
      'Your payments for the next 12 months are in simply-sub-payments-2026-10-25.ics, in your downloads.',
    );
    // As a screen reader hears them: the link's icon is hidden.
    const steps = Array.from(dialog?.querySelectorAll('li') ?? []).map((step) => {
      const copy = step.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      return text(copy);
    });
    expect(steps).toEqual([
      'Open Proton Calendar on the web, at calendar.proton.me, opens in a new tab.',
      'Open Settings, then All settings, then Import/export.',
      'Select Import from ICS, then choose the file and the calendar to add the payments to.',
      'Select Import.',
    ]);
    // Focus starts on the heading, for the steps to be read in order.
    await until(() => document.activeElement === dialog?.querySelector('h2'));

    Array.from(dialog?.querySelectorAll<HTMLElement>('button') ?? [])
      .find((button) => text(button) === 'Download again')
      ?.click();
    await until(() => downloads.length === 2);
    // Sync calendar's dialog says it downloaded: no snackbar.
    expect(document.querySelector('.mat-mdc-snack-bar-label')).toBeNull();
  });

  it('lays the month out as a compact grid over an agenda by date on a phone (M7.8)', async () => {
    narrow = true;
    await open('/calendar?month=2027-01');
    await until(() => page().querySelectorAll('.agenda-day').length === 2);
    expect(
      Array.from(page().querySelectorAll('.agenda-day h3')).map((heading) => text(heading)),
    ).toEqual(['Tuesday, January 12', 'Wednesday, January 20']);
    expect(text(page().querySelector('.agenda-day .entry .entry-name'))).toBe('Netflix Standard');
    // Each day can be picked straight from the grid: a dot on the days with payments, no chips.
    expect(page().querySelector('.grid.compact')).not.toBeNull();
    expect(page().querySelector('.grid .chip')).toBeNull();
    expect(
      Array.from(page().querySelectorAll('.cell:has(.dot) .day')).map((day) =>
        day.getAttribute('data-date'),
      ),
    ).toEqual(['2027-01-12', '2027-01-20']);
    page().querySelector<HTMLElement>('.day[data-date="2027-01-05"]')?.click();
    await until(() => document.querySelector('ss-day-sheet') !== null, 5000);
    await until(
      () => text(document.querySelector('ss-day-sheet h2')) === 'Tuesday, January 5',
      5000,
    );
    expect(text(document.querySelector('ss-day-sheet'))).toContain('No payments on this day.');
  });

  it('keeps the grid where it is when a day opens, in a column beside it with Upcoming (M7.8)', async () => {
    await open('/calendar?month=2026-10');
    await until(() => days().length > 0);
    expect(page().querySelector('.body.wide')).not.toBeNull();
    expect(text(page().querySelector('.side .pick-day'))).toBe('Choose a day to see its payments.');
    expect(page().querySelector('.side .upcoming')).not.toBeNull();
    page().querySelector<HTMLElement>('.day[data-date="2026-10-12"]')?.click();
    await until(() => page().querySelector('.side ss-day-panel') !== null);
    expect(page().querySelector('.side .pick-day')).toBeNull();
    expect(page().querySelector('.side .upcoming')).not.toBeNull();
  });

  it('has a back button to the page it was opened from, but not from the sidebar (M7.8)', async () => {
    harness = await RouterTestingHarness.create(`/lists/${work.id}`);
    await harness.navigateByUrl('/calendar?month=2026-10');
    // Named by the list, once the lists have loaded.
    await until(() => text(page().querySelector('.back')) === 'arrow_back Work Related');
    expect(page().querySelector('.back')?.getAttribute('href')).toBe(`/lists/${work.id}`);

    const router = TestBed.inject(Router);
    await router.navigateByUrl(`/lists/${work.id}`);
    await router.navigateByUrl('/calendar', { state: { sidebar: true } });
    await harness.fixture.whenStable();
    await until(() => page().querySelector('h1') !== null);
    expect(page().querySelector('.back')).toBeNull();
  });
});
