import type { ComponentHarnessConstructor, HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CatalogData, ListItem, Settings, SubscriptionList, Tag } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { DraftsRepository } from '../../core/storage/drafts-repository';
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
    expect(text(card(netflix.id)?.querySelector('ss-status-badge'))).toBe('Active');
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
    expect(text(page().querySelector('.shown'))).toBe('');
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
      ['View in Search', '/search?q=Mullvad%20VPN'],
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

  it('sorts and filters from the Sort menu, and Clear all keeps the sort', async () => {
    await plant();
    await open(work.id);
    await until(() => groups().length === 4);
    const toggle = page().querySelector('.filters-toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    const loader = await openFilters();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');

    await (
      await control(loader, 'Sort by', MatSelectHarness)
    ).clickOptions({ text: 'Name, A to Z' });
    expect(groups().slice(1)).toEqual(['Crave · Premium', 'Mullvad VPN', 'Netflix · Standard']);

    await (await control(loader, 'Status', MatSelectHarness)).clickOptions({ text: 'Active only' });
    expect(groups().slice(1)).toEqual(['Mullvad VPN', 'Netflix · Standard']);
    expect(spoken(toggle)).toBe('Sort and filter, 1 on');
    expect(text(toggle?.querySelector('.badge'))).toBe('1');

    const tags = await control(loader, 'Tags', MatSelectHarness);
    await tags.open();
    expect(await Promise.all((await tags.getOptions()).map((option) => option.getText()))).toEqual([
      'Family',
    ]);
    await tags.clickOptions({ text: 'Family' });
    await tags.close();
    expect(groups().slice(1)).toEqual(['Netflix · Standard']);

    const lowest = await control(loader, 'Lowest price per month', MatInputHarness);
    await lowest.setValue('abc');
    await lowest.blur();
    expect(
      await (
        await loader.getHarness(
          MatFormFieldHarness.with({ floatingLabelText: 'Lowest price per month' }),
        )
      ).getTextErrors(),
    ).toEqual(['Enter an amount, like 9.99']);
    await lowest.setValue('20');
    expect(groups()).toEqual([]);
    expect(text(page().querySelector('.shown'))).toBe('0 of 3 shown');

    page().querySelector<HTMLElement>('ss-list-filters .clear')?.click();
    await harness.fixture.whenStable();
    expect(groups().slice(1)).toEqual(['Crave · Premium', 'Mullvad VPN', 'Netflix · Standard']);
    expect(await lowest.getValue()).toBe('');
    expect(spoken(toggle)).toBe('Sort and filter');
    expect(toggle?.querySelector('.badge')).toBeNull();
  });

  it('keeps Tags in the Sort menu with no tags in the list, turned off and saying why', async () => {
    await plant();
    await TestBed.inject(ItemsRepository).update(netflix.id, { tagIds: [] });
    await open(work.id);
    await until(() => groups().length === 4);
    const loader = await openFilters();
    const tags = await control(loader, 'Tags', MatSelectHarness);
    expect(await tags.isDisabled()).toBe(true);
    expect(
      await (
        await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Tags' }))
      ).getTextHints(),
    ).toEqual(['No subscription here has a tag yet: add them with ✎ Edit']);
    expect(await (await control(loader, 'Features', MatSelectHarness)).isDisabled()).toBe(false);
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
  });

  it('says a list that isn’t there doesn’t exist', async () => {
    await open('0192f1c4-7b2e-7c3a-9d41-000000000000');
    await until(() => page().querySelector('ss-empty-state') !== null);
    expect(text(page().querySelector('ss-empty-state h2'))).toBe("This list doesn't exist");
    expect(text(page().querySelector('h1'))).toBe('List');
  });
});
