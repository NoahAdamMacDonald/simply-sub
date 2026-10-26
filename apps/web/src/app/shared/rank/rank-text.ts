import type { Rank } from '@simply-sub/core';

// What ranks are called on screen (BLUEPRINT §8.3). Their order and which ones a dropdown offers come from core.

export const rankNames: Record<Rank, string> = {
  essential: 'Essential',
  critical: 'Critical',
  needed: 'Needed',
  wanted: 'Wanted',
  uses: 'Uses',
  sometimes: 'Sometimes',
  'not-ranked': 'Not ranked',
  unused: 'Unused',
  unwanted: 'Unwanted',
};

/** The one-line hints of the subscription-only ranks (P6). */
export const rankHints: Partial<Record<Rank, string>> = {
  essential: 'Keep this plan',
  critical: 'Keep this provider',
};
