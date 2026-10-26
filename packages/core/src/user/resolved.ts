import type { IsoDate } from '../dates/iso-date';
import type { RankKey } from '../ranking/rank-keys';

// Parts of the view models pages show (PROJECT-PLAN §3.4), which the shared components take as inputs (M4.5).
// M4.6 adds ResolvedItem and ListMetrics around them; M6.1 and M7.1 compute them.

/** Whether an item is active today (PROJECT-PLAN §3.3). */
export interface ItemStatus {
  kind: 'active' | 'inactive';
  /** When an inactive item starts again: a future window or start date. */
  activeFrom?: IsoDate;
  /** Its end date, when that's within the next 30 days. */
  endsOn?: IsoDate;
  /** Its next charge is a manual renewal. */
  manual: boolean;
}

/** One line of a feature summary, "VPN 2 / 3" (PROJECT-PLAN §3.2). */
export interface FeatureSummaryRow {
  key: RankKey;
  label: string;
  /** The active items that provide the key. */
  active: number;
  /** All the items that provide it. */
  total: number;
}
