import { Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, apply, form } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { settingsDefaults } from '@simply-sub/core';
import { BROWSER_LANGUAGES } from '../../core/settings/browser-languages';
import { SettingsStore } from '../../core/settings/settings-store';
import { ThemeService } from '../../core/theme/theme-service';
import { focusFirstError } from '../../shared/focus-first-error';
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
 * backup instead" comes with backups (M6.9).
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

  protected firstError(field: 'monthlyBudget' | 'annualBudget'): string | undefined {
    return this.form[field]().errors()[0]?.message;
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
