import * as z from 'zod';
import { currencySchema, isoDateSchema, planIdSchema, textSchema } from '../catalog/formats';
import { intervalSchema } from '../catalog/price';
import type { CatalogData } from '../catalog/snapshot';
import { addDays, type IsoDate } from '../dates/iso-date';
import { planTitle } from './item-text';
import type { ListItem } from './list-item';
import { resolveItem, type ResolveContext } from './resolved';

// The price changes Home lists (PROJECT-PLAN P2, M7.10): when a catalog update changes what a plan in the user's lists
// costs, the old and new prices are kept for a month in the settings (no table of their own, and sealed with the rest by
// the app lock), each as the provider lists it, in its own currency and for the item's billing period.

/** One plan's price, before and after a catalog update. */
export const priceChangeSchema = z.strictObject({
  planId: planIdSchema,
  /** "Netflix Standard". */
  title: textSchema,
  currency: currencySchema,
  interval: intervalSchema,
  intervalCount: z.int().positive(),
  from: z.number().nonnegative(),
  to: z.number().nonnegative(),
  /** The day the update brought it. */
  date: isoDateSchema,
});
export type PriceChange = z.infer<typeof priceChangeSchema>;

/** The most changes kept, and for how long. */
export const maxPriceChanges = 20;
export const priceChangeDays = 30;

/**
 * What a catalog update changed in the prices of `items`' plans: each catalog item's price for its billing period and
 * region, in the catalog `before` and `after`, where they differ. A plan the update took out has none.
 */
export function priceChangesBetween(
  items: readonly ListItem[],
  before: CatalogData,
  after: CatalogData,
  context: Omit<ResolveContext, 'catalog'>,
): PriceChange[] {
  const found = new Map<string, PriceChange>();
  for (const item of items) {
    if (item.source.kind !== 'catalog' || item.deletedAt !== undefined) continue;
    const old = resolveItem(item, { ...context, catalog: before });
    const now = resolveItem(item, { ...context, catalog: after });
    if (!old.ok || !now.ok) continue;
    const was = old.resolved.price.source;
    const is = now.resolved.price.source;
    if (was.currency !== is.currency || was.amount === is.amount) continue;
    const { interval, intervalCount } = now.resolved.price;
    const key = `${item.source.planId} ${is.currency} ${interval}/${intervalCount}`;
    found.set(key, {
      planId: item.source.planId,
      title: planTitle(now.resolved.name, now.resolved.planName),
      currency: is.currency,
      interval,
      intervalCount,
      from: was.amount,
      to: is.amount,
      date: context.today,
    });
  }
  return [...found.values()];
}

/**
 * The changes kept after an update on `today`: the new ones, then the earlier ones they don't replace (the same plan,
 * currency and period), none older than a month, at most `maxPriceChanges`.
 */
export function withPriceChanges(
  kept: readonly PriceChange[],
  found: readonly PriceChange[],
  today: IsoDate,
): PriceChange[] {
  const key = (change: PriceChange) =>
    `${change.planId} ${change.currency} ${change.interval}/${change.intervalCount}`;
  const fresh = new Set(found.map(key));
  const since = addDays(today, -priceChangeDays);
  return [
    ...found,
    ...kept.filter((change) => !fresh.has(key(change)) && change.date >= since),
  ].slice(0, maxPriceChanges);
}
