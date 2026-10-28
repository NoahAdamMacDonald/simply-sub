import { describe, expect, it } from 'vitest';
import {
  addPeriods,
  afterPlanChange,
  billingDayChoices,
  defaultRenewal,
  isDuplicate,
  itemFormFor,
  itemFormIssues,
  itemFromForm,
  keptBillingDay,
  listItemSchema,
  newItemForm,
  periodAfterPlanChange,
  periodChoices,
  renewalAfterPeriodChange,
  sortedWindows,
  windowIssues,
  type ItemForm,
  type ItemFormContext,
  type ListItem,
  type Period,
  type WindowForm,
} from '../../src';
import { listId } from './fixtures';

const today = '2026-10-26';
const monthly: Period = { interval: 'month', intervalCount: 1 };
const yearly: Period = { interval: 'year', intervalCount: 1 };
const weekly: Period = { interval: 'week', intervalCount: 1 };

/** Netflix Standard for an Albertan, as Search's price asks for it: monthly, with its two kinds of extra member. */
function standardForm(changes: Partial<ItemForm> = {}): ItemForm {
  return {
    ...newItemForm({
      source: { kind: 'catalog', planId: 'netflix.standard' },
      period: monthly,
      addOnIds: ['netflix.extra-member-ads', 'netflix.extra-member'],
      today,
      country: 'CA',
      currency: 'CAD',
    }),
    ...changes,
  };
}

const context: ItemFormContext = {
  periods: [monthly, yearly],
  free: false,
  addOnLimit: 2,
  autoRenew: true,
  country: 'CA',
  providedKeys: ['streaming.ad-free', 'video.quality=1080p'],
  today,
};

const window = (
  start: string,
  end: string,
  repeatYearly = false,
): WindowForm & { start: string; end: string } => ({
  start,
  end,
  repeatYearly,
});

/** The item the fields make, as stored, so the schema can check it. */
function stored(fields: ReturnType<typeof itemFromForm>, extra: Partial<ListItem> = {}): ListItem {
  return listItemSchema.parse({
    id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c60',
    listId,
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
    ...fields,
    ...extra,
  });
}

describe('periodChoices', () => {
  it('offers each period a price list has, once, in its order', () => {
    expect(
      periodChoices([
        { interval: 'month', intervalCount: 1 },
        { interval: 'month', intervalCount: 1 },
        { interval: 'month', intervalCount: 12 },
        { interval: 'year', intervalCount: 1 },
      ]),
    ).toEqual([monthly, { interval: 'month', intervalCount: 12 }, yearly]);
    expect(periodChoices([])).toEqual([]);
  });
});

describe('periodAfterPlanChange', () => {
  it('keeps the period when the new plan is priced for it, else takes its first', () => {
    expect(periodAfterPlanChange(yearly, [monthly, yearly])).toEqual(yearly);
    // Every 12 months is a year, which bills on the same dates.
    expect(
      periodAfterPlanChange({ interval: 'month', intervalCount: 12 }, [monthly, yearly]),
    ).toEqual(yearly);
    expect(
      periodAfterPlanChange({ interval: 'year', intervalCount: 2 }, [
        monthly,
        { interval: 'month', intervalCount: 24 },
      ]),
    ).toEqual({ interval: 'month', intervalCount: 24 });
    expect(periodAfterPlanChange(yearly, [monthly])).toEqual(monthly);
    expect(periodAfterPlanChange({ interval: 'month', intervalCount: 3 }, [monthly])).toEqual(
      monthly,
    );
    // A plan with no prices for it keeps what it had.
    expect(periodAfterPlanChange(yearly, [])).toEqual(yearly);
  });
});

describe('addPeriods', () => {
  it('counts days and weeks, and months and years by the calendar', () => {
    expect(addPeriods('2026-01-31', { interval: 'day', intervalCount: 30 })).toBe('2026-03-02');
    expect(addPeriods('2026-01-31', weekly, 2)).toBe('2026-02-14');
    expect(addPeriods('2026-01-31', monthly)).toBe('2026-02-28');
    expect(addPeriods('2026-01-31', { interval: 'month', intervalCount: 3 })).toBe('2026-04-30');
    expect(addPeriods('2028-02-29', yearly)).toBe('2029-02-28');
  });
});

