import { Component, signal } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  CatalogData,
  ListDraft,
  ListItem,
  Settings,
  SubscriptionList,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { leaveGuard } from '../../core/leave-guard';
import { SettingsStore } from '../../core/settings/settings-store';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import { DraftsRepository } from '../../core/storage/drafts-repository';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService, type ConfirmOptions } from '../../shared/confirm/confirm-service';
import { alberta, fx, searchCatalogData } from '../../shared/sub-card/search.testing';
import { ListEditPage } from './list-edit-page';

// The list editor (P5) on a real draft in a fake IndexedDB, with Search's small catalog (search.testing.ts) for an
// Albertan: Netflix Standard at $18.99 a month, and Mullvad VPN at €60 a year, about $94.16. ConfirmService answers
// as each test says.

/** The pages the editor goes to. */
@Component({ template: '<h1>Elsewhere</h1>' })
class Elsewhere {}

const unknownId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';

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

describe('ListEditPage', () => {
  let storage: TestStorage;
  let harness: RouterTestingHarness;
  let location: SpyLocation;
  let answer: boolean;
  let questions: ConfirmOptions[];
  let work: SubscriptionList;
  let netflix: ListItem;
  let mullvad: ListItem;

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
          { path: 'lists', component: Elsewhere },
          { path: 'lists/new', component: ListEditPage, canDeactivate: [leaveGuard] },
          { path: 'lists/:listId', component: Elsewhere },
          { path: 'lists/:listId/edit', component: ListEditPage, canDeactivate: [leaveGuard] },
          { path: 'search', component: Elsewhere },
        ]),
        provideLocationMocks(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    location = TestBed.inject(Location) as SpyLocation;
    const family = await TestBed.inject(TagsRepository).create({
      name: 'Family',
      color: '#1e88e5',
    });
    work = await TestBed.inject(ListsRepository).create({ name: 'Work Related' });
    const items = TestBed.inject(ItemsRepository);
    netflix = await items.create({
      ...fields('netflix.standard'),
      listId: work.id,
      tagIds: [family.id],
      rankOverrides: { 'streaming.ad-free': 'essential' },
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
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  async function open(url: string): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await until(() => page().querySelector('.footer, ss-empty-state') !== null);
    await harness.fixture.whenStable();
  }

  const page = () => harness.routeNativeElement as HTMLElement;
  const text = (selector: string) =>
    page().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
  const rows = () =>
    Array.from(page().querySelectorAll('li.item')).map((row) => ({
      title: row.querySelector('.title')?.textContent?.replace(/\s+/g, ' ').trim(),
      details: row.querySelector('.details')?.textContent?.trim(),
      tags: Array.from(row.querySelectorAll('ss-tag-chip')).map((tag) => tag.textContent?.trim()),
      price: row.querySelector('ss-price')?.textContent?.replace(/\s+/g, ' ').trim(),
      problem: row.querySelector('.problem')?.textContent?.trim(),
    }));
  const footer = () => page().querySelector('.footer [aria-hidden]')?.textContent?.trim();
  const nameInput = () => page().querySelector<HTMLInputElement>('.toolbar input')!;
  /** A button or link by its aria-label, or its text without its icon. */
  const button = (name: string) =>
    Array.from(page().querySelectorAll<HTMLElement>('button, a')).find((candidate) => {
      const copy = candidate.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('mat-icon').forEach((icon) => icon.remove());
      return (
        copy.textContent?.replace(/\s+/g, ' ').trim() === name ||
        candidate.getAttribute('aria-label') === name
      );
    });
  const drafts = async () => (await storedRows(storage.indexedDB, 'drafts')) as ListDraft[];
  const storedItems = async () => (await storedRows(storage.indexedDB, 'items')) as ListItem[];
  const storedList = async () =>
    ((await storedRows(storage.indexedDB, 'lists')) as SubscriptionList[]).find(
      (list) => list.id === work.id,
    );
  const editor = () => `/lists/${work.id}/edit`;

  async function type(value: string): Promise<void> {
    nameInput().value = value;
    nameInput().dispatchEvent(new Event('input'));
    await harness.fixture.whenStable();
  }

  async function click(name: string): Promise<void> {
    const target = button(name);
    if (!target) throw new Error(`No ${name}`);
    target.click();
    await harness.fixture.whenStable();
  }

  async function storedName(name: string): Promise<void> {
    await vi.waitFor(async () => expect((await drafts())[0]?.name).toBe(name));
  }

  describe('an existing list', () => {
    it('copies the list into a draft, and shows its name, its items and what it costs a month', async () => {
      await open(editor());

      expect(text('h1')).toBe('Edit list');
      expect(nameInput().value).toBe('Work Related');
      expect(rows()).toEqual([
        {
          title: 'Netflix · Standard',
          details: 'Monthly · auto-renews · 1 custom rank',
          tags: ['Family'],
          price: expect.stringMatching(/^\$18\.99 \/ mo a month \+ tax$/),
          problem: undefined,
        },
        {
          title: 'Mullvad VPN',
          details: 'Yearly · renews manually',
          tags: [],
          price: expect.stringContaining('$94.16 / year'),
          problem: undefined,
        },
      ]);
      // €60 a year is about $7.85 a month.
      expect(footer()).toBe('No unsaved changes · ≈ $26.84 / mo average');
      expect(text('.footer .visually-hidden')).toBe(
        'No unsaved changes, about $26.84 a month on average',
      );
      expect((await drafts()).map((draft) => draft.listId)).toEqual([work.id]);
      expect(page().querySelector('[role=status]')).toBeNull();
    });

    it('keeps a new name in the draft as it’s typed, and says there are unsaved changes', async () => {
      await open(editor());
      await type('Work');

      await storedName('Work');
      await until(() => footer()?.startsWith('Unsaved changes ·') === true);
      expect((await storedList())?.name).toBe('Work Related');
    });

    it('won’t save a list without a name, and says so at the field', async () => {
      await open(editor());
      await type('   ');
      await click('Save');

      await until(() => text('mat-error') === 'Give the list a name');
      expect(document.activeElement).toBe(nameInput());
      expect(location.path()).toBe(editor());
      expect((await drafts())[0].name).toBe('Work Related');
    });

    it('saves the list and its items at once, then opens the list in place of the editor', async () => {
      await open(editor());
      await type('Work');
      await click('Remove Mullvad VPN');
      storage.clock.time = '2026-10-27T09:00:00.000Z';
      await click('Save');

      await until(() => location.path() === `/lists/${work.id}`);
      expect(location.urlChanges.at(-1)).toBe(`replace: /lists/${work.id}`);
      const now = '2026-10-27T09:00:00.000Z';
      expect(await storedList()).toEqual({ ...work, name: 'Work', updatedAt: now });
      expect((await storedItems()).find((item) => item.id === mullvad.id)?.deletedAt).toBe(now);
      expect((await storedItems()).find((item) => item.id === netflix.id)).toEqual(netflix);
      expect(await drafts()).toEqual([]);
    });

    it('removes an item with Undo, moving focus to the next row and back', async () => {
      await open(editor());
      await click('Remove Netflix Standard');

      await until(() => rows().length === 1);
      await until(() => document.activeElement === button('Remove Mullvad VPN'));
      const snackBar = document.querySelector('.mat-mdc-snack-bar-container');
      expect(snackBar?.textContent).toContain('Removed Netflix Standard');
      await until(() => footer()?.startsWith('Unsaved changes') === true);

      snackBar?.querySelector('button')?.click();
      await until(() => rows().length === 2);
      await until(() => document.activeElement === button('Remove Netflix Standard'));
      await until(() => footer()?.startsWith('No unsaved changes') === true);
    });

    it('goes back to the list on Cancel without asking when nothing changed', async () => {
      await open(editor());
      await click('Cancel');

      await until(() => location.path() === `/lists/${work.id}`);
      expect(questions).toEqual([]);
      expect(await drafts()).toEqual([]);
    });

    it('asks before Cancel discards changes, and keeps them when told to', async () => {
      await open(editor());
      await type('Work');
      await storedName('Work');

      answer = false;
      await click('Cancel');
      await vi.waitFor(() => expect(questions).toHaveLength(1));
      expect(questions[0]).toMatchObject({ title: 'Discard changes?', danger: true });
      expect(location.path()).toBe(editor());
      expect(await drafts()).toHaveLength(1);

      answer = true;
      await click('Cancel');
      await until(() => location.path() === `/lists/${work.id}`);
      expect(await drafts()).toEqual([]);
      expect(await storedList()).toEqual(work);
    });

    it('keeps the draft for Search in pick mode, and resumes it', async () => {
      await open(editor());
      await type('Work');
      await storedName('Work');
      await click('Add from catalog');

      await until(() => location.path() === `/search?addTo=${work.id}`);
      expect(questions).toEqual([]);

      await harness.navigateByUrl(editor());
      await until(() => text('[role=status]') === 'Resumed unsaved changes');
      expect(nameInput().value).toBe('Work');
    });

    it('asks before leaving anywhere else with changes', async () => {
      await open(editor());
      await type('Work');
      await storedName('Work');

      answer = false;
      expect(await TestBed.inject(Router).navigateByUrl('/lists')).toBe(false);
      expect(questions).toHaveLength(1);
      expect(await drafts()).toHaveLength(1);

      answer = true;
      expect(await TestBed.inject(Router).navigateByUrl('/lists')).toBe(true);
      expect(await drafts()).toEqual([]);
    });

    it('drops a draft with no changes when it leaves, without asking', async () => {
      await open(editor());
      expect(await TestBed.inject(Router).navigateByUrl('/lists')).toBe(true);
      expect(questions).toEqual([]);
      expect(await drafts()).toEqual([]);
    });

    it('deletes the list and its items from ⋮, after asking', async () => {
      await open(editor());
      await click('More actions');
      const remove = Array.from(document.querySelectorAll<HTMLElement>('[mat-menu-item]')).find(
        (item) => item.textContent?.includes('Delete list'),
      );
      remove?.click();

      await until(() => location.path() === '/lists');
      expect(questions[0]).toMatchObject({ title: 'Delete Work Related?', danger: true });
      expect((await storedList())?.deletedAt).toBeDefined();
      expect((await storedItems()).every((item) => item.deletedAt !== undefined)).toBe(true);
      expect(await drafts()).toEqual([]);
    });

    it('shows an item it can’t price, and leaves it out of the average', async () => {
      await TestBed.inject(ItemsRepository).create({
        ...fields('netflix.basic'),
        listId: work.id,
      });
      await open(editor());

      expect(rows()[2]).toMatchObject({
        title: 'netflix.basic',
        problem: 'This plan is no longer in the catalog',
        price: undefined,
      });
      expect(footer()).toBe('No unsaved changes · ≈ $26.84 / mo average (1 not counted)');
    });

    it('starts again from the saved list when another tab saves or drops the draft', async () => {
      await open(editor());
      await type('Work');
      await storedName('Work');

      // Another tab's Cancel.
      await TestBed.inject(DraftsRepository).remove(work.id);
      await until(() => nameInput()?.value === 'Work Related');
      await vi.waitFor(async () => expect((await drafts())[0]?.name).toBe('Work Related'));
      expect(footer()?.startsWith('No unsaved changes')).toBe(true);
    });
  });

  describe('what Search and the list view ask it to open', () => {
    it('says which plan it will add, by name, and how often it bills', async () => {
      await open(`${editor()}?add=netflix.standard&interval=month`);
      expect(text('.waiting')).toBe(
        'Netflix Standard, billed monthly, will be added here once the item dialog is ready.',
      );
    });

    it('opens an item from its ✎, by ?item=', async () => {
      await open(editor());
      const edit = button('Edit Netflix Standard');
      expect(edit?.getAttribute('href')).toBe(`${editor()}?item=${netflix.id}`);

      await click('Edit Netflix Standard');
      await until(() => text('.waiting') !== undefined);
      expect(text('.waiting')).toBe(
        'Netflix Standard will open here once the item dialog is ready.',
      );
      expect(await drafts()).toHaveLength(1);
    });
  });

  it.each([
    ['there isn’t', unknownId],
    ['was deleted', ''],
  ])('says a list %s doesn’t exist, and links back to the lists', async (_, id) => {
    if (id === '') await TestBed.inject(ListsRepository).remove(work.id);
    await open(`/lists/${id || work.id}/edit`);
    expect(text('ss-empty-state h2')).toBe("This list doesn't exist");
    expect(button('Back to lists')?.getAttribute('href')).toBe('/lists');
    expect(await drafts()).toEqual([]);
  });

  describe('/lists/new', () => {
    /** Opens /lists/new with `query`, and waits for its new list's editor. */
    async function openNew(query = ''): Promise<ListDraft> {
      harness = await RouterTestingHarness.create(`/lists/new${query}`);
      const router = TestBed.inject(Router);
      await until(() => /^\/lists\/[0-9a-f-]{36}\/edit/.test(router.url));
      await until(() => page().querySelector('.footer') !== null);
      const stored = await drafts();
      expect(stored).toHaveLength(1);
      return stored[0];
    }

    it('makes a new list’s draft in place of its URL, saving nothing to the lists table', async () => {
      const draft = await openNew();

      expect(draft).toMatchObject({
        isNew: true,
        name: 'Subscription List',
        items: [],
        startedAt: storage.clock.time,
      });
      expect(location.urlChanges).toEqual(['/lists/new', `replace: /lists/${draft.listId}/edit`]);
      expect(
        ((await storedRows(storage.indexedDB, 'lists')) as SubscriptionList[]).map(
          (list) => list.id,
        ),
      ).toEqual([work.id]);
      expect(text('h1')).toBe('New list');
      expect(nameInput().value).toBe('Subscription List');
      expect(button('More actions')).toBeUndefined();
      expect(text('.empty')).toBe('No subscriptions yet. Add one from the catalog.');
      expect(button('Add from catalog')?.getAttribute('href')).toBe(
        `/search?addTo=${draft.listId}`,
      );
    });

    it('keeps what Search asked to add, a bundle billed every 3 months here', async () => {
      const query = '?addBundle=bundle.netflix-crave&interval=month&count=3';
      const draft = await openNew(query);

      expect(TestBed.inject(Router).url).toBe(`/lists/${draft.listId}/edit${query}`);
      expect(text('.waiting')).toBe(
        'Netflix and Crave, billed every 3 months, will be added here once the item dialog is ready.',
      );
    });

    it('goes to the lists on Cancel, and drops the draft', async () => {
      await openNew();
      await click('Cancel');
      await until(() => location.path() === '/lists');
      expect(await drafts()).toEqual([]);
      expect(questions).toEqual([]);
    });
  });
});
