import { addMonths, type IsoDate } from '../dates/iso-date';
import type { Plan } from './provider';

// A renamed plan keeps its id (BLUEPRINT §4.3, M10.27): its `formerNames` are matched by Search for good, and its cards
// say "Ultra (formerly Max 20x)" for six months after it stopped using the old name.

/** How long the cards show a former name. */
export const formerNameMonths = 6;

/** The plan's latest former name while the cards still show it (until six months after its `until`), else undefined. */
export function shownFormerName(
  plan: Pick<Plan, 'formerNames'>,
  today: IsoDate,
): string | undefined {
  const [latest] = plan.formerNames ?? [];
  return latest && today <= addMonths(latest.until, formerNameMonths) ? latest.name : undefined;
}

/** "(formerly Max 20x)" while the cards show it, else undefined. */
export function formerlyText(plan: Pick<Plan, 'formerNames'>, today: IsoDate): string | undefined {
  const name = shownFormerName(plan, today);
  return name === undefined ? undefined : `(formerly ${name})`;
}

/** Every name the plan goes by: its own, then its former names. */
export function planNames(plan: Pick<Plan, 'name' | 'formerNames'>): string[] {
  return [plan.name, ...(plan.formerNames ?? []).map(({ name }) => name)];
}
