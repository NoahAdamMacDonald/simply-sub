import { slotsFrom } from './coverage';
import type { ItemModel, OptimizerModel } from './model';
import { severityOfRank, severities, type Severity } from './suggestion';

// Judging a combination of options (BLUEPRINT §10.2, §10.4). Every key an item provides is checked for that item, in
// each slot it's active, since ranks are the item's own: it's kept when what replaces the item still gives it (its
// new plan, the extra member, the bundle's or suite's plan). Only a removed item's keys can be kept by others: an
// item of another provider, the overlap that's the reason to remove it (two VPNs). Another item of the same provider
// never counts, since it's someone's own account (two Netflix accounts for two people). A Needed, Critical or
// Essential key that isn't kept makes the combination invalid; any other loss gives it a severity by the key's rank,
// and removing an item loses its service too.

/** A severity as a number, worst last; `blocked` (4) can't happen. */
export type SeverityLevel = 0 | 1 | 2 | 3 | 4;
export const blocked: SeverityLevel = 4;

export function levelOf(severity: Severity | 'blocked'): SeverityLevel {
  return severity === 'blocked' ? blocked : (severities.indexOf(severity) as SeverityLevel);
}

/** One key an item provides, to keep for it in every slot it's active. */
export interface KeyCheck {
  item: number;
  key: number;
  need: number;
  level: SeverityLevel;
  /** The items whose options can give or take it for this item: it can be judged once they're all decided. */
  affecting: number[];
}

/**
 * A removal's reason, for an item whose service loss is yellow (anything it gives is wanted or not ranked): another
 * provider's item must still give one of its keys after it ends, or there was no reason to suggest it (two VPNs, but
 * never both removed).
 */
export interface RemovalCheck {
  item: number;
  affecting: number[];
}

export interface Checks {
  keys: KeyCheck[];
  byItem: KeyCheck[][];
  /** Each item's removal check, when its removal needs a reason. */
  removals: (RemovalCheck | undefined)[];
}

/** Every item's key checks, with the items that affect each. */
export function buildChecks(model: OptimizerModel): Checks {
  const byItem: KeyCheck[][] = model.items.map(() => []);
  const keys: KeyCheck[] = [];
  for (const item of model.items) {
    if (item.active === 0) continue;
    const removable = model.own[item.index].some(
      (option) => model.options[option].removes.length > 0,
    );
    for (const [key, rank] of item.ranks) {
      const affecting = new Set<number>([item.index]);
      for (const option of model.options) {
        if ((option.byKey.get(key) ?? []).some((c) => counts(c, item, removable))) {
          for (const other of option.items) affecting.add(other);
        }
      }
      const check: KeyCheck = {
        item: item.index,
        key,
        need: item.active,
        level: levelOf(severityOfRank(rank)),
        affecting: [...affecting].sort((a, b) => a - b),
      };
      keys.push(check);
      byItem[item.index].push(check);
    }
  }
  const removals = model.items.map((item): RemovalCheck | undefined =>
    item.serviceSeverity === 'yellow' &&
    model.own[item.index].some((option) => model.options[option].removes.length > 0)
      ? {
          item: item.index,
          affecting: [...new Set(byItem[item.index].flatMap((check) => check.affecting))].sort(
            (a, b) => a - b,
          ),
        }
      : undefined,
  );
  return { keys, byItem, removals };
}

/** Whether a contribution keeps a key for `item`: what replaces it, or another provider's when it's removed. */
export function counts(
  contribution: { provider: number; forItems: readonly number[] },
  item: ItemModel,
  removed: boolean,
): boolean {
  return (
    contribution.forItems.includes(item.index) ||
    (removed && !item.providers.includes(contribution.provider))
  );
}

/**
 * The slots of a check that `choice` (an option per item) leaves without the key. What replaces the item is the option
 * it's decided by, so only a removed item needs the others looked at.
 */
