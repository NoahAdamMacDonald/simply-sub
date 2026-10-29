// What a budget bar shows (BLUEPRINT §8.1, §8.1.1): how full it is, its colour and its percent label. Home, the
// Lists cards and List view fill a bar with spending against a budget; the Calendar fills it with the month's
// payments so far against the month's total, with a tick at the monthly budget.

/** A bar's colour: green under 75% of the budget, amber from 75% to 100%, red over it. */
export type BudgetLevel = 'ok' | 'warn' | 'over';

/** The share of a budget where a bar turns amber. */
export const budgetWarnShare = 0.75;

/** The share of a budget where a bar's colour is all red (M7.7): half again over it. */
export const budgetRedShare = 1.5;

export interface BudgetBar {
  level: BudgetLevel;
  /** How much of the bar is filled, from 0 to 1: a bar over its max is full. */
  fill: number;
  /**
   * `value` as a whole percent of `max`, with no cap: 112 over budget. It rounds down up to 100 and up past it, so the
   * label never contradicts the colour (100.4% shows 101%, red; 99.6% shows 99%).
   */
  percent: number;
  /** Where the marker's tick sits, from 0 to 1; none without a marker, or with one past the bar's end. */
  markerAt?: number;
  /**
   * The fill's one colour, on a scale (M7.7, the user's choice): green with nothing spent, changing gradually to yellow
   * exactly at the budget, then to red at half again over it. `towardYellow`, from 0 to 1, is how far it has gone from
   * green to yellow, and `towardRed` how far from yellow to red. With a marker it's the max (the month's total) against
   * the marker (its budget), as the level is.
   */
  towardYellow: number;
  towardRed: number;
}

/**
 * A bar of `value` against `max`. Without a marker its colour compares `value` to `max`: spending against a budget.
 * With one, `max` is a total and the marker its budget, so the colour compares `max` to the marker: the Calendar's
 * bar is red when the month's payments go over the monthly budget, however few are paid yet. A `max` of 0 (a month
 * with no payments) gives an empty bar.
 */
export function budgetBar(value: number, max: number, marker?: number): BudgetBar {
  const percent = max > 0 ? wholePercent(value / max) : 0;
  const level =
    marker === undefined ? levelOf(percent) : levelOf(marker > 0 ? wholePercent(max / marker) : 0);
  // What the colour measures: spending against the budget, or the month's total against its budget.
  const share = marker === undefined ? (max > 0 ? value / max : 0) : marker > 0 ? max / marker : 0;
  return {
    level,
    fill: max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0,
    percent,
    ...(marker !== undefined &&
      max > 0 &&
      marker >= 0 &&
      marker <= max && { markerAt: marker / max }),
    towardYellow: scaled(share),
    towardRed: scaled((share - 1) / (budgetRedShare - 1)),
  };
}

/** `share` within 0 and 1, to four places: how far along one half of the colour scale it is. */
function scaled(share: number): number {
  return Math.round(Math.min(Math.max(share, 0), 1) * 1e4) / 1e4;
}

/** The level of a share given as a whole percent, so the colour and the label agree at every edge. */
function levelOf(percent: number): BudgetLevel {
  if (percent > 100) return 'over';
  return percent >= budgetWarnShare * 100 ? 'warn' : 'ok';
}

function wholePercent(share: number): number {
  // Rounded to a millionth of a percent first: 0.29 * 100 is 28.999999999999996 in floating point, which is 29%.
  const exact = Math.round(share * 100 * 1e6) / 1e6;
  return exact <= 100 ? Math.floor(exact) : Math.ceil(exact);
}
