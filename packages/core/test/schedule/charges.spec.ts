import { describe, expect, it } from 'vitest';
import {
  itemCharges,
  manualRenewal,
  nextCharge,
  periodCost,
  type Billing,
  type Chargeable,
  type ListItem,
  type PickedPrice,
  type TaxPlace,
} from '../../src';

// An item's charges (PROJECT-PLAN §3.1, BLUEPRINT §4.8): its dates priced, with the buyer's sales tax.

const ontario: TaxPlace = { country: 'CA', subdivision: 'CA-ON' };
const alberta: TaxPlace = { country: 'CA', subdivision: 'CA-AB' };
const itemId = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';

/** A price as pickPrice gives it, in CAD unless said, monthly unless said. */
function picked(
  amount: number,
  extra: Partial<PickedPrice> & { interval?: PickedPrice['interval'] } = {},
): PickedPrice {
  const interval = extra.interval ?? 'month';
  return {
    interval,
    intervalCount: 1,
    amount,
    currency: 'CAD',
    monthlyEquivalent: interval === 'year' ? amount / 12 : amount,
    autoRenew: true,
    native: true,
    source: { region: 'CA', amount, currency: 'CAD' },
    ...extra,
  };
}

function chargeable(
  billing: Partial<Billing> = {},
  extra: Partial<Omit<Chargeable, 'item'>> & { item?: Partial<ListItem> } = {},
): Chargeable {
  const { item, ...rest } = extra;
  return {
    item: {
      id: itemId,
      listId,
      source: { kind: 'catalog', planId: 'netflix.standard' },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-12',
        autoRenew: true,
        ...billing,
      } as Billing,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
      ...item,
    },
    listId,
    price: picked(18.99),
    addOns: [],
    ...rest,
  };
}

const november = { from: '2026-11-01', to: '2026-12-01' };
const amounts = (charges: { date: string; amount: number; tax: number }[]) =>
  charges.map(({ date, amount, tax }) => [date, round(amount), round(tax)]);
const round = (amount: number) => Math.round(amount * 1e6) / 1e6;

