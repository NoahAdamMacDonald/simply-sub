import { describe, expect, it } from 'vitest';
import {
  actionTitle,
  chargesIn,
  itemReplacements,
  next12Range,
  suggestionEdits,
  type ListItem,
  type Suggestion,
} from '../../src';
import { catalog, item, resolveAll, run, today } from './fixtures';

// Applying suggestions one after another, as Optimizations does (P14, M8.4): each Apply changes the draft, and the
// suggestions come again for it. Whatever is applied, in whatever order, nobody loses a service no suggestion said it
// gives up: an item that ends is taken over by an account, bundle or suite that goes on, never by one that ends too
// (two Netflix accounts each an extra member on the other, the feedback after M10). And each list costs what the
// suggestion applied said it would.

const place = { country: 'CA', subdivision: 'CA-AB' };
let nextId = 0;

/** The items with `suggestion` applied, as the draft has them. */
function apply(items: readonly ListItem[], suggestion: Suggestion): ListItem[] {
  const edits = suggestionEdits(suggestion, new Map(items.map((entry) => [entry.id, entry])));
  if (!edits) throw new Error(`${titleOf(suggestion)} no longer fits`);
  let next = [...items];
  for (const edit of edits) {
    if (edit.kind === 'remove') next = next.filter((entry) => entry.id !== edit.itemId);
    if (edit.kind === 'change') {
      next = next.map((entry) => {
        if (entry.id !== edit.itemId) return entry;
        const changed: Record<string, unknown> = { ...entry, ...edit.changes };
        for (const key of Object.keys(changed)) if (changed[key] === undefined) delete changed[key];
        return changed as ListItem;
      });
    }
    if (edit.kind === 'add') {
      next.push({
        ...edit.fields,
        id: `0192f1c5-1c2d-7e3f-8a4b-${String(900_000 + ++nextId).padStart(12, '0')}`,
        listId: items[0].listId,
        createdAt: '2026-10-28T12:00:00.000Z',
        updatedAt: '2026-10-28T12:00:00.000Z',
      });
    }
  }
  return next;
}

function titleOf(suggestion: Suggestion): string {
  return suggestion.actions.map(actionTitle).join(' + ');
}

/** The items' charges over the next 12 months, added up. */
function next12(items: readonly ListItem[]): number {
  return chargesIn(resolveAll(items), next12Range(today), place).reduce(
    (sum, charge) => sum + charge.amount,
    0,
  );
}

/**
 * Why the item's service doesn't go on, or undefined when it does: it doesn't end, or what takes over from it goes
 * on. An item that ends with nothing to take over, or one that's gone, is fine when a suggestion said it gives it up.
 */
function lostWithoutSaying(
  itemId: string,
  items: readonly ListItem[],
  announced: ReadonlySet<string>,
): string | undefined {
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const replacements = itemReplacements(items, catalog);
  const chain: string[] = [];
  for (let id: string | undefined = itemId; id !== undefined;) {
    if (chain.includes(id)) return `each takes over from the next: ${chain.join(' → ')} → ${id}`;
    chain.push(id);
    const entry = byId.get(id);
    if (!entry) return announced.has(id) ? undefined : `${id} is gone`;
    if (entry.billing.mode !== 'recurring' || entry.billing.endDate === undefined) return undefined;
    const replacement = replacements.get(id);
    if (!replacement) {
      return announced.has(id)
        ? undefined
        : `${id} ends on ${entry.billing.endDate}, replaced by nothing`;
    }
    id = replacement.itemId;
  }
  return undefined;
}

interface Step {
  title: string;
  items: ListItem[];
}

/**
 * Applies suggestions round after round, `paths` choosing which: the first, or the last, every time, or each of the
 * first suggestions in turn to `depth`. Checks each list on the way, and returns the problems found, each with the
 * suggestions that led to it.
 */
function explore(start: ListItem[], depth: number): string[] {
  const problems: string[] = [];
  const people = start.map((entry) => entry.id);
  const visit = (items: ListItem[], steps: Step[], announced: Set<string>, left: number) => {
    const { suggestions } = run(items);
    if (left === 0 || suggestions.length === 0) return;
    if (steps.length >= 20) {
      problems.push(`${steps.map((step) => step.title).join(' ⟶ ')}: suggestions never run out`);
      return;
    }
    const tried = left === Infinity ? [suggestions[0]] : suggestions.slice(0, 6);
    for (const suggestion of tried) {
      const title = titleOf(suggestion);
      const path = [...steps.map((step) => step.title), title].join(' ⟶ ');
      const after = apply(items, suggestion);
      const said = new Set([...announced, ...suggestion.lostServices.map((lost) => lost.itemId)]);
      // A bundle or suite has the ranks of the people it took over, so a change to it that gives up what they had says
      // so in its own losses. An extra member's host never does: their person isn't its.
      if (suggestion.lost.length > 0 || suggestion.lostServices.length > 0) {
        const kept = itemReplacements(after, catalog);
        for (const [itemId, replacement] of itemReplacements(items, catalog)) {
          if (replacement.kind !== 'extra-member' && !kept.has(itemId)) said.add(itemId);
        }
      }
      for (const person of people) {
        const why = lostWithoutSaying(person, after, said);
        if (why) problems.push(`${path}: ${why}`);
      }
      const byCard = suggestion.actions.some(
        (action) => action.kind === 'card' || action.kind === 'currency',
      );
      if (!byCard && Math.abs(next12(after) - suggestion.next12) > 0.05) {
        problems.push(
          `${path}: the list costs ${next12(after).toFixed(2)} for the next 12 months, not ${suggestion.next12.toFixed(2)}`,
        );
      }
      if (problems.length > 0) return;
      visit(after, [...steps, { title, items: after }], said, left - 1);
    }
  };
  visit(start, [], new Set(), depth);
  // Then the first suggestion every time, until there's none.
  visit(start, [], new Set(), Infinity);
  return problems;
}

