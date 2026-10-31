import type { Rank } from '../user/rank';
import {
  blocked,
  buildChecks,
  counts,
  evaluate,
  levelOf,
  losesService,
  type Checks,
} from './evaluate';
import { fingerprintOf, itemSignature } from './fingerprint';
import { cardRoom, cardSuggestions } from './card-suggestions';
import { currencySuggestions } from './currency-suggestions';
import { buildModel, savingEpsilon, type OptimizerInput, type OptimizerModel } from './model';
import { replacements } from './replacements';
import { searchPlans } from './search';
import { actionTitle } from './suggestion-text';
import {
  actionItemIds,
  severities,
  severityOfRank,
  type FeatureChange,
  type OptimizerResult,
  type Suggestion,
} from './suggestion';

// optimize (BLUEPRINT §10): a pure function the app runs for one list. It finds the cheapest valid combination of
// changes at each severity (free, red, orange, yellow), its plans, and splits each into cards that can be applied on
// their own (PROJECT-PLAN P14). Each section lists its own plan's cards of its severity: within a section the cards
// never conflict, and a card in a looser section can be an alternative to one in a stricter section for the same
// item (Disney+ billed yearly, or Standard billed yearly). A looser plan's card that gives up less than its section
// is left out: it's a stricter plan's card, or an alternative to one, rearranged around the looser changes. With the
// user's payment cards, a better card for an item is a free saving of its own (M9.3, card-suggestions.ts), and so is
// paying in another currency its seller lets the buyer pick (M9.6, currency-suggestions.ts), for an item no other free
// change is about. "Save up to" adds those of the items the best plan keeps as they are.

/** The suggestions for a list, and what its best plan saves. */
export function optimize(input: OptimizerInput): OptimizerResult {
  const model = buildModel(input);
  const checks = buildChecks(model);
  const { plans, exhaustive } = searchPlans(model, checks);
  const list = model.items
    .map((item) => itemSignature(item.resolved))
    .sort()
    .join('\n');
  const suggestions: Suggestion[] = [];
  plans.forEach((plan, level) => {
    for (const card of cardsOf(model, checks, plan)) {
      const signature = card
        .map((option) => model.options[option].signature)
        .sort()
        .join('|');
      const suggestion = suggestionOf(model, checks, card, fingerprintOf(list, signature));
      if (suggestion?.severity === severities[level]) suggestions.push(suggestion);
    }
  });
  const cards = input.cards ?? [];
  const room =
    cards.length > 0 ? cardRoom(model, cards, input.cardLoads, input.context) : undefined;
  const byCard = room ? cardSuggestions(model, room, input.context, list) : [];
  // A currency is judged on the item as it'll be paid for: one another free change is about waits for it.
  const freeChanged = new Set(
    [...suggestions, ...byCard]
      .filter((suggestion) => suggestion.severity === 'free')
      .flatMap((suggestion) => suggestion.actions.flatMap(actionItemIds)),
  );
  const byCurrency = room ? currencySuggestions(model, input, room, freeChanged, list) : [];
  suggestions.push(...byCard, ...byCurrency);
  // Equal savings by their changes' titles, so the order never hangs on the items' ids.
  const titles = new Map(
    suggestions.map((suggestion) => [suggestion, suggestion.actions.map(actionTitle).join(' + ')]),
  );
  suggestions.sort(
    (a, b) =>
      severities.indexOf(a.severity) - severities.indexOf(b.severity) ||
      b.savings - a.savings ||
      (titles.get(a) ?? '').localeCompare(titles.get(b) ?? '', 'en') ||
      (a.fingerprint < b.fingerprint ? -1 : 1),
  );
  const best = evaluate(model, checks, plans[3]);
  const planSavings = model.baseline - best.cost;
  const changes = [...new Set(plans[3])].filter((option) => !isKeep(model, option));
  // A better card for each item the best plan keeps: one it removes or replaces isn't paid for any more.
  const replaced = new Set(changes.flatMap((option) => replacedItems(model, option)));
  const cardKept = byCard.filter((suggestion) =>
    suggestion.actions.every(
      (action) => action.kind === 'card' && !replaced.has(action.item.itemId),
    ),
  );
  // Another currency for each item the best plan leaves as it is: a new plan or period has prices of its own.
  const changed = new Set(
    changes.flatMap((option) =>
      model.options[option].items.map((index) => model.items[index].resolved.item.id),
    ),
  );
  const currencyKept = byCurrency.filter((suggestion) =>
    suggestion.actions.flatMap(actionItemIds).every((itemId) => !changed.has(itemId)),
  );
  const kept = [...cardKept, ...currencyKept];
  const bestSavings =
    (planSavings >= savingEpsilon ? planSavings : 0) +
    kept.reduce((total, suggestion) => total + suggestion.savings, 0);
  return {
    suggestions,
    bestSavings,
    bestEstimated:
      (planSavings >= savingEpsilon && estimated(model, changes)) ||
      kept.some((suggestion) => suggestion.estimated),
    currency: input.context.currency,
    next12: model.baseline,
    search: exhaustive ? 'exhaustive' : 'greedy',
    replacements: replacements(input),
  };
}

