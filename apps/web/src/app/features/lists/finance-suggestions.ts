import { Component, computed, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { FinanceSuggestion } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { financeCard } from './finance-text';

/**
 * Optimizations' finance cards (M11.13, BLUEPRINT §10.6): what a list's accounts could earn after fees, or a balance
 * no insurer covers, warnings first. Each says it's information, not financial advice; one about an account sold
 * elsewhere links to it in Search. Nothing here is applied: the user acts on it themselves.
 */
@Component({
  selector: 'ss-finance-suggestions',
  imports: [MatIcon, RouterLink],
  templateUrl: './finance-suggestions.html',
  styleUrl: './finance-suggestions.scss',
})
export class FinanceSuggestions {
  private readonly settings = inject(SettingsStore);

  readonly suggestions = input.required<readonly FinanceSuggestion[]>();
  /** The user's currency, which the optimizer's amounts are in. */
  readonly currency = input.required<string>();

  protected readonly cards = computed(() => {
    const country = this.settings.saved()?.country;
    return this.suggestions().map((suggestion) =>
      financeCard(suggestion, this.currency(), country),
    );
  });
}
