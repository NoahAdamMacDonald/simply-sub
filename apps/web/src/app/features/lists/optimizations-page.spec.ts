import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CatalogData, ListItem, Settings, SubscriptionList } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { DraftsRepository } from '../../core/storage/drafts-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { alberta, fx, searchCatalogData } from '../../shared/sub-card/search.testing';
import { OptimizationsPage } from './optimizations-page';

// Optimizations (P14) on a fake IndexedDB, with Search's small catalog for an Albertan, on Oct 25, 2026: Work Related
// has Netflix Standard, CA$18.99 a month from Nov 12 (CA$189.99 a year, or CA$7.99 a month with ads).

@Component({ template: '<h1>Elsewhere</h1>' })
class Elsewhere {}

describe('OptimizationsPage', () => {
  let storage: TestStorage;
  let harness: RouterTestingHarness;
  let work: SubscriptionList;
  let netflix: ListItem;

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
        provideRouter([
          { path: 'lists', component: Elsewhere },
          { path: 'lists/:listId', component: Elsewhere },
          { path: 'lists/:listId/optimize', component: OptimizationsPage },
          { path: 'lists/:listId/edit', component: Elsewhere },
          { path: 'lists/:listId/optimize/review', component: Elsewhere },
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
    work = await TestBed.inject(ListsRepository).create({ name: 'Work Related' });
    netflix = await TestBed.inject(ItemsRepository).create({
      listId: work.id,
      source: { kind: 'catalog', planId: 'netflix.standard' },
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
    });
  }

  async function open(listId: string): Promise<void> {
    harness = await RouterTestingHarness.create(`/lists/${listId}/optimize`);
    await until(() => !text(page())?.includes('Loading the list'));
  }

  const page = () => harness.routeNativeElement as HTMLElement;
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  /** Each section's heading, then its cards' changes and savings. */
  const shown = () =>
    Array.from(page().querySelectorAll('.section h2, ss-suggestion-card')).map((element) =>
      element.matches('h2')
        ? `# ${text(element)}`
        : `${text(element.querySelector('.title'))} | ${text(element.querySelector('.savings'))}`,
    );
  const button = (label: string) =>
    page().querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`);

  it('lists the cards by section, with what each saves and loses, Save up to, and the back button by the list’s name', async () => {
    await plant();
    await open(work.id);
    await until(() => shown().length === 4);

    expect(text(page().querySelector('h1'))).toBe('Optimizations');
    expect(text(page().querySelector('.back'))).toBe('arrow_back Work Related');
    expect(page().querySelector('.back')?.getAttribute('href')).toBe(`/lists/${work.id}`);
    // 12 × $18.99 against $189.99 a year, with 5% GST; and $7.99 a month with ads.
    expect(shown()).toEqual([
      '# Free savings — nothing is lost',
      'Switch Netflix Standard to annual billing | Save $39.78 over the next 12 months',
      '# Recommended — only removes features you marked Unwanted or didn’t rank',
      'Downgrade Netflix Standard → Standard with ads | Save $138.60 over the next 12 months',
    ]);
    expect(text(page().querySelector('.save-up-to'))).toBe('Save up to $138.60 a year');
    expect(text(page().querySelector('ss-suggestion-card[data-severity="red"] .features'))).toBe(
      'You lose: Ad free (Not ranked)',
    );
    expect(button('How suggestions are chosen')?.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('puts a card’s changes on the list’s draft and stays, for the next, saving nothing until Save (M8.4)', async () => {
    await plant();
    // Crave Premium too, whose downgrade has nothing to do with Netflix's.
    const crave = await TestBed.inject(ItemsRepository).create({
      ...netflix,
      source: { kind: 'catalog', planId: 'crave.premium' },
    });
    await open(work.id);
    await until(() => button('Apply: Downgrade Crave Premium') !== null, 5000);
    const drafts = TestBed.inject(DraftsRepository);
    const planOf = (id: string) => {
      const source = drafts
        .byList()
        .get(work.id)
        ?.items.find((entry) => entry.item.id === id)?.item.source;
      return source?.kind === 'catalog' ? source.planId : undefined;
    };

    button('Apply: Downgrade Crave Premium')?.click();
    await until(() => planOf(crave.id) === 'crave.basic', 5000);
    // The suggestions come again for the draft: Crave's downgrade is in it, so its card is gone.
    await until(() => !shown().some((card) => card.startsWith('Downgrade Crave Premium')), 5000);
    // The saved item hasn't changed.
    const stored = (await storedRows(storage.indexedDB, 'items')) as ListItem[];
    expect(stored.find((item) => item.id === crave.id)?.source).toEqual(crave.source);
    const review = () => page().querySelector<HTMLAnchorElement>('.unsaved a.review');
    await until(() => review() !== null, 5000);
    expect(text(page().querySelector('.unsaved p'))).toBe(
      '1 change is applied but not saved, and the suggestions count it. Apply more, then review them before you save.',
    );
    expect(review()?.getAttribute('href')).toBe(`/lists/${work.id}/optimize/review`);
    const snack = () => document.querySelector('.mat-mdc-snack-bar-container');
    await until(() => text(snack())?.startsWith('Applied: Downgrade Crave Premium') === true, 5000);
    // Focus is on a card that's left.
    await until(() => document.activeElement?.classList.contains('title') === true, 5000);

    // Netflix's downgrade, applied next, joins it on the draft.
    await until(
      () => button('Apply: Downgrade Netflix Standard → Standard with ads') !== null,
      5000,
    );
    button('Apply: Downgrade Netflix Standard → Standard with ads')?.click();
    await until(() => planOf(netflix.id) === 'netflix.standard-ads', 5000);
    expect(planOf(crave.id)).toBe('crave.basic');

    // Undo takes back the last one, and the one before stays (M8.6).
    await until(
      () => text(snack())?.startsWith('Applied: Downgrade Netflix Standard') === true,
      5000,
    );
    Array.from(snack()?.querySelectorAll('button') ?? [])
      .find((element) => text(element) === 'Undo')
      ?.click();
    await until(() => planOf(netflix.id) === 'netflix.standard', 5000);
    expect(planOf(crave.id)).toBe('crave.basic');

    review()?.click();
    await until(() => text(harness.routeNativeElement) === 'Elsewhere', 5000);
  }, 20000);

  it('drops the draft it made when the first Apply is undone (M8.4)', async () => {
    await plant();
    await open(work.id);
    await until(() => button('Apply: Switch Netflix Standard') !== null, 5000);
    button('Apply: Switch Netflix Standard')?.click();
    const snack = () => document.querySelector('.mat-mdc-snack-bar-container');
    await until(() => text(snack())?.startsWith('Applied:') === true, 5000);
    Array.from(snack()?.querySelectorAll('button') ?? [])
      .find((element) => text(element) === 'Undo')
      ?.click();
    const drafts = TestBed.inject(DraftsRepository);
    await until(() => !drafts.byList().has(work.id), 5000);
    await until(() => shown().length === 4, 5000);
    expect(page().querySelector('.unsaved')).toBeNull();
  });

  it('closes Applied’s snackbar when the page is left, its Undo being for this page (M8.6)', async () => {
    await plant();
    await open(work.id);
    await until(() => button('Apply: Switch Netflix Standard') !== null, 5000);
    button('Apply: Switch Netflix Standard')?.click();
    const snack = () => document.querySelector('.mat-mdc-snack-bar-container');
    await until(() => text(snack())?.startsWith('Applied:') === true, 5000);
    await harness.navigateByUrl(`/lists/${work.id}/optimize/review`);
    await until(() => snack() === null, 5000);
    // The draft stays, for Review changes.
    expect(TestBed.inject(DraftsRepository).byList().has(work.id)).toBe(true);
  });

  it('hides a dismissed card until the list changes, and Show dismissed brings it back', async () => {
    await plant();
    await open(work.id);
    await until(() => shown().length === 4);

    button('Dismiss: Switch Netflix Standard')?.click();
    await until(() => shown().length === 2);
    expect(shown()[0]).toBe(
      '# Recommended — only removes features you marked Unwanted or didn’t rank',
    );
    // Focus moves to the card that's left.
    await until(() => document.activeElement?.classList.contains('title') === true);
    expect(text(document.activeElement)).toBe('Downgrade Netflix Standard → Standard with ads');

    const show = page().querySelector<HTMLInputElement>('.show-dismissed input');
    expect(text(page().querySelector('.show-dismissed'))).toBe('Show dismissed (1)');
    show?.click();
    await until(() => shown().length === 4);
    expect(button('Show again: Switch Netflix Standard')).not.toBeNull();
    show?.click();
    await until(() => shown().length === 2);

    // A change to the list gives its suggestions new fingerprints: the dismissed one comes back.
    await TestBed.inject(ItemsRepository).update(netflix.id, {
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-13',
        autoRenew: true,
      },
    });
    await until(() => shown().length === 4);
    expect(page().querySelector('.show-dismissed')).toBeNull();
  });

  it('says a list that isn’t there doesn’t exist', async () => {
    await plant();
    await open('0192f1c4-7b2e-7c3a-9d41-000000000000');
    expect(text(page().querySelector('ss-empty-state h2'))).toBe("This list doesn't exist");
  });
});
