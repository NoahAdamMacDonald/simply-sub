import { describe, expect, it } from 'vitest';
import {
  actionTitle,
  fingerprintOf,
  keptAddOns,
  namesText,
  reperiod,
  stableJson,
  suggestionSummary,
  withAddOn,
  type PickedPrice,
  type Severity,
  type SuggestedItem,
} from '../../src';
import {
  activeSlots,
  slotBounds,
  slotOf,
  slotsBefore,
  slotsFrom,
} from '../../src/optimizer/coverage';

describe('coverage slots', () => {
  const bounds = slotBounds('2026-10-28');

  it('are the next 12 months, a month each from today', () => {
    expect(bounds[0]).toBe('2026-10-28');
    expect(bounds[1]).toBe('2026-11-28');
    expect(bounds[12]).toBe('2027-10-28');
    expect(slotOf('2026-10-28', bounds)).toBe(0);
    expect(slotOf('2026-11-27', bounds)).toBe(0);
    expect(slotOf('2026-11-28', bounds)).toBe(1);
    expect(slotOf('2027-10-28', bounds)).toBe(12);
    expect(slotsFrom(10)).toBe(0b110000000000);
    expect(slotsBefore(2)).toBe(0b11);
    expect(slotsFrom(12)).toBe(0);
  });

  it('mark an ongoing item from its start date until its end date', () => {
    const ongoing = { mode: 'recurring', interval: 'month', intervalCount: 1, autoRenew: true };
    expect(activeSlots({ ...ongoing, anchorDate: '2026-11-10' } as never, bounds)).toBe(0xfff);
    // Ends Jan 15: active in the slots up to Dec 28 – Jan 28.
    expect(
      activeSlots({ ...ongoing, anchorDate: '2026-11-10', endDate: '2027-01-15' } as never, bounds),
    ).toBe(0b111);
    // Starts Sep 1, 2027: slots 10 and 11.
    expect(
      activeSlots(
        { ...ongoing, anchorDate: '2027-09-01', startDate: '2027-09-01' } as never,
        bounds,
      ),
    ).toBe(0b110000000000);
  });

  it('mark a window through its end, and a window that repeats yearly in every year', () => {
    const windows = (window: { start: string; end: string; repeatYearly: boolean }) =>
      activeSlots(
        { mode: 'limited', interval: 'month', intervalCount: 1, windows: [window] },
        bounds,
      );
    // This year's Sep–Oct runs until Oct 31, in slot 0; next year's is in slots 10 and 11.
    expect(windows({ start: '2026-09-01', end: '2026-10-31', repeatYearly: true })).toBe(
      0b110000000001,
    );
    expect(windows({ start: '2026-09-01', end: '2026-10-31', repeatYearly: false })).toBe(0b1);
    // A window across New Year, first held in 2024: Dec 20 – Jan 10, in the slots from Nov 28 and Dec 28.
    expect(windows({ start: '2024-12-20', end: '2025-01-10', repeatYearly: true })).toBe(0b110);
  });
});