/**
 * A plan's changes, as cards that can each be applied alone: changes that depend on each other share a card. A change
 * depends on another when a key of an item it changes, in some slot, is given neither by the change itself nor by an
 * item left as it is, and the other change gives it or takes away an item that gave it (removing both VPNs, or a
 * bundle that brings what another change takes away).
 */
function cardsOf(model: OptimizerModel, checks: Checks, plan: Int32Array): number[][] {
  const changes = [...new Set(plan)].filter((option) => !isKeep(model, option));
  const parent = new Map(changes.map((option) => [option, option]));
  const find = (option: number): number => {
    let root = option;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(option, root);
    return root;
  };
  for (const change of changes) {
    for (const index of model.options[change].items) {
      const item = model.items[index];
      const removed = losesService(model, item, plan);
      // The slots an option gives the key in, for this item.
      const gives = (option: number, key: number) =>
        (model.options[option].byKey.get(key) ?? []).reduce(
          (mask, contribution) =>
            counts(contribution, item, removed) ? mask | contribution.mask : mask,
          0,
        );
      for (const check of checks.byItem[index]) {
        let settled = gives(change, check.key);
        for (const other of check.affecting) {
          if (isKeep(model, plan[other])) settled |= gives(plan[other], check.key);
        }
        if ((check.need & ~settled) === 0) continue;
        for (const other of check.affecting) {
          const option = plan[other];
          if (option === change || isKeep(model, option)) continue;
          if (gives(option, check.key) !== 0 || gives(model.keep[other], check.key) !== 0) {
            parent.set(find(option), find(change));
          }
        }
      }
    }
  }
  const cards = new Map<number, number[]>();
  for (const change of changes) {
    const root = find(change);
    cards.set(root, [...(cards.get(root) ?? []), change]);
  }
  return [...cards.values()];
}

/** The items an option ends: one it removes, or makes an extra member, or puts in a bundle or suite. */
function replacedItems(model: OptimizerModel, option: number): string[] {
  return model.options[option].actions.flatMap((action) => {
    switch (action.kind) {
      case 'remove':
      case 'extra-member':
        return [action.item.itemId];
      case 'bundle':
      case 'suite':
        return action.items.map((item) => item.itemId);
      default:
        return [];
    }
  });
}

function isKeep(model: OptimizerModel, option: number): boolean {
  return model.keep[model.options[option].items[0]] === option;
}

/** A card judged alone against the list as it is, or undefined when it saves nothing. */
function suggestionOf(
  model: OptimizerModel,
  checks: Checks,
  card: readonly number[],
  fingerprint: string,
): Suggestion | undefined {
  const choice = Int32Array.from(model.keep);
  for (const option of card) {
    for (const item of model.options[option].items) choice[item] = option;
  }
  const evaluation = evaluate(model, checks, choice);
  const savings = model.baseline - evaluation.cost;
  if (evaluation.level >= blocked || savings < savingEpsilon) return undefined;

  const lost = new Map<number, Rank>();
  for (const { check } of evaluation.lost) {
    const rank = model.items[check.item].ranks.get(check.key) ?? 'not-ranked';
    const known = lost.get(check.key);
    // A key lost as Wanted for one item and Unwanted for another shows as Wanted: the worse loss.
    if (known === undefined || check.level > levelOf(severityOfRank(known))) {
      lost.set(check.key, rank);
    }
  }
  const provided = new Set(model.items.flatMap((item) => [...item.ranks.keys()]));
  const gained = new Map<string, FeatureChange>();
  for (const option of card) {
    for (const added of model.options[option].added) {
      for (const key of added.providedKeys) {
        const number = model.keyIds.indexOf(key);
        if ((number >= 0 && provided.has(number)) || gained.has(key)) continue;
        gained.set(key, {
          key,
          label: number >= 0 ? model.labels[number] : key,
          rank: added.effectiveRanks[key] ?? 'not-ranked',
        });
      }
    }
  }
  const next12 = evaluation.cost;
  return {
    fingerprint,
    severity: severities[evaluation.level as 0 | 1 | 2 | 3],
    actions: card.flatMap((option) => model.options[option].actions),
    savings,
    next12,
    monthly: next12 / 12,
    estimated: estimated(model, card),
    lost: [...lost].map(([key, rank]) => ({
      key: model.keyIds[key],
      label: model.labels[key],
      rank,
    })),
    lostServices: evaluation.lostServices.map((index) => ({
      itemId: model.items[index].resolved.item.id,
      title: model.items[index].suggested.title,
    })),
    gained: [...gained.values()],
  };
}

/** Whether changes involve a converted price: one they add, or one of the items they replace. */
function estimated(model: OptimizerModel, changes: readonly number[]): boolean {
  return changes.some(
    (option) =>
      model.options[option].converted ||
      model.options[option].items.some((item) => model.items[item].full.converted),
  );
}