describe('itemCharges', () => {
  describe('sales tax', () => {
    it('adds the province’s rate to a catalog price: Netflix in Ontario is $21.46', () => {
      const [charge] = itemCharges(chargeable(), november, ontario);
      expect(charge).toEqual({
        date: '2026-11-12',
        amount: 18.99 * 1.13,
        tax: 18.99 * 0.13,
        currency: 'CAD',
        itemId,
        listId,
        converted: false,
        manual: false,
        charged: { amount: 18.99 * 1.13, currency: 'CAD' },
      });
      expect(round(charge.amount)).toBe(21.4587);
    });

    it.each([
      { place: alberta, rate: 5 },
      { place: { country: 'CA', subdivision: 'CA-QC' }, rate: 14.975 },
      { place: { country: 'CA', subdivision: 'CA-BC' }, rate: 12 },
      { place: { country: 'CA', subdivision: 'CA-NS' }, rate: 14 },
      { place: { country: 'US', salesTaxPercent: 7.5 }, rate: 7.5 },
      { place: { country: 'CA', subdivision: 'CA-ON', salesTaxPercent: 10 }, rate: 10 },
    ])('at $rate% for $place', ({ place, rate }) => {
      const [charge] = itemCharges(chargeable(), november, place);
      expect(round(charge.tax)).toBe(round((18.99 * rate) / 100));
      expect(round(charge.amount)).toBe(round(18.99 + (18.99 * rate) / 100));
    });

    it('adds none where prices include it, or where no rate is known', () => {
      for (const place of [
        { country: 'GB' },
        { country: 'SE', salesTaxPercent: 25 },
        { country: 'US' },
        { country: 'CA' },
      ]) {
        expect(itemCharges(chargeable(), november, place)[0].tax).toBe(0);
      }
    });

    it('adds none to a price that includes it everywhere: Mullvad’s €5', () => {
      const mullvad = chargeable(
        { autoRenew: false },
        { price: picked(7.85, { taxIncluded: true, native: false }) },
      );
      const [charge] = itemCharges(mullvad, november, ontario);
      expect([charge.amount, charge.tax]).toEqual([7.85, 0]);
    });

    it('takes a typed amount as charged, and adds tax to one marked plus tax', () => {
      const typed = chargeable({}, { overridePrice: picked(15, { taxIncluded: true }) });
      expect(amounts(itemCharges(typed, november, ontario))).toEqual([['2026-11-12', 15, 0]]);
      const plusTax = chargeable({}, { overridePrice: picked(15) });
      expect(amounts(itemCharges(plusTax, november, ontario))).toEqual([
        ['2026-11-12', 16.95, 1.95],
      ]);
    });

    it('follows the rule of the region an item was bought in, with no rate outside the user’s country', () => {
      const bought = chargeable({}, { item: { region: 'US' } });
      expect(itemCharges(bought, november, ontario)[0].tax).toBe(0);
      const ukItem = chargeable({}, { item: { region: 'GB' } });
      expect(itemCharges(ukItem, november, { country: 'US', salesTaxPercent: 8 })[0].tax).toBe(0);
    });
  });

  describe('what each charge costs', () => {
    it('adds its add-ons, each times its quantity', () => {
      const withMembers = chargeable(
        {},
        {
          addOns: [
            { id: 'netflix.extra-member', name: 'Extra member', quantity: 2, price: picked(7.99) },
          ],
        },
      );
      expect(amounts(itemCharges(withMembers, november, alberta))).toEqual([
        ['2026-11-12', round((18.99 + 2 * 7.99) * 1.05), round((18.99 + 2 * 7.99) * 0.05)],
      ]);
    });

    it('charges an add-on sold only monthly every month, from a yearly plan’s anchor', () => {
      const disney = chargeable(
        { interval: 'year', anchorDate: '2026-11-12' },
        {
          price: picked(169.99, { interval: 'year' }),
          addOns: [{ id: 'disney.extra', name: 'Extra member', quantity: 1, price: picked(7.99) }],
        },
      );
      const charges = itemCharges(
        disney,
        { from: '2026-11-01', to: '2027-02-01' },
        { country: 'GB' },
      );
      expect(amounts(charges)).toEqual([
        // The plan and the month's extra member fall on the same day: one charge.
        ['2026-11-12', 177.98, 0],
        ['2026-12-12', 7.99, 0],
        ['2027-01-12', 7.99, 0],
      ]);
    });

    it('costs the price override before its until, and the catalog price from that day on', () => {
      const offer = chargeable(
        {},
        {
          item: { priceOverride: { amount: 9.99, currency: 'CAD', until: '2027-01-12' } },
          overridePrice: picked(9.99, { taxIncluded: true }),
          addOns: [
            { id: 'netflix.extra-member', name: 'Extra member', quantity: 1, price: picked(7.99) },
          ],
        },
      );
      const charges = itemCharges(offer, { from: '2026-11-01', to: '2027-03-01' }, alberta);
      expect(amounts(charges)).toEqual([
        ['2026-11-12', 9.99, 0],
        ['2026-12-12', 9.99, 0],
        // The offer ended: the plan and its add-on, with tax.
        ['2027-01-12', round(26.98 * 1.05), round(26.98 * 0.05)],
        ['2027-02-12', round(26.98 * 1.05), round(26.98 * 0.05)],
      ]);
    });

    it('costs the catalog price before the override’s since, and the override from that day on (M9.6)', () => {
      const switched = chargeable(
        {},
        {
          item: { priceOverride: { amount: 9.99, currency: 'CAD', since: '2026-12-12' } },
          overridePrice: picked(9.99, { taxIncluded: true }),
        },
      );
      const charges = itemCharges(switched, { from: '2026-11-01', to: '2027-02-01' }, alberta);
      expect(amounts(charges)).toEqual([
        ['2026-11-12', round(18.99 * 1.05), round(18.99 * 0.05)],
        ['2026-12-12', 9.99, 0],
        ['2027-01-12', 9.99, 0],
      ]);
    });

    it('costs the override on every date when it has no until', () => {
      const own = chargeable(
        {},
        {
          item: { priceOverride: { amount: 15, currency: 'CAD' } },
          overridePrice: picked(15, { taxIncluded: true }),
        },
      );
      expect(
        itemCharges(own, { from: '2026-01-01', to: '2027-01-01' }, alberta).every(
          (charge) => charge.amount === 15,
        ),
      ).toBe(true);
    });

    it('creates no charges for a free plan, but one for a paid add-on on it', () => {
      const free = chargeable({}, { price: picked(0) });
      expect(itemCharges(free, { from: '2026-01-01', to: '2027-01-01' }, alberta)).toEqual([]);
      const withAddOn = chargeable(
        {},
        {
          price: picked(0),
          addOns: [{ id: 'x.extra', name: 'Extra', quantity: 1, price: picked(2) }],
        },
      );
      expect(amounts(itemCharges(withAddOn, november, alberta))).toEqual([
        ['2026-11-12', 2.1, 0.1],
      ]);
    });

    it('counts a 30-day plan twice in a month that has two of its dates', () => {
      const thirty = chargeable({ interval: 'day', intervalCount: 30, anchorDate: '2026-05-01' });
      expect(
        itemCharges(thirty, { from: '2026-05-01', to: '2026-06-01' }, { country: 'GB' }),
      ).toHaveLength(2);
    });
  });

  describe('what the provider charges', () => {
    it('is the price in its own currency with the tax, before it was converted', () => {
      const dollars = chargeable(
        {},
        {
          price: picked(13.79, {
            native: false,
            source: { region: 'US', amount: 9.99, currency: 'USD' },
            fx: { rate: 1.38, date: '2026-10-21', source: 'ECB' },
          }),
        },
      );
      const [charge] = itemCharges(dollars, november, alberta);
      expect([round(charge.amount), charge.currency]).toEqual([round(13.79 * 1.05), 'CAD']);
      expect([round(charge.charged.amount), charge.charged.currency]).toEqual([10.4895, 'USD']);
    });

    it('is a charge of its own for a part the provider charges in another currency', () => {
      const mixed = chargeable(
        {},
        {
          addOns: [
            {
              id: 'x.extra',
              name: 'Extra',
              quantity: 2,
              price: picked(6.9, {
                native: false,
                source: { region: 'US', amount: 5, currency: 'USD' },
                fx: { rate: 1.38, date: '2026-10-21', source: 'ECB' },
              }),
            },
          ],
        },
      );
      const charges = itemCharges(mixed, november, { country: 'GB' });
      expect(charges.map(({ amount, currency, charged }) => [amount, currency, charged])).toEqual([
        [18.99, 'CAD', { amount: 18.99, currency: 'CAD' }],
        [13.8, 'CAD', { amount: 10, currency: 'USD' }],
      ]);
    });
  });

  describe('marks', () => {
    it('marks a converted price, and keeps one with no rate in its own currency, apart', () => {
      const converted = chargeable(
        {},
        {
          price: picked(13.79, {
            native: false,
            fx: { rate: 1.38, date: '2026-10-21', source: 'ECB' },
          }),
          addOns: [
            {
              id: 'x.extra',
              name: 'Extra',
              quantity: 1,
              price: picked(5, { currency: 'EUR', native: false }),
            },
          ],
        },
      );
      const charges = itemCharges(converted, november, { country: 'GB' });
      expect(
        charges.map(({ amount, currency, converted }) => [amount, currency, converted]),
      ).toEqual([
        [13.79, 'CAD', true],
        [5, 'EUR', false],
      ]);
    });

    it('marks every charge manual when it renews by hand, and a prepaid plan’s Specific dates', () => {
      expect(itemCharges(chargeable({ autoRenew: false }), november, alberta)[0].manual).toBe(true);
      const windows = chargeable(
        {
          mode: 'limited',
          windows: [{ start: '2026-11-01', end: '2027-01-01', repeatYearly: false }],
        } as Partial<Billing>,
        { price: picked(5, { autoRenew: false }) },
      );
      expect(itemCharges(windows, november, alberta).map((charge) => charge.manual)).toEqual([
        true,
      ]);
    });

    it('marks the last charge before the end date', () => {
      const ending = chargeable({ anchorDate: '2026-09-12', endDate: '2027-01-01' });
      const charges = itemCharges(ending, { from: '2026-10-01', to: '2027-03-01' }, alberta);
      expect(charges.map((charge) => [charge.date, charge.ends ?? false])).toEqual([
        ['2026-10-12', false],
        ['2026-11-12', false],
        ['2026-12-12', true],
      ]);
    });
  });
});

