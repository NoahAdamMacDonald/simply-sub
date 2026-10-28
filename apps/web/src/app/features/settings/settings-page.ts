import { Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { subdivisionName, taxAddedRegions, type Settings } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { catalogDate } from '../../core/catalog/catalog-dates';
import { CatalogStore, type CatalogCheckOutcome } from '../../core/catalog/catalog-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { ThemeService, type ThemeMode } from '../../core/theme/theme-service';
import { countryName } from '../../shared/country-name';
import { importedText } from './backup-text';
import { PageHeader } from '../../shared/page-header/page-header';
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
 * Settings (PROJECT-PLAN P13): budgets, appearance, where the user is (📍), Search's start, Your data (backups and
 * Delete all data, M6.9) and the catalog's version. Tags and the app lock (M6.10) come with their tasks.
 */
@Component({
  selector: 'ss-settings-page',
  imports: [
    BudgetSetting,
    MatButton,
    MatCheckbox,
    MatIcon,
    MatRadioButton,
    MatRadioGroup,
    PageHeader,
  ],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly settings = inject(SettingsStore);
  private readonly catalog = inject(CatalogStore);
  private readonly theme = inject(ThemeService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

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

  /** The user's country, by name, for Search's Sold in. */
  protected readonly country = computed(() => {
    const saved = this.saved();
    return saved && countryName(saved.country);
  });

  /** Whether Search starts with Sold in on (P8, M5.6); kept only when it's on. */
  protected setSoldOnly(on: boolean): void {
    void this.settings.update({ searchSoldOnly: on ? true : undefined });
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

  /** Export backup: the dialog, then "Saved simply-sub-backup-2026-10-27.json". */
  protected async exportBackup(): Promise<void> {
    const { ExportBackupDialog } = await import('./export-backup-dialog');
    const name = await firstValueFrom(
      this.dialog.open(ExportBackupDialog, backupDialog).afterClosed(),
    );
    if (name) this.snackBar.open(`Saved ${name}`, undefined, { duration: 5000 });
  }

  /** Import backup: the dialog, then what it did. */
  protected async importBackup(): Promise<void> {
    const { ImportBackupDialog } = await import('./import-backup-dialog');
    const result = await firstValueFrom(
      this.dialog.open(ImportBackupDialog, backupDialog).afterClosed(),
    );
    if (result) {
      this.snackBar.open(importedText(result.mode, result.counts), undefined, { duration: 5000 });
    }
  }

  /** Delete all data: after typing DELETE, everything goes, and Home shows the first-run dialog. */
  protected async deleteAll(): Promise<void> {
    const { DeleteDataDialog } = await import('./delete-data-dialog');
    const deleted = await firstValueFrom(
      this.dialog.open(DeleteDataDialog, backupDialog).afterClosed(),
    );
    if (deleted) void this.router.navigateByUrl('/');
  }
}

/** The backup dialogs' size: 480 px, or the screen's width less a margin. */
const backupDialog = { maxWidth: 'min(480px, calc(100vw - 32px))', width: '480px' };
