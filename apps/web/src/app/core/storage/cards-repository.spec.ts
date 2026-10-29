import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import {
  InvalidRecordError,
  type ListDraft,
  type ListItem,
  type PaymentCard,
} from '@simply-sub/core';
import { AppLockRepository } from './app-lock-repository';
import { CardsRepository } from './cards-repository';
import { DraftsRepository } from './drafts-repository';
import { ItemsRepository } from './items-repository';
import { ListsRepository } from './lists-repository';
import type { NewRecord } from './record-repository';
import { RejectedRecords } from './rejected-records';
import { SettingsRepository } from './settings-repository';
import { StorageService } from './storage-service';
import { plantRows, storedRows, testStorage, until, type TestStorage } from './storage.testing';

// Payment cards (P11, M9.1): created, changed and soft-deleted, every record checked on the way in and out; and
// deleting one in use, which takes it off every item and draft in one transaction, with the app lock off and on.

function itemFields(planId: string, cardId?: string): Omit<NewRecord<'items'>, 'listId'> {
  return {
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    ...(cardId !== undefined && { cardId }),
    tagIds: [],
    rankOverrides: {},
    pinned: false,
  };
}

const cashBackFields: NewRecord<'cards'> = {
  name: 'Cash Back Mastercard',
  type: 'credit',
  network: 'mastercard',
  currency: 'CAD',
  cashbackPercent: 1.5,
  fxFeePercent: 2.5,
  monthlyLimit: 500,
};

