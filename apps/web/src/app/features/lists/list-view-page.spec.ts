import type { ComponentHarnessConstructor, HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSliderHarness } from '@angular/material/slider/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  suggestionSummary,
  type CatalogData,
  type ListItem,
  type Settings,
  type SubscriptionList,
  type Tag,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { OptimizerService } from '../../core/optimizer/optimizer-service';
import { DismissedSuggestionsRepository } from '../../core/storage/dismissed-suggestions-repository';
import { DraftsRepository } from '../../core/storage/drafts-repository';
import { CardsRepository } from '../../core/storage/cards-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import { TagsRepository } from '../../core/storage/tags-repository';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { captureDownloads, csvText } from '../../shared/export/downloads.testing';
import { alberta, fx, searchCatalogData } from '../../shared/sub-card/search.testing';
import { CustomSubEditor } from '../custom-subs/custom-sub-editor';
import { ListViewPage } from './list-view-page';

// List view (P4) on a fake IndexedDB, with Search's small catalog for an Albertan, on Oct 25, 2026: Work Related has
// Netflix Standard (CA$18.99, tagged Family), Mullvad VPN (€60 a year, about CA$7.85 a month) and Crave Premium
// (CA$22, from Dec 1); the profile ranks VPN Wanted. Empty has nothing in it.

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

