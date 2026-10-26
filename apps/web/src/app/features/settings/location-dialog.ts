import { Component, inject, signal } from '@angular/core';
import { FormRoot, form } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import type { Settings } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { focusFirstError } from './focus-first-error';
import { LocationFields } from './location-fields';
import { locationModel, locationSchema, locationValues } from './settings-form';

/**
 * Settings' 📍 dialog (P13): country, province or state, currency and the sales tax that follows. It opens with the
 * saved settings.
 */
@Component({
  selector: 'ss-location-dialog',
  imports: [
    FormRoot,
    LocationFields,
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
  ],
  templateUrl: './location-dialog.html',
  styleUrl: './location-dialog.scss',
})
export class LocationDialog {
  private readonly settings = inject(SettingsStore);
  private readonly dialogRef = inject<MatDialogRef<LocationDialog>>(MatDialogRef);

  private readonly model = signal(locationModel(inject<Settings>(MAT_DIALOG_DATA)));
  protected readonly form = form(this.model, locationSchema, {
    submission: { action: () => this.save(), onInvalid: focusFirstError },
  });

  private async save(): Promise<void> {
    await this.settings.update(locationValues(this.model()));
    this.dialogRef.close();
  }
}