describe('defaultRenewal', () => {
  it('is one period from today', () => {
    expect(defaultRenewal(today, monthly)).toEqual({ anchorDate: '2026-11-26' });
    expect(defaultRenewal(today, yearly)).toEqual({ anchorDate: '2027-10-26' });
    expect(defaultRenewal(today, weekly)).toEqual({ anchorDate: '2026-11-02' });
    expect(defaultRenewal(today, { interval: 'day', intervalCount: 30 })).toEqual({
      anchorDate: '2026-11-25',
    });
  });

  it('keeps today’s day of the month when a shorter month cuts it: Jan 31 gives Feb 28, billed on the 31st', () => {
    expect(defaultRenewal('2027-01-31', monthly)).toEqual({
      anchorDate: '2027-02-28',
      billingDay: 31,
    });
    expect(defaultRenewal('2028-01-30', monthly)).toEqual({
      anchorDate: '2028-02-29',
      billingDay: 30,
    });
    expect(defaultRenewal('2026-03-31', monthly)).toEqual({
      anchorDate: '2026-04-30',
      billingDay: 31,
    });
    expect(defaultRenewal('2028-02-29', yearly)).toEqual({
      anchorDate: '2029-02-28',
      billingDay: 29,
    });
  });

  it('has no billing day for days and weeks, or when the month is long enough', () => {
    expect(defaultRenewal('2027-01-31', weekly)).toEqual({ anchorDate: '2027-02-07' });
    expect(defaultRenewal('2026-12-31', monthly)).toEqual({ anchorDate: '2027-01-31' });
    expect(defaultRenewal('2027-01-28', monthly)).toEqual({ anchorDate: '2027-02-28' });
  });
});

describe('billingDayChoices', () => {
  it('offers the later days only on the last day of a month shorter than 31 days', () => {
    expect(billingDayChoices('2027-02-28', monthly)).toEqual([29, 30, 31]);
    expect(billingDayChoices('2028-02-29', monthly)).toEqual([30, 31]);
    expect(billingDayChoices('2026-04-30', monthly)).toEqual([31]);
    expect(billingDayChoices('2026-04-29', monthly)).toEqual([]);
    expect(billingDayChoices('2027-02-27', monthly)).toEqual([]);
    expect(billingDayChoices('2026-01-31', monthly)).toEqual([]);
  });

  it('has none for a date input’s value that isn’t a date, a year of 6 digits', () => {
    expect(billingDayChoices('202702-02-28', monthly)).toEqual([]);
    expect(billingDayChoices('', monthly)).toEqual([]);
  });

  it('is only for months and years', () => {
    expect(billingDayChoices('2027-02-28', weekly)).toEqual([]);
    expect(billingDayChoices('2027-02-28', { interval: 'day', intervalCount: 30 })).toEqual([]);
  });

  it('offers only days a later charge’s month has', () => {
    // Billed yearly, Feb 28 can only be Feb 29, in a leap year.
    expect(billingDayChoices('2027-02-28', yearly)).toEqual([29]);
    expect(billingDayChoices('2026-04-30', yearly)).toEqual([]);
    // Every two years from 2027 is never a leap year; from 2026 it is in 2028.
    expect(billingDayChoices('2027-02-28', { interval: 'year', intervalCount: 2 })).toEqual([]);
    expect(billingDayChoices('2026-02-28', { interval: 'year', intervalCount: 2 })).toEqual([29]);
    // Every 6 months from Feb 28 comes to Aug 31; every 12 months is a year.
    expect(billingDayChoices('2027-02-28', { interval: 'month', intervalCount: 6 })).toEqual([
      29, 30, 31,
    ]);
    expect(billingDayChoices('2027-02-28', { interval: 'month', intervalCount: 12 })).toEqual([29]);
  });
});

describe('keptBillingDay', () => {
  it('keeps a billing day only while the date and period allow it', () => {
    expect(keptBillingDay('2027-02-28', monthly, 31)).toBe(31);
    expect(keptBillingDay('2027-02-28', yearly, 31)).toBeUndefined();
    expect(keptBillingDay('2027-02-27', monthly, 31)).toBeUndefined();
    expect(keptBillingDay('2027-02-28', weekly, 31)).toBeUndefined();
    expect(keptBillingDay('', monthly, 31)).toBeUndefined();
    expect(keptBillingDay('2027-02-28', monthly, undefined)).toBeUndefined();
  });
});

