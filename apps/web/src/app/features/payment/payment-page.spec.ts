import type { ComponentHarnessConstructor, HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideRouter } from '@angular/router';
import type { CatalogData, ListItem, PaymentCard, Settings } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { CardsRepository } from '../../core/storage/cards-repository';
import { ItemsRepository } from '../../core/storage/items-repository';
import type { NewRecord } from '../../core/storage/record-repository';
import {
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { ConfirmService, type ConfirmOptions } from '../../shared/confirm/confirm-service';
import { alberta, fx, searchCatalogData } from '../../shared/sub-card/search.testing';
import { PaymentPage } from './payment-page';

// Payment cards (P11, M9.1) on a fake IndexedDB, for an Albertan (5% GST) on Oct 25, 2026, with Search's small
// catalog: Crave Basic $11.99 and Premium $22 a month, and Mullvad €60 a year with VAT included (CA$94.16).
// ConfirmService answers as each test says.

const workId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const familyId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';

const simpliiFields: NewRecord<'cards'> = {
  name: 'Simplii Cashback Mastercard',
  nickname: 'Everyday',
  type: 'credit',
  network: 'mastercard',
  currency: 'CAD',
  cashbackPercent: 1.5,
  fxFeePercent: 2.5,
  monthlyLimit: 500,
};

const debitFields: NewRecord<'cards'> = {
  name: 'Everyday Debit',
  type: 'debit',
  network: 'interac',
  currency: 'CAD',
  cashbackPercent: 0,
  fxFeePercent: 2.5,
};

function itemFields(
  planId: string,
  listId: string,
  cardId: string | undefined,
  billing: Partial<NewRecord<'items'>['billing']> = {},
): NewRecord<'items'> {
  return {
    listId,
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-10',
      autoRenew: true,
      ...billing,
    } as NewRecord<'items'>['billing'],
    ...(cardId !== undefined && { cardId }),
    tagIds: [],
    rankOverrides: {},
    pinned: false,
  };
}

