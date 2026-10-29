import { Component, Injector, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox, type MatCheckboxChange } from '@angular/material/checkbox';
import { MatOption } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatSelect } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import {
  lockIdleChoice,
  lockIdleChoices,
  lockIdleLabel,
  subdivisionName,
  taxAddedRegions,
  type LockIdleChoice,
  type Settings,
} from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { catalogDate } from '../../core/catalog/catalog-dates';
import { CatalogStore, type CatalogCheckOutcome } from '../../core/catalog/catalog-store';
import { AppUpdates, type AppCheckOutcome } from '../../core/pwa/app-updates';
import { appVersion } from '../../core/pwa/app-version';
import { installOffer, installedHere } from '../../core/pwa/install-offer';
import { SettingsStore } from '../../core/settings/settings-store';
import { AppLockRepository } from '../../core/storage/app-lock-repository';
import { LiveCalendarRepository } from '../../core/storage/live-calendar-repository';
import { StorageService } from '../../core/storage/storage-service';
import { ThemeService, type ThemeMode } from '../../core/theme/theme-service';
import { countryName } from '../../shared/country-name';
import { dateText } from '../../shared/date-text';
import { openLiveCalendar } from '../../shared/live-calendar/open-live-calendar';
import { importedText } from './backup-text';
import { PageHeader } from '../../shared/page-header/page-header';
import { BudgetSetting } from './budget-setting';
import { LocationDialog } from './location-dialog';
import { percentText, placeSummary } from './place-names';
import { TagsSetting } from './tags-setting';

/** What [Check for updates] found. */
const checkMessages: Record<CatalogCheckOutcome, string> = {
  current: 'You have the latest catalog.',
  updated: 'Downloaded the latest catalog.',
  offline: "You're offline. Try again when you're back online.",
  failed: "Couldn't check for updates. Try again later.",
};

/** What the App group's [Check for updates] found (M10.6). */
const appCheckMessages: Record<AppCheckOutcome, string> = {
  current: 'You have the latest version.',
  ready: 'A new version is ready: reload to use it.',
  offline: "You're offline. Try again when you're back online.",
  failed: "Couldn't check for updates. Try again later.",
};

/**
 * Settings (PROJECT-PLAN P13): budgets, custom tags (M6.11), appearance, where the user is (📍), Search's start, Your
 * data (backups and Delete all data, M6.9), Security (the app lock, M6.10), the catalog's version, and the App: its
 * install and its version (M10.6).
 */
