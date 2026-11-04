import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import {
  policyGradeCounts,
  type PlanPolicies,
  type PolicyCitation,
  type PolicyGroup,
  type PolicyStatus,
  type PolicyTier,
} from '@simply-sub/core';

/** The grades' names, in muted text beside each rating's topic (BLUEPRINT §4.10). */
export const tierNames: Record<PolicyTier, string> = {
  great: 'Great',
  good: 'Good',
  neutral: 'Neutral',
  poor: 'Poor',
  bad: 'Bad',
};

/** What a rating without a grade says instead, in grey (M11.1). */
const statusNames: Record<PolicyStatus, string> = {
  'not-stated': 'Not stated',
  'not-applicable': 'Not applicable',
};

const groupNames: Record<PolicyGroup, string> = {
  privacy: 'Privacy',
  billing: 'Billing',
  legal: 'Legal',
  security: 'Security',
  service: 'Service',
  finance: 'Money',
  other: 'Notable',
};

/**
 * A Search card's Terms and policies, rated (BLUEPRINT §4.10, M1.13, M1.14, M11.1): their grades counted, then by group
 * each topic's grade as a dot and in words, why in plain words with a citation of each page it quotes, and where to
 * change it; then the pages, numbered. The card details' Terms tab (the owner's design, 2026-11-03).
 */
@Component({
  selector: 'ss-policy-ratings',
  imports: [MatIcon, MatTooltip],
  templateUrl: './policy-ratings.html',
  styleUrl: './policy-ratings.scss',
})
export class PolicyRatings {
  /** Its ratings for the plan shown, as they apply where the user lives (core's planPolicies). */
  readonly policies = input.required<PlanPolicies>();

  /** How many ratings have each grade, "7 Great", then how many have none, "3 not graded". */
  protected readonly grades = computed(() =>
    policyGradeCounts(this.policies()).map(({ tier, count }) => ({
      tier,
      words: `${count} ${tier === 'none' ? 'not graded' : tierNames[tier]}`,
    })),
  );
  protected readonly tierNames = tierNames;
  protected readonly statusNames = statusNames;
  protected readonly groupNames = groupNames;

  /** A citation's tooltip: the words it quotes, and the page; a page read that's silent on the topic, by name. */
  protected quoteText({ quotes, name }: PolicyCitation): string {
    return quotes.length > 0 ? `${quotes.map((quote) => `“${quote}”`).join(' ')} (${name})` : name;
  }
}
