import type { ComponentHarnessConstructor, HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideRouter } from '@angular/router';
import type { CatalogData, CustomSubscription, ListItem, Settings } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { CustomSubsRepository } from '../../core/storage/custom-subs-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { ConfirmService, type ConfirmOptions } from '../../shared/confirm/confirm-service';
import { alberta, searchCatalogData } from '../../shared/sub-card/search.testing';
import { CustomSubsPage } from './custom-subs-page';

// Custom subscriptions (P12) and their editor on a fake IndexedDB, for an Albertan, with Search's small catalog for
// the feature registry: Video quality (1080p, 4K), Ad free and VPN. ConfirmService answers as each test says.

const basicId = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d';
const premiumId = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1e';
const workId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const familyId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';

/** Local Gym: Basic at $29.99 a month, ad free, and Premium at $49.99 every 3 months. */
const gymFields: NewRecord<'customSubs'> = {
  name: 'Local Gym',
  link: 'https://www.localgym.ca/join',
  plans: [
    {
      id: basicId,
      name: 'Basic',
      features: { 'streaming.ad-free': true },
      price: { amount: 29.99, currency: 'CAD', interval: 'month', intervalCount: 1 },
      autoRenewAvailable: true,
    },
    {
      id: premiumId,
      name: 'Premium',
      features: {},
      price: { amount: 49.99, currency: 'CAD', interval: 'month', intervalCount: 3 },
      autoRenewAvailable: false,
    },
  ],
};

