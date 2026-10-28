import { catalogIconFile, type BundleSaving, type PickedPrice } from '@simply-sub/core';
import { amountText, intervalSpoken, intervalText } from '../price-tag/price-text';

/**
 * A provider's or reseller's icon as the app loads it: the relative icons/<id>.webp, since the snapshot's absolute
 * URL points at production, where a preview's new logo isn't yet (as ResolvedItem.iconUrl). None without a logo.
 */
export function catalogIcon({ id, iconUrl }: { id: string; iconUrl?: string }): string | undefined {
  return iconUrl === undefined ? undefined : `icons/${catalogIconFile(id)}`;
}

/** A saving as a card writes it, in parts for the screen and for screen readers, like ss-price. */
export interface SavingText {
  /** Worked out from a converted price. */
  approx: boolean;
  amount: string;
  /** "/ mo", and spoken "a month". */
  interval: string;
  spoken: string;
}

/** What `saving` saves, approximate when the deal's price for its interval was converted. */
export function savingText(
  saving: BundleSaving,
  pricing: readonly PickedPrice[],
  country: string | undefined,
): SavingText {
  const price = pricing.find(
    (candidate) =>
      candidate.interval === saving.interval && candidate.intervalCount === saving.intervalCount,
  );
  return {
    approx: price?.native === false,
    amount: amountText(saving.amount, saving.currency, country),
    interval: intervalText(saving.interval, saving.intervalCount),
    spoken: intervalSpoken(saving.interval, saving.intervalCount),
  };
}
