import { samePeriod, type Period } from '../dates/period';
import { periodText, planTitle } from '../user/item-text';
import type { Severity, SuggestionAction } from './suggestion';

// What P14's cards say: each change in words, and each section's heading. Amounts are the UI's to format.

/** A change in words: "Switch Disney+ Premium to annual billing", "Downgrade Netflix Premium → Standard". */
export function actionTitle(action: SuggestionAction): string {
  switch (action.kind) {
    case 'interval':
      return `Switch ${action.item.title} to ${billingText(action.to)}`;
    case 'downgrade':
    case 'switch': {
      const verb = action.kind === 'downgrade' ? 'Downgrade' : 'Switch';
      const billed = samePeriod(action.to, action.item.price) ? '' : `, ${billingText(action.to)}`;
      return `${verb} ${action.item.title} → ${action.planName}${billed}`;
    }
    case 'remove':
      return `Remove ${action.item.title}`;
    case 'extra-member':
      return `Make ${action.item.title} an extra member on ${action.host.title}`;
    case 'bundle':
      return `Replace ${namesText(action.items.map((item) => item.title))} with ${action.name}`;
    case 'suite':
      return `Replace ${namesText(action.items.map((item) => item.title))} with ${planTitle(action.name, action.planName)}`;
    case 'card':
      return `Pay for ${action.item.title} with a better card`;
    case 'currency':
      return `Pay for ${action.item.title} in ${action.to.source.currency}`;
  }
}

/** "annual billing", "monthly billing", "billing every 3 months". */
function billingText({ interval, intervalCount }: Period): string {
  if (interval === 'year' && intervalCount === 1) return 'annual billing';
  const text = periodText(interval, intervalCount);
  return intervalCount === 1 ? `${text} billing` : `billing ${text}`;
}

/** "A", "A and B", "A, B and C". */
export function namesText(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** P14's sections: each severity's heading and what it means. */
export const severityText: Record<Severity, { heading: string; meaning: string }> = {
  free: { heading: 'Free savings', meaning: 'nothing is lost' },
  red: {
    heading: 'Recommended',
    meaning: 'only removes features you marked Unwanted or didn’t rank',
  },
  orange: { heading: 'Suggested', meaning: 'also removes features you marked Unused' },
  yellow: {
    heading: 'Worth a look',
    meaning: 'affects Wanted, Uses or Sometimes features, or a service itself',
  },
};