function itemFields(subId: string, customPlanId: string, listId = workId): NewRecord<'items'> {
  return {
    listId,
    source: { kind: 'custom', customSubId: subId, customPlanId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-01',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
  };
}

describe('CustomSubsPage', () => {
  let storage: TestStorage;
  let fixture: ComponentFixture<CustomSubsPage>;
  let answer: boolean;
  let questions: ConfirmOptions[];
  let subs: CustomSubsRepository;
  let items: ItemsRepository;

  beforeEach(async () => {
    storage = testStorage();
    answer = true;
    questions = [];
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        provideRouter([]),
        { provide: SettingsStore, useValue: { saved: signal<Settings | undefined>(alberta) } },
        {
          provide: CatalogStore,
          useValue: { catalog: signal<CatalogData | undefined>(searchCatalogData) },
        },
        {
          provide: ConfirmService,
          useValue: {
            confirm: async (options: ConfirmOptions) => {
              questions.push(options);
              return answer;
            },
          },
        },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    subs = TestBed.inject(CustomSubsRepository);
    items = TestBed.inject(ItemsRepository);
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(CustomSubsPage);
    await until(() => page().querySelector('ul.subs, ss-empty-state') !== null);
    await fixture.whenStable();
  }

  const page = () => fixture.nativeElement as HTMLElement;
  const rows = () =>
    Array.from(page().querySelectorAll('li.sub')).map((row) => ({
      name: row.querySelector('.name')?.textContent?.trim(),
      details: row.querySelector('.details')?.textContent?.trim(),
    }));
  const dialog = () => document.querySelector<HTMLElement>('ss-custom-sub-dialog');
  const storedSubs = async () =>
    (await storedRows(storage.indexedDB, 'customSubs')) as CustomSubscription[];
  const storedItems = async () => (await storedRows(storage.indexedDB, 'items')) as ListItem[];

  async function click(label: string): Promise<void> {
    const target = Array.from(page().querySelectorAll<HTMLElement>('button')).find(
      (candidate) =>
        candidate.getAttribute('aria-label') === label ||
        candidate.textContent?.replace(/^\s*add/, '').trim() === label,
    );
    if (!target) throw new Error(`No ${label}`);
    target.click();
    await fixture.whenStable();
  }

  async function dialogLoader(): Promise<HarnessLoader> {
    await until(() => dialog() !== null);
    await fixture.whenStable();
    return TestbedHarnessEnvironment.documentRootLoader(fixture).getChildLoader(
      'ss-custom-sub-dialog',
    );
  }

  /** The dialog's controls labelled `label`, in order. */
  async function controls<T extends MatInputHarness | MatSelectHarness>(
    loader: HarnessLoader,
    label: string,
    type: ComponentHarnessConstructor<T>,
  ): Promise<T[]> {
    const fields = await loader.getAllHarnesses(
      MatFormFieldHarness.with({ floatingLabelText: label }),
    );
    const found: T[] = [];
    for (const field of fields) {
      const one = await field.getControl(type);
      if (one) found.push(one);
    }
    return found;
  }

  async function control<T extends MatInputHarness | MatSelectHarness>(
    loader: HarnessLoader,
    label: string,
    type: ComponentHarnessConstructor<T>,
  ): Promise<T> {
    const [found] = await controls(loader, label, type);
    if (!found) throw new Error(`No control labelled ${label}`);
    return found;
  }

  async function press(loader: HarnessLoader, name: string): Promise<void> {
    // A button's text starts with its icon's name, if it has one.
    const text = new RegExp(`(^| )${name}$`);
    await (await loader.getHarness(MatButtonHarness.with({ text }))).click();
    await fixture.whenStable();
  }

  const errors = () =>
    Array.from(dialog()?.querySelectorAll('mat-error') ?? []).map((error) =>
      error.textContent?.trim(),
    );

  it('says when there are none', async () => {
    await open();
    expect(page().querySelector('ss-empty-state h2')?.textContent).toBe(
      'No custom subscriptions yet',
    );
    // Back to Lists, which links here.
    const back = page().querySelector('.back');
    expect(back?.getAttribute('href')).toBe('/lists');
    expect(back?.querySelector('.mdc-button__label')?.textContent?.trim()).toBe('Lists');
  });

  it('lists each with its icon, its plans and the lists that use it', async () => {
    const gym = await subs.create(gymFields);
    await subs.create({ name: 'Substack', plans: [{ ...gymFields.plans[0], id: premiumId }] });
    await items.create(itemFields(gym.id, basicId));
    await items.create(itemFields(gym.id, premiumId));
    await items.create(itemFields(gym.id, basicId, familyId));
    await open();

    // The items' live query may answer after the custom subscriptions'.
    await until(() => rows()[0]?.details === '2 plans · used in 2 lists');
    expect(rows()).toEqual([
      { name: 'Local Gym', details: '2 plans · used in 2 lists' },
      { name: 'Substack', details: '1 plan · not used' },
    ]);
    expect(page().querySelector('li.sub img')?.getAttribute('src')).toBe(
      'api/v1/icon?domain=www.localgym.ca',
    );
  });

  it('makes a new one in the editor, with plans and features, and says so', async () => {
    await open();
    await click('New custom subscription');
    const loader = await dialogLoader();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('New custom subscription');

    await (await control(loader, 'Name', MatInputHarness)).setValue(' Local Gym ');
    await (await control(loader, 'Website', MatInputHarness)).setValue('https://www.localgym.ca');
    await (await control(loader, 'Plan name', MatInputHarness)).setValue('Basic');
    await (await control(loader, 'Cost', MatInputHarness)).setValue('29.99');
    await (await loader.getHarness(MatCheckboxHarness.with({ label: /^Plus tax/ }))).check();

    // A yes-or-no feature is added at once; an enum asks for its value.
    const features = await loader.getHarness(
      MatAutocompleteHarness.with({ ancestor: 'ss-feature-picker' }),
    );
    await features.enterText('ad');
    await features.selectOption({ text: 'Ad free' });
    await features.enterText('video');
    await features.selectOption({ text: 'Video quality' });
    await press(loader, 'Add feature');
    expect(dialog()?.querySelector('.value .error')?.textContent).toBe('Choose a value');
    await (
      await control(loader, 'Value', MatSelectHarness)
    ).clickOptions({ text: '4K (Ultra HD)' });
    await press(loader, 'Add feature');
    await fixture.whenStable();
    expect(
      Array.from(dialog()?.querySelectorAll('.features .feature-text') ?? []).map((feature) =>
        feature.textContent?.trim(),
      ),
    ).toEqual(['Video quality: 4K (Ultra HD)', 'Ad free']);

    // A second plan, billed every 3 months.
    await press(loader, 'New plan');
    expect(document.activeElement).toBe(
      dialog()?.querySelectorAll('.plan-name input')[1] as HTMLElement,
    );
    const [, premiumName] = await controls(loader, 'Plan name', MatInputHarness);
    await premiumName.setValue('Premium');
    const [, premiumCost] = await controls(loader, 'Cost', MatInputHarness);
    await premiumCost.setValue('49.99');
    const [, every] = await controls(loader, 'Billed every', MatInputHarness);
    await every.setValue('3');
    await press(loader, 'Save');

    await until(() => dialog() === null);
    const [gym] = await storedSubs();
    expect(gym).toMatchObject({
      name: 'Local Gym',
      link: 'https://www.localgym.ca',
      plans: [
        {
          name: 'Basic',
          features: { 'streaming.ad-free': true, 'video.quality': '4k' },
          price: {
            amount: 29.99,
            currency: 'CAD',
            interval: 'month',
            intervalCount: 1,
            plusTax: true,
          },
          autoRenewAvailable: true,
        },
        {
          name: 'Premium',
          features: {},
          price: { amount: 49.99, currency: 'CAD', interval: 'month', intervalCount: 3 },
          autoRenewAvailable: true,
        },
      ],
    });
    expect(gym.plans[0].id).not.toBe(gym.plans[1].id);
    expect(document.querySelector('.mat-mdc-snack-bar-container')?.textContent).toContain(
      'Added Local Gym',
    );
    await until(
      () => document.activeElement === page().querySelector('[aria-label="Edit Local Gym"]'),
    );
  });

  it('won’t save without a name, a plan’s name and cost, or with a link that isn’t https://', async () => {
    await open();
    await click('New custom subscription');
    const loader = await dialogLoader();
    await (await control(loader, 'Website', MatInputHarness)).setValue('http://localgym.ca');
    await press(loader, 'Save');

    await until(() => errors().length === 4);
    expect(errors()).toEqual([
      'Give it a name',
      'Use a full address that starts with https://',
      'Give the plan a name',
      'Enter what it costs, 0 or more',
    ]);
    expect(document.activeElement).toBe(dialog()?.querySelector('input'));
    expect(await storedSubs()).toEqual([]);
    // The only plan can't be removed.
    expect(dialog()?.querySelector('.remove-plan')).toBeNull();
  });

  it('asks before a change reaches the items that use a plan, with their count', async () => {
    const gym = await subs.create(gymFields);
    const [first] = [
      await items.create(itemFields(gym.id, basicId)),
      await items.create(itemFields(gym.id, basicId, familyId)),
    ];
    // Both in the same list, so the row's "used in" can't tell one item from two.
    await until(() => items.records().length === 2);
    await open();
    await until(() => rows()[0]?.details?.includes('used in') === true);
    await click('Edit Local Gym');
    const loader = await dialogLoader();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Edit custom subscription');
    await (await control(loader, 'Cost', MatInputHarness)).setValue('31.99');

    answer = false;
    await press(loader, 'Save');
    await vi.waitFor(() => expect(questions).toHaveLength(1));
    expect(questions[0]).toEqual({
      title: 'Save changes to Local Gym?',
      message: '2 subscriptions in your lists use plans you changed, and change with them.',
      confirmText: 'Save changes',
      danger: false,
    });
    expect(dialog()).not.toBeNull();
    expect((await storedSubs())[0].plans[0].price.amount).toBe(29.99);

    answer = true;
    await press(loader, 'Save');
    await until(() => dialog() === null);
    expect((await storedSubs())[0].plans[0].price.amount).toBe(31.99);
    expect((await storedItems()).find((item) => item.id === first.id)?.deletedAt).toBeUndefined();
  });

  it('removes a plan’s items from their lists with it, after asking', async () => {
    const gym = await subs.create(gymFields);
    const premium = await items.create(itemFields(gym.id, premiumId));
    const basic = await items.create(itemFields(gym.id, basicId));
    await until(() => items.records().length === 2);
    await open();
    await until(() => rows()[0]?.details?.includes('used in') === true);
    await click('Edit Local Gym');
    const loader = await dialogLoader();
    await (
      await loader.getHarness(
        MatButtonHarness.with({ selector: '[aria-label="Remove plan Premium"]' }),
      )
    ).click();
    await fixture.whenStable();
    expect(document.activeElement?.textContent?.trim()).toMatch(/New plan$/);
    await press(loader, 'Save');

    await until(() => dialog() === null);
    expect(questions[0]).toMatchObject({
      message: '1 subscription uses a plan you removed, and is removed from 1 list.',
      danger: true,
    });
    expect((await storedSubs())[0].plans.map((plan) => plan.name)).toEqual(['Basic']);
    const stored = await storedItems();
    expect(stored.find((item) => item.id === premium.id)?.deletedAt).toBeDefined();
    expect(stored.find((item) => item.id === basic.id)?.deletedAt).toBeUndefined();
  });

  it('deletes one after asking, removing it from the lists that have it', async () => {
    const gym = await subs.create(gymFields);
    await subs.create({ ...gymFields, name: 'Substack' });
    await items.create(itemFields(gym.id, basicId));
    await open();
    await until(() => rows()[0]?.details === '2 plans · used in 1 list');
    await click('Delete Local Gym');

    await until(() => rows().length === 1);
    expect(questions[0]).toEqual({
      title: 'Delete Local Gym?',
      message: 'Also remove it from 1 list.',
      confirmText: 'Delete',
      danger: true,
    });
    expect((await storedSubs()).find((sub) => sub.id === gym.id)?.deletedAt).toBeDefined();
    expect((await storedItems()).every((item) => item.deletedAt !== undefined)).toBe(true);
    await until(
      () => document.activeElement === page().querySelector('[aria-label="Delete Substack"]'),
    );
    expect(document.querySelector('.mat-mdc-snack-bar-container')?.textContent).toContain(
      'Deleted Local Gym',
    );
  });

  it('keeps one when the question is turned down', async () => {
    await subs.create(gymFields);
    await open();
    answer = false;
    await click('Delete Local Gym');
    await vi.waitFor(() => expect(questions).toHaveLength(1));
    expect(questions[0].message).toBe('It isn’t in any of your lists.');
    expect(rows()).toHaveLength(1);
    expect((await storedSubs())[0].deletedAt).toBeUndefined();
  });
});
