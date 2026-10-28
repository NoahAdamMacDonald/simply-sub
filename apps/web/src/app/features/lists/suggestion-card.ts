import { Component, computed, inject, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import type { Suggestion } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { PriceTag } from '../../shared/price-tag/price-tag';
import { amountText } from '../../shared/price-tag/price-text';
import { RankDot } from '../../shared/rank/rank-dot';
import { rankNames } from '../../shared/rank/rank-text';
import { actionLine } from './suggestion-text';

/**
 * One P14 card: its changes, with the prices they go from and to and when each happens; what it saves over the next 12
 * months, tagged Estimated when converted prices are in it; the features it loses or gains, with their ranks' dots;
 * and Apply and Dismiss, or Show again when it's dismissed. Its stripe is its section's colour.
 */
@Component({
  selector: 'ss-suggestion-card',
  imports: [MatButton, MatIcon, MatTooltip, PriceTag, RankDot],
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

  protected readonly rankNames = rankNames;
  protected readonly id = computed(() => `suggestion-${this.suggestion().fingerprint}`);
  protected readonly lines = computed(() => this.suggestion().actions.map(actionLine));
  protected readonly title = computed(() =>
    this.lines()
      .map((line) => line.title)
      .join('; '),
  );
  protected readonly savings = computed(() =>
    amountText(this.suggestion().savings, this.currency(), this.settings.saved()?.country),
  );
}
