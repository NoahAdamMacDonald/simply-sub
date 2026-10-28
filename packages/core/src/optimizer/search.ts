import {
  blocked,
  fits,
  levelOf,
  losesService,
  lostSlots,
  removalJustified,
  type Checks,
  type KeyCheck,
  type SeverityLevel,
} from './evaluate';
import { savingEpsilon, type OptimizerModel } from './model';

// Finding the cheapest valid combination for each severity (BLUEPRINT §10.4): the list splits into parts whose items
// can't affect each other (no shared keys across providers, no option together), and each part is searched on its
// own. A part with up to about 10^5 combinations is searched exhaustively, depth first, pruned by cost and by checks
// that fail as soon as the items they depend on are decided; a bigger one by greedy search plus local improvement.

/** The most combinations a part is searched exhaustively for. */
export const exhaustiveLimit = 100_000;

/** The most combinations greedy search and its local improvement judge, per part and severity. */
const greedyBudget = 20_000;

export interface Plans {
  /** For each severity, as a level from free (0) to yellow (3): an option per item. */
  plans: Int32Array[];
  exhaustive: boolean;
}

/** The cheapest combination at each severity, each at least as cheap as the one before. */
export function searchPlans(model: OptimizerModel, checks: Checks): Plans {
  const plans = [0, 1, 2, 3].map(() => Int32Array.from(model.keep));
  let exhaustive = true;
  for (const part of partsOf(model, checks)) {
    const search = new PartSearch(model, checks, part);
    const big = search.combinations() > exhaustiveLimit;
    exhaustive &&= !big;
    let previous: { choice: Int32Array; cost: number } | undefined;
    for (const level of [0, 1, 2, 3] as const) {
      const found = big ? search.greedy(level) : search.exhaustive(level);
      // Greedy search can miss: a looser severity never does worse than a stricter one.
      const kept = previous && previous.cost <= found.cost ? previous : found;
      for (const item of part) plans[level][item] = kept.choice[item];
      previous = kept;
    }
  }
  return { plans, exhaustive };
}

/** The list's parts: items linked by a check's affecting items or by an option of several items. */
function partsOf(model: OptimizerModel, checks: Checks): number[][] {
  const parent = model.items.map((item) => item.index);
  const find = (item: number): number => {
    while (parent[item] !== item) item = parent[item] = parent[parent[item]];
    return item;
  };
  const join = (items: readonly number[]) => {
    for (const item of items.slice(1)) parent[find(item)] = find(items[0]);
  };
  for (const check of checks.keys) join(check.affecting);
  for (const option of model.options) join(option.items);
  const parts = new Map<number, number[]>();
  for (const item of model.items) {
    const root = find(item.index);
    parts.set(root, [...(parts.get(root) ?? []), item.index]);
  }
  return [...parts.values()];
}

class PartSearch {
  /** The part's items, the most expensive first, so the costly choices are made first. */
  private readonly order: number[];
  /** Each position's options: the item's own, and the options of several items it's the first of. */
  private readonly at: number[][];
  private readonly checksAt: KeyCheck[][];
  private readonly removalsAt: number[][];
  /** Each item's least possible cost: its cheapest option, an option of several split evenly. */
  private readonly share: Float64Array;
  /** The options that change something, for greedy search. */
  private readonly changes: number[];
  /** For each change, the later ones it can interact with: a check depends on items of both. */
  private readonly partners: number[][];

  constructor(
    private readonly model: OptimizerModel,
    private readonly checks: Checks,
    part: readonly number[],
  ) {
    this.order = [...part].sort(
      (a, b) => model.items[b].full.amount - model.items[a].full.amount || a - b,
    );
    const position = new Map(this.order.map((item, index) => [item, index]));
    const first = (items: readonly number[]) =>
      Math.min(...items.map((item) => position.get(item) ?? Infinity));
    this.at = this.order.map((item, index) => [
      ...model.own[item],
      ...model.groups[item].filter((option) => first(model.options[option].items) === index),
    ]);
    // A check is judged once every item that affects it is decided.
    const last = (items: readonly number[]) => Math.max(...items.map((a) => position.get(a) ?? 0));
    this.checksAt = this.order.map(() => []);
    this.removalsAt = this.order.map(() => []);
    for (const item of this.order) {
      for (const check of checks.byItem[item]) this.checksAt[last(check.affecting)].push(check);
      const removal = checks.removals[item];
      if (removal) this.removalsAt[last(removal.affecting)].push(item);
    }
    this.share = new Float64Array(model.items.length);
    for (const item of this.order) {
      const costs = [
        ...model.own[item].map((option) => model.options[option].cost),
        ...model.groups[item].map(
          (option) => model.options[option].cost / model.options[option].items.length,
        ),
      ];
      this.share[item] = Math.min(...costs);
    }
    this.changes = [
      ...new Set(
        this.order.flatMap((item) => [...model.own[item].slice(1), ...model.groups[item]]),
      ),
    ];
    // Two changes that no check depends on together save what each saves alone, which single changes find already.
    const near = new Map<number, Set<number>>(this.order.map((item) => [item, new Set([item])]));
    for (const item of this.order) {
      const together = [
        ...checks.byItem[item].map((check) => check.affecting),
        checks.removals[item]?.affecting ?? [],
      ];
      for (const items of together) for (const other of items) near.get(item)?.add(other);
    }
    this.partners = this.changes.map((option, index) => {
      const reach = new Set(
        model.options[option].items.flatMap((item) => [...(near.get(item) ?? [])]),
      );
      return this.changes
        .slice(index + 1)
        .filter((other) => model.options[other].items.some((item) => reach.has(item)));
    });
  }

