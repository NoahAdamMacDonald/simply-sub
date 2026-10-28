import { describe, expect, it } from 'vitest';
import {
  cardFormFor,
  cardFormIssues,
  cardFromForm,
  cardNetworkNames,
  cardNetworkSchema,
  cardNetworks,
  cardTitle,
  cardUsage,
  draftChanged,
  listDraftSchema,
  listItemSchema,
  looksLikeCardNumber,
  newCardForm,
  paymentCardSchema,
  savedItem,
  startDraft,
  withoutCard,
  type CardForm,
  type ListDraft,
  type ListItem,
  type PaymentCard,
  type SubscriptionList,
} from '../../src';
import { withValue } from '../catalog/helpers';
import { card, cardId, item as fullItem, list as savedWork } from './fixtures';

const otherCardId = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3f';
const secondItemId = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0c';
const thirdItemId = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0d';
const now = '2026-10-28T10:00:00.000Z';

/** The fixtures' item, not deleted, paid with the fixtures' card. */
const netflix = withValue(fullItem, ['deletedAt'], undefined) as ListItem;
const paid = (id: string, paidWith: string | undefined, deleted = false): ListItem => {
  const withCard: ListItem = { ...netflix, id, ...(deleted && { deletedAt: netflix.updatedAt }) };
  if (paidWith === undefined) delete withCard.cardId;
  else withCard.cardId = paidWith;
  return withCard;
};

describe('looksLikeCardNumber', () => {
  it.each(['4111111111111111', '4111 1111 1111 1111', '5500-0000-0000-0004', 'x123456789012'])(
    'finds 12 or more digits in a row: %s',
    (text) => expect(looksLikeCardNumber(text)).toBe(true),
  );

  it.each(['Visa 2026', '12345678901', '1.5', '500', 'Card 1234 5678'])(
    'lets anything shorter through: %s',
    (text) => expect(looksLikeCardNumber(text)).toBe(false),
  );
});

describe('cardTitle and cardNetworkNames', () => {
  it('calls a card by its nickname, else its name', () => {
    expect(cardTitle({ name: 'Simplii Cashback Mastercard', nickname: 'Everyday' })).toBe(
      'Everyday',
    );
    expect(cardTitle({ name: 'Simplii Cashback Mastercard' })).toBe('Simplii Cashback Mastercard');
  });

  it('names every network', () => {
    expect([...cardNetworks].sort()).toEqual([...cardNetworkSchema.options].sort());
    expect(cardNetworks.map((network) => cardNetworkNames[network])).toContain('Mastercard');
    expect(cardNetworkNames.amex).toBe('American Express');
  });
});

describe('cardUsage', () => {
  it('counts the items in lists and in drafts paid with the card, each once', () => {
    const items = [
      paid(netflix.id, cardId),
      paid(secondItemId, otherCardId),
      paid(thirdItemId, cardId, true),
    ];
    const draft: ListDraft = {
      ...startDraft(savedWork as SubscriptionList, [paid(netflix.id, cardId)], now),
      items: [
        { item: paid(netflix.id, cardId), saved: paid(netflix.id, cardId) },
        // Added in the draft, not saved yet.
        { item: paid(thirdItemId, cardId) },
        // Removed in the draft.
        { item: paid(secondItemId, cardId), removed: true },
      ],
    };
    // Netflix once (saved and in the draft), and the draft's new item; not the deleted or removed ones.
    expect(cardUsage(cardId, items, [draft])).toBe(2);
    expect(cardUsage(otherCardId, items, [draft])).toBe(1);
  });
});

describe('withoutCard', () => {
  it('takes the card off every item paid with it, a deleted one too, as a change made now', () => {
    const items = [
      paid(netflix.id, cardId),
      paid(secondItemId, otherCardId),
      paid(thirdItemId, cardId, true),
    ];
    const { items: changed } = withoutCard(cardId, items, [], now);
    expect(changed.map((item) => [item.id, 'cardId' in item, item.updatedAt])).toEqual([
      [netflix.id, false, now],
      [thirdItemId, false, now],
    ]);
    // Still deleted, and still a valid item.
    expect(changed[1].deletedAt).toBe(netflix.updatedAt);
    for (const item of changed) expect(listItemSchema.safeParse(item).success).toBe(true);
  });

  it("takes it off a draft's items as edited and as saved, so the draft doesn't look changed", () => {
    const saved = paid(netflix.id, cardId);
    const draft = startDraft(
      savedWork as SubscriptionList,
      [saved, paid(secondItemId, otherCardId)],
      now,
    );
    const { drafts } = withoutCard(cardId, [], [draft], now);
    expect(drafts).toHaveLength(1);
    const [entry, other] = drafts[0].items;
    expect('cardId' in entry.item).toBe(false);
    expect(entry.saved && 'cardId' in entry.saved).toBe(false);
    expect(other.item.cardId).toBe(otherCardId);
    // The item's own timestamps are Save's to set.
    expect(entry.item.updatedAt).toBe(saved.updatedAt);
    expect(draftChanged(drafts[0])).toBe(false);
    expect(listDraftSchema.safeParse(drafts[0]).success).toBe(true);
    // Saving it later writes nothing: the stored item lost the card in the same change.
    const stored = withoutCard(cardId, [saved], [], now).items[0];
    expect(savedItem(entry, stored, now)).toBeUndefined();
  });

  it('changes nothing when nothing is paid with the card', () => {
    expect(withoutCard(cardId, [paid(netflix.id, otherCardId)], [], now)).toEqual({
      items: [],
      drafts: [],
    });
  });
});

