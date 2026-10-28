// Lock after (PROJECT-PLAN P13; BLUEPRINT §11.5, M6.10): how long the app lock waits without input before it locks
// again. This file imports no Zod, so Settings and the idle timer can use it without loading the record schemas.

/** Lock after's choices in minutes, as the lock's settings store them. */
export const lockIdleMinuteChoices = [5, 15, 30, 60] as const;
export type LockIdleMinutes = (typeof lockIdleMinuteChoices)[number];

/** Lock after's choices (P13), in order: minutes without input, or never (it locks only when the tab closes). */
export const lockIdleChoices = [...lockIdleMinuteChoices, 'never'] as const;
export type LockIdleChoice = (typeof lockIdleChoices)[number];

/** What Lock after starts on when the lock is turned on. */
export const defaultLockIdleChoice: LockIdleChoice = 15;

/** Lock after's label: "5 minutes", "1 hour", "Never". */
export function lockIdleLabel(choice: LockIdleChoice): string {
  if (choice === 'never') return 'Never';
  return choice === 60 ? '1 hour' : `${choice} minutes`;
}

/** Lock after's choice for a lock's settings: no idleMinutes is never. */
export function lockIdleChoice(lock: { idleMinutes?: LockIdleMinutes }): LockIdleChoice {
  return lock.idleMinutes ?? 'never';
}

/** A lock's idleMinutes for a choice: undefined for never. */
export function lockIdleMinutes(choice: LockIdleChoice): LockIdleMinutes | undefined {
  return choice === 'never' ? undefined : choice;
}