describe('renewalAfterPeriodChange', () => {
  it('moves the suggested date with the period', () => {
    expect(renewalAfterPeriodChange({ anchorDate: '2026-11-26' }, monthly, yearly, today)).toEqual({
      anchorDate: '2027-10-26',
    });
    expect(
      renewalAfterPeriodChange(
        { anchorDate: '2027-02-28', billingDay: 31 },
        monthly,
        weekly,
        '2027-01-31',
      ),
    ).toEqual({ anchorDate: '2027-02-07' });
    expect(renewalAfterPeriodChange({ anchorDate: '' }, monthly, yearly, today)).toEqual({
      anchorDate: '2027-10-26',
    });
  });

  it('keeps a date the user entered, and its billing day while it applies', () => {
    const entered = { anchorDate: '2027-02-28', billingDay: 31 };
    expect(
      renewalAfterPeriodChange(entered, monthly, { interval: 'month', intervalCount: 3 }, today),
    ).toEqual(entered);
    expect(renewalAfterPeriodChange(entered, monthly, weekly, today)).toEqual({
      anchorDate: '2027-02-28',
    });
  });
});

describe('windowIssues', () => {
  it('passes windows that don’t overlap, a yearly one’s copies included', () => {
    expect(
      windowIssues([
        window('2026-09-02', '2026-11-01', true),
        window('2027-01-10', '2027-02-10'),
        window('2026-11-02', '2026-12-01'),
      ]),
    ).toEqual([]);
  });

  it('needs at least one window, with both dates', () => {
    expect(windowIssues([])).toEqual([{ path: ['windows'], message: 'Add at least one window' }]);
    expect(windowIssues([window('', '')])).toEqual([
      { path: ['windows', 0, 'start'], message: 'Enter the start date' },
      { path: ['windows', 0, 'end'], message: 'Enter the end date' },
    ]);
  });

  it('needs each end after its start', () => {
    expect(windowIssues([window('2026-09-02', '2026-09-02')])).toEqual([
      { path: ['windows', 0, 'end'], message: 'Must be after the start date' },
    ]);
    expect(windowIssues([window('2026-09-02', '2026-08-01')])).toEqual([
      { path: ['windows', 0, 'end'], message: 'Must be after the start date' },
    ]);
  });

  it('finds windows that overlap, at the later one’s start', () => {
    expect(
      windowIssues([window('2026-09-02', '2026-11-01'), window('2026-10-01', '2026-12-01')]),
    ).toEqual([{ path: ['windows', 1, 'start'], message: 'Overlaps window 1' }]);
    // Both are active on Nov 1.
    expect(
      windowIssues([
        window('2026-12-01', '2027-01-01'),
        window('2026-09-02', '2026-11-01'),
        window('2026-11-01', '2026-11-20'),
      ]),
    ).toEqual([{ path: ['windows', 2, 'start'], message: 'Overlaps window 2' }]);
  });

  it('finds a window that overlaps a yearly window’s copy in a later year', () => {
    expect(
      windowIssues([window('2026-09-02', '2026-11-01', true), window('2028-10-15', '2028-12-01')]),
    ).toEqual([{ path: ['windows', 1, 'start'], message: 'Overlaps window 1' }]);
    // Over the new year: Dec 2026 to Jan 2027 again in Dec 2029, which meets Jan 2030.
    expect(
      windowIssues([
        window('2030-01-05', '2030-02-01', true),
        window('2026-12-01', '2027-01-10', true),
      ]),
    ).toEqual([{ path: ['windows', 1, 'start'], message: 'Overlaps window 1' }]);
    // A window before a yearly one's first doesn't meet its copies.
    expect(
      windowIssues([window('2027-09-02', '2027-11-01', true), window('2026-10-01', '2026-10-20')]),
    ).toEqual([]);
  });

  it('needs a yearly window to be shorter than a year', () => {
    expect(windowIssues([window('2026-09-02', '2027-09-02', true)])).toEqual([
      {
        path: ['windows', 0, 'end'],
        message: 'A window that repeats every year must be shorter than a year',
      },
    ]);
    expect(windowIssues([window('2026-09-02', '2027-09-01', true)])).toEqual([]);
  });
});

