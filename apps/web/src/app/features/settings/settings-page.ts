import { Location } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { Router } from '@angular/router';
import { subdivisionName, taxAddedRegions, type Settings } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { ThemeService, type ThemeMode } from '../../core/theme/theme-service';
import { BudgetSetting } from './budget-setting';
import { LocationDialog } from './location-dialog';
import { percentText, placeSummary } from './place-names';

/**
 * Settings (PROJECT-PLAN P13): budgets, appearance, and where the user is (📍). Tags, backups (M6.9), the app lock
 * (M6.10) and the catalog's version come with their tasks.
 */
@Component({
  selector: 'ss-settings-page',
  imports: [BudgetSetting, MatButton, MatIcon, MatIconButton, MatRadioButton, MatRadioGroup],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly settings = inject(SettingsStore);
  private readonly theme = inject(ThemeService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  protected readonly saved = this.settings.saved;
  protected readonly mode = this.theme.mode;
  protected readonly modes: readonly { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  protected readonly place = computed(() => {
    const saved = this.saved();
    return saved && placeSummary(saved);
  });

  /** The tax line under 📍: "Sales tax 13% (Ontario)". */
  protected readonly salesTax = computed(() => {
    const saved = this.saved();
    if (!saved) return undefined;
    if (!taxAddedRegions.has(saved.country)) return 'Prices include sales tax';
    const tax = this.settings.salesTax();
    if (!tax) return 'No sales tax added';
    const where =
      tax.source === 'own' ? 'your rate' : (subdivisionName(saved.subdivision ?? '') ?? '');
    return `Sales tax ${percentText(tax.percent)} (${where})`;
  });

  /** ←: back where the user came from, or Home when Settings was the first page opened. */
  protected back(): void {
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) {
      this.location.back();
    } else {
      void this.router.navigateByUrl('/');
    }
  }

  protected setMode(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }

  protected editLocation(saved: Settings): void {
    this.dialog.open(LocationDialog, {
      data: saved,
      maxWidth: 'min(560px, calc(100vw - 32px))',
      width: '560px',
    });
  }
}
