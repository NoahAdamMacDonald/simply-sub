import type { Plan } from './provider';

// A renamed plan keeps its id (BLUEPRINT §4.3, M10.27): its `formerNames` are matched by Search for good. An item shows
// the old name until its next renewal (user/former-name.ts, M10.28).

/** Every name the plan goes by: its own, then its former names. */
export function planNames(plan: Pick<Plan, 'name' | 'formerNames'>): string[] {
  return [plan.name, ...(plan.formerNames ?? []).map(({ name }) => name)];
}