describe('CardsRepository', () => {
  let storage: TestStorage;
  let cards: CardsRepository;
  let items: ItemsRepository;
  let drafts: DraftsRepository;
  let cashBack: PaymentCard;
  let debit: PaymentCard;
  let netflix: ListItem;
  let mullvad: ListItem;
  let gone: ListItem;
  let listId: string;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    cards = TestBed.inject(CardsRepository);
    items = TestBed.inject(ItemsRepository);
    drafts = TestBed.inject(DraftsRepository);
    await TestBed.inject(SettingsRepository).save({
      country: 'CA',
      currency: 'CAD',
      theme: 'system',
    });
    cashBack = await cards.create(cashBackFields);
    debit = await cards.create({
      name: 'Everyday Debit',
      type: 'debit',
      network: 'interac',
      currency: 'CAD',
      cashbackPercent: 0,
      fxFeePercent: 2.5,
    });
    listId = (await TestBed.inject(ListsRepository).create({ name: 'Work Related' })).id;
    netflix = await items.create({ ...itemFields('netflix.standard', cashBack.id), listId });
    mullvad = await items.create({ ...itemFields('mullvad.vpn', debit.id), listId });
    gone = await items.create({ ...itemFields('crave.premium', cashBack.id), listId });
    await items.remove(gone.id);
    // The editor's open, with Mullvad moved to the Cash Back card in it, not saved yet.
    await drafts.start(listId);
    await drafts.change(listId, (draft) => ({
      ...draft,
      items: draft.items.map((entry) =>
        entry.item.id === mullvad.id
          ? { ...entry, item: { ...entry.item, cardId: cashBack.id } }
          : entry,
      ),
    }));
    storage.clock.time = '2026-10-28T10:00:00.000Z';
    await until(() => cards.records().length === 2 && drafts.drafts().length === 1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every record as stored, opened when sealed, read through the repositories' engine. */
  async function readAll<T extends 'items' | 'drafts' | 'cards'>(table: T) {
    const engine = await TestBed.inject(StorageService).engine();
    return engine.read(table);
  }

  it('creates and changes cards, oldest first, and clears a field set to undefined', async () => {
    expect(cards.records().map((card) => card.name)).toEqual([
      'Cash Back Mastercard',
      'Everyday Debit',
    ]);
    await cards.update(cashBack.id, { nickname: 'Everyday', monthlyLimit: undefined });
    await until(() => cards.byId().get(cashBack.id)?.nickname === 'Everyday');
    const changed = cards.byId().get(cashBack.id);
    expect(changed).not.toHaveProperty('monthlyLimit');
    expect(changed?.updatedAt).toBe('2026-10-28T10:00:00.000Z');
  });

  it('refuses a card number, on the way in', async () => {
    await expect(
      cards.create({ ...cashBackFields, name: 'My card 4111 1111 1111 1111' }),
    ).rejects.toBeInstanceOf(InvalidRecordError);
    await expect(
      cards.update(cashBack.id, { nickname: '5500-0000-0000-0004' }),
    ).rejects.toBeInstanceOf(InvalidRecordError);
    expect(JSON.stringify(await storedRows(storage.indexedDB, 'cards'))).not.toMatch(/4111|5500/);
  });

  it('leaves out a stored card that fails its schema, on the way out', async () => {
    await plantRows(storage.indexedDB, 'cards', [
      { ...cashBack, id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d41', nickname: '4111111111111111' },
    ]);
    await until(() => TestBed.inject(RejectedRecords).count() === 1);
    expect(cards.records()).toHaveLength(2);
  });

  it('counts the subscriptions a card pays for, in lists and drafts', async () => {
    // Netflix, and Mullvad in the draft; not the deleted Crave.
    expect(await cards.usage(cashBack.id)).toBe(2);
    // Mullvad as saved.
    expect(await cards.usage(debit.id)).toBe(1);
  });

  async function expectRemoved(): Promise<void> {
    const storedCards = (await readAll('cards')) as PaymentCard[];
    expect(storedCards.find((card) => card.id === cashBack.id)?.deletedAt).toBe(
      '2026-10-28T10:00:00.000Z',
    );
    expect(storedCards.find((card) => card.id === debit.id)?.deletedAt).toBeUndefined();

    const storedItems = (await readAll('items')) as ListItem[];
    const byId = new Map(storedItems.map((item) => [item.id, item]));
    expect(byId.get(netflix.id)).not.toHaveProperty('cardId');
    expect(byId.get(netflix.id)?.updatedAt).toBe('2026-10-28T10:00:00.000Z');
    // Untouched: it was paid with the other card.
    expect(byId.get(mullvad.id)?.cardId).toBe(debit.id);
    expect(byId.get(mullvad.id)?.updatedAt).toBe(mullvad.updatedAt);
    // A deleted item loses it too, so a list's Undo can't bring it back.
    expect(byId.get(gone.id)).not.toHaveProperty('cardId');
    expect(byId.get(gone.id)?.deletedAt).toBeDefined();

    const [draft] = (await readAll('drafts')) as ListDraft[];
    for (const { item, saved } of draft.items) {
      expect(item.cardId).not.toBe(cashBack.id);
      expect(saved?.cardId).not.toBe(cashBack.id);
    }

    await until(() => !cards.byId().has(cashBack.id));
    expect(cards.records().map((card) => card.name)).toEqual(['Everyday Debit']);
    expect(TestBed.inject(RejectedRecords).count()).toBe(0);
  }

  it('deletes a card in use: soft-deleted, and off every item and draft, in one transaction', async () => {
    await cards.removeWithItems(cashBack.id);
    await expectRemoved();
  });

  it('does the same with the app lock on, writing every changed row sealed', async () => {
    await TestBed.inject(AppLockRepository).turnOn('correct horse battery', 15);
    await cards.removeWithItems(cashBack.id);
    await expectRemoved();
    for (const table of ['cards', 'items', 'drafts'] as const) {
      const rows = await storedRows(storage.indexedDB, table);
      for (const row of rows) expect(row, table).toHaveProperty('sealed');
      expect(JSON.stringify(rows), table).not.toContain('Cash Back Mastercard');
    }
  });

  it('changes nothing when the card is deleted already, or there is none', async () => {
    await cards.removeWithItems(cashBack.id);
    const before = await storedRows(storage.indexedDB, 'items');
    storage.clock.time = '2026-10-29T10:00:00.000Z';
    await cards.removeWithItems(cashBack.id);
    await cards.removeWithItems('0192f1c8-4f50-7162-bd7e-8f9a0b1c2d42');
    expect(await storedRows(storage.indexedDB, 'items')).toEqual(before);
  });

  it('assigns items their cards in one transaction, and gives back the cards they had', async () => {
    const before = await cards.assign([
      { itemId: netflix.id, cardId: debit.id },
      { itemId: mullvad.id },
      // Deleted: left as it is.
      { itemId: gone.id, cardId: debit.id },
    ]);
    expect(before).toEqual([
      { itemId: netflix.id, cardId: cashBack.id },
      { itemId: mullvad.id, cardId: debit.id },
    ]);
    const stored = new Map(((await readAll('items')) as ListItem[]).map((item) => [item.id, item]));
    expect(stored.get(netflix.id)?.cardId).toBe(debit.id);
    expect(stored.get(netflix.id)?.updatedAt).toBe('2026-10-28T10:00:00.000Z');
    expect(stored.get(mullvad.id)).not.toHaveProperty('cardId');
    expect(stored.get(gone.id)?.cardId).toBe(cashBack.id);
    // Undo puts them back.
    await cards.assign(before);
    const back = new Map(((await readAll('items')) as ListItem[]).map((item) => [item.id, item]));
    expect([back.get(netflix.id)?.cardId, back.get(mullvad.id)?.cardId]).toEqual([
      cashBack.id,
      debit.id,
    ]);
  });

  it('writes nothing when a step fails', async () => {
    const before = await storedRows(storage.indexedDB, 'items');
    const real = await TestBed.inject(StorageService).engine();
    // A write that fails part way, after the card and the items.
    vi.spyOn(real, 'transaction').mockImplementationOnce(async (tables, work) =>
      real.transaction.call(real, tables, async (transaction) =>
        work({
          ...transaction,
          put: async (table, record) => {
            if (table === 'drafts') throw new Error('Disk full');
            return transaction.put(table, record);
          },
        }),
      ),
    );
    await expect(cards.removeWithItems(cashBack.id)).rejects.toThrow('Disk full');
    expect(await storedRows(storage.indexedDB, 'items')).toEqual(before);
    expect(
      ((await readAll('cards')) as PaymentCard[]).every((card) => card.deletedAt === undefined),
    ).toBe(true);
  });
});