describe('sortedWindows', () => {
  it('orders windows by start, then end', () => {
    const later = window('2027-01-10', '2027-02-10');
    const first = window('2026-09-02', '2026-10-01');
    const longer = window('2026-09-02', '2026-11-01');
    expect(sortedWindows([later, longer, first])).toEqual([first, longer, later]);
  });
});

describe('itemFormIssues', () => {
  it('passes a new item’s form as it starts', () => {
    expect(itemFormIssues(standardForm(), context)).toEqual([]);
  });

  it('needs the next renewal for Ongoing billing', () => {
    expect(itemFormIssues(standardForm({ anchorDate: '' }), context)).toEqual([
      { path: ['anchorDate'], message: 'Enter the next renewal date' },
    ]);
  });

  it('takes a date the picker couldn’t read (null) as none', () => {
    expect(itemFormIssues(standardForm({ anchorDate: null }), context)).toEqual([
      { path: ['anchorDate'], message: 'Enter the next renewal date' },
    ]);
    expect(
      itemFormIssues(
        standardForm({
          mode: 'limited',
          windows: [{ start: null, end: '2026-12-01', repeatYearly: false }],
        }),
        context,
      ),
    ).toEqual([{ path: ['windows', 0, 'start'], message: 'Enter the start date' }]);
    expect(billingDayChoices(null, monthly)).toEqual([]);
    const fields = itemFromForm(
      standardForm({ startDate: null, endDate: null, priceUntil: null }),
      context,
    );
    expect(fields.billing).not.toHaveProperty('startDate');
    expect(fields.billing).not.toHaveProperty('endDate');
  });

  it('needs an end after the date it was subscribed since', () => {
    const form = standardForm({ startDate: '2026-01-10', endDate: '2026-01-10' });
    expect(itemFormIssues(form, context)).toEqual([
      { path: ['endDate'], message: 'Must be after the date you subscribed' },
    ]);
    expect(itemFormIssues({ ...form, endDate: '2026-01-11' }, context)).toEqual([]);
  });

  it('needs a period the plan is priced for, and a count from 1 to 120', () => {
    expect(itemFormIssues(standardForm({ interval: 'week' }), context)).toEqual([
      { path: ['interval'], message: 'This plan isn’t billed that way' },
    ]);
    // A custom plan's any period will do.
    const custom = { ...context, periods: undefined };
    expect(itemFormIssues(standardForm({ interval: 'week', intervalCount: 2 }), custom)).toEqual(
      [],
    );
    for (const intervalCount of [0, 1.5, 121]) {
      expect(itemFormIssues(standardForm({ intervalCount }), custom)).toEqual([
        { path: ['intervalCount'], message: 'Enter a whole number from 1 to 120' },
      ]);
    }
  });

  it('checks the windows of Specific dates, not the renewal', () => {
    const form = standardForm({
      mode: 'limited',
      anchorDate: '',
      windows: [window('2026-09-02', '2026-11-01'), window('2026-10-01', '2026-12-01')],
    });
    expect(itemFormIssues(form, context)).toEqual([
      { path: ['windows', 1, 'start'], message: 'Overlaps window 1' },
    ]);
  });

  it('allows add-ons up to the plan’s limit in all', () => {
    const addOns = [
      { id: 'netflix.extra-member-ads', chosen: true, quantity: 1 },
      { id: 'netflix.extra-member', chosen: true, quantity: 1 },
    ];
    expect(itemFormIssues(standardForm({ addOns }), context)).toEqual([]);
    expect(
      itemFormIssues(standardForm({ addOns: [addOns[0], { ...addOns[1], quantity: 2 }] }), context),
    ).toEqual([{ path: ['addOns', 1, 'chosen'], message: 'This plan allows 2 in all' }]);
    // One not taken doesn't count.
    expect(
      itemFormIssues(
        standardForm({ addOns: [{ ...addOns[0], chosen: false, quantity: 2 }, addOns[1]] }),
        context,
      ),
    ).toEqual([]);
  });

  it('needs an own price above 0, with a currency', () => {
    for (const priceAmount of [null, 0, -5]) {
      expect(itemFormIssues(standardForm({ ownPrice: true, priceAmount }), context)).toEqual([
        { path: ['priceAmount'], message: 'Enter an amount above 0' },
      ]);
    }
    expect(
      itemFormIssues(
        standardForm({ ownPrice: true, priceAmount: 15.99, priceCurrency: '' }),
        context,
      ),
    ).toEqual([{ path: ['priceCurrency'], message: 'Choose a currency' }]);
    // Unticked, what it holds isn't checked.
    expect(itemFormIssues(standardForm({ ownPrice: false, priceAmount: 0 }), context)).toEqual([]);
  });

  it('checks only a free plan’s dates', () => {
    const free = { ...context, free: true };
    const form = standardForm({
      anchorDate: '',
      interval: 'week',
      mode: 'limited',
      windows: [],
      ownPrice: true,
      priceAmount: 0,
    });
    expect(itemFormIssues(form, free)).toEqual([]);
    expect(
      itemFormIssues({ ...form, startDate: '2026-02-01', endDate: '2026-01-01' }, free),
    ).toEqual([{ path: ['endDate'], message: 'Must be after the date you subscribed' }]);
  });
});