describe('ListViewPage', () => {
  let storage: TestStorage;
  let harness: RouterTestingHarness;
  let work: SubscriptionList;
  let family: Tag;
  let netflix: ListItem;
  let mullvad: ListItem;

  beforeEach(() => {
    storage = testStorage();
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
        { provide: CustomSubEditor, useValue: { open: async () => undefined } },
        provideRouter([
          { path: 'lists', component: Elsewhere },
          { path: 'lists/:listId', component: ListViewPage },
          { path: 'lists/:listId/edit', component: Elsewhere },
          { path: 'search', component: Elsewhere },
          { path: 'features', component: Elsewhere },
        ]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  async function plant(): Promise<void> {
    await TestBed.inject(RankingsRepository).set('vpn.included', 'wanted');
    const lists = TestBed.inject(ListsRepository);
    const items = TestBed.inject(ItemsRepository);
    work = await lists.create({ name: 'Work Related' });
    family = await TestBed.inject(TagsRepository).create({ name: 'Family', color: '#1e88e5' });
    netflix = await items.create({
      ...fields('netflix.standard'),
      listId: work.id,
      tagIds: [family.id],
    });
    mullvad = await items.create({
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
    await items.create({
      ...fields('crave.premium'),
      listId: work.id,
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-12-01',
        startDate: '2026-12-01',
        autoRenew: true,
      },
    });
  }

  async function open(listId: string): Promise<void> {
    harness = await RouterTestingHarness.create(`/lists/${listId}`);
    await until(() => !page().querySelector('.note')?.textContent?.includes('Loading'));
    await harness.fixture.whenStable();
  }

  const page = () => harness.routeNativeElement as HTMLElement;
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  /** Its text without what's hidden from screen readers: icons, and the count beside Sort. */
  const spoken = (element: Element | null | undefined) => {
    const copy = element?.cloneNode(true) as Element | undefined;
    copy?.querySelectorAll('[aria-hidden="true"], mat-icon').forEach((hidden) => hidden.remove());
    return text(copy);
  };
  /** Each group's heading, then its cards' titles. */
  const groups = () =>
    Array.from(page().querySelectorAll('.items h2, ss-item-card .name, .unresolved .title')).map(
      (element) =>
        element.matches('h2')
          ? `# ${text(element)}`
          : [text(element), text(element.parentElement?.querySelector('.plan-name'))]
              .filter(Boolean)
              .join(' · '),
    );
  const card = (itemId: string) => page().querySelector(`[data-item="${itemId}"]`);
  const button = (label: string) => page().querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const storedItems = async () => (await storedRows(storage.indexedDB, 'items')) as ListItem[];

  async function search(value: string): Promise<void> {
    const box = page().querySelector<HTMLInputElement>('.search input');
    if (!box) throw new Error('No search box');
    box.value = value;
    box.dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
  }

  async function openFilters(): Promise<HarnessLoader> {
    page().querySelector<HTMLElement>('.filters-toggle')?.click();
    await until(() => page().querySelector('ss-list-filters') !== null);
    return TestbedHarnessEnvironment.loader(harness.fixture);
  }

  async function control<T extends MatInputHarness | MatSelectHarness>(
    loader: HarnessLoader,
    label: string,
    type: ComponentHarnessConstructor<T>,
  ): Promise<T> {
    const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    const found = await field.getControl(type);
    if (!found) throw new Error(`No ${label}`);
    return found;
  }

  it('shows the list’s cards by price, with what it costs and its feature summary', async () => {
    await plant();
    await open(work.id);
    await until(() => groups().length === 4);

    expect(text(page().querySelector('h1'))).toBe('Work Related');
    expect(page().querySelector('.back')?.getAttribute('href')).toBe('/lists');
    expect(text(page().querySelector('.summary [aria-hidden]'))).toBe('≈ $48.84 / mo average');
    expect(text(page().querySelector('.summary span:last-child'))).toBe('3 subscriptions');
    // Nothing pinned: no Pinned or All, only a hidden heading over the cards.
    expect(groups()).toEqual([
      '# Subscriptions',
      'Crave · Premium',
      'Netflix · Standard',
      'Mullvad VPN',
    ]);
    expect(page().querySelector('.items h2')?.classList).toContain('visually-hidden');
    expect(text(card(netflix.id)?.querySelector('ss-tag-chip'))).toBe('Family');
    // It renews by itself, and says when (M6.12).
    expect(text(card(netflix.id)?.querySelector('ss-status-badge'))).toBe(
      'Active Auto-renews Nov 12',
    );
    expect(text(page().querySelectorAll('ss-item-card ss-status-badge')[0])).toBe(
      'Inactive · active from Dec 1, 2026',
    );
    expect(
      Array.from(page().querySelectorAll('ss-feature-summary li')).map((row) =>
        text(row.querySelector('.label')),
      ),
    ).toEqual([
      // Ranked, then what the items have themselves.
      'VPN:',
      'Ad free:',
      'Video quality: 1080p (Full HD):',
      'Video quality: 4K (Ultra HD):',
    ]);
    expect(
      Array.from(page().querySelectorAll('ss-type-counts li')).map(
        (row) =>
          `${text(row.querySelector('.label'))} ${text(row.querySelector('span:last-child'))}`,
      ),
    ).toEqual(['Streaming video: 2', 'VPN: 1']);
    expect(page().querySelector('.edit-list')?.getAttribute('href')).toBe(`/lists/${work.id}/edit`);
    // At the top too.
    expect(page().querySelector('.edit-list-top')?.getAttribute('href')).toBe(
      `/lists/${work.id}/edit`,
    );
    expect(text(page().querySelector('.shown'))).toBe('');
  });

  it('shows the net beside the gross, with tax, once an item is paid with a card (M9.4)', async () => {
    await plant();
    await open(work.id);
    expect(page().querySelector('.net-summary')).toBeNull();
    const card = await TestBed.inject(CardsRepository).create({
      name: 'Simplii Cashback Mastercard',
      nickname: 'Everyday',
      type: 'credit',
      network: 'mastercard',
      currency: 'CAD',
      cashbackPercent: 1.5,
      fxFeePercent: 2.5,
    });
    await TestBed.inject(ItemsRepository).update(netflix.id, { cardId: card.id });
    // A month with Alberta's 5%: Netflix $19.94 with 1.5% back, Mullvad ≈ $7.85 and Crave $23.10 with no card.
    await until(() => page().querySelector('.net-summary') !== null);
    expect(text(page().querySelector('.net-summary [aria-hidden="true"]'))).toBe(
      '≈ $50.89 / mo with tax · ≈ $50.59 after cash back & FX fees',
    );
    expect(text(page().querySelector('.net-summary .visually-hidden'))).toBe(
      'about $50.89 a month with tax, about $50.59 after cash back and FX fees',
    );
    const netflixCard = page().querySelector(`[data-item="${netflix.id}"] .on-card`);
    expect(spoken(netflixCard)).toBe(
      'Paid with Everyday: $19.94 a month with tax, $19.64 after cash back and FX fees',
    );
    expect(page().querySelectorAll('.on-card')).toHaveLength(1);
  });

  it('shows this month and this year, and each card’s share of the next 12 months (M7.2)', async () => {
    await plant();
    await open(work.id);
    await until(() => groups().length === 4);
    // Today is Oct 25. Netflix's $18.99 with Alberta's 5% on the 12th of each month; Mullvad's €60 on Jan 20, which
    // includes tax; Crave's $22 from Dec 1.
    expect(
      Array.from(page().querySelectorAll('.money .total [aria-hidden]')).map((total) =>
        text(total),
      ),
    ).toEqual(['$19.94 this month', '≈ $356.54 in 2026']);
    // No budgets: no bars, and no prompt off Home.
    expect(page().querySelector('.money ss-budget-bar')).toBeNull();
    expect(page().querySelector('.money a.prompt')).toBeNull();
    const share = (itemId: string) => text(card(itemId)?.querySelector('.share'));
    expect(share(netflix.id)).toBe('41% of list over the next 12 months');
    expect(share(mullvad.id)).toBe('16% of list over the next 12 months');
  });

  it('opens a card’s details, with how it’s billed, its links and Edit for the item', async () => {
    await plant();
    await open(work.id);
    await until(() => button('Details: Mullvad VPN') !== null);
    button('Details: Mullvad VPN')?.click();
    await until(() => card(mullvad.id)?.querySelector('.facts') !== null);

    const details = card(mullvad.id);
    expect(
      Array.from(details?.querySelectorAll('.facts li') ?? []).map((fact) => text(fact)),
    ).toEqual(['Yearly · renews manually']);
    expect(details?.querySelector('ss-feature-list')).not.toBeNull();
    expect(
      Array.from(details?.querySelectorAll('.actions a') ?? []).map((link) => [
        spoken(link),
        link.getAttribute('href'),
      ]),
    ).toEqual([
      ['Plan Mullvad VPN, opens in a new tab', 'https://example.com/mullvad.vpn'],
      ['Cancel Mullvad VPN, opens in a new tab', 'https://mullvad.net/cancel'],
      ['View in Search', '/search?q=Mullvad%20VPN&plan=mullvad.vpn'],
      ['Edit', `/lists/${work.id}/edit?item=${mullvad.id}`],
    ]);
    expect(button('Details: Mullvad VPN')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('pins straight to the item, with no draft, and moves its card to Pinned with focus on 📌', async () => {
    await plant();
    await open(work.id);
    await until(() => button('Pin Mullvad VPN') !== null);
    expect(button('Pin Mullvad VPN')?.getAttribute('aria-pressed')).toBe('false');
    button('Pin Mullvad VPN')?.focus();
    button('Pin Mullvad VPN')?.click();

    await until(() => groups()[0] === '# Pinned');
    expect(groups()).toEqual([
      '# Pinned',
      'Mullvad VPN',
      '# All',
      'Crave · Premium',
      'Netflix · Standard',
    ]);
    expect(button('Pin Mullvad VPN')?.getAttribute('aria-pressed')).toBe('true');
    await until(() => document.activeElement === button('Pin Mullvad VPN'));
    expect((await storedItems()).find((item) => item.id === mullvad.id)?.pinned).toBe(true);
    expect(await storedRows(storage.indexedDB, 'drafts')).toEqual([]);

    button('Pin Mullvad VPN')?.click();
    await until(() => groups()[0] === '# Subscriptions');
    expect((await storedItems()).find((item) => item.id === mullvad.id)?.pinned).toBe(false);
  });

  it('finds a card by its name, plan, tag or feature, and says how many are shown', async () => {
    await plant();
    await open(work.id);
    await until(() => groups().length === 4);

    await search('fam');
    expect(groups()).toEqual(['# Subscriptions', 'Netflix · Standard']);
    expect(text(page().querySelector('.shown'))).toBe('1 of 3 shown');
    await search('4k');
    expect(groups()).toEqual(['# Subscriptions', 'Crave · Premium']);
    await search('zzz');
    expect(groups()).toEqual([]);
    expect(text(page().querySelector('.no-match p'))).toBe('No subscriptions match.');

    button('Clear search')?.click();
    await harness.fixture.whenStable();
    expect(groups()).toHaveLength(4);
    expect(document.activeElement).toBe(page().querySelector('.search input'));
  });

  it('sorts and filters from the Sort menu, with Search’s controls, and Clear all keeps the sort', async () => {
    await plant();
    await open(work.id);
    await until(() => groups().length === 4);
    const toggle = page().querySelector('.filters-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    const loader = await openFilters();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const filters = () => page().querySelector('ss-list-filters') as HTMLElement;
    const boxes = (selector: string) => [
      ...filters().querySelectorAll<HTMLInputElement>(`${selector} input[type=checkbox]`),
    ];
    const settle = () => harness.fixture.whenStable();

    await (
      await control(loader, 'Sort by', MatSelectHarness)
    ).clickOptions({ text: 'Name, A to Z' });
    expect(groups().slice(1)).toEqual(['Crave · Premium', 'Mullvad VPN', 'Netflix · Standard']);

    // Status: chips, as Search's Activity.
    expect(text(filters().querySelector('.status legend'))).toBe('Status');
    expect(boxes('.status').map((box) => spoken(box.closest('label')))).toEqual([
      'Active',
      'Inactive',
    ]);
    boxes('.status')[0].click();
    await settle();
    expect(groups().slice(1)).toEqual(['Mullvad VPN', 'Netflix · Standard']);
    expect(spoken(toggle)).toBe('Sort and filter, 1 on');
    expect(text(toggle?.querySelector('.badge'))).toBe('1');

    // Tags: chips with their colours.
    expect(boxes('.tags').map((box) => spoken(box.closest('label')))).toEqual(['Family']);
    boxes('.tags')[0].click();
    await settle();
    expect(groups().slice(1)).toEqual(['Netflix · Standard']);

    // Features: Search's box.
    expect(
      await (
        await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Features' }))
      ).getTextHints(),
    ).toEqual(['Subscriptions need every feature chosen']);

    // The price: Search's slider, up to Crave's CA$22 a month, by 1.
    const slider = await loader.getHarness(MatSliderHarness);
    expect([await slider.getMaxValue(), await slider.getStep()]).toEqual([25, 1]);
    await (await slider.getStartThumb()).setValue(20);
    await settle();
    expect(groups()).toEqual([]);
    expect(text(page().querySelector('.shown'))).toBe('0 of 3 shown');
    expect(spoken(toggle)).toBe('Sort and filter, 3 on');

    filters().querySelector<HTMLElement>('.clear')?.click();
    await settle();
    expect(groups().slice(1)).toEqual(['Crave · Premium', 'Mullvad VPN', 'Netflix · Standard']);
    expect(await (await slider.getStartThumb()).getValue()).toBe(0);
    expect(boxes('.status').some((box) => box.checked)).toBe(false);
    expect(spoken(toggle)).toBe('Sort and filter');
    expect(toggle?.querySelector('.badge')).toBeNull();
  });

  it('keeps Tags in the Sort menu with no tags in the list, saying how to add them', async () => {
    await plant();
    await TestBed.inject(ItemsRepository).update(netflix.id, { tagIds: [] });
    await open(work.id);
    await until(() => groups().length === 4);
    await openFilters();
    const tags = page().querySelector('ss-list-filters .tags');
    expect(text(tags?.querySelector('.label'))).toBe('Tags');
    expect(text(tags?.querySelector('.hint'))).toBe(
      'No subscription here has a tag yet: add them with ✎ Edit',
    );
    expect(tags?.querySelector('input')).toBeNull();
  });

  it('turns Features off in the Sort menu when nothing in the list has one, saying so', async () => {
    const old = await TestBed.inject(ListsRepository).create({ name: 'Old' });
    await TestBed.inject(ItemsRepository).create({ ...fields('netflix.gone'), listId: old.id });
    await open(old.id);
    await until(() => groups().length === 2);
    await openFilters();
    const features = page().querySelector('ss-list-filters ss-feature-filter');
    expect(features?.querySelector('input')?.disabled).toBe(true);
    expect(text(features?.querySelector('mat-hint'))).toBe(
      'None of these has a feature to filter by',
    );
  });

  it('finds a card by its nickname, which it shows over the plan', async () => {
    await plant();
    await TestBed.inject(ItemsRepository).update(mullvad.id, { nickname: 'Work laptop' });
    await open(work.id);
    await until(() => groups().includes('Work laptop · Mullvad VPN'));
    await search('laptop');
    expect(groups()).toEqual(['# Subscriptions', 'Work laptop · Mullvad VPN']);
  });

  it('lists an item it can’t price, with why and Edit', async () => {
    await plant();
    const gone = await TestBed.inject(ItemsRepository).create({
      ...fields('netflix.gone'),
      listId: work.id,
    });
    await open(work.id);
    await until(() => card(gone.id) !== null);

    expect(text(card(gone.id)?.querySelector('.note'))).toBe(
      'This plan is no longer in the catalog',
    );
    expect(button('Edit netflix.gone')?.getAttribute('href')).toBe(
      `/lists/${work.id}/edit?item=${gone.id}`,
    );
    expect(text(page().querySelector('.summary [aria-hidden]'))).toBe(
      '≈ $48.84 / mo average (1 not counted)',
    );
    // Text it can't match hides it.
    await search('netflix');
    expect(card(gone.id)).toBeNull();
  });

  it('says when the list has changes in the editor that aren’t saved', async () => {
    await plant();
    const drafts = TestBed.inject(DraftsRepository);
    await drafts.start(work.id);
    await open(work.id);
    await until(() => groups().length === 4);
    // A draft with no changes, left by opening the editor, isn't one.
    expect(page().querySelector('.unsaved')).toBeNull();
    await drafts.change(work.id, (draft) => ({ ...draft, name: 'Work' }));
    await until(() => page().querySelector('.unsaved') !== null);
    expect(text(page().querySelector('.unsaved'))).toBe(
      "This list has changes you haven't saved. Go back to editing",
    );
    expect(page().querySelector('.unsaved a')?.getAttribute('href')).toBe(`/lists/${work.id}/edit`);
  });

  it('exports the list from Export, in each format, and says what it saved (M7.5)', async () => {
    const downloads = captureDownloads();
    await plant();
    await open(work.id);
    await until(() => groups().length === 4);
    page().querySelector<HTMLElement>('.export')?.click();
    await harness.fixture.whenStable();
    const choices = Array.from(
      document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel [mat-menu-item]'),
    );
    expect(choices.map(spoken)).toEqual([
      'CSV (.csv)',
      'Excel (.xlsx)',
      'JSON (.json)',
      'Text (.txt)',
      'Calendar (.ics)',
    ]);

    choices[0].click();
    // papaparse loads with the first CSV: give it time when every spec runs at once.
    await until(() => downloads.length === 1, 5000);
    expect(downloads[0].name).toBe('simply-sub-work-related-2026-10-25.csv');
    // Only this list's items, in the order they were added.
    const rows = (await csvText(downloads[0])).split('\r\n');
    expect(rows.map((row) => row.split(',').slice(0, 3).join(' · '))).toEqual([
      'List · Service · Plan',
      'Work Related · Netflix · Standard',
      'Work Related · Mullvad VPN · Mullvad VPN',
      'Work Related · Crave · Premium',
    ]);
    await until(
      () =>
        document.querySelector('.mat-mdc-snack-bar-label')?.textContent?.trim() ===
        'Saved simply-sub-work-related-2026-10-25.csv',
    );
  });

  it('warns when the list alone goes over the monthly budget, with its month in the Calendar (M7.6)', async () => {
    const saved = TestBed.inject(SettingsStore).saved as WritableSignal<Settings | undefined>;
    saved.set({ ...alberta, monthlyBudget: 50 });
    await plant();
    await open(work.id);
    await until(() => page().querySelector('ss-budget-warnings .warning') !== null);
    const warning = page().querySelector('ss-budget-warnings .warning');
    // January: Netflix, Crave (from Dec 1) and Mullvad's ≈ $94.16.
    expect(text(warning?.querySelector('.text [aria-hidden="true"]'))).toBe(
      'This list’s payments in January 2027 add up to ≈ $137.20, over your $50.00 monthly budget.',
    );
    expect(warning?.querySelector('a')?.getAttribute('href')).toBe(
      `/calendar?month=2027-01&lists=${work.id}`,
    );
  });

  it('links to its optimizations, with how many and coloured by the strongest, which a dismissal changes (M8.2)', async () => {
    await plant();
    await open(work.id);
    const link = () => page().querySelector('ss-optimizations-link a');
    await until(() => link()?.textContent?.includes('suggestions') === true);

    expect(link()?.getAttribute('href')).toBe(`/lists/${work.id}/optimize`);
    // Under 960 px it's compact, in the pinned bar with the search box (M6.13): the icon and the count, named by its
    // words, the strongest's section with them, which the colour shows.
    expect(page().querySelector('.toolbar ss-optimizations-link a.compact')).toBe(link());
    expect(text(link()?.querySelector('.visually-hidden'))).toBe('View optimizations:');
    expect(spoken(link())).toBe('View optimizations: 4 suggestions, the strongest: Recommended');
    expect(link()?.hasAttribute('aria-label')).toBe(false);
    expect(link()?.getAttribute('data-strongest')).toBe('red');

    // With the red ones dismissed, the next strongest colours it.
    const optimizer = TestBed.inject(OptimizerService);
    const input = optimizer.input(work.id);
    if (!input) throw new Error('No input');
    const { suggestions } = await optimizer.run(input);
    const red = suggestions.filter((suggestion) => suggestion.severity === 'red');
    for (const suggestion of red) {
      await TestBed.inject(DismissedSuggestionsRepository).dismiss(suggestion.fingerprint, work.id);
    }
    const next = suggestionSummary(suggestions, new Set(red.map((card) => card.fingerprint)));
    await until(() => link()?.getAttribute('data-strongest') === next.strongest);
    expect(link()?.textContent).toContain(
      `${next.count} ${next.count === 1 ? 'suggestion' : 'suggestions'},`,
    );
  });

  it('offers to add from the catalog or a custom subscription to an empty list', async () => {
    const empty = await TestBed.inject(ListsRepository).create({ name: 'Empty' });
    await open(empty.id);
    await until(() => page().querySelector('ss-empty-state') !== null);

    expect(text(page().querySelector('ss-empty-state h2'))).toBe('No subscriptions yet');
    expect(text(page().querySelector('.summary'))).toBe('0 subscriptions');
    const links = Array.from(page().querySelectorAll('ss-empty-state a'));
    expect(links.map((link) => [spoken(link), link.getAttribute('href')])).toEqual([
      ['Add from catalog', `/search?addTo=${empty.id}`],
    ]);
    expect(spoken(page().querySelector('ss-empty-state button'))).toBe('Add custom subscription');
    expect(page().querySelector('.features')).toBeNull();
    expect(page().querySelector('.search')).toBeNull();
    // Nothing to export.
    expect(page().querySelector('.export')).toBeNull();
  });

  it('says a list that isn’t there doesn’t exist', async () => {
    await open('0192f1c4-7b2e-7c3a-9d41-000000000000');
    await until(() => page().querySelector('ss-empty-state') !== null);
    expect(text(page().querySelector('ss-empty-state h2'))).toBe("This list doesn't exist");
    expect(text(page().querySelector('h1'))).toBe('List');
    expect(page().querySelector('.edit-list-top')).toBeNull();
    expect(page().querySelector('.back')?.getAttribute('href')).toBe('/lists');
  });
});
