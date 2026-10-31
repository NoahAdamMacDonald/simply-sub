import type { Plan } from '../catalog/provider';
import { addDays, type IsoDate } from '../dates/iso-date';
import { nextChargeDate } from '../schedule/charge-dates';
import type { ListItem } from './list-item';

// A renamed plan's old name is a grace period for the people who have it (BLUEPRINT §4.3, M10.28): an item shows
// "Ultra (formerly Max 20x)" until its first charge after the rename, its renewal, so its user gets used to the new
// name. An item added since, one with no charge to come, and anyone without the plan see the new name only.

/** The plan's latest former name while `item` still shows it on `today`, else undefined. */
export function itemFormerName(
  plan: Pick<Plan, 'formerNames'>,
  item: Pick<ListItem, 'billing' | 'createdAt'>,
  today: IsoDate,
): string | undefined {
  const [latest] = plan.formerNames ?? [];
  if (!latest) return undefined;
  const renamed = addDays(latest.until, 1);
  // Added under the new name: it never had the old one.
  if (item.createdAt.slice(0, 10) >= renamed) return undefined;
  const renewal = nextChargeDate(item.billing, renamed);
  return renewal !== undefined && today < renewal ? latest.name : undefined;
}

/** "(formerly Max 20x)". */
export function formerlyText(name: string): string {
  return `(formerly ${name})`;
}
