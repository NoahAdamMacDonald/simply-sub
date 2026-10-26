import { Location } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { Router } from '@angular/router';
import { subdivisionName, taxAddedRegions, type Settings } from '@simply-sub/core';
import { catalogDate } from '../../core/catalog/catalog-dates';
import { CatalogStore, type CatalogCheckOutcome } from '../../core/catalog/catalog-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { ThemeService, type ThemeMode } from '../../core/theme/theme-service';
import { BudgetSetting } from './budget-setting';
import { LocationDialog } from './location-dialog';
import { percentText, placeSummary } from './place-names';

/** What [Check for updates] found. */
const checkMessages: Record<CatalogCheckOutcome, string> = {
  current: 'You have the latest catalog.',
  updated: 'Downloaded the latest catalog.',
  offline: "You're offline. Try again when you're back online.",
  failed: "Couldn't check for updates. Try again later.",
};

/**
 * Settings (PROJECT-PLAN P13): budgets, appearance, where the user is (📍) and the catalog's version. Tags, backups
 * (M6.9) and the app lock (M6.10) come with their tasks.
 */
@Component({
  selector: 'ss-settings-page',
  imports: [BudgetSetting, MatButton, MatIcon, MatIconButton, MatRadioButton, MatRadioGroup],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly settings = inject(SettingsStore);
  private readonly catalog = inject(CatalogStore);
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

  /** The Catalog line: "Updated Oct 22, 2026 · version 37f6573". */
  protected readonly catalogLine = computed(() => {
    const version = this.catalog.version();
    const generatedAt = this.catalog.generatedAt();
    return version === undefined || generatedAt === undefined
      ? 'Not downloaded yet'
      : `Updated ${catalogDate(generatedAt)} · version ${version}`;
  });

  /** What the last [Check for updates] found: only the user's own checks, not the automatic ones. */
  protected readonly checkMessage = signal('');

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

  protected async checkForUpdates(): Promise<void> {
    this.checkMessage.set('Checking for updates…');
    this.checkMessage.set(checkMessages[await this.catalog.check()]);
  }

  protected editLocation(saved: Settings): void {
    this.dialog.open(LocationDialog, {
      data: saved,
      maxWidth: 'min(560px, calc(100vw - 32px))',
      width: '560px',
    });
  }
}
