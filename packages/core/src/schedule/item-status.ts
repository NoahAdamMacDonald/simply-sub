import { addDays, type IsoDate } from '../dates/iso-date';
import { itemActivity } from '../user/item-activity';
import type { ListItem } from '../user/list-item';
import type { ItemStatus } from '../user/resolved';
import type { Charge } from './charges';

/** How soon an end date shows as "Ends Nov 3" (PROJECT-PLAN §3.3). */
export const endingSoonDays = 30;

/**
 * The item's status today (PROJECT-PLAN §3.3): Active or Inactive from its dates (itemActivity), "Ends Nov 3" when its
 * end date is within the next 30 days, and a manual renewal when its next charge is one ("Renew by Nov 3").
 */
export function itemStatus(item: ListItem, today: IsoDate, next: Charge | undefined): ItemStatus {
  const { kind, activeFrom } = itemActivity(item, today);
  const endDate = item.billing.mode === 'recurring' ? item.billing.endDate : undefined;
  const endsOn =
    endDate !== undefined && today < endDate && endDate <= addDays(today, endingSoonDays)
      ? endDate
      : undefined;
  return {
    kind,
    ...(activeFrom !== undefined && { activeFrom }),
    ...(endsOn !== undefined && { endsOn }),
    manual: next?.manual ?? false,
  };
}