describe('the card form', () => {
  const filled: CardForm = {
    name: ' Simplii Cashback Mastercard ',
    nickname: '',
    type: 'credit',
    network: 'mastercard',
    currency: 'CAD',
    cashbackPercent: '1.5',
    fxFeePercent: '2.5',
    monthlyLimit: '',
  };
  const issuesOf = (form: CardForm) =>
    cardFormIssues(form).map(({ path, message }) => `${path.join('.')}: ${message}`);

  it("starts empty but for the user's currency", () => {
    expect(newCardForm('CAD')).toEqual({
      name: '',
      nickname: '',
      type: '',
      network: '',
      currency: 'CAD',
      cashbackPercent: '',
      fxFeePercent: '',
      monthlyLimit: '',
    });
  });

  it('needs a name, a type, a network and a currency', () => {
    expect(issuesOf({ ...newCardForm(''), name: '  ' })).toEqual([
      'name: Give the card a name',
      'type: Choose credit or debit',
      'network: Choose its network',
      'currency: Choose a currency',
    ]);
    expect(issuesOf(filled)).toEqual([]);
  });

  it.each(['name', 'nickname', 'cashbackPercent', 'fxFeePercent', 'monthlyLimit'] as const)(
    'refuses a card number in %s, and says only that',
    (field) => {
      expect(issuesOf({ ...filled, [field]: '4111 1111 1111 1111' })).toEqual([
        `${field}: Never enter a card number`,
      ]);
      expect(issuesOf({ ...filled, [field]: '5500000000000004' })).toEqual([
        `${field}: Never enter a card number`,
      ]);
    },
  );

  it('takes cash back from 0 to 20% and an FX fee from 0 to 10%', () => {
    expect(issuesOf({ ...filled, cashbackPercent: '20', fxFeePercent: '0' })).toEqual([]);
    expect(issuesOf({ ...filled, cashbackPercent: '20.5', fxFeePercent: '-1' })).toEqual([
      'cashbackPercent: Enter a percentage from 0 to 20',
      'fxFeePercent: Enter a percentage from 0 to 10',
    ]);
    expect(issuesOf({ ...filled, cashbackPercent: 'lots', fxFeePercent: '10.01' })).toHaveLength(2);
  });

  it('takes a limit above 0, or none', () => {
    expect(issuesOf({ ...filled, monthlyLimit: '500' })).toEqual([]);
    for (const limit of ['0', 'none', '-5']) {
      expect(issuesOf({ ...filled, monthlyLimit: limit })).toEqual([
        'monthlyLimit: Enter an amount above 0, or leave it empty for no limit',
      ]);
    }
  });

  it('takes at most 60 characters in a name or nickname', () => {
    expect(issuesOf({ ...filled, name: 'x'.repeat(60), nickname: 'y'.repeat(61) })).toEqual([
      'nickname: Use at most 60 characters',
    ]);
  });

  it('saves a trimmed card, with no cash back or FX fee when they were left empty', () => {
    expect(cardFromForm({ ...filled, cashbackPercent: '', fxFeePercent: ' ' })).toEqual({
      name: 'Simplii Cashback Mastercard',
      type: 'credit',
      network: 'mastercard',
      currency: 'CAD',
      cashbackPercent: 0,
      fxFeePercent: 0,
    });
  });

  it('gives back a saved card as it was', () => {
    const saved = card as PaymentCard;
    const form = cardFormFor(saved);
    expect(form).toMatchObject({
      nickname: 'Everyday',
      monthlyLimit: '500',
      cashbackPercent: '1.5',
    });
    expect(cardFormIssues(form)).toEqual([]);
    const { id, createdAt, updatedAt, ...fields } = saved;
    expect(cardFromForm(form)).toEqual(fields);
    expect(paymentCardSchema.parse({ ...cardFromForm(form), id, createdAt, updatedAt })).toEqual(
      saved,
    );
  });
});

describe('paymentCardSchema', () => {
  it('refuses a limit of 12 digits, which could be a card number', () => {
    expect(paymentCardSchema.safeParse({ ...card, monthlyLimit: 99_999_999_999 }).success).toBe(
      true,
    );
    expect(paymentCardSchema.safeParse({ ...card, monthlyLimit: 100_000_000_000 }).success).toBe(
      false,
    );
  });
});
