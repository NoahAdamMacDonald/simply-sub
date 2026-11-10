import { Component, computed, inject } from '@angular/core';
import {
  MatButtonToggle,
  MatButtonToggleGroup,
  type MatButtonToggleChange,
} from '@angular/material/button-toggle';
import { SettingsStore } from '../../core/settings/settings-store';

let nextId = 0;

/**
 * List view's yearly total (P4): this calendar year's or the next 12 months' (PROJECT-PLAN §3.1), a labelled segmented
 * button above the totals. The choice is this device's (settings.yearlyTotal, which sync leaves alone), saved at once.
 */
@Component({
  selector: 'ss-yearly-total-switch',
  imports: [MatButtonToggleGroup, MatButtonToggle],
  templateUrl: './yearly-total-switch.html',
  styleUrl: './yearly-total-switch.scss',
})
export class YearlyTotalSwitch {
  private readonly settings = inject(SettingsStore);

  protected readonly id = `ss-yearly-total-${nextId++}`;
  /** The yearly total this device shows. */
  protected readonly yearly = computed(() => this.settings.saved()?.yearlyTotal ?? 'calendar');

  protected choose(change: MatButtonToggleChange): void {
    void this.settings.update({
      yearlyTotal: change.value === 'next-12-months' ? 'next-12-months' : undefined,
    });
  }
}