describe('itemFromForm', () => {
  it('makes a new item from the form, as the schema stores it', () => {
    const fields = itemFromForm(standardForm(), context);
    expect(fields).toEqual({
      source: { kind: 'catalog', planId: 'netflix.standard' },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-26',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
    });
    expect(() => stored(fields)).not.toThrow();
  });

  it('keeps every field the form sets', () => {
    const fields = itemFromForm(
      standardForm({
        addOns: [
          { id: 'netflix.extra-member-ads', chosen: false, quantity: 1 },
          { id: 'netflix.extra-member', chosen: true, quantity: 2 },
        ],
        anchorDate: '2027-02-28',
        billingDay: 31,
        startDate: '2025-01-31',
        endDate: '2027-06-30',
        autoRenew: false,
        ownPrice: true,
        priceAmount: 15.99,
        priceCurrency: 'USD',
        priceUntil: '2027-01-31',
        plusTax: true,
        region: 'US',
        rankOverrides: { 'streaming.ad-free': 'essential', 'video.quality=4k': 'needed' },
        tagIds: ['0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d'],
        cardId: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
        ownRanks: true,
      }),
      context,
    );
    expect(fields).toEqual({
      source: {
        kind: 'catalog',
        planId: 'netflix.standard',
        addOns: [{ id: 'netflix.extra-member', quantity: 2 }],
      },
      region: 'US',
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2027-02-28',
        billingDay: 31,
        startDate: '2025-01-31',
        endDate: '2027-06-30',
        autoRenew: false,
      },
      priceOverride: { amount: 15.99, currency: 'USD', until: '2027-01-31', plusTax: true },
      tagIds: ['0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d'],
      // 4K isn't a key Netflix Standard provides.
      rankOverrides: { 'streaming.ad-free': 'essential' },
      cardId: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
      // Its ranks aren't shared with its provider's other plans (M6.14).
      ownRanks: true,
    });
    expect(() => stored(fields)).not.toThrow();
  });

  it('leaves out a billing day the date no longer has, and auto-renewal a plan doesn’t have', () => {
    const fields = itemFromForm(standardForm({ anchorDate: '2027-02-27', billingDay: 31 }), {
      ...context,
      autoRenew: false,
    });
    expect(fields.billing).toEqual({
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2027-02-27',
      autoRenew: false,
    });
  });

  it('saves Specific dates’ windows in date order', () => {
    const fields = itemFromForm(
      standardForm({
        mode: 'limited',
        windows: [window('2027-09-02', '2027-11-01', true), window('2026-12-01', '2027-01-01')],
      }),
      context,
    );
    expect(fields.billing).toEqual({
      mode: 'limited',
      windows: [window('2026-12-01', '2027-01-01'), window('2027-09-02', '2027-11-01', true)],
      interval: 'month',
      intervalCount: 1,
    });
    expect(() => stored(fields)).not.toThrow();
  });

  it('saves a free plan as Ongoing from today, with no own price or card', () => {
    const free = { ...context, free: true, periods: [monthly] };
    const form = standardForm({
      mode: 'limited',
      ownPrice: true,
      priceAmount: 4.99,
      startDate: '2026-01-01',
      cardId: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
    });
    const fields = itemFromForm(form, free);
    expect(fields.billing).toEqual({
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: today,
      startDate: '2026-01-01',
      autoRenew: true,
    });
    expect(fields.priceOverride).toBeUndefined();
    expect(fields.cardId).toBeUndefined();
    expect(() => stored(fields)).not.toThrow();
  });

  it('keeps a free item’s own anchor when it’s changed', () => {
    const billingBefore: ListItem['billing'] = {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-02-28',
      billingDay: 31,
      autoRenew: true,
    };
    const fields = itemFromForm(standardForm(), { ...context, free: true, billingBefore });
    expect(fields.billing).toEqual(billingBefore);
  });

  it('makes a bundle’s and a custom plan’s source', () => {
    const bundle = newItemForm({
      source: { kind: 'bundle', bundleId: 'bundle.netflix-crave' },
      period: monthly,
      addOnIds: [],
      today,
      country: 'CA',
      currency: 'CAD',
    });
    expect(itemFromForm(bundle, context).source).toEqual({
      kind: 'bundle',
      bundleId: 'bundle.netflix-crave',
    });
    const source = {
      kind: 'custom' as const,
      customSubId: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c',
      customPlanId: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d',
    };
    const custom = newItemForm({
      source,
      period: { interval: 'week', intervalCount: 2 },
      addOnIds: [],
      today,
      country: 'CA',
      currency: 'CAD',
    });
    const fields = itemFromForm(custom, { ...context, periods: undefined });
    expect(fields.source).toEqual(source);
    expect(fields.billing).toMatchObject({ interval: 'week', intervalCount: 2 });
  });
});

