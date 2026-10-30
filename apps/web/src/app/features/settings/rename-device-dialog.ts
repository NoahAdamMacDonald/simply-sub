import { Component, inject, signal } from '@angular/core';
import {
  FormField,
  FormRoot,
  form,
  maxLength,
  required,
  type FieldTree,
} from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { maxDeviceNameLength } from '@simply-sub/core';
import { focusFirstError } from '../../shared/focus-first-error';

/**
 * Names this device in sync's list of devices (PROJECT-PLAN P13, M10.9), so the others can tell it apart. Closes with
 * the new name, trimmed.
 */
@Component({
  selector: 'ss-rename-device-dialog',
  imports: [
    FormField,
    FormRoot,
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
  ],
  templateUrl: './rename-device-dialog.html',
  styleUrl: './rename-device-dialog.scss',
})
export class RenameDeviceDialog {
  private readonly dialogRef = inject<MatDialogRef<RenameDeviceDialog, string>>(MatDialogRef);
  private readonly model = signal({ name: inject<string>(MAT_DIALOG_DATA) });
  protected readonly form = form(
    this.model,
    (path) => {
      required(path.name, { message: 'Give this device a name' });
      maxLength(path.name, maxDeviceNameLength, {
        message: `Use at most ${maxDeviceNameLength} characters`,
      });
    },
    {
      submission: {
        action: async () => this.dialogRef.close(this.model().name.trim()),
        onInvalid: focusFirstError,
      },
    },
  );

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }
}
