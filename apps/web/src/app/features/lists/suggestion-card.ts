import { Component, computed, inject, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import type { FeatureChange, Rank, Suggestion } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { PriceTag } from '../../shared/price-tag/price-tag';
import { amountText } from '../../shared/price-tag/price-text';
import { RankChip } from '../../shared/rank/rank-chip';
import { rankNames } from '../../shared/rank/rank-text';
import { actionLine } from './suggestion-text';

/**
 * One P14 card: its change, with the prices it goes from and to and when it happens; what it saves over the next 12
 * months, tagged Estimated when converted prices are in it; the services and ranked features it loses or gains, a row
 * each, by rank, with the features you haven't ranked folded under them (M10.34); and Apply and Dismiss, or Show again
 * when it's dismissed. Its stripe is its section's colour.
 */
@Component({
  selector: 'ss-suggestion-card',
  imports: [MatButton, MatIcon, MatTooltip, PriceTag, RankChip],
  templateUrl: './suggestion-card.html',
  styleUrl: './suggestion-card.scss',
  host: { '[attr.data-severity]': 'suggestion().severity', '[class.dismissed]': 'dismissed()' },
})
export class SuggestionCard {
  private readonly settings = inject(SettingsStore);

  readonly suggestion = input.required<Suggestion>();
  /** The user's currency, which the savings are in. */
  readonly currency = input.required<string>();
  readonly dismissed = input(false);
  /** Apply is under way, here or on another card. */
  readonly busy = input(false);
  readonly apply = output();
  readonly dismiss = output();
  readonly restore = output();

  protected readonly id = computed(() => `suggestion-${this.suggestion().fingerprint}`);
  protected readonly lines = computed(() => this.suggestion().actions.map(actionLine));
  protected readonly title = computed(() =>
    this.lines()
      .map((line) => line.title)
      .join('; '),
  );
  /** The ranked features it loses and gains, the most important rank first. */
  protected readonly lost = computed(() => ranked(this.suggestion().lost));
  protected readonly gained = computed(() => ranked(this.suggestion().gained));
  /** The features you haven't ranked that it loses and gains, folded under a summary; undefined when there are none. */
  protected readonly unranked = computed(() => {
    const lost = this.suggestion().lost.filter(isUnranked);
    const gained = this.suggestion().gained.filter(isUnranked);
    if (lost.length + gained.length === 0) return undefined;
    const features = (count: number) =>
      `${count} ${count === 1 ? 'feature' : 'features'} you haven't ranked`;
    const summary =
      gained.length === 0
        ? `Also loses ${features(lost.length)}`
        : lost.length === 0
          ? `Also gains ${features(gained.length)}`
          : `Also changes ${features(lost.length + gained.length)}: loses ${lost.length}, gains ${gained.length}`;
    return { lost, gained, summary };
  });
  protected readonly savings = computed(() =>
    amountText(this.suggestion().savings, this.currency(), this.settings.saved()?.country),
  );
}

/** Ranks in importance, as rankNames lists them: Essential first, Unwanted last. */
const order = Object.keys(rankNames) as Rank[];

function isUnranked(change: FeatureChange): boolean {
  return change.rank === 'not-ranked';
}

function ranked(changes: readonly FeatureChange[]): FeatureChange[] {
  return changes
    .filter((change) => !isUnranked(change))
    .sort(
      (a, b) =>
        order.indexOf(a.rank) - order.indexOf(b.rank) || a.label.localeCompare(b.label, 'en'),
    );
}