  /** About how many combinations there are: each position's options multiplied. */
  combinations(): number {
    return this.at.reduce((product, options) => product * options.length, 1);
  }

  /** Every combination, depth first, pruned. */
  exhaustive(cap: SeverityLevel): { choice: Int32Array; cost: number } {
    const { model, order } = this;
    const choice = Int32Array.from(model.keep);
    for (const item of order) choice[item] = -1;
    let best = order.reduce((total, item) => total + model.options[model.keep[item]].cost, 0);
    let bestChoice = Int32Array.from(model.keep);
    let remaining = order.reduce((total, item) => total + this.share[item], 0);

    const visit = (index: number, cost: number, level: SeverityLevel) => {
      if (cost + remaining >= best - savingEpsilon) return;
      if (index === order.length) {
        best = cost;
        bestChoice = Int32Array.from(choice);
        return;
      }
      const item = order[index];
      if (choice[item] >= 0) {
        const judged = this.judge(index, choice, level, cap);
        if (judged <= cap) visit(index + 1, cost, judged);
        return;
      }
      for (const option of this.at[index]) {
        const { items } = model.options[option];
        if (items.some((member) => member !== item && choice[member] >= 0)) continue;
        for (const member of items) {
          choice[member] = option;
          remaining -= this.share[member];
        }
        const judged = this.judge(index, choice, level, cap);
        if (judged <= cap) visit(index + 1, cost + model.options[option].cost, judged);
        for (const member of items) {
          choice[member] = -1;
          remaining += this.share[member];
        }
      }
    };
    visit(0, 0, 0);
    return { choice: bestChoice, cost: best };
  }

  /** The level after the item at `index` is decided: its service, and the checks it completes. */
  private judge(
    index: number,
    choice: Int32Array,
    level: SeverityLevel,
    cap: SeverityLevel,
  ): SeverityLevel {
    const item = this.model.items[this.order[index]];
    let judged = level;
    if (losesService(this.model, item, choice)) {
      judged = Math.max(judged, levelOf(item.serviceSeverity)) as SeverityLevel;
    }
    for (const removed of this.removalsAt[index]) {
      if (!removalJustified(this.model, this.checks, this.model.items[removed], choice)) {
        return blocked;
      }
    }
    for (const check of this.checksAt[index]) {
      if (judged > cap) break;
      if (lostSlots(this.model, check, choice) !== 0) {
        judged = Math.max(judged, check.level) as SeverityLevel;
      }
    }
    return judged;
  }

  /**
   * Greedy search: from keeping everything, the change that saves the most while the result stays within `cap`,
   * again and again; then pairs of changes, which can get past a change that only pays off with another.
   */
  greedy(cap: SeverityLevel): { choice: Int32Array; cost: number } {
    const { model, checks, order } = this;
    let choice: Int32Array = Int32Array.from(model.keep);
    let cost = this.cost(choice);
    let budget = greedyBudget;
    const judged = (next: Int32Array, under: number) => {
      const nextCost = this.cost(next);
      if (nextCost >= under) return Infinity;
      budget--;
      return fits(model, checks, next, order, cap) ? nextCost : Infinity;
    };
    for (let improved = true; improved && budget > 0;) {
      improved = false;
      let bestChoice: Int32Array | undefined;
      let bestCost = cost - savingEpsilon;
      for (const option of this.changes) {
        if (budget <= 0) break;
        const next = this.applied(choice, option);
        if (!next) continue;
        const nextCost = judged(next, bestCost);
        if (nextCost < bestCost) [bestChoice, bestCost] = [next, nextCost];
      }
      if (!bestChoice) {
        // Local improvement: two changes at once.
        pairs: for (let a = 0; a < this.changes.length; a++) {
          const once = this.applied(choice, this.changes[a]);
          if (!once) continue;
          for (const partner of this.partners[a]) {
            if (budget <= 0) break pairs;
            const twice = this.applied(once, partner);
            if (!twice) continue;
            const nextCost = judged(twice, bestCost);
            if (nextCost < bestCost) {
              [bestChoice, bestCost] = [twice, nextCost];
              break pairs;
            }
          }
        }
      }
      if (bestChoice) {
        choice = bestChoice;
        cost = bestCost;
        improved = true;
      }
    }
    return { choice, cost };
  }

  /** What the part's items cost with `choice`: each option once. */
  private cost(choice: Int32Array): number {
    const counted = new Set<number>();
    let cost = 0;
    for (const item of this.order) {
      const option = choice[item];
      if (counted.has(option)) continue;
      counted.add(option);
      cost += this.model.options[option].cost;
    }
    return cost;
  }

  /**
   * `choice` with `option` taken: an option of several items it replaces goes, its other items kept as they are.
   * Undefined when it's taken already.
   */
  private applied(choice: Int32Array, option: number): Int32Array | undefined {
    const { model } = this;
    const { items } = model.options[option];
    if (items.every((item) => choice[item] === option)) return undefined;
    const next = Int32Array.from(choice);
    for (const item of items) {
      const previous = model.options[next[item]];
      if (previous.index !== option && previous.items.length > 1) {
        for (const member of previous.items) next[member] = model.keep[member];
      }
    }
    for (const item of items) next[item] = option;
    return next;
  }
}
