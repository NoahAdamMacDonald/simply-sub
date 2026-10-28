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

  it('puts a card’s changes on the list’s draft and opens the editor, saving nothing until Save', async () => {
    await plant();
    await open(work.id);
    await until(() => button('Apply: Switch Netflix Standard') !== null);

    button('Apply: Switch Netflix Standard')?.click();
    await until(() => text(harness.routeNativeElement) === 'Elsewhere');

    const draft = TestBed.inject(DraftsRepository).byList().get(work.id);
    expect(draft?.items[0].item.billing).toEqual({
      mode: 'recurring',
      interval: 'year',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    });
    // The saved item hasn't changed.
    const [stored] = (await storedRows(storage.indexedDB, 'items')) as ListItem[];
    expect(stored.billing).toEqual(netflix.billing);
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
