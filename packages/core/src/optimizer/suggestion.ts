import type { PickedPrice } from '../catalog/pick-price';
import type { IsoDate } from '../dates/iso-date';
import type { RankKey } from '../ranking/rank-keys';
import type { Rank } from '../user/rank';

// What the optimizer suggests (BLUEPRINT §10, PROJECT-PLAN P14): ways to pay less over the next 12 months, each
// sorted by what it gives up. optimize.ts finds them.

/**
 * How much a suggestion gives up, from nothing to the most (BLUEPRINT §10.4): free savings lose nothing at all; red
 * loses only Unwanted and Not-ranked features; orange Unused ones too; yellow Wanted, Uses or Sometimes ones too, or
 * a service itself. Needed, Critical and Essential features are never lost.
 */
export const severities = ['free', 'red', 'orange', 'yellow'] as const;
export type Severity = (typeof severities)[number];

/** What losing a feature of this rank costs: `blocked` for the ranks that can't be lost (§10.2). */
export function severityOfRank(rank: Rank): Severity | 'blocked' {
  switch (rank) {
    case 'essential':
    case 'critical':
    case 'needed':
      return 'blocked';
    case 'wanted':
    case 'uses':
    case 'sometimes':
      return 'yellow';
    case 'unused':
      return 'orange';
    case 'not-ranked':
    case 'unwanted':
      return 'red';
  }
}

/** The worse of two severities. */
export function worseSeverity(a: Severity, b: Severity): Severity {
  return severities.indexOf(a) >= severities.indexOf(b) ? a : b;
}

/** A list item a suggestion changes, as it is now. */
export interface SuggestedItem {
  itemId: string;
  /** What it is, with its nickname (itemTitle): "Disney+ Premium", "Mom's (Netflix Standard)". */
  title: string;
  /** ResolvedItem's name and planName: "Disney+", "Premium". */
  name: string;
  planName: string;
  /** One charge of its billing period now, before tax: its price override while it applies, else its price. */
  price: PickedPrice;
  /** Its next charge: when a change to it takes effect, and when it ends if it's replaced or removed. */
  next?: IsoDate;
}

/**
 * One change (BLUEPRINT §10.3). Each takes effect on `on`, the item's next charge (for a bundle or suite, the earliest
 * of the items it replaces), so what's paid for already is used up first.
 * - `interval`: the same plan billed yearly instead.
 * - `downgrade`: another plan of the same provider that gives less (its free plan too); `switch`: one that gives
 *   something else. `to` is its price, for the billing period it's suggested with.
 * - `remove`: the item ends at its next charge.
 * - `extra-member`: the item ends, and its person becomes an extra member (an add-on) on `host`.
 * - `bundle` and `suite`: the items are replaced by one bundle or suite plan.
 * - `card` (M9.3): pay with a better payment card (§9.3): `cardId`, and the cards' names, the one it's paid with now
 *   when it has one.
 */
export type SuggestionAction =
  | { kind: 'interval'; item: SuggestedItem; to: PickedPrice; on: IsoDate }
  | {
      kind: 'downgrade' | 'switch';
      item: SuggestedItem;
      planId: string;
      planName: string;
      /** The item's add-ons the new plan allows, within its limit. */
      addOns?: { id: string; quantity: number }[];
      to: PickedPrice;
      on: IsoDate;
    }
  | { kind: 'remove'; item: SuggestedItem; on: IsoDate }
  | {
      kind: 'extra-member';
      item: SuggestedItem;
      host: SuggestedItem;
      addOnId: string;
      addOnName: string;
      to: PickedPrice;
      on: IsoDate;
    }
  | {
      kind: 'bundle';
      items: SuggestedItem[];
      bundleId: string;
      name: string;
      to: PickedPrice;
      on: IsoDate;
    }
  | {
      kind: 'suite';
      items: SuggestedItem[];
      providerId: string;
      planId: string;
      /** The provider's and the suite plan's names: "Proton", "Unlimited". */
      name: string;
      planName: string;
      to: PickedPrice;
      on: IsoDate;
    }
  | {
      kind: 'card';
      item: SuggestedItem;
      cardId: string;
      cardTitle: string;
      fromCardTitle?: string;
    };

export type SuggestionActionKind = SuggestionAction['kind'];

/** A feature a suggestion loses or gains, with its rank: for a loss, the most severe among the items that lose it. */
export interface FeatureChange {
  key: RankKey;
  /** As Search's feature chips name it: "Video quality: 4K (Ultra HD)". */
  label: string;
  rank: Rank;
}

/** One card on P14: changes that can be applied on their own, with what they save and what they give up. */
export interface Suggestion {
  /**
   * Stable while the list stays the same: the list's items as the optimizer read them and this suggestion's changes.
   * A dismissal is stored under it (P14), so it comes back once the list changes.
   */
  fingerprint: string;
  severity: Severity;
  actions: SuggestionAction[];
  /** What it saves over the next 12 months (PROJECT-PLAN §3.1), sales tax included, in the user's currency. */
  savings: number;
  /** The list's next-12-months total with only this suggestion applied, and the same a month (÷ 12). */
  next12: number;
  monthly: number;
  /** Converted prices are involved, so the savings are an estimate (BLUEPRINT §4.7). */
  estimated: boolean;
  lost: FeatureChange[];
  /**
   * The services it gives up: each removed item's own, which no feature describes, by its title, so two accounts of one
   * provider are told apart ("Mine (Netflix Standard)", "Sam's (Netflix Standard)").
   */
  lostServices: { itemId: string; title: string }[];
  gained: FeatureChange[];
}

/** What optimize found for one list. */
export interface OptimizerResult {
  /** In P14's order: free savings, then red, orange and yellow; within each, the most savings first. */
  suggestions: Suggestion[];
  /**
   * What the best plan saves over the next 12 months, with everything that may be given up ("Save up to $214 /
   * year"), and whether that's an estimate.
   */
  bestSavings: number;
  bestEstimated: boolean;
  /** The user's currency, which every amount is in. */
  currency: string;
  /** The list's next-12-months total now, of the items it could price in the user's currency. */
  next12: number;
  /** How the plans were found: every combination (with pruning), or greedy search where there were too many. */
  search: 'exhaustive' | 'greedy';
}

/** What List view's View optimizations shows (PROJECT-PLAN P4). */
export interface SuggestionSummary {
  /** The suggestions not dismissed. */
  count: number;
  /** The colour of the strongest: red, then orange, then yellow; free savings when they're all there is. */
  strongest?: Severity;
}

const strength: readonly Severity[] = ['red', 'orange', 'yellow', 'free'];

export function suggestionSummary(
  suggestions: readonly Pick<Suggestion, 'fingerprint' | 'severity'>[],
  dismissed: ReadonlySet<string>,
): SuggestionSummary {
  const shown = suggestions.filter((suggestion) => !dismissed.has(suggestion.fingerprint));
  const strongest = strength.find((severity) =>
    shown.some((suggestion) => suggestion.severity === severity),
  );
  return { count: shown.length, ...(strongest && { strongest }) };
}
