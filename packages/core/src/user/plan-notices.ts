import * as z from 'zod';
import { isoDateSchema, planIdSchema, textSchema } from '../catalog/formats';
import { planOf } from '../catalog/plan-lookup';
import { retirementOf } from '../catalog/retired';
import type { CatalogData } from '../catalog/snapshot';
import { addDays, type IsoDate } from '../dates/iso-date';
import { planTitle } from './item-text';
import type { ListItem } from './list-item';
import { priceChangeDays } from './price-changes';

// What Home tells the users who have a plan when the catalog changes it, beside its price changes (PROJECT-PLAN P2,
// M10.27): a plan renamed ("Claude Max 20x is now called Ultra"), or ending for its subscribers ("Claude Max ends for
// its subscribers on Mar 1"). Kept in the settings like the price changes, for a month, and recorded once: by the
// catalog update that brings the change.

const noticeFields = {
  planId: planIdSchema,
  /** What the user knew it as: "Claude Max 20x". */
  title: textSchema,
  /** The day the update brought it. */
  date: isoDateSchema,
};

export const planNoticeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('renamed'),
    ...noticeFields,
    /** Its name now: "Ultra". */
    name: textSchema,
  }),
  z.strictObject({
    kind: z.literal('ends'),
    ...noticeFields,
    /** The day it ends for its subscribers (its `endsOn`). */
    on: isoDateSchema,
  }),
]);
export type PlanNotice = z.infer<typeof planNoticeSchema>;

/** The most notices kept. They're kept as long as price changes. */
export const maxPlanNotices = 20;

/** Home's line for a notice, with `day` writing its date: "Claude Max 20x is now called Ultra". */
export function planNoticeText(notice: PlanNotice, day: (date: IsoDate) => string): string {
  switch (notice.kind) {
    case 'renamed':
      return `${notice.title} is now called ${notice.name}`;
    case 'ends':
      return `${notice.title} ends for its subscribers on ${day(notice.on)}`;
  }
}

/**
 * What a catalog update changed in `items`' plans that their users are told, once: each plan renamed, and each that
 * now ends for its subscribers (or on another day).
 */
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
    if (!was || !is) continue;
    const title = planTitle(was.provider.name, was.plan.name);
    if (
      was.plan.name !== is.plan.name &&
      (is.plan.formerNames ?? []).some(({ name }) => name === was.plan.name)
    ) {
      found.push({ kind: 'renamed', planId, title, name: is.plan.name, date: today });
    }
    const ends = retirementOf(is.plan, is.provider)?.endsOn;
    if (ends !== undefined && ends !== retirementOf(was.plan, was.provider)?.endsOn) {
      found.push({
        kind: 'ends',
        planId,
        title: planTitle(is.provider.name, is.plan.name),
        on: ends,
        date: today,
      });
    }
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
