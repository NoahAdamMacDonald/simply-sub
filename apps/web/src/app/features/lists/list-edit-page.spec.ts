import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ListDraft } from '@simply-sub/core';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { searchStores } from '../../shared/sub-card/search.testing';
import { ListEditPage } from './list-edit-page';

// The placeholder editor says what Search's Add to list asked it to add (M5.4), from Search's catalog
// (search.testing.ts): Netflix Standard, and the Netflix and Crave bundle. /lists/new makes a new list's draft (M6.3).

describe('ListEditPage', () => {
  let storage: TestStorage;
  let harness: RouterTestingHarness;

  async function open(url: string): Promise<HTMLElement> {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        ...searchStores(),
        storage.providers,
        provideRouter([
          { path: 'lists/new', component: ListEditPage },
          { path: 'lists/:listId/edit', component: ListEditPage },
        ]),
        provideLocationMocks(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    harness = await RouterTestingHarness.create(url);
    return page();
  }

  const page = () => harness.routeNativeElement as HTMLElement;
  const adding = (element: HTMLElement) => element.querySelector('.adding')?.textContent?.trim();

  /** Opens /lists/new with `query`, and waits for its new list's editor. */
  async function openNew(query = ''): Promise<ListDraft> {
    await open(`/lists/new${query}`);
    const router = TestBed.inject(Router);
    await until(() => router.url.endsWith(`/edit${query}`));
    await harness.fixture.whenStable();
    const drafts = (await storedRows(storage.indexedDB, 'drafts')) as ListDraft[];
    expect(drafts).toHaveLength(1);
    return drafts[0];
  }

  it('says which plan it will add, by name, and how often it bills', async () => {
    const element = await open('/lists/list-1/edit?add=netflix.standard&interval=month');
    expect(adding(element)).toBe(
      'Netflix Standard, billed monthly, will be added here once the list editor is ready.',
    );
  });

  it('says nothing without a request, or with one that isn’t', async () => {
    expect(adding(await open('/lists/list-1/edit'))).toBeUndefined();
  });

  it('opens Search in pick mode for the list from [+ Add from catalog] (M5.5)', async () => {
    const link = (await open('/lists/list-1/edit?add=netflix.standard')).querySelector('a');

    expect(link?.textContent?.replace('add', '').trim()).toBe('Add from catalog');
    expect(link?.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(link?.getAttribute('href')).toBe('/search?addTo=list-1');
  });

  describe('/lists/new (M6.3)', () => {
    it('makes a new list’s draft, saving nothing to the lists table', async () => {
      const draft = await openNew();

      expect(draft).toEqual({
        listId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        isNew: true,
        name: 'Subscription List',
        startName: 'Subscription List',
        items: [],
        startedAt: storage.clock.time,
      });
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([]);
    });

    it('replaces its URL with the new list’s editor, which opens Search in pick mode for it', async () => {
      const draft = await openNew();
      const location = TestBed.inject(Location) as SpyLocation;

      expect(location.urlChanges).toEqual(['/lists/new', `replace: /lists/${draft.listId}/edit`]);
      expect(page().querySelector('a')?.getAttribute('href')).toBe(`/search?addTo=${draft.listId}`);
    });

    it('keeps what Search asked to add, a bundle billed every 3 months here', async () => {
      const query = '?addBundle=bundle.netflix-crave&interval=month&count=3';
      const draft = await openNew(query);

      expect(TestBed.inject(Router).url).toBe(`/lists/${draft.listId}/edit${query}`);
      expect(adding(page())).toBe(
        'Netflix and Crave, billed every 3 months, will be added here once the list editor is ready.',
      );
    });
  });
});
