import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CatalogData, ListItem, Settings, SubscriptionList } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { ListDraftService } from '../../core/lists/list-draft-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { CardsRepository } from '../../core/storage/cards-repository';
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
import { ReviewChangesPage } from './review-changes-page';

// Review changes (P14, M8.6) on a fake IndexedDB, with Search's small catalog for an Albertan: Work Related has
// Netflix Standard and Crave Premium, both from Nov 12, replaced on the draft by their bundle (Netflix and Crave,
// CA$35 a month), which a later change puts on a card.

@Component({ template: '<h1>Elsewhere</h1>' })
class Elsewhere {}

describe('ReviewChangesPage', () => {
  let storage: TestStorage;
  let harness: RouterTestingHarness;
  let work: SubscriptionList;
  let netflix: ListItem;
  let crave: ListItem;

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
          { path: 'lists/:listId', component: Elsewhere },
          { path: 'lists/:listId/edit', component: Elsewhere },
          { path: 'lists/:listId/optimize', component: Elsewhere },
          { path: 'lists/:listId/optimize/review', component: ReviewChangesPage },
        ]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  const billing = {
    mode: 'recurring' as const,
    interval: 'month' as const,
    intervalCount: 1,
    anchorDate: '2026-11-12',
    autoRenew: true,
  };

  /** The list, and its draft with the bundle applied, then a card for the bundle. */
  async function plant(): Promise<void> {
    work = await TestBed.inject(ListsRepository).create({ name: 'Work Related' });
    const items = TestBed.inject(ItemsRepository);
    const fields = { listId: work.id, billing, tagIds: [], rankOverrides: {}, pinned: false };
    netflix = await items.create({
      ...fields,
      source: { kind: 'catalog', planId: 'netflix.standard' },
    });
    crave = await items.create({ ...fields, source: { kind: 'catalog', planId: 'crave.premium' } });
    const card = await TestBed.inject(CardsRepository).create({
      name: 'Cash Back Mastercard',
      type: 'credit',
      network: 'mastercard',
      currency: 'CAD',
      cashbackPercent: 2,
      fxFeePercent: 2.5,
    });
    const drafts = TestBed.inject(ListDraftService);
    await drafts.start(work.id);
    const ended = { ...billing, endDate: '2026-11-12' };
    const bundled = await drafts.applyEdits(
      work.id,
      [
        { kind: 'change', itemId: netflix.id, changes: { billing: ended } },
        { kind: 'change', itemId: crave.id, changes: { billing: ended } },
        {
          kind: 'add',
          fields: {
            source: { kind: 'bundle', bundleId: 'bundle.netflix-crave' },
            billing: { ...billing, startDate: '2026-11-12' },
            tagIds: [],
            rankOverrides: {},
            pinned: false,
          },
        },
      ],
      {
        title: 'Replace Netflix Standard and Crave Premium with Netflix and Crave',
        savings: 66.99,
        currency: 'CAD',
      },
    );
    const bundleId = bundled.applied?.[0].added[0] ?? '';
    await drafts.applyEdits(
      work.id,
      [{ kind: 'change', itemId: bundleId, changes: { cardId: card.id } }],
      { title: 'Pay Netflix and Crave with Cash Back Mastercard', savings: 8.82, currency: 'CAD' },
    );
  }

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create(`/lists/${work.id}/optimize/review`);
    await until(() => !text(page())?.includes('Loading the changes'));
  }

  const page = () => harness.routeNativeElement as HTMLElement;
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  /** Each change's heading, then its lines as the eye reads them. */
  const shown = () =>
    Array.from(page().querySelectorAll('.change h2, .lines li')).map((element) =>
      element.matches('h2')
        ? `# ${text(element)}`
        : [
            text(element.querySelector('.sign')),
            text(element.querySelector('.name')),
            text(element.querySelector('.price')),
            text(element.querySelector('.what')),
          ]
            .filter(Boolean)
            .join(' | '),
    );

  it('lists each change applied, like a diff, with what it saves and the totals before and after', async () => {
    await plant();
    await open();
    await until(() => shown().length === 6, 5000);
    expect(text(page().querySelector('h1'))).toBe('Review changes');
    expect(page().querySelector('.back')?.getAttribute('href')).toBe(`/lists/${work.id}/optimize`);
    expect(shown()).toEqual([
      '# Replace Netflix Standard and Crave Premium with Netflix and Crave',
      "− | Netflix Standard | $18.99 a month | Ends Nov 12, 2026, when what's paid for runs out",
      "− | Crave Premium | $22.00 a month | Ends Nov 12, 2026, when what's paid for runs out",
      '+ | Netflix and Crave | $35.00 a month | From Nov 12, 2026',
      '# Pay Netflix and Crave with Cash Back Mastercard',
      '~ | Netflix and Crave | $35.00 a month | Paid with Cash Back Mastercard',
    ]);
    expect(text(page().querySelector('.change .saves'))).toBe(
      'Saves $66.99 over the next 12 months',
    );
    expect(Array.from(page().querySelectorAll('.totals dt')).map(text)).toEqual([
      'This year',
      'Next 12 months',
    ]);
  }, 20000);

  it('undoes a change with the later ones that build on it, and drops a draft left with none', async () => {
    await plant();
    await open();
    await until(() => shown().length === 6, 5000);
    page().querySelector<HTMLButtonElement>('button[aria-label^="Undo: Replace"]')?.click();
    const drafts = TestBed.inject(DraftsRepository);
    await until(() => !drafts.byList().has(work.id), 5000);
    const snack = () => document.querySelector('.mat-mdc-snack-bar-container');
    await until(() => text(snack()) === 'Undone, with the change that built on it', 5000);
    await until(
      () => text(page().querySelector('ss-empty-state h2')) === 'No changes to review',
      5000,
    );
  }, 20000);

  it('undoes the last change alone, keeping the one before', async () => {
    await plant();
    await open();
    await until(() => shown().length === 6, 5000);
    page().querySelector<HTMLButtonElement>('button[aria-label^="Undo: Pay"]')?.click();
    await until(() => shown().length === 4, 5000);
    const draft = TestBed.inject(DraftsRepository).byList().get(work.id);
    expect(draft?.applied?.map((change) => change.title)).toEqual([
      'Replace Netflix Standard and Crave Premium with Netflix and Crave',
    ]);
  }, 20000);

  it('saves the list with every change and opens it', async () => {
    await plant();
    await open();
    await until(() => shown().length === 6, 5000);
    Array.from(page().querySelectorAll<HTMLButtonElement>('.actions button'))
      .find((element) => text(element) === 'Save changes')
      ?.click();
    await until(() => text(harness.routeNativeElement) === 'Elsewhere', 5000);
    const stored = (await storedRows(storage.indexedDB, 'items')) as ListItem[];
    expect(stored.find((item) => item.id === crave.id)?.billing).toMatchObject({
      endDate: '2026-11-12',
    });
    expect(stored.some((item) => item.source.kind === 'bundle')).toBe(true);
    expect(TestBed.inject(DraftsRepository).byList().has(work.id)).toBe(false);
  }, 20000);
});
