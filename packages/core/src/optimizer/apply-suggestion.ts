import type { IsoDate } from '../dates/iso-date';
import type { ListDraft } from '../user/list-draft';
import type { ListItem } from '../user/list-item';
import { rankSchema, type Rank } from '../user/rank';
import type { Timestamp } from '../user/record';
import { withChanges } from '../user/stamps';
import { reperiod, withAddOn } from './model';
import type { Suggestion, SuggestionAction } from './suggestion';

// Apply (PROJECT-PLAN P14): a suggestion's changes as edits to its list's draft, which the editor opens with them, so
// nothing is saved until Save. Each change takes effect on the item's next charge, as the savings assume: a removed
// or replaced item ends then (it stays until what's paid for runs out), a plan or billing change re-anchors the item
// on it, and a bundle or suite starts on the earliest next charge of the items it replaces. Specific dates have no
// end date, so a removed one leaves the draft, and a plan change keeps its windows.

/** An item's fields, as the draft gives them an id, its list and the time. */
export type NewItemFields = Omit<ListItem, 'id' | 'listId' | 'createdAt' | 'updatedAt'>;

/** One edit to a draft: an item changed (a field set to undefined is cleared), taken out, or added. */
export type DraftEdit =
  | { kind: 'change'; itemId: string; changes: Partial<Pick<ListItem, ChangedField>> }
  | { kind: 'remove'; itemId: string }
  | { kind: 'add'; fields: NewItemFields };

type ChangedField = 'source' | 'billing' | 'priceOverride';

/**
 * The edits that apply `suggestion` to a draft whose items (the ones it hasn't removed) are `items`, by id. Undefined
 * when an item the suggestion changes isn't there any more: the draft has changed it away, so the suggestion no longer
 * fits.
 */
export function suggestionEdits(
  suggestion: Pick<Suggestion, 'actions'>,
  items: ReadonlyMap<string, ListItem>,
): DraftEdit[] | undefined {
  const working = new Map<string, ListItem>();
  const removed = new Set<string>();
  const added: NewItemFields[] = [];
  const current = (itemId: string) => working.get(itemId) ?? items.get(itemId);
  const change = (itemId: string, changes: Partial<ListItem>) => {
    const item = current(itemId);
    if (item) working.set(itemId, { ...item, ...changes });
  };
  const end = (itemId: string, on: IsoDate) => {
    const item = current(itemId);
    if (!item) return;
    const { billing } = item;
    if (
      billing.mode === 'limited' ||
      (billing.startDate !== undefined && on <= billing.startDate)
    ) {
      removed.add(itemId);
    } else if (billing.endDate === undefined || billing.endDate > on) {
      change(itemId, { billing: { ...billing, endDate: on } });
    }
  };

  for (const action of suggestion.actions) {
    if (actionItems(action).some((itemId) => !items.has(itemId))) return undefined;
    switch (action.kind) {
      case 'interval':
      case 'downgrade':
      case 'switch': {
        const item = current(action.item.itemId);
        if (!item) break;
        const source =
          action.kind === 'interval' || item.source.kind !== 'catalog'
            ? item.source
            : {
                kind: 'catalog' as const,
                planId: action.planId,
                ...(action.addOns && { addOns: action.addOns }),
              };
        change(item.id, {
          source,
          billing:
            item.billing.mode === 'recurring'
              ? reperiod(item.billing, action.to, action.on)
              : item.billing,
          priceOverride: undefined,
        });
        break;
      }
      case 'remove':
        end(action.item.itemId, action.on);
        break;
      case 'extra-member': {
        const host = current(action.host.itemId);
        if (host?.source.kind === 'catalog') {
          change(host.id, {
            source: { ...host.source, addOns: withAddOn(host.source.addOns, action.addOnId, 1) },
          });
        }
        end(action.item.itemId, action.on);
        break;
      }
      case 'bundle':
      case 'suite': {
        const members = action.items.flatMap((member) => current(member.itemId) ?? []);
        added.push({
          source:
            action.kind === 'bundle'
              ? { kind: 'bundle', bundleId: action.bundleId }
              : { kind: 'catalog', planId: action.planId },
          ...(members[0]?.region !== undefined && { region: members[0].region }),
          billing: {
            mode: 'recurring',
            interval: action.to.interval,
            intervalCount: action.to.intervalCount,
            anchorDate: action.on,
            autoRenew: action.to.autoRenew,
          },
          tagIds: [...new Set(members.flatMap((member) => member.tagIds))],
          rankOverrides: mergedOverrides(members),
          pinned: members.some((member) => member.pinned),
        });
        for (const member of action.items) end(member.itemId, member.next ?? action.on);
        break;
      }
      case 'card':
        // M9 (BLUEPRINT §9.3): the item's card. Never suggested yet.
        break;
    }
  }

  const edits: DraftEdit[] = [];
  for (const [itemId, item] of working) {
    if (removed.has(itemId)) continue;
    edits.push({
      kind: 'change',
      itemId,
      changes: { source: item.source, billing: item.billing, priceOverride: item.priceOverride },
    });
  }
  for (const itemId of removed) edits.push({ kind: 'remove', itemId });
  for (const fields of added) edits.push({ kind: 'add', fields });
  return edits;
}

/**
 * `draft` with `edits` made at `now`: changed items stamped, removed ones marked (so Undo can bring them back, P5),
 * and added ones given `ids`, one for each edit, in order (undefined for the others). Throws when an edit names an
 * item the draft doesn't have.
 */
export function withDraftEdits(
  draft: ListDraft,
  edits: readonly DraftEdit[],
  ids: readonly (string | undefined)[],
  now: Timestamp,
): ListDraft {
  let items = draft.items;
  const named = (itemId: string) => {
    if (!items.some((entry) => entry.item.id === itemId)) {
      throw new Error(`The draft of list ${draft.listId} has no item ${itemId}`);
    }
  };
  edits.forEach((edit, index) => {
    switch (edit.kind) {
      case 'change':
        named(edit.itemId);
        items = items.map((entry) =>
          entry.item.id === edit.itemId
            ? { ...entry, item: withChanges<ListItem>(entry.item, edit.changes, now) }
            : entry,
        );
        break;
      case 'remove':
        named(edit.itemId);
        items = items.map((entry) =>
          entry.item.id === edit.itemId ? { ...entry, removed: true as const } : entry,
        );
        break;
      case 'add': {
        const id = ids[index];
        if (id === undefined) throw new Error('An added item needs an id');
        items = [
          ...items,
          { item: { ...edit.fields, id, listId: draft.listId, createdAt: now, updatedAt: now } },
        ];
        break;
      }
    }
  });
  return { ...draft, items };
}

/** The items an action changes. */
function actionItems(action: SuggestionAction): string[] {
  switch (action.kind) {
    case 'bundle':
    case 'suite':
      return action.items.map((item) => item.itemId);
    case 'extra-member':
      return [action.item.itemId, action.host.itemId];
    default:
      return [action.item.itemId];
  }
}

/** The replaced items' own ranks together: where two rank one key, the more important rank. */
function mergedOverrides(items: readonly ListItem[]): ListItem['rankOverrides'] {
  const merged: Record<string, Rank> = {};
  const order = rankSchema.options;
  for (const item of items) {
    for (const [key, rank] of Object.entries(item.rankOverrides)) {
      const known = merged[key];
      if (known === undefined || order.indexOf(rank) < order.indexOf(known)) merged[key] = rank;
    }
  }
  return merged;
}
