import { describe, expect, it } from 'vitest';
import {
  addOnText,
  itemTitle,
  periodText,
  planTitle,
  sourceText,
  unresolvedText,
  type ListItem,
} from '../../src';
import { item } from './fixtures';

// What an item is called and how often it bills, in words, as the app and the exports write them (M7.5).

describe('planTitle', () => {
  it('puts the provider’s name before the plan’s, unless the plan’s starts with it', () => {
    expect(planTitle('Netflix', 'Standard')).toBe('Netflix Standard');
    expect(planTitle('Proton', 'Proton Unlimited')).toBe('Proton Unlimited');
    expect(planTitle('Mullvad VPN', 'mullvad vpn')).toBe('mullvad vpn');
  });
});

describe('itemTitle', () => {
  const listItem = item as unknown as ListItem;
  const plain = { ...listItem, nickname: undefined };

  it('is the plan’s title, a bundle’s name, or the nickname with the plan', () => {
    expect(itemTitle({ item: plain, name: 'Netflix', planName: 'Standard' })).toBe(
      'Netflix Standard',
    );
    expect(
      itemTitle({
        item: { ...plain, source: { kind: 'bundle', bundleId: 'crave-netflix' } },
        name: 'Crave + Netflix',
        planName: 'Netflix Standard + Crave Premium',
      }),
    ).toBe('Crave + Netflix');
    expect(itemTitle({ item: listItem, name: 'Netflix', planName: 'Standard' })).toBe(
      "Mom's (Netflix Standard)",
    );
  });
});

describe('periodText', () => {
  it('says how often a period bills', () => {
    expect(periodText('month', 1)).toBe('monthly');
    expect(periodText('year', 1)).toBe('yearly');
    expect(periodText('week', 2)).toBe('every 2 weeks');
    expect(periodText('day', 30)).toBe('every 30 days');
  });
});

describe('addOnText', () => {
  it('gives the quantity when there’s more than one', () => {
    expect(addOnText({ name: 'Extra member', quantity: 1 })).toBe('Extra member');
    expect(addOnText({ name: 'Extra member', quantity: 2 })).toBe('Extra member × 2');
  });
});

describe('an item that can’t be resolved', () => {
  it('is named by its source, and says why', () => {
    expect(sourceText({ kind: 'catalog', planId: 'netflix.basic' })).toBe('netflix.basic');
    expect(sourceText({ kind: 'bundle', bundleId: 'crave-netflix' })).toBe('crave-netflix');
    expect(
      sourceText({
        kind: 'custom',
        customSubId: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c',
        customPlanId: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d',
      }),
    ).toBe('Custom subscription');
    expect(unresolvedText('plan-gone')).toBe('This plan is no longer in the catalog');
    expect(unresolvedText('no-price')).toBe('There’s no price for how it’s billed');
  });
});
