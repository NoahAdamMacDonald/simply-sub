import type { Settings } from './settings';

// The settings every device shares (PROJECT-PLAN M10.7, BLUEPRINT §11.4), which sync merges as one, by when one of them
// last changed (the settings' sharedUpdatedAt): what the settings repository needs to keep that time. It's in the app's
// initial bundle, so this file imports no Zod and holds no more than that (sync.ts has the rest, BLUEPRINT §11.1).

/** The settings every device shares: where the user is, the tax, the budgets, Search's defaults and dismissed warnings. */
export const sharedSettingsFields = [
  'country',
  'subdivision',
  'currency',
  'salesTaxPercent',
  'monthlyBudget',
  'annualBudget',
  'searchSoldOnly',
  'searchAllResellers',
  'dismissedBudgetWarnings',
] as const satisfies readonly (keyof Settings)[];

/**
 * `after`, saved in place of `before`, with when its shared settings last changed: at its `updatedAt` when one of them
 * did, else as before. Each is a string, a number, a flag or a list of strings, so their text tells them apart. Settings
 * from before there was a `sharedUpdatedAt` had them change no later than their `updatedAt`.
 */
export function withSharedTime(before: Settings | undefined, after: Settings): Settings {
  const changed =
    before === undefined ||
    sharedSettingsFields.some((field) => String(before[field]) !== String(after[field]));
  return {
    ...after,
    sharedUpdatedAt: changed ? after.updatedAt : (before.sharedUpdatedAt ?? before.updatedAt),
  };
}
