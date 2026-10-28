import type { Interval } from '../catalog/price';
import type { ItemSource } from './list-item';
import type { ResolvedAddOn, ResolvedItem, UnresolvedReason } from './resolved';

// What an item is called, and how often it bills, in words: the same on the app's cards, rows and dialogs as in the
// exports (M7.5). The app writes money and dates itself.

/**
 * A plan's full name: "Netflix Standard", but "Proton Unlimited" for Proton's plan of that name, since plans often
 * start with their provider's name.
 */
export function planTitle(providerName: string, planName: string): string {
  return planName.toLocaleLowerCase('en').startsWith(providerName.toLocaleLowerCase('en'))
    ? planName
    : `${providerName} ${planName}`;
}

/** What an item is: "Netflix Standard", a bundle's name, or with a nickname "Mom's (Netflix Standard)". */
export function itemTitle({
  item,
  name,
  planName,
}: Pick<ResolvedItem, 'item' | 'name' | 'planName'>): string {
  const plan = item.source.kind === 'bundle' ? name : planTitle(name, planName);
  return item.nickname === undefined ? plan : `${item.nickname} (${plan})`;
}

/** How often a period bills, in words: monthly, every 3 months, every 30 days. */
export function periodText(interval: Interval, count: number): string {
  if (count === 1) {
    return { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[interval];
  }
  return `every ${count} ${interval}s`;
}

/** "Extra member", or "Extra member × 2". */
export function addOnText({ name, quantity }: Pick<ResolvedAddOn, 'name' | 'quantity'>): string {
  return quantity === 1 ? name : `${name} × ${quantity}`;
}

/** What an item is when it can't be resolved: its plan's or bundle's id, or that it's a custom subscription. */
export function sourceText(source: ItemSource): string {
  switch (source.kind) {
    case 'catalog':
      return source.planId;
    case 'bundle':
      return source.bundleId;
    case 'custom':
      return 'Custom subscription';
  }
}

/** Why an item can't be resolved, in words. */
export function unresolvedText(reason: UnresolvedReason): string {
  return {
    pending: 'Loading…',
    'plan-gone': 'This plan is no longer in the catalog',
    'bundle-gone': 'This bundle is no longer in the catalog',
    'custom-gone': 'Its custom subscription was deleted',
    'add-on-gone': 'One of its add-ons is no longer in the catalog',
    'no-price': 'There’s no price for how it’s billed',
  }[reason];
}
