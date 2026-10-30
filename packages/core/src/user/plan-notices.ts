import * as z from 'zod';
import { isoDateSchema, planIdSchema, textSchema } from '../catalog/formats';
import { planOf } from '../catalog/plan-lookup';
import type { CatalogData } from '../catalog/snapshot';
import { addDays, type IsoDate } from '../dates/iso-date';
import { planTitle } from './item-text';
import type { ListItem } from './list-item';
import { priceChangeDays } from './price-changes';

// What Home tells the users who have a plan when the catalog changes it, beside its price changes (PROJECT-PLAN P2,
// M10.27): a plan renamed ("Claude Max 20x is now called Ultra"). Kept in the settings like the price changes, for a
// month, and recorded once: by the catalog update that brings the change.

export const planNoticeSchema = z.strictObject({
  kind: z.literal('renamed'),
  planId: planIdSchema,
  /** What the user knew it as: "Claude Max 20x". */
  title: textSchema,
  /** Its name now: "Ultra". */
  name: textSchema,
  /** The day the update brought it. */
  date: isoDateSchema,
});
export type PlanNotice = z.infer<typeof planNoticeSchema>;

/** The most notices kept. They're kept as long as price changes. */
export const maxPlanNotices = 20;

/** Home's line for a notice: "Claude Max 20x is now called Ultra". */
export function planNoticeText(notice: PlanNotice): string {
  return `${notice.title} is now called ${notice.name}`;
}

/** What a catalog update changed in `items`' plans that their users are told: each plan renamed, once. */
export function planNoticesBetween(
  items: readonly ListItem[],
  before: CatalogData,
  after: CatalogData,
  today: IsoDate,
): PlanNotice[] {
  const planIds = new Set(
    items.flatMap((item) =>
      item.deletedAt === undefined && item.source.kind === 'catalog' ? [item.source.planId] : [],
    ),
  );
  const found: PlanNotice[] = [];
  for (const planId of planIds) {
    const was = planOf(before, planId);
    const is = planOf(after, planId);
    if (!was || !is || was.plan.name === is.plan.name) continue;
    if (!(is.plan.formerNames ?? []).some(({ name }) => name === was.plan.name)) continue;
    found.push({
      kind: 'renamed',
      planId,
      title: planTitle(was.provider.name, was.plan.name),
      name: is.plan.name,
      date: today,
    });
  }
  return found;
}

/** The notices kept after an update on `today`: the new ones, then the earlier ones less than a month old. */
export function withPlanNotices(
  kept: readonly PlanNotice[],
  found: readonly PlanNotice[],
  today: IsoDate,
): PlanNotice[] {
  const key = (notice: PlanNotice) => `${notice.kind} ${notice.planId}`;
  const fresh = new Set(found.map(key));
  const since = addDays(today, -priceChangeDays);
  return [
    ...found,
    ...kept.filter((notice) => !fresh.has(key(notice)) && notice.date >= since),
  ].slice(0, maxPlanNotices);
}