@Component({
  selector: 'ss-settings-page',
  imports: [
    BudgetSetting,
    MatButton,
    MatCheckbox,
    MatFormField,
    MatHint,
    MatIcon,
    MatLabel,
    MatOption,
    MatRadioButton,
    MatRadioGroup,
    MatSelect,
    PageHeader,
    TagsSetting,
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
  private readonly lock = inject(AppLockRepository);
  private readonly storage = inject(StorageService);
  private readonly liveCalendar = inject(LiveCalendarRepository);
  private readonly appUpdates = inject(AppUpdates);
  private readonly injector = inject(Injector);

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

  /** The live calendar (M10.3): on, with how many calendars and when they were last sent, or off. */
  protected readonly liveCalendarOn = computed(() => this.liveCalendar.record() !== undefined);
  protected readonly liveCalendarLine = computed(() => {
    const record = this.liveCalendar.record();
    if (!record) {
      return 'Off. A link your calendar app follows, so your payments show there and stay up to date.';
    }
    if (record.broken) return 'Its links no longer work: make new ones.';
    const count = record.calendars.length;
    return `On: ${count === 1 ? 'a calendar' : `${count} calendars`}, last sent ${dateText(record.sentAt.slice(0, 10))}.`;
  });

  protected openLiveCalendar(): void {
    void openLiveCalendar(this.injector);
  }

  /** What the last [Check for updates] found: only the user's own checks, not the automatic ones. */
  protected readonly checkMessage = signal('');

  /**
   * The App group (M10.6): Install, unless this is the installed app (iOS's home screen apps say so their own way), and
   * the version with its own check.
   */
  protected readonly runsInstalled =
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  protected readonly installAvailable = computed(() => installOffer() !== undefined);
  protected readonly installedHere = installedHere.asReadonly();
  protected readonly updatesAvailable = this.appUpdates.available;
  protected readonly appCheckMessage = signal('');
  /** "Version fd54aac, built Oct 29, 2026"; a development build has no version. */
  protected readonly versionLine = appVersion
    ? `${appVersion.commit ? `Version ${appVersion.commit}, built` : 'Built'} ${dateText(appVersion.builtOn)}`
    : 'A development build';

  /** The browser's install dialog, which an offer shows once; installing it fires appinstalled. */
  protected install(): void {
    const offer = installOffer();
    if (!offer) return;
    installOffer.set(undefined);
    void offer.prompt();
  }

  protected async checkForAppUpdates(): Promise<void> {
    this.appCheckMessage.set('Checking for updates…');
    this.appCheckMessage.set(appCheckMessages[await this.appUpdates.check()]);
  }

  /** Security: whether the app lock is on, and Lock after. */
  protected readonly lockOn = computed(() => this.saved()?.appLock !== undefined);
  protected readonly idleChoice = computed(() => {
    const lock = this.saved()?.appLock;
    return lock && lockIdleChoice(lock);
  });
  protected readonly idleChoices = lockIdleChoices.map((value) => ({
    value,
    label: lockIdleLabel(value),
  }));
  /** IndexedDB is blocked and nothing is saved (P15), so there's nothing to lock. */
  protected readonly inMemory = computed(() => this.storage.mode() === 'memory');

  /** The user's country, by name, for Search's Sold in. */
  protected readonly country = computed(() => {
    const saved = this.saved();
    return saved && countryName(saved.country);
  });

  /** Whether Search starts with Sold in on (P8, M5.6); kept only when it's on. */
  /** The page's groups and their sections, for "On this page" (M4.7): the most used first. */
  protected readonly groups = [
    {
      id: 'everyday',
      name: 'Everyday',
      sections: [
        { id: 'budgets', name: 'Budgets' },
        { id: 'tags', name: 'Custom tags' },
        { id: 'appearance', name: 'Appearance' },
      ],
    },
    {
      id: 'where',
      name: 'Where you are',
      sections: [
        { id: 'location', name: 'Location and currency' },
        { id: 'search', name: 'Search' },
      ],
    },
    {
      id: 'data',
      name: 'Your data',
      sections: [
        { id: 'backups', name: 'Backups' },
        { id: 'lock', name: 'App lock' },
        { id: 'live-calendar', name: 'Live calendar' },
        { id: 'catalog', name: 'Catalog' },
        { id: 'delete', name: 'Delete all data' },
      ],
    },
    {
      id: 'app',
      name: 'App',
      sections: [
        ...(this.runsInstalled ? [] : [{ id: 'install', name: 'Install' }]),
        { id: 'version', name: 'Version' },
      ],
    },
  ];

  /** Goes to a group or section, below the top bar, with focus on its heading so Tab goes on from there. */
  protected jump(event: Event, id: string): void {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    target.focus({ preventScroll: true });
  }

  protected setSoldOnly(on: boolean): void {
    void this.settings.update({ searchSoldOnly: on ? true : undefined });
  }

  /** Search lists every official reseller of a plan, cheaper or not (M5.13). Off by default. */
  protected setAllResellers(on: boolean): void {
    void this.settings.update({ searchAllResellers: on ? true : undefined });
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
      // Its heading first: the Country menu, focused, would open its list over the dialog (M6.16).
      autoFocus: 'first-heading',
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

  /**
   * Lock with a passphrase: its dialog turns the lock on, or off with the passphrase. The checkbox shows what's so,
   * not the click, until the dialog has done it.
   */
  protected async toggleLock(change: MatCheckboxChange): Promise<void> {
    const on = this.lockOn();
    change.source.checked = on;
    const dialog = on
      ? (await import('./lock-off-dialog')).LockOffDialog
      : (await import('./lock-on-dialog')).LockOnDialog;
    const done = await firstValueFrom(
      this.dialog.open<unknown, unknown, boolean>(dialog, backupDialog).afterClosed(),
    );
    if (done) {
      this.snackBar.open(on ? 'The lock is off' : 'The lock is on', undefined, { duration: 5000 });
    }
  }

  /** Lock after. */
  protected setIdle(choice: LockIdleChoice): void {
    void this.lock.setIdle(choice);
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
