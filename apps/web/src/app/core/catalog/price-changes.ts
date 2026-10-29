import {
  priceChangesBetween,
  withPriceChanges,
  type CatalogData,
  type IsoDate,
  type ListItem,
} from '@simply-sub/core';
import type { SettingsStore } from '../settings/settings-store';

/**
 * Keeps what a catalog update changed in the lists' prices (P2's Price changes, M7.10) in the settings, newest first,
 * for a month. In a chunk of its own: CatalogStore loads it only when an update changes the catalog.
 */
export async function recordPriceChanges(
  before: CatalogData,
  after: CatalogData,
  items: readonly ListItem[],
  settings: SettingsStore,
  today: IsoDate,
): Promise<void> {
  const saved = settings.saved();
  if (!saved) return;
  const found = priceChangesBetween(items, before, after, {
    customSubs: new Map(),
    country: saved.country,
    currency: saved.currency,
    today,
    profileRanks: new Map(),
  });
  if (found.length === 0) return;
  const kept = withPriceChanges(saved.priceChanges ?? [], found, today);
  await settings.update({ priceChanges: kept.length > 0 ? kept : undefined });
}