describe('PaymentPage', () => {
  let storage: TestStorage;
  let fixture: ComponentFixture<PaymentPage>;
  let answer: boolean;
  let questions: ConfirmOptions[];
  let cards: CardsRepository;
  let items: ItemsRepository;

  beforeEach(() => {
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
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    cards = TestBed.inject(CardsRepository);
    items = TestBed.inject(ItemsRepository);
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(PaymentPage);
    await until(() => page().querySelector('ul.tiles, ss-empty-state') !== null);
    await fixture.whenStable();
  }

  const page = () => fixture.nativeElement as HTMLElement;
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const tiles = () =>
    Array.from(page().querySelectorAll('li.tile')).map((tile) => ({
      title: text(tile.querySelector('.title')),
      name: text(tile.querySelector('.name')),
      badges: Array.from(tile.querySelectorAll('.badge')).map((badge) => text(badge)),
      rates: text(tile.querySelector('.rates')),
      limit:
        text(tile.querySelector('.limit-total [aria-hidden="true"]')) ??
        text(tile.querySelector('.no-limit')),
      paid: Array.from(tile.querySelectorAll('.paid li')).map(
        (row) =>
          text(row.querySelector('.paid-title')) +
          ' ' +
          text(row.querySelector('.paid-amount [aria-hidden="true"]')),
      ),
      total: text(tile.querySelector('.total [aria-hidden="true"]')),
      muted: text(tile.querySelector('.subscriptions .muted')),
    }));
  const dialog = () => document.querySelector<HTMLElement>('ss-card-dialog');
  const storedCards = async () => (await storedRows(storage.indexedDB, 'cards')) as PaymentCard[];
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
    return TestbedHarnessEnvironment.documentRootLoader(fixture).getChildLoader('ss-card-dialog');
  }

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

  async function press(loader: HarnessLoader, name: string): Promise<void> {
    await (await loader.getHarness(MatButtonHarness.with({ text: name }))).click();
    await fixture.whenStable();
  }

  const errors = () =>
    Array.from(dialog()?.querySelectorAll('mat-error') ?? []).map((error) =>
      error.textContent?.trim(),
    );

  it('says when there are none, and that it never asks for card numbers', async () => {
    await open();
    expect(page().querySelector('h1')?.textContent).toBe('Payment cards');
    expect(text(page().querySelector('.subtitle'))).toBe(
      "We never ask for card numbers, only what's needed to estimate cash back and fees.",
    );
    expect(page().querySelector('ss-empty-state h2')?.textContent).toBe('No cards yet');
  });

  it('shows each card with its network, cash back, FX fee, limit and the subscriptions it pays for', async () => {
    const simplii = await cards.create(simpliiFields);
    await cards.create(debitFields);
    // Charged on Oct 10 and Oct 20, this month.
    await items.create(
      itemFields('crave.premium', workId, simplii.id, { anchorDate: '2026-11-10' }),
    );
    await items.create(
      itemFields('mullvad.vpn', familyId, simplii.id, {
        interval: 'year',
        anchorDate: '2027-10-20',
        autoRenew: false,
      }),
    );
    await items.create(itemFields('crave.basic', familyId, undefined));
    await open();
    await until(() => tiles()[0]?.paid.length === 2);

    expect(tiles()).toEqual([
      {
        title: 'Everyday',
        name: 'Simplii Cashback Mastercard',
        badges: ['Mastercard', 'Credit'],
        rates: '1.5% cash back · FX fee 2.5%',
        // $22 + 5% GST, and €60 with VAT included plus the card's 2.5% FX fee on it.
        limit: '≈ $119.62 of $500.00',
        paid: ['Crave Premium $23.10', 'Mullvad VPN ≈ $7.85'],
        total: '≈ $30.95 / mo with tax',
        muted: undefined,
      },
      {
        title: 'Everyday Debit',
        name: undefined,
        badges: ['Interac', 'Debit'],
        rates: '0% cash back · FX fee 2.5%',
        limit: 'No limit',
        paid: [],
        total: undefined,
        muted: 'No subscriptions',
      },
    ]);
    expect(page().querySelector('.limit ss-budget-bar')?.getAttribute('aria-label')).toBe(
      'Everyday, this month against its limit',
    );
    expect(text(page().querySelector('.limit-total .visually-hidden'))).toBe(
      'about $119.62 of $500.00',
    );
    expect(text(page().querySelector('.unassigned'))).toBe('1 subscription has no card');
  });

  it('adds a card in the dialog, and says so', async () => {
    await open();
    await click('Add card');
    const loader = await dialogLoader();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Add a card');
    expect(text(dialog()?.querySelector('.never'))).toContain('Never enter a card number');
    // The user's currency to start with.
    expect(await (await control(loader, 'Card currency', MatSelectHarness)).getValueText()).toBe(
      'CAD — Canadian Dollar',
    );

    await (
      await control(loader, 'Name', MatInputHarness)
    ).setValue(' Simplii Cashback Mastercard ');
    await (await control(loader, 'Type', MatSelectHarness)).clickOptions({ text: 'Credit' });
    await (await control(loader, 'Network', MatSelectHarness)).clickOptions({ text: 'Mastercard' });
    await (await control(loader, 'Cash back', MatInputHarness)).setValue('1.5');
    await (await control(loader, 'FX fee', MatInputHarness)).setValue('2.5');
    await (await control(loader, 'Monthly limit', MatInputHarness)).setValue('500');
    await press(loader, 'Add card');

    await until(() => dialog() === null);
    const [saved] = await storedCards();
    expect(saved).toMatchObject({
      name: 'Simplii Cashback Mastercard',
      type: 'credit',
      network: 'mastercard',
      currency: 'CAD',
      cashbackPercent: 1.5,
      fxFeePercent: 2.5,
      monthlyLimit: 500,
    });
    expect(saved).not.toHaveProperty('nickname');
    expect(document.querySelector('.mat-mdc-snack-bar-container')?.textContent).toContain(
      'Added Simplii Cashback Mastercard',
    );
    await until(
      () =>
        document.activeElement ===
        page().querySelector('[aria-label="Edit Simplii Cashback Mastercard"]'),
    );
  });

  it('won’t save without a name, a type and a network, or with a card number in any field', async () => {
    await open();
    await click('Add card');
    const loader = await dialogLoader();
    await press(loader, 'Add card');
    await until(() => errors().length === 3);
    expect(errors()).toEqual([
      'Give the card a name',
      'Choose credit or debit',
      'Choose its network',
    ]);
    expect(document.activeElement).toBe(dialog()?.querySelector('input'));

    await (await control(loader, 'Name', MatInputHarness)).setValue('My card 4111 1111 1111 1111');
    await (await control(loader, 'Monthly limit', MatInputHarness)).setValue('5500000000000004');
    await (await control(loader, 'Type', MatSelectHarness)).clickOptions({ text: 'Debit' });
    await (await control(loader, 'Network', MatSelectHarness)).clickOptions({ text: 'Visa' });
    await press(loader, 'Add card');
    await until(() => errors().length === 2);
    expect(errors()).toEqual(['Never enter a card number', 'Never enter a card number']);
    expect(await storedCards()).toEqual([]);
  });

  it('changes a card, clearing a nickname and limit left empty', async () => {
    await cards.create(simpliiFields);
    await open();
    await click('Edit Everyday');
    const loader = await dialogLoader();
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Edit Everyday');
    await (await control(loader, 'Nickname', MatInputHarness)).setValue('');
    await (await control(loader, 'Monthly limit', MatInputHarness)).setValue('');
    await (await control(loader, 'Cash back', MatInputHarness)).setValue('2');
    await press(loader, 'Save');

    await until(() => dialog() === null);
    const [saved] = await storedCards();
    expect(saved).toMatchObject({ name: 'Simplii Cashback Mastercard', cashbackPercent: 2 });
    expect(saved).not.toHaveProperty('nickname');
    expect(saved).not.toHaveProperty('monthlyLimit');
    await until(() => tiles()[0]?.title === 'Simplii Cashback Mastercard');
    expect(tiles()[0].limit).toBe('No limit');
  });

  it('deletes a card after asking, and the subscriptions it paid for have no card', async () => {
    const simplii = await cards.create(simpliiFields);
    const debit = await cards.create(debitFields);
    const crave = await items.create(itemFields('crave.premium', workId, simplii.id));
    await items.create(itemFields('crave.basic', familyId, debit.id));
    await open();

    answer = false;
    await click('Delete Everyday');
    expect(questions).toEqual([
      {
        title: 'Delete Everyday?',
        message: '1 subscription is paid with it, and will have no card.',
        confirmText: 'Delete card',
        danger: true,
      },
    ]);
    expect((await storedCards()).every((card) => card.deletedAt === undefined)).toBe(true);

    answer = true;
    await click('Delete Everyday');
    await until(() => tiles().length === 1);
    const stored = new Map((await storedItems()).map((item) => [item.id, item]));
    expect(stored.get(crave.id)).not.toHaveProperty('cardId');
    expect(document.querySelector('.mat-mdc-snack-bar-container')?.textContent).toContain(
      'Deleted Everyday',
    );
    // Focus moves to the next tile's 🗑.
    await until(
      () => document.activeElement === page().querySelector('[aria-label="Delete Everyday Debit"]'),
    );

    await click('Delete Everyday Debit');
    expect(questions.at(-1)?.message).toBe(
      '1 subscription is paid with it, and will have no card.',
    );
    await until(() => page().querySelector('ss-empty-state') !== null);
    await until(() => document.activeElement === page().querySelector('.add'));
  });
});
