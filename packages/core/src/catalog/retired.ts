import type { IsoDate } from '../dates/iso-date';
import type { Plan, Provider } from './provider';

// A plan or provider no longer sold is retired, never deleted (BLUEPRINT §4.3, M10.27): ids are permanent, and the items
// on it are still the users'. From its `retired` date nothing offers it, but items on it resolve and count, until its
// `endsOn` when it ends for its subscribers too.

/** When a plan stopped being sold, its own date or its provider's, and when it ends for its subscribers. */
export interface Retirement {
  since: IsoDate;
  endsOn?: IsoDate;
}

/** The plan's retirement, or its provider's, whatever the date; undefined for a plan still sold. */
export function retirementOf(
  plan: Pick<Plan, 'retired' | 'endsOn'>,
  provider: Pick<Provider, 'retired' | 'endsOn'>,
): Retirement | undefined {
  const own = plan.retired !== undefined ? plan : provider;
  if (own.retired === undefined) return undefined;
  return { since: own.retired, ...(own.endsOn !== undefined && { endsOn: own.endsOn }) };
}

/** Whether the plan is no longer sold on `today`: Search, the bundle offers and the optimizer leave it out. */
export function isRetired(
  plan: Pick<Plan, 'retired' | 'endsOn'>,
  provider: Pick<Provider, 'retired' | 'endsOn'>,
  today: IsoDate,
): boolean {
  const retirement = retirementOf(plan, provider);
  return retirement !== undefined && retirement.since <= today;
}