describe('suggestions applied one after another', () => {
  it('never makes two accounts extra members of each other (two Netflix Standards)', () => {
    const mine = item('netflix.standard', {}, { nickname: 'Mine' });
    const sams = item('netflix.standard', {}, { nickname: "Sam's" });
    const first = run([mine, sams]).suggestions.find((suggestion) =>
      suggestion.actions.some((action) => action.kind === 'extra-member'),
    );
    if (!first) throw new Error('No extra member suggested');
    expect(first.severity).toBe('free');
    const after = apply([mine, sams], first);
    // The account that ends hosts nobody, and the one that hosts the extra member keeps it.
    const again = run(after).suggestions.map(titleOf);
    expect(again.filter((title) => /extra member/.test(title))).toEqual([]);
    expect(again.filter((title) => /Standard with ads/.test(title))).toHaveLength(0);
    expect(explore([mine, sams], 4)).toEqual([]);
  });

  it('keeps the extra member an account hosts, whatever else changes', () => {
    const mine = item('netflix.standard', {}, { nickname: 'Mine' });
    const sams = item('netflix.standard', { anchorDate: '2026-11-20' }, { nickname: "Sam's" });
    const dads = item('netflix.premium', { anchorDate: '2026-11-15' }, { nickname: "Dad's" });
    const kids = item('netflix.standard', { anchorDate: '2026-11-25' }, { nickname: "Kids'" });
    expect(explore([mine, sams, dads, kids], 3)).toEqual([]);
  });

  it('keeps the day an extra member joins when its host moves to another plan', () => {
    const mine = item('netflix.premium', {}, { nickname: 'Mine' });
    const sams = item('netflix.standard', { anchorDate: '2026-11-20' }, { nickname: "Sam's" });
    const joined = run([mine, sams]).suggestions.find((suggestion) =>
      suggestion.actions.some(
        (action) => action.kind === 'extra-member' && action.host.itemId === mine.id,
      ),
    );
    if (!joined) throw new Error('No extra member suggested');
    const hosting = apply([mine, sams], joined);
    const downgrade = run(hosting).suggestions.find((suggestion) =>
      suggestion.actions.some(
        (action) => action.kind === 'downgrade' && action.item.itemId === mine.id,
      ),
    );
    if (!downgrade) throw new Error('No downgrade suggested');
    const after = apply(hosting, downgrade);
    expect(after.find((entry) => entry.id === mine.id)?.source).toEqual({
      kind: 'catalog',
      planId: 'netflix.standard',
      addOns: [{ id: 'netflix.extra-member', quantity: 1, since: '2026-11-20' }],
    });
    expect(itemReplacements(after, catalog).get(sams.id)).toMatchObject({
      kind: 'extra-member',
      itemId: mine.id,
    });
    expect(next12(after)).toBeCloseTo(downgrade.next12, 1);
  });

  it('never ends the items a bundle takes over without saying so (Crave and Disney+)', () => {
    const crave = item('crave.premium', { anchorDate: '2026-11-05' });
    const disney = item('disney-plus.premium', { anchorDate: '2026-11-15' });
    const disneyStandard = item('disney-plus.standard', { anchorDate: '2026-11-20' });
    expect(explore([crave, disney, disneyStandard], 3)).toEqual([]);
  });

  it('never ends the items a suite takes over without saying so (Proton, and two VPNs)', () => {
    const mail = item('proton.mail-plus', { anchorDate: '2026-11-03' });
    const vpn = item('proton.vpn-plus', { anchorDate: '2026-11-12' });
    const pass = item('proton.pass-plus', { anchorDate: '2026-11-18' });
    const ivpn = item('ivpn.pro', { anchorDate: '2026-11-08' });
    expect(explore([mail, vpn, pass, ivpn], 3)).toEqual([]);
  });

  it('stays sound for a long list, applying the first suggestion every time', () => {
    const items = [
      item('netflix.standard', {}, { nickname: 'Mine' }),
      item('netflix.standard', { anchorDate: '2026-11-20' }, { nickname: "Sam's" }),
      item('netflix.premium', { anchorDate: '2026-11-15' }, { nickname: "Dad's" }),
      item('netflix.standard', { anchorDate: '2026-11-25' }, { nickname: "Kids'" }),
      item('crave.premium', { anchorDate: '2026-11-05' }),
      item('disney-plus.premium', { anchorDate: '2026-11-15' }),
      item('proton.mail-plus', { anchorDate: '2026-11-03' }),
      item('proton.vpn-plus', { anchorDate: '2026-11-12' }),
      item('ivpn.pro', { anchorDate: '2026-11-08' }),
    ];
    expect(explore(items, 1)).toEqual([]);
  });
});
