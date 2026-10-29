import {
  addOnText,
  planTitle,
  sourceText,
  unresolvedText,
  type IsoDate,
  type ItemResolution,
  type PickedPrice,
  type ResolvedAddOn,
  type Tag,
} from '@simply-sub/core';
import { billingText, renewalText } from '../../shared/billing-text';
import { dateText } from '../../shared/date-text';
import { amountText, intervalSpoken } from '../../shared/price-tag/price-text';

// What the list editor (P5) says about each item of its draft: when it renews, from its next charge ("Renews Nov 12 ·
// auto", M7.1), or how it's billed when it can't be priced (shared/billing-text.ts).

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
  /** When it renews, its add-ons with their prices, own price and custom ranks, in words. */
  details: string[];
  tags: Tag[];
  /** Why it can't be priced or named. */
  problem?: string;
}

/**
 * An item's row. `tags` are the user's, by id; one the item names that's gone is left out. Amounts are written for
 * `country`, Settings' country.
 */
export function editRow(
  result: ItemResolution,
  tags: ReadonlyMap<string, Tag>,
  today: IsoDate,
  country?: string,
): EditRow {
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
  const { name, planName, iconUrl, override, price, addOns, nextCharge } = result.resolved;
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
      ...(shown.amount === 0 ? [] : [renewalText(item.billing, nextCharge, today)]),
      ...addOns.map((addOn) => addOnLine(addOn, country)),
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

/**
 * An add-on and what it costs, in words that read the same aloud (M6.12): "Extra member (with ads) for $7.99 a month",
 * "for about" when converted. Before tax, as its price tag is.
 */
function addOnLine(addOn: ResolvedAddOn, country: string | undefined): string {
  const { price } = addOn;
  const amount = amountText(price.amount * addOn.quantity, price.currency, country);
  const about = price.fx === undefined ? '' : 'about ';
  return `${addOnText(addOn)} for ${about}${amount} ${intervalSpoken(price.interval, price.intervalCount)}`;
}

function customRanksText(count: number): string[] {
  if (count === 0) return [];
  return [count === 1 ? '1 custom rank' : `${count} custom ranks`];
}