describe('nextCharge', () => {
  it('is the first charge on or after today, with tax', () => {
    const next = nextCharge(chargeable(), '2026-10-28', ontario);
    expect([next?.date, round(next?.amount ?? 0)]).toEqual(['2026-11-12', 21.4587]);
    expect(nextCharge(chargeable(), '2026-11-12', ontario)?.date).toBe('2026-11-12');
  });

  it('is the anchor while that is still to come, though a charge counted back from it falls today', () => {
    // Subscribed today, Oct 28, renewing in a month: today's payment is made, and the next is Nov 28.
    const fresh = chargeable({ anchorDate: '2026-11-28' });
    expect(nextCharge(fresh, '2026-10-28', alberta)?.date).toBe('2026-11-28');
    expect(itemCharges(fresh, { from: '2026-10-28', to: '2026-10-29' }, alberta)).toHaveLength(1);
    // Once the anchor has passed, the next is the first on or after today, today's included.
    expect(nextCharge(fresh, '2026-12-28', alberta)?.date).toBe('2026-12-28');
  });

  it('is none for a free plan, or once the end date has passed', () => {
    expect(nextCharge(chargeable({}, { price: picked(0) }), '2026-10-28', ontario)).toBeUndefined();
    expect(
      nextCharge(chargeable({ endDate: '2026-11-01' }), '2026-10-28', ontario),
    ).toBeUndefined();
  });

  it('is a separately billed add-on’s, when that comes first', () => {
    const disney = chargeable(
      { interval: 'year', anchorDate: '2027-03-15' },
      {
        price: picked(169.99, { interval: 'year' }),
        addOns: [{ id: 'disney.extra', name: 'Extra member', quantity: 1, price: picked(7.99) }],
      },
    );
    expect(nextCharge(disney, '2026-10-28', { country: 'GB' })).toMatchObject({
      date: '2026-11-15',
      amount: 7.99,
    });
  });

  it('looks past a date that costs nothing: a free plan’s, once its offer has ended', () => {
    const free = chargeable(
      {},
      {
        price: picked(0),
        item: { priceOverride: { amount: 3, currency: 'CAD', until: '2026-12-01' } },
        overridePrice: picked(3, { taxIncluded: true }),
      },
    );
    expect(nextCharge(free, '2026-10-28', alberta)?.date).toBe('2026-11-12');
    expect(nextCharge(free, '2026-11-13', alberta)).toBeUndefined();
  });
});