describe('newItemForm', () => {
  it('starts “I pay a different price” with a reseller’s price', () => {
    const form = newItemForm({
      source: { kind: 'catalog', planId: 'mullvad.vpn' },
      period: yearly,
      ownPrice: { amount: 87, currency: 'CAD', plusTax: true },
      addOnIds: [],
      today,
      country: 'CA',
      currency: 'CAD',
    });
    expect(form).toMatchObject({
      ownPrice: true,
      priceAmount: 87,
      priceCurrency: 'CAD',
      plusTax: true,
    });
    expect(itemFromForm(form, { ...context, periods: [yearly] }).priceOverride).toEqual({
      amount: 87,
      currency: 'CAD',
      plusTax: true,
    });
  });
});

describe('itemFormFor', () => {
  it('gives back the item it was made from, when nothing is changed', () => {
    const item = stored(
      itemFromForm(
        standardForm({
          addOns: [
            { id: 'netflix.extra-member-ads', chosen: true, quantity: 1 },
            { id: 'netflix.extra-member', chosen: false, quantity: 1 },
          ],
          anchorDate: '2027-02-28',
          billingDay: 31,
          endDate: '2027-06-30',
          ownPrice: true,
          priceAmount: 15.99,
          priceUntil: '2027-01-31',
          region: 'US',
          rankOverrides: { 'streaming.ad-free': 'critical' },
          cardId: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
          ownRanks: true,
        }),
        context,
      ),
    );
    const options = {
      addOnIds: ['netflix.extra-member-ads', 'netflix.extra-member'],
      today,
      country: 'CA',
      currency: 'CAD',
    };
    const form = itemFormFor(item, options);
    expect(form).toMatchObject({
      addOns: [
        { id: 'netflix.extra-member-ads', chosen: true, quantity: 1 },
        { id: 'netflix.extra-member', chosen: false, quantity: 1 },
      ],
      anchorDate: '2027-02-28',
      billingDay: 31,
      windows: [window(today, '')],
      region: 'US',
      cardId: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
      ownRanks: true,
    });
    expect(stored(itemFromForm(form, context))).toEqual(item);

    const limited = stored({
      ...itemFromForm(form, context),
      billing: {
        mode: 'limited',
        windows: [window('2026-09-02', '2026-11-01', true)],
        interval: 'month',
        intervalCount: 1,
      },
    });
    const limitedForm = itemFormFor(limited, options);
    // Ongoing's fields start as a new item's would.
    expect(limitedForm).toMatchObject({ mode: 'limited', anchorDate: '2026-11-26' });
    expect(stored(itemFromForm(limitedForm, context))).toEqual(limited);
  });
});