export function lostSlots(
  model: OptimizerModel,
  check: KeyCheck,
  choice: ArrayLike<number>,
): number {
  const item = model.items[check.item];
  const own = model.options[choice[check.item]];
  let kept = 0;
  for (const contribution of own.byKey.get(check.key) ?? []) {
    if (contribution.forItems.includes(item.index)) kept |= contribution.mask;
  }
  if ((check.need & ~kept) === 0 || !own.removes.includes(item.index)) return check.need & ~kept;
  for (const other of check.affecting) {
    if (other === item.index) continue;
    for (const contribution of model.options[choice[other]].byKey.get(check.key) ?? []) {
      if (counts(contribution, item, true)) kept |= contribution.mask;
    }
  }
  return check.need & ~kept;
}

/** Whether `choice` gives up the item's service: its option removes it. */
export function losesService(
  model: OptimizerModel,
  item: ItemModel,
  choice: ArrayLike<number>,
): boolean {
  const option = model.options[choice[item.index]];
  return option.removes.includes(item.index);
}

/**
 * Whether `choice` keeps the reason for removing the item: it isn't removed, or another provider's item gives one of
 * its keys in every slot it would have been active in after its next charge. A month that another removed item has
 * still paid for isn't a reason.
 */
export function removalJustified(
  model: OptimizerModel,
  checks: Checks,
  item: ItemModel,
  choice: ArrayLike<number>,
): boolean {
  if (checks.removals[item.index] === undefined || !losesService(model, item, choice)) return true;
  const after = item.active & slotsFrom(item.changeSlot);
  return checks.byItem[item.index].some((check) => {
    let others = 0;
    for (const other of check.affecting) {
      for (const contribution of model.options[choice[other]].byKey.get(check.key) ?? []) {
        if (!item.providers.includes(contribution.provider)) others |= contribution.mask;
      }
    }
    return (after & ~others) === 0;
  });
}

/** Whether `choice` loses nothing above `cap` for `items`: evaluate's level alone, stopping at the first loss over it. */
export function fits(
  model: OptimizerModel,
  checks: Checks,
  choice: ArrayLike<number>,
  items: readonly number[],
  cap: SeverityLevel,
): boolean {
  for (const index of items) {
    const item = model.items[index];
    if (losesService(model, item, choice)) {
      if (levelOf(item.serviceSeverity) > cap) return false;
      if (!removalJustified(model, checks, item, choice)) return false;
    }
    for (const check of checks.byItem[index]) {
      if (check.level > cap && lostSlots(model, check, choice) !== 0) return false;
    }
  }
  return true;
}

export interface Evaluation {
  /** The worst loss: 0 when nothing is lost, `blocked` when a key that can't be lost is. */
  level: SeverityLevel;
  cost: number;
  /** Each lost key's slots, by check. */
  lost: { check: KeyCheck; slots: number }[];
  lostServices: number[];
}

/** Judges `choice` for `items` (every item when left out): what it costs, and what it loses. */
export function evaluate(
  model: OptimizerModel,
  checks: Checks,
  choice: ArrayLike<number>,
  items: readonly number[] = model.items.map((item) => item.index),
): Evaluation {
  const evaluation: Evaluation = {
    level: 0,
    cost: 0,
    lost: [],
    lostServices: [],
  };
  const counted = new Set<number>();
  for (const index of items) {
    const option = model.options[choice[index]];
    if (!counted.has(option.index)) {
      counted.add(option.index);
      evaluation.cost += option.cost;
    }
    const item = model.items[index];
    if (losesService(model, item, choice)) {
      evaluation.lostServices.push(index);
      const level = removalJustified(model, checks, item, choice)
        ? levelOf(item.serviceSeverity)
        : blocked;
      evaluation.level = Math.max(evaluation.level, level) as SeverityLevel;
    }
    for (const check of checks.byItem[index]) {
      const slots = lostSlots(model, check, choice);
      if (slots === 0) continue;
      evaluation.lost.push({ check, slots });
      evaluation.level = Math.max(evaluation.level, check.level) as SeverityLevel;
    }
  }
  return evaluation;
}
