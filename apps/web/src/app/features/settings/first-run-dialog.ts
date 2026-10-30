import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormField, FormRoot, apply, form } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MatDialog,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { readJoinLink, settingsDefaults, type JoinLink } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { joinInbox } from '../../core/join-inbox';
import { BROWSER_LANGUAGES } from '../../core/settings/browser-languages';
import { SettingsStore } from '../../core/settings/settings-store';
import { ThemeService } from '../../core/theme/theme-service';
import { focusFirstError } from '../../shared/focus-first-error';
import type { JoinSyncData } from './join-sync-dialog';
import { LocationFields } from './location-fields';
import {
  budgetSchema,
  locationModel,
  locationSchema,
  locationValues,
  type LocationModel,
} from './settings-form';

interface FirstRunModel {
  location: LocationModel;
  monthlyBudget: number | null;
  annualBudget: number | null;
}

/**
 * "Welcome to Simply Sub" (PROJECT-PLAN P1): shown while no settings are saved, and closed only by saving them. It
 * starts from the browser's languages (en-CA → Canada, in CAD), and saves the theme already on screen. "Import a
 * backup instead" (M6.9) and "Join with a sync code" (M10.15) end it too, with the backup's settings or the synced
 * copy's; a join link opened on a new device (M10.14) opens Join at once. Settings saved some other way (another tab's
 * first run) close it as well.
 */
@Component({
  selector: 'ss-first-run-dialog',
  imports: [
    FormField,
    FormRoot,
    LocationFields,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSuffix,
  ],
  templateUrl: './first-run-dialog.html',
  styleUrl: './first-run-dialog.scss',
})
export class FirstRunDialog {
  private readonly settings = inject(SettingsStore);
  private readonly theme = inject(ThemeService);
  private readonly dialogRef = inject<MatDialogRef<FirstRunDialog>>(MatDialogRef);
  private readonly dialog = inject(MatDialog);

  private readonly model = signal<FirstRunModel>({
    location: locationModel(settingsDefaults(inject(BROWSER_LANGUAGES))),
    monthlyBudget: null,
    annualBudget: null,
  });

  protected readonly form = form(
    this.model,
    (path) => {
      apply(path.location, locationSchema);
      apply(path.monthlyBudget, budgetSchema);
      apply(path.annualBudget, budgetSchema);
    },
    { submission: { action: () => this.save(), onInvalid: focusFirstError } },
  );

  protected readonly currency = computed(() => this.model().location.currency);

  constructor() {
    effect(() => {
      const fragment = joinInbox();
      if (fragment === undefined) return;
      untracked(() => {
        joinInbox.set(undefined);
        const link = readJoinLink(fragment);
        if (link) void this.joinSync(link);
      });
    });
    effect(() => {
      if (this.settings.saved()) untracked(() => this.dialogRef.close());
    });
  }

  protected firstError(field: 'monthlyBudget' | 'annualBudget'): string | undefined {
    return this.form[field]().errors()[0]?.message;
  }

  /** Import a backup instead (P1): its settings and lists, which end the first run. */
  protected async importBackup(): Promise<void> {
    const { ImportBackupDialog } = await import('./import-backup-dialog');
    const imported = await firstValueFrom(
      this.dialog
        .open(ImportBackupDialog, {
          data: { firstRun: true },
          maxWidth: 'min(480px, calc(100vw - 32px))',
          width: '480px',
        })
        .afterClosed(),
    );
    if (imported) this.dialogRef.close();
  }

  /** Join with a sync code (M10.15), or a join link: the synced copy's settings and data, which end the first run. */
  protected async joinSync(link?: JoinLink): Promise<void> {
    const { JoinSyncDialog } = await import('./join-sync-dialog');
    const joined = await firstValueFrom(
      this.dialog
        .open(JoinSyncDialog, {
          data: { firstRun: true, link } satisfies JoinSyncData,
          autoFocus: 'first-tabbable',
          maxWidth: 'min(720px, calc(100vw - 32px))',
          width: '720px',
        })
        .afterClosed(),
    );
    if (joined) this.dialogRef.close();
  }

  private async save(): Promise<void> {
    const { location, monthlyBudget, annualBudget } = this.model();
    await this.settings.save({
      ...locationValues(location),
      monthlyBudget: monthlyBudget ?? undefined,
      annualBudget: annualBudget ?? undefined,
      theme: this.theme.mode(),
    });
    this.dialogRef.close();
  }
}