describe('afterPlanChange', () => {
  it('keeps the period and the add-ons the new plan has too', () => {
    const form = standardForm({
      interval: 'year',
      addOns: [
        { id: 'netflix.extra-member-ads', chosen: false, quantity: 1 },
        { id: 'netflix.extra-member', chosen: true, quantity: 2 },
      ],
    });
    expect(
      afterPlanChange(form, { periods: [monthly, yearly], addOnIds: ['netflix.extra-member'] }),
    ).toMatchObject({
      interval: 'year',
      addOns: [{ id: 'netflix.extra-member', chosen: true, quantity: 2 }],
    });
  });

  it('takes the new plan’s first period when it isn’t priced for the one chosen', () => {
    const form = standardForm({ interval: 'month', intervalCount: 3 });
    expect(afterPlanChange(form, { periods: [yearly, monthly], addOnIds: [] })).toMatchObject({
      interval: 'year',
      intervalCount: 1,
      addOns: [],
    });
    // A custom plan, or prices not loaded yet: any period will do.
    expect(afterPlanChange(form, { addOnIds: [] })).toMatchObject({
      interval: 'month',
      intervalCount: 3,
    });
  });
});

describe('isDuplicate', () => {
  const items = [
    stored(itemFromForm(standardForm(), context)),
    stored(
      {
        ...itemFromForm(standardForm(), context),
        source: { kind: 'bundle', bundleId: 'bundle.netflix-crave' },
      },
      { id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c61' },
    ),
  ];

  it('finds the same plan, whatever its add-ons, or the same bundle', () => {
    expect(
      isDuplicate(
        {
          kind: 'catalog',
          planId: 'netflix.standard',
          addOns: [{ id: 'netflix.extra-member', quantity: 1 }],
        },
        items,
      ),
    ).toBe(true);
    expect(isDuplicate({ kind: 'bundle', bundleId: 'bundle.netflix-crave' }, items)).toBe(true);
    expect(isDuplicate({ kind: 'catalog', planId: 'netflix.premium' }, items)).toBe(false);
  });

  it('finds another item’s plan when an item is changed to it, but not the item’s own', () => {
    const [netflix, bundle] = items;
    expect(isDuplicate({ kind: 'catalog', planId: 'netflix.standard' }, items, netflix)).toBe(
      false,
    );
    expect(isDuplicate({ kind: 'catalog', planId: 'netflix.standard' }, items, bundle)).toBe(true);
    // An item whose plan is in the list twice already can be changed without asking.
    const twice = [...items, { ...netflix, id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c62' }];
    expect(isDuplicate(netflix.source, twice, netflix)).toBe(false);
  });
});

describe('nickname and note', () => {
  it('start empty, and an item’s are filled in', () => {
    expect(standardForm()).toMatchObject({ nickname: '', note: '' });
    const form = itemFormFor(
      stored(itemFromForm(standardForm(), context), { nickname: "Mom's", note: 'Hers' }),
      {
        addOnIds: [],
        today,
        country: 'CA',
        currency: 'CAD',
      },
    );
    expect(form).toMatchObject({ nickname: "Mom's", note: 'Hers' });
  });

  it('are saved trimmed, and left out when empty', () => {
    const fields = itemFromForm(standardForm({ nickname: "  Mom's ", note: ' Hers\n' }), context);
    expect(fields).toMatchObject({ nickname: "Mom's", note: 'Hers' });
    expect(stored(fields)).toMatchObject({ nickname: "Mom's", note: 'Hers' });
    const empty = itemFromForm(standardForm({ nickname: '  ', note: '' }), context);
    expect(empty).not.toHaveProperty('nickname');
    expect(empty).not.toHaveProperty('note');
  });

  it('can be at most 60 and 1000 characters', () => {
    expect(
      itemFormIssues(standardForm({ nickname: 'x'.repeat(61), note: 'x'.repeat(1001) }), context),
    ).toEqual([
      { path: ['nickname'], message: 'Use at most 60 characters' },
      { path: ['note'], message: 'Use at most 1000 characters' },
    ]);
    expect(
      itemFormIssues(
        standardForm({ nickname: ` ${'x'.repeat(60)} `, note: 'x'.repeat(1000) }),
        context,
      ),
    ).toEqual([]);
  });
});
