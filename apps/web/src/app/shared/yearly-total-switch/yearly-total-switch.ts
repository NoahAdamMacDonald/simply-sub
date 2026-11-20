import { Component, computed, inject } from '@angular/core';
import {
  MatButtonToggle,
  MatButtonToggleGroup,
  type MatButtonToggleChange,
} from '@angular/material/button-toggle';
import { SettingsStore } from '../../core/settings/settings-store';

let nextId = 0;

/**
 * The yearly total (P2, P3, P4): this calendar year's or the next 12 months' (PROJECT-PLAN §3.1), a labelled segmented
 * button above the totals on Home, the Lists overview and List view. The choice is this device's (settings.yearlyTotal,
 * which sync leaves alone), saved at once, and every page's totals follow it (M10.35), so it's chosen once.
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
