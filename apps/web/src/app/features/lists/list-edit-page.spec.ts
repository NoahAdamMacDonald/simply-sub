import type { ComponentHarnessConstructor, HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, signal } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatRadioGroupHarness } from '@angular/material/radio/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
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
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import { DraftsRepository } from '../../core/storage/drafts-repository';
import { RankingsRepository } from '../../core/storage/rankings-repository';
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

// The list editor (P5) and its item dialog (P6) on a real draft in a fake IndexedDB, with Search's small catalog
// (search.testing.ts) for an Albertan: Netflix Standard at $18.99 a month, and Mullvad VPN at €60 a year, about
// $94.16. Today is Oct 25, 2026. ConfirmService answers as each test says.

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
            need: () => undefined,
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
      // Back to the list, by its saved name.
      expect(page().querySelector('.back')?.getAttribute('href')).toBe(`/lists/${work.id}`);
      expect(text('.back .mdc-button__label')).toBe('Work Related');
      expect(nameInput().value).toBe('Work Related');
      expect(rows()).toEqual([
        {
          title: 'Netflix · Standard',
          details: 'Renews Nov 12 · auto · 1 custom rank',
          tags: ['Family'],
          price: expect.stringMatching(/^\$18\.99 \/ mo a month \+ tax$/),
          problem: undefined,
        },
        {
          title: 'Mullvad VPN',
          details: 'Renews Jan 20, 2027 · manual',
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

  describe('the item dialog', () => {
    const dialog = () => document.querySelector<HTMLElement>('ss-item-dialog');
    const inDialog = (selector: string) =>
      dialog()?.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    const draftItem = async (id: string) =>
      (await drafts())[0]?.items.find((entry) => entry.item.id === id)?.item;
    const addedItems = async () =>
      (await drafts())[0]?.items
        .filter((entry) => entry.saved === undefined)
        .map(({ item }) => item) ?? [];

    /** Opens the editor at `url` and waits for the dialog it opens. */
    async function openDialog(url: string): Promise<HarnessLoader> {
      await open(url);
      return dialogLoader();
    }

    async function dialogLoader(): Promise<HarnessLoader> {
      await until(() => dialog() !== null);
      await harness.fixture.whenStable();
      return TestbedHarnessEnvironment.documentRootLoader(harness.fixture).getChildLoader(
        'ss-item-dialog',
      );
    }

    /** The dialog's input or menu labelled `label`. */
    async function control<T extends MatInputHarness | MatSelectHarness>(
      loader: HarnessLoader,
      label: string,
      type: ComponentHarnessConstructor<T>,
    ): Promise<T> {
      const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
      const found = await field.getControl(type);
      if (!found) throw new Error(`No control labelled ${label}`);
      return found;
    }

    /** A menu's choices as they're shown: without the words only screen readers get. */
    async function choices(select: MatSelectHarness): Promise<string[]> {
      await select.open();
      const options = await select.getOptions();
      const shown = await Promise.all(
        options.map(async (option) => (await option.host()).text({ exclude: '.visually-hidden' })),
      );
      // The menu's own backdrop: MatSelectHarness.close() clicks the first one, the dialog's, which closes the dialog.
      document.querySelector<HTMLElement>('.cdk-overlay-transparent-backdrop')?.click();
      await harness.fixture.whenStable();
      return shown;
    }

    /** The rank dropdown of the key named `name`. */
    async function rankSelect(loader: HarnessLoader, name: string): Promise<MatSelectHarness> {
      const label = Array.from(dialog()?.querySelectorAll('.rank-name') ?? []).find(
        (candidate) => candidate.textContent?.trim() === name,
      );
      if (!label) throw new Error(`No rank row ${name}`);
      return loader.getHarness(
        MatSelectHarness.with({ selector: `[aria-labelledby~="${label.id}"]` }),
      );
    }

    async function press(loader: HarnessLoader, name: string): Promise<void> {
      // A button's text starts with its icon's name, if it has one.
      const text = new RegExp(`(^| )${name}$`);
      await (await loader.getHarness(MatButtonHarness.with({ text }))).click();
      await harness.fixture.whenStable();
    }

    describe('opens once from the URL, which then drops what it asked', () => {
      it('?add=, at the period asked for', async () => {
        const loader = await openDialog(`${editor()}?add=netflix.standard&interval=year`);

        expect(inDialog('h2')).toBe('Add subscription');
        expect(inDialog('.subject .name')).toBe('Netflix');
        expect(await (await control(loader, 'Plan', MatSelectHarness)).getValueText()).toContain(
          'Standard — $189.99 / year',
        );
        expect(await (await control(loader, 'Billed', MatSelectHarness)).getValueText()).toContain(
          'Yearly — $189.99',
        );
        expect(await (await control(loader, 'Next renewal', MatInputHarness)).getValue()).toBe(
          '2027-10-25',
        );
        expect(inDialog('.monthly [aria-hidden]')).toBe('$15.83 / mo · next charge Oct 25, 2027');
        await until(() => location.path() === editor());
        expect(location.urlChanges.at(-1)).toBe(`replace: ${editor()}`);

        await press(loader, 'Cancel');
        await until(() => dialog() === null);
        await harness.fixture.whenStable();
        expect(dialog()).toBeNull();
        expect(await addedItems()).toEqual([]);
      });

      it('a reseller’s price: the plan at the same length of period, with the price paid as its own', async () => {
        const loader = await openDialog(
          `${editor()}?add=mullvad.vpn&interval=month&count=12&price=87&currency=CAD&plusTax=1`,
        );
        // Amazon sells 12 months, which Mullvad prices as a year.
        expect(await (await control(loader, 'Billed', MatSelectHarness)).getValueText()).toContain(
          'Yearly',
        );
        expect(
          await (
            await loader.getHarness(MatCheckboxHarness.with({ label: 'I pay a different price' }))
          ).isChecked(),
        ).toBe(true);
        expect(await (await control(loader, 'Amount', MatInputHarness)).getValue()).toBe('87');
        expect(
          await (
            await loader.getHarness(MatCheckboxHarness.with({ label: /^Plus tax/ }))
          ).isChecked(),
        ).toBe(true);
        await until(() => location.path() === editor());
        await press(loader, 'Add to list');

        await until(() => dialog() === null);
        expect((await addedItems())[0]).toMatchObject({
          source: { kind: 'catalog', planId: 'mullvad.vpn' },
          billing: { interval: 'year', intervalCount: 1 },
          priceOverride: { amount: 87, currency: 'CAD', plusTax: true },
        });
      });

      it('?addBundle=, showing its plans, on its own period when it isn’t sold for the one asked', async () => {
        const loader = await openDialog(
          `${editor()}?addBundle=bundle.netflix-crave&interval=month&count=3`,
        );

        expect(inDialog('.subject .name')).toBe('Netflix and Crave');
        expect(
          Array.from(dialog()?.querySelectorAll('.includes li') ?? []).map((plan) =>
            plan.textContent?.trim(),
          ),
        ).toEqual(['Netflix Standard', 'Crave Premium']);
        expect(dialog()?.querySelector('.plan')).toBeNull();
        expect(await (await control(loader, 'Billed', MatSelectHarness)).getValueText()).toContain(
          'Monthly — $35.00',
        );
        await until(() => location.path() === editor());
      });

      it('?addCustom=, with its plans', async () => {
        const gym = await TestBed.inject(CustomSubsRepository).create({
          name: 'Local gym',
          plans: [
            {
              id: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d',
              name: 'Monthly pass',
              features: {},
              price: { amount: 45, currency: 'CAD', interval: 'week', intervalCount: 2 },
              autoRenewAvailable: true,
            },
          ],
        });
        const loader = await openDialog(`${editor()}?addCustom=${gym.id}`);

        expect(inDialog('.subject .name')).toBe('Local gym');
        // A custom plan can be billed any way: it starts on its own price's.
        expect(await (await control(loader, 'Billed every', MatInputHarness)).getValue()).toBe('2');
        expect(await (await control(loader, 'Unit', MatSelectHarness)).getValueText()).toBe(
          'Weeks',
        );
        await press(loader, 'Add to list');

        await until(() => dialog() === null);
        expect((await addedItems())[0]).toMatchObject({
          source: {
            kind: 'custom',
            customSubId: gym.id,
            customPlanId: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d',
          },
          billing: { interval: 'week', intervalCount: 2, anchorDate: '2026-11-08' },
        });
        await until(() => location.path() === editor());
      });

      it('?item=, for the item as it is', async () => {
        const loader = await openDialog(`${editor()}?item=${mullvad.id}`);

        expect(inDialog('h2')).toBe('Edit subscription');
        expect(inDialog('.subject .name')).toBe('Mullvad VPN');
        expect(await (await control(loader, 'Next renewal', MatInputHarness)).getValue()).toBe(
          '2027-01-20',
        );
        // Mullvad's price is renewed by hand.
        expect(inDialog('.billing .note')).toBe('This plan renews manually — we’ll remind you');
        expect(
          await loader.getAllHarnesses(MatCheckboxHarness.with({ label: 'Auto-renews' })),
        ).toEqual([]);
        await until(() => location.path() === editor());
      });

      it.each([
        [
          'a plan',
          '?add=netflix.basic&interval=month',
          'There’s no plan netflix.basic in the catalog.',
        ],
        ['a bundle', '?addBundle=bundle.nope', 'There’s no bundle bundle.nope in the catalog.'],
        [
          'a custom subscription',
          `?addCustom=${unknownId}`,
          'That custom subscription doesn’t exist. It may have been deleted.',
        ],
        ['an item', `?item=${unknownId}`, 'That subscription isn’t in this list.'],
      ])('says when there’s no such %s, and opens nothing', async (_, query, notice) => {
        await open(`${editor()}${query}`);
        await until(() => text('.notice') === notice);
        await until(() => location.path() === editor());
        await harness.fixture.whenStable();
        expect(dialog()).toBeNull();
      });

      it('on a new list, once its draft is made', async () => {
        harness = await RouterTestingHarness.create('/lists/new?add=crave.basic&interval=month');
        const loader = await dialogLoader();
        await press(loader, 'Add to list');

        await until(() => rows().length === 1);
        expect(rows()[0].title).toBe('Crave · Basic');
        expect(TestBed.inject(Router).url).toMatch(/^\/lists\/[0-9a-f-]{36}\/edit$/);
      });
    });

    it('adds to the draft: the row shows, the snackbar says so, and Save stores it', async () => {
      const loader = await openDialog(`${editor()}?add=crave.basic&interval=month`);
      await press(loader, 'Add to list');

      await until(() => dialog() === null);
      await until(() => rows().length === 3);
      expect(rows()[2]).toMatchObject({ title: 'Crave · Basic', details: 'Renews Nov 25 · auto' });
      expect(document.querySelector('.mat-mdc-snack-bar-container')?.textContent).toContain(
        'Added Crave Basic',
      );
      const [added] = await addedItems();
      expect(added).toMatchObject({
        source: { kind: 'catalog', planId: 'crave.basic' },
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-11-25',
          autoRenew: true,
        },
        pinned: false,
      });
      await until(() => document.activeElement === button('Edit Crave Basic'));

      await click('Save');
      await until(() => location.path() === `/lists/${work.id}`);
      expect((await storedItems()).find((item) => item.id === added.id)).toMatchObject({
        listId: work.id,
        source: { kind: 'catalog', planId: 'crave.basic' },
      });
    });

    it('offers only the periods the plan is priced for, and keeps the one chosen when the plan changes if it can', async () => {
      const loader = await openDialog(`${editor()}?add=netflix.standard&interval=year`);
      const plan = await control(loader, 'Plan', MatSelectHarness);
      const billed = await control(loader, 'Billed', MatSelectHarness);

      expect(await choices(billed)).toEqual(['Monthly — $18.99', 'Yearly — $189.99']);
      // Premium is sold only in the US.
      expect(await choices(plan)).toEqual([
        'Standard with ads — $7.99 / mo',
        'Standard — $189.99 / year',
      ]);

      await plan.clickOptions({ text: /^Standard with ads/ });
      await harness.fixture.whenStable();
      expect(await choices(billed)).toEqual(['Monthly — $7.99']);
      expect(await billed.getValueText()).toContain('Monthly — $7.99');
      // The suggested renewal follows the period.
      expect(await (await control(loader, 'Next renewal', MatInputHarness)).getValue()).toBe(
        '2026-11-25',
      );
    });

    it('asks for a billing day when the date is a shorter month’s last day', async () => {
      const loader = await openDialog(`${editor()}?add=crave.basic&interval=month`);
      expect(dialog()?.querySelector('.billing-day')).toBeNull();
      await (await control(loader, 'Next renewal', MatInputHarness)).setValue('2027-02-28');
      await harness.fixture.whenStable();

      const day = await loader.getHarness(
        MatRadioGroupHarness.with({ selector: '.billing-day mat-radio-group' }),
      );
      expect(
        await Promise.all((await day.getRadioButtons()).map((radio) => radio.getLabelText())),
      ).toEqual([
        'the 28th',
        'the 29th (the last day in shorter months)',
        'the 30th (the last day in shorter months)',
        'the 31st (the last day in shorter months)',
      ]);
      expect(await day.getCheckedValue()).toBe('0');
      await day.checkRadioButton({ label: /31st/ });
      await press(loader, 'Add to list');

      await until(() => dialog() === null);
      expect((await addedItems())[0].billing).toMatchObject({
        anchorDate: '2027-02-28',
        billingDay: 31,
      });
    });

    describe('won’t save what the rules don’t allow, and says why at the field', () => {
      it('an Ongoing item with no next renewal', async () => {
        const loader = await openDialog(`${editor()}?add=crave.basic&interval=month`);
        const renewal = await control(loader, 'Next renewal', MatInputHarness);
        await renewal.setValue('');
        await press(loader, 'Add to list');

        await until(() => inDialog('mat-error') === 'Enter the next renewal date');
        expect(await renewal.isFocused()).toBe(true);
        expect(dialog()).not.toBeNull();
        expect(await addedItems()).toEqual([]);
      });

      it('windows with no end, or that overlap', async () => {
        const loader = await openDialog(`${editor()}?add=crave.basic&interval=month`);
        await (
          await loader.getHarness(MatRadioGroupHarness.with({ selector: '.mode' }))
        ).checkRadioButton({
          label: 'Specific dates',
        });
        await harness.fixture.whenStable();
        expect(
          await (
            await control(loader, 'Billed during each window', MatSelectHarness)
          ).getValueText(),
        ).toContain('Monthly');
        await press(loader, 'Add to list');
        await until(() => inDialog('.window mat-error') === 'Enter the end date');
        expect(await addedItems()).toEqual([]);

        const ends = await loader.getAllHarnesses(
          MatInputHarness.with({ selector: '.window input:not(.window-start)' }),
        );
        await ends[0].setValue('2026-12-25');
        await press(loader, 'Add window');
        const starts = await loader.getAllHarnesses(
          MatInputHarness.with({ selector: '.window-start' }),
        );
        expect(await starts[1].isFocused()).toBe(true);
        const bothEnds = await loader.getAllHarnesses(
          MatInputHarness.with({ selector: '.window input:not(.window-start)' }),
        );
        await bothEnds[1].setValue('2027-01-10');
        await press(loader, 'Add to list');
        await until(() => inDialog('.window + .window mat-error') === 'Overlaps window 1');
        expect(await addedItems()).toEqual([]);

        await starts[1].setValue('2026-12-26');
        await press(loader, 'Add to list');
        await until(() => dialog() === null);
        expect((await addedItems())[0].billing).toEqual({
          mode: 'limited',
          windows: [
            { start: '2026-10-25', end: '2026-12-25', repeatYearly: false },
            { start: '2026-12-26', end: '2027-01-10', repeatYearly: false },
          ],
          interval: 'month',
          intervalCount: 1,
        });
      });

      it('an own price that isn’t above 0', async () => {
        const loader = await openDialog(`${editor()}?add=crave.basic&interval=month`);
        await (
          await loader.getHarness(MatCheckboxHarness.with({ label: 'I pay a different price' }))
        ).check();
        const amount = await control(loader, 'Amount', MatInputHarness);
        await amount.setValue('0');
        await press(loader, 'Add to list');

        await until(() => inDialog('.own-price mat-error') === 'Enter an amount above 0');
        expect(await amount.isFocused()).toBe(true);

        await amount.setValue('9.99');
        await (await loader.getHarness(MatCheckboxHarness.with({ label: /^Plus tax/ }))).check();
        await (await control(loader, 'Until', MatInputHarness)).setValue('2027-01-25');
        await press(loader, 'Add to list');
        await until(() => dialog() === null);
        expect((await addedItems())[0].priceOverride).toEqual({
          amount: 9.99,
          currency: 'CAD',
          until: '2027-01-25',
          plusTax: true,
        });
      });
    });

    it('shows each key’s profile rank, and choosing it removes the item’s own', async () => {
      await TestBed.inject(RankingsRepository).set('video.quality=1080p', 'wanted');
      await open(editor());
      await click('Edit Netflix Standard');
      const loader = await dialogLoader();

      // A group this subscription ranks something in starts open.
      expect(inDialog('.ranks .group-name')).toBe('Streaming');
      expect(inDialog('.ranks .count')).toBe('1 of 2 ranked here');
      const quality = await rankSelect(loader, 'Video quality: 1080p (Full HD)');
      const adFree = await rankSelect(loader, 'Ad free');
      expect(await quality.getValueText()).toBe('Profile default (Wanted)');
      expect(await adFree.getValueText()).toBe('Essential');

      await adFree.clickOptions({ text: 'Profile default (Not ranked)' });
      await quality.clickOptions({ text: /^Critical/ });
      await press(loader, 'Save');

      await until(() => dialog() === null);
      expect((await draftItem(netflix.id))?.rankOverrides).toEqual({
        'video.quality=1080p': 'critical',
      });
    });

    it('folds each group of feature ranks, closed to start when nothing in it is ranked here', async () => {
      await openDialog(`${editor()}?add=crave.premium&interval=month`);
      const toggle = () => dialog()?.querySelector<HTMLButtonElement>('.group-toggle');
      expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
      expect(dialog()?.querySelector('.rank-rows')).toBeNull();
      expect(inDialog('.ranks .count')).toBe('0 of 3 ranked here');

      toggle()?.click();
      await harness.fixture.whenStable();
      expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
      expect(dialog()?.querySelectorAll('.rank-rows li')).toHaveLength(3);
    });

    it('asks before adding a plan that’s in the list already', async () => {
      const loader = await openDialog(`${editor()}?add=netflix.standard&interval=month`);
      answer = false;
      await press(loader, 'Add to list');

      await vi.waitFor(() => expect(questions).toHaveLength(1));
      expect(questions[0]).toMatchObject({
        title: 'Already in this list — add another?',
        message:
          'Netflix Standard is in Work Related already. A list can have it more than once, for each person who has it.',
        confirmText: 'Add another',
      });
      expect(dialog()).not.toBeNull();
      expect(await addedItems()).toEqual([]);

      answer = true;
      await press(loader, 'Add to list');
      await until(() => dialog() === null);
      expect((await addedItems()).map((item) => item.source)).toEqual([
        { kind: 'catalog', planId: 'netflix.standard' },
      ]);
    });

    it('changes an item in the draft, keeping its id, pinning and card', async () => {
      const cardId = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e';
      await TestBed.inject(ItemsRepository).update(netflix.id, { pinned: true, cardId });
      await open(editor());
      await click('Edit Netflix Standard');
      const loader = await dialogLoader();
      expect(questions).toEqual([]);

      await (
        await control(loader, 'Plan', MatSelectHarness)
      ).clickOptions({ text: /^Standard with ads/ });
      await (await control(loader, 'Next renewal', MatInputHarness)).setValue('2026-12-01');
      await (await loader.getHarness(MatCheckboxHarness.with({ label: 'Auto-renews' }))).uncheck();
      await press(loader, 'Save');

      await until(() => dialog() === null);
      expect(questions).toEqual([]);
      expect(await draftItem(netflix.id)).toMatchObject({
        id: netflix.id,
        pinned: true,
        cardId,
        tagIds: netflix.tagIds,
        source: { kind: 'catalog', planId: 'netflix.standard-ads' },
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-12-01',
          autoRenew: false,
        },
        // Standard with ads isn't ad free.
        rankOverrides: {},
      });
      expect(document.querySelector('.mat-mdc-snack-bar-container')?.textContent).toContain(
        'Saved Netflix Standard with ads',
      );
      await until(() => document.activeElement === button('Edit Netflix Standard with ads'));
      await until(() => footer()?.startsWith('Unsaved changes') === true);
    });

    it('gives an item a nickname and a note, which its row shows, and clears them', async () => {
      await open(editor());
      await click('Edit Netflix Standard');
      let loader = await dialogLoader();
      await (await control(loader, 'Nickname', MatInputHarness)).setValue("  Mom's ");
      await (await control(loader, 'Note', MatInputHarness)).setValue('Paid by Dad');
      await press(loader, 'Save');

      await until(() => dialog() === null);
      expect(await draftItem(netflix.id)).toMatchObject({ nickname: "Mom's", note: 'Paid by Dad' });
      await until(() => button("Edit Mom's (Netflix Standard)") !== null);
      expect(text(`[data-item="${netflix.id}"] .title`)).toBe("Mom's · Netflix Standard");

      await click("Edit Mom's (Netflix Standard)");
      loader = await dialogLoader();
      expect(await (await control(loader, 'Nickname', MatInputHarness)).getValue()).toBe("Mom's");
      await (await control(loader, 'Nickname', MatInputHarness)).setValue('');
      await (await control(loader, 'Note', MatInputHarness)).setValue(' ');
      await press(loader, 'Save');

      await until(() => dialog() === null);
      const cleared = await draftItem(netflix.id);
      expect(cleared).not.toHaveProperty('nickname');
      expect(cleared).not.toHaveProperty('note');
    });

    it('refuses a nickname over 60 characters, at its field', async () => {
      await open(editor());
      await click('Edit Netflix Standard');
      const loader = await dialogLoader();
      await (await control(loader, 'Nickname', MatInputHarness)).setValue('x'.repeat(61));
      await press(loader, 'Save');
      expect(dialog()).not.toBeNull();
      expect(
        await (
          await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Nickname' }))
        ).getTextErrors(),
      ).toEqual(['Use at most 60 characters']);
    });

    it('takes an item’s add-ons, up to what the plan allows', async () => {
      const loader = await openDialog(`${editor()}?add=netflix.standard&interval=month`);
      answer = true;
      expect(inDialog('.add-ons legend')).toBe('Add-ons');
      await (await loader.getHarness(MatCheckboxHarness.with({ label: 'Extra member' }))).check();
      expect(inDialog('.monthly [aria-hidden]')).toBe('$26.98 / mo · next charge Nov 25');
      await press(loader, 'Add to list');

      await until(() => dialog() === null);
      expect((await addedItems())[0].source).toEqual({
        kind: 'catalog',
        planId: 'netflix.standard',
        addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
      });
    });

    describe('[+ Add custom subscription] (flow F3)', () => {
      const planId = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d';
      const menuItems = () =>
        Array.from(document.querySelectorAll('.mat-mdc-menu-panel [mat-menu-item]')).map((item) =>
          item.textContent?.replace(/^add/, '').trim(),
        );

      async function openMenu(): Promise<void> {
        await click('Add custom subscription');
        await until(() => menuItems().length > 0);
      }

      async function pick(name: string): Promise<void> {
        const item = Array.from(
          document.querySelectorAll<HTMLElement>('.mat-mdc-menu-panel [mat-menu-item]'),
        ).find((candidate) => candidate.textContent?.includes(name));
        item?.click();
        await harness.fixture.whenStable();
      }

      it('adds one of the user’s custom subscriptions through the item dialog', async () => {
        const gym = await TestBed.inject(CustomSubsRepository).create({
          name: 'Local Gym',
          plans: [
            {
              id: planId,
              name: 'Basic',
              features: { 'streaming.ad-free': true },
              price: { amount: 29.99, currency: 'CAD', interval: 'month', intervalCount: 1 },
              autoRenewAvailable: true,
            },
          ],
        });
        await open(editor());
        await openMenu();
        expect(menuItems()).toEqual(['Local Gym', 'Create new…']);
        await pick('Local Gym');

        const loader = await dialogLoader();
        expect(inDialog('.subject .name')).toBe('Local Gym');
        expect(inDialog('.ranks .group-name')).toBe('Streaming');
        await press(loader, 'Add to list');
        await until(() => dialog() === null);
        expect((await addedItems())[0].source).toEqual({
          kind: 'custom',
          customSubId: gym.id,
          customPlanId: planId,
        });
        await until(() => rows().some((row) => row.title === 'Local Gym · Basic'));
      });

      it('Create new… opens the custom subscription editor, then the item dialog for what it made', async () => {
        await open(editor());
        await openMenu();
        expect(menuItems()).toEqual(['Create new…']);
        await pick('Create new…');

        await until(() => document.querySelector('ss-custom-sub-dialog') !== null);
        await harness.fixture.whenStable();
        const editorLoader = await TestbedHarnessEnvironment.documentRootLoader(
          harness.fixture,
        ).getChildLoader('ss-custom-sub-dialog');
        await (await control(editorLoader, 'Name', MatInputHarness)).setValue('Local Gym');
        await (await control(editorLoader, 'Plan name', MatInputHarness)).setValue('Basic');
        await (await control(editorLoader, 'Cost', MatInputHarness)).setValue('29.99');
        await press(editorLoader, 'Save');

        const loader = await dialogLoader();
        expect(document.querySelector('ss-custom-sub-dialog')).toBeNull();
        expect(inDialog('.subject .name')).toBe('Local Gym');
        await press(loader, 'Add to list');
        await until(() => dialog() === null);
        const [sub] = (await storedRows(storage.indexedDB, 'customSubs')) as { id: string }[];
        expect((await addedItems())[0].source).toMatchObject({
          kind: 'custom',
          customSubId: sub.id,
        });
      });
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
      // A list that isn't saved has no page: back to Lists.
      expect(page().querySelector('.back')?.getAttribute('href')).toBe('/lists');
      expect(text('.back .mdc-button__label')).toBe('Lists');
      expect(nameInput().value).toBe('Subscription List');
      expect(button('More actions')).toBeUndefined();
      expect(text('.empty')).toBe(
        'No subscriptions yet. Add one from the catalog, or one of your own.',
      );
      expect(button('Add from catalog')?.getAttribute('href')).toBe(
        `/search?addTo=${draft.listId}`,
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
