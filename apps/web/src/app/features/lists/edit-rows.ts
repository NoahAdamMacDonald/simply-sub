import type {
  ItemResolution,
  ItemSource,
  PickedPrice,
  Tag,
  UnresolvedReason,
} from '@simply-sub/core';
import { addOnText, billingText } from '../../shared/billing-text';
import { dateText } from '../../shared/date-text';
import { planTitle } from '../../shared/sub-card/card-text';

// What the list editor (P5) says about each item of its draft. Its renewal date and status ("Renews Nov 12") come
// with the charges (M7.1); until then a row says how it's billed (shared/billing-text.ts).

/** One item of the draft, as its row shows it. */
export interface EditRow {
  id: string;
  /** "Netflix Standard": what its buttons and messages call it. */
  title: string;
  /**
   * The provider's, bundle's or custom subscription's name, then its plan: "Netflix", "Standard". A plan named after
   * its provider is shown alone: "Mullvad VPN", "Proton Unlimited". With a nickname, the nickname, then the plan.
   */
  name: string;
  planName?: string;
  iconUrl?: string;
  /** What it costs: the price override while it applies, else the plan's price. None when it can't be priced. */
  price?: PickedPrice;
  /** Where it was bought, when that's not the user's country: its tax rule applies. */
  region?: string;
  /** Its billing, add-ons, own price and custom ranks, in words. */
  details: string[];
  tags: Tag[];
  /** Why it can't be priced or named. */
  problem?: string;
}

/** An item's row. `tags` are the user's, by id; one the item names that's gone is left out. */
export function editRow(result: ItemResolution, tags: ReadonlyMap<string, Tag>): EditRow {
  const item = result.ok ? result.resolved.item : result.unresolved.item;
  const shared = {
    id: item.id,
    ...(item.region !== undefined && { region: item.region }),
    tags: item.tagIds.flatMap((id) => tags.get(id) ?? []),
  };
  const ranks = customRanksText(Object.keys(item.rankOverrides).length);
  if (!result.ok) {
    const title = sourceText(item.source);
    return {
      ...shared,
      title,
      name: title,
      details: [billingText(item.billing), ...ranks],
      problem: unresolvedText(result.unresolved.reason),
    };
  }
  const { name, planName, iconUrl, override, price, addOns } = result.resolved;
  const shown = override ?? price;
  const priceOverride = item.priceOverride;
  const plan = item.source.kind === 'bundle' ? name : planTitle(name, planName);
  const { nickname } = item;
  return {
    ...shared,
    // A nickname tells two of the same plan apart: "Mom's (Netflix Standard)", shown over the plan.
    title: nickname === undefined ? plan : `${nickname} (${plan})`,
    ...(nickname !== undefined
      ? { name: nickname, planName: plan }
      : plan === planName
        ? { name: planName }
        : { name, planName }),
    ...(iconUrl !== undefined && { iconUrl }),
    price: shown,
    details: [
      // A free plan has nothing to bill.
      ...(shown.amount === 0 ? [] : [billingText(item.billing)]),
      ...addOns.map(addOnText),
      ...(override && priceOverride
        ? [
            priceOverride.until === undefined
              ? 'Your own price'
              : `Your own price until ${dateText(priceOverride.until)}`,
          ]
        : []),
      ...ranks,
    ],
  };
}

/** What an item is when it can't be resolved: its plan's or bundle's id, or that it's a custom subscription. */
function sourceText(source: ItemSource): string {
  switch (source.kind) {
    case 'catalog':
      return source.planId;
    case 'bundle':
      return source.bundleId;
    case 'custom':
      return 'Custom subscription';
  }
}

function unresolvedText(reason: UnresolvedReason): string {
  return {
    pending: 'Loading…',
    'plan-gone': 'This plan is no longer in the catalog',
    'bundle-gone': 'This bundle is no longer in the catalog',
    'custom-gone': 'Its custom subscription was deleted',
    'add-on-gone': 'One of its add-ons is no longer in the catalog',
    'no-price': 'There’s no price for how it’s billed',
  }[reason];
}

function customRanksText(count: number): string[] {
  if (count === 0) return [];
  return [count === 1 ? '1 custom rank' : `${count} custom ranks`];
}
