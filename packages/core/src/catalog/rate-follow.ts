import type { AccountRates, FollowedChange } from './account';
import type { BankOfCanadaChange } from './bank-of-canada';

// How soon an account's rates followed the Bank of Canada's (M11.14, BLUEPRINT §4.11): from the days its rates changed
// (each set's `since`, and each old set's `until`, rates.history) and the Bank's changes (data/bank-of-canada.yaml).
// data:build puts it on the account for its card, and leaves the history itself out of the app's files.

/** How many of the Bank's changes a card says how soon it followed. */
export const followedCount = 3;

/**
 * For the Bank's last changes, newest first: the day the account's rates next changed, before the Bank's next change;
 * none when they didn't, or haven't yet as of the rates' lastVerified. Only for rates that follow the Bank's or the
 * prime rate. A change before the account's record begins is judged only when the change that begins it followed it;
 * older ones are unknown, and so is one since the rates were last read.
 */
export function followedChanges(
  rates: AccountRates,
  changes: readonly BankOfCanadaChange[],
  count = followedCount,
): FollowedChange[] {
  if (rates.follows === 'none') return [];
  const history = rates.history ?? [];
  const days = [
    ...new Set(
      [rates.since, ...history.flatMap((entry) => [entry.since, entry.until])].filter(
        (day): day is string => day !== undefined,
      ),
    ),
  ].sort();
  // The record is complete from the oldest set's start, or, when that isn't known, from the change that ended it.
  const oldest = history.at(-1);
  const recordFrom = oldest ? (oldest.since ?? oldest.until) : rates.since;
  if (recordFrom === undefined) return [];
  const bank = [...changes].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const followed: FollowedChange[] = [];
  for (let index = bank.length - 1; index >= 0 && followed.length < count; index--) {
    const { on: change, rate } = bank[index];
    const next = bank[index + 1]?.on;
    const day = days.find(
      (candidate) => candidate >= change && (next === undefined || candidate < next),
    );
    if (change < recordFrom) {
      if (day === recordFrom) followed.push({ change, rate, on: day });
      break;
    }
    if (day !== undefined) followed.push({ change, rate, on: day });
    else if (next !== undefined || rates.lastVerified >= change) followed.push({ change, rate });
  }
  return followed;
}