describe('suggestion text', () => {
  const picked = (amount: number, interval: 'month' | 'year' = 'month'): PickedPrice => ({
    interval,
    intervalCount: 1,
    amount,
    currency: 'CAD',
    monthlyEquivalent: interval === 'year' ? amount / 12 : amount,
    autoRenew: true,
    native: true,
    source: { region: 'CA', amount, currency: 'CAD' },
  });
  const suggested = (title: string, price = picked(16.99)): SuggestedItem => ({
    itemId: title,
    title,
    name: title.split(' ')[0],
    planName: title.split(' ').slice(1).join(' '),
    price,
  });
  const on = '2026-11-10';

  it('names each change', () => {
    const disney = suggested('Disney+ Premium');
    expect(actionTitle({ kind: 'interval', item: disney, to: picked(169.99, 'year'), on })).toBe(
      'Switch Disney+ Premium to annual billing',
    );
    expect(
      actionTitle({
        kind: 'downgrade',
        item: disney,
        planId: 'disney-plus.standard',
        planName: 'Standard',
        to: picked(129.99, 'year'),
        on,
      }),
    ).toBe('Downgrade Disney+ Premium → Standard, annual billing');
    expect(
      actionTitle({
        kind: 'switch',
        item: disney,
        planId: 'disney-plus.standard',
        planName: 'Standard',
        to: picked(12.99),
        on,
      }),
    ).toBe('Switch Disney+ Premium → Standard');
    expect(actionTitle({ kind: 'remove', item: disney, on })).toBe('Remove Disney+ Premium');
    expect(
      actionTitle({
        kind: 'extra-member',
        item: suggested("Sam's (Netflix Standard)"),
        host: suggested('Netflix Premium'),
        addOnId: 'netflix.extra-member',
        addOnName: 'Extra member',
        to: picked(7.99),
        on,
      }),
    ).toBe("Make Sam's (Netflix Standard) an extra member on Netflix Premium");
    expect(
      actionTitle({
        kind: 'suite',
        items: [suggested('Proton Mail Plus'), suggested('Proton VPN Plus')],
        providerId: 'proton',
        planId: 'proton.unlimited',
        name: 'Proton',
        planName: 'Unlimited',
        to: picked(16.49),
        on,
      }),
    ).toBe('Replace Proton Mail Plus and Proton VPN Plus with Proton Unlimited');
    expect(namesText(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('fingerprints', () => {
  it('are 16 hex digits, the same for equal values in any key order, and differ otherwise', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
    const fingerprint = fingerprintOf('list', 'interval:1');
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf('list', 'interval:1')).toBe(fingerprint);
    expect(fingerprintOf('list', 'interval:2')).not.toBe(fingerprint);
    expect(fingerprintOf('lis', 't\u0000interval:1')).not.toBe(fingerprint);
  });
});

describe('changed items', () => {
  it('re-anchor on the next charge with the new period, keeping a billing day that still applies', () => {
    const billing = {
      mode: 'recurring' as const,
      interval: 'month' as const,
      intervalCount: 1,
      anchorDate: '2026-09-30',
      billingDay: 31 as const,
      autoRenew: true,
    };
    expect(reperiod(billing, { interval: 'year', intervalCount: 1 }, '2026-10-31')).toEqual({
      mode: 'recurring',
      interval: 'year',
      intervalCount: 1,
      anchorDate: '2026-10-31',
      autoRenew: true,
    });
    expect(reperiod(billing, { interval: 'month', intervalCount: 1 }, '2027-02-28')).toMatchObject({
      anchorDate: '2027-02-28',
      billingDay: 31,
    });
  });

  it('keep the add-ons the new plan allows, within its limit, and add an extra member', () => {
    const addOns = [
      { id: 'netflix.extra-member', quantity: 2 },
      { id: 'netflix.other', quantity: 1 },
    ];
    expect(keptAddOns(addOns, { addOnIds: ['netflix.extra-member'], addOnLimit: 1 })).toEqual([
      { id: 'netflix.extra-member', quantity: 1 },
    ]);
    expect(keptAddOns(addOns, {})).toBeUndefined();
    // An extra member who joins on a later day keeps it.
    const joining = [{ id: 'netflix.extra-member', quantity: 1, since: '2026-11-20' }];
    expect(keptAddOns(joining, { addOnIds: ['netflix.extra-member'] })).toEqual(joining);
    expect(withAddOn(addOns, 'netflix.extra-member', 1)[0]).toEqual({
      id: 'netflix.extra-member',
      quantity: 3,
    });
    expect(withAddOn(undefined, 'netflix.extra-member', 2)).toEqual([
      { id: 'netflix.extra-member', quantity: 2 },
    ]);
  });
});

describe('suggestionSummary', () => {
  const card = (fingerprint: string, severity: Severity) => ({ fingerprint, severity });

  it('counts what isn’t dismissed, coloured by the strongest, free savings last', () => {
    const cards = [card('a', 'free'), card('b', 'yellow'), card('c', 'orange')];
    expect(suggestionSummary(cards, new Set())).toEqual({ count: 3, strongest: 'orange' });
    expect(suggestionSummary(cards, new Set(['b', 'c']))).toEqual({ count: 1, strongest: 'free' });
    expect(suggestionSummary([...cards, card('d', 'red')], new Set())).toMatchObject({
      strongest: 'red',
    });
    expect(suggestionSummary(cards, new Set(['a', 'b', 'c']))).toEqual({ count: 0 });
  });
});