describe('periodCost', () => {
  const cost = (one: Chargeable, date = '2026-10-28', place: TaxPlace = alberta) => {
    const { amount, tax, currency, converted } = periodCost(one, date, place);
    return { amount: round(amount), tax: round(tax), currency, converted };
  };

  it('is a charge of the item’s period with the add-ons billed with it, sales tax included', () => {
    const withMember = chargeable(
      {},
      {
        addOns: [
          { id: 'netflix.extra-member', name: 'Extra member', quantity: 2, price: picked(7.99) },
        ],
      },
    );
    expect(cost(withMember)).toEqual({
      amount: round((18.99 + 2 * 7.99) * 1.05),
      tax: round((18.99 + 2 * 7.99) * 0.05),
      currency: 'CAD',
      converted: false,
    });
  });

  it('leaves out an add-on billed on a period of its own', () => {
    const disney = chargeable(
      { interval: 'year' },
      {
        price: picked(169.99, { interval: 'year' }),
        addOns: [{ id: 'disney.extra', name: 'Extra member', quantity: 1, price: picked(7.99) }],
      },
    );
    expect(cost(disney, '2026-10-28', { country: 'GB' }).amount).toBe(169.99);
  });

  it('is the price override while it applies, then the price', () => {
    const offer = chargeable(
      {},
      {
        item: { priceOverride: { amount: 9.99, currency: 'CAD', until: '2027-01-12' } },
        overridePrice: picked(9.99, { taxIncluded: true }),
      },
    );
    expect(cost(offer).amount).toBe(9.99);
    expect(cost(offer, '2027-01-12').amount).toBe(round(18.99 * 1.05));
  });

  it('marks a converted price, adds no tax to one that includes it, and follows the region it was bought in', () => {
    const mullvad = chargeable(
      { interval: 'year' },
      {
        price: picked(94.16, {
          interval: 'year',
          native: false,
          taxIncluded: true,
          source: { region: 'EU', amount: 60, currency: 'EUR' },
          fx: { rate: 1.5693, date: '2026-10-21', source: 'ECB' },
        }),
      },
    );
    expect(cost(mullvad)).toEqual({ amount: 94.16, tax: 0, currency: 'CAD', converted: true });
    // Bought in the US, where this buyer added no rate: no tax.
    const american = chargeable({}, { item: { region: 'US' } });
    expect(cost(american).tax).toBe(0);
  });

  it('is 0 in its price’s currency for a free plan', () => {
    expect(cost(chargeable({}, { price: picked(0, { currency: 'USD' }) }))).toEqual({
      amount: 0,
      tax: 0,
      currency: 'USD',
      converted: false,
    });
  });
});

describe('manualRenewal', () => {
  it('is an Ongoing item’s autoRenew turned off, or a prepaid price’s dates', () => {
    expect(manualRenewal(chargeable())).toBe(false);
    expect(manualRenewal(chargeable({ autoRenew: false }))).toBe(true);
    const window = {
      mode: 'limited',
      windows: [{ start: '2026-09-02', end: '2026-11-01' }],
    } as unknown as Partial<Billing>;
    expect(manualRenewal(chargeable(window, { price: picked(9, { autoRenew: false }) }))).toBe(
      true,
    );
    expect(manualRenewal(chargeable(window))).toBe(false);
  });
});
