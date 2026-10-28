import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, validate, type FieldTree } from '@angular/forms/signals';
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
import { BackupService } from '../../core/backup/backup-service';
import { focusFirstError } from '../../shared/focus-first-error';

/** What the user types to delete everything (P13). */
const confirmWord = 'DELETE';

/** Where it starts: Settings, or the lock screen (P15), where a backup can't be exported first. */
export interface DeleteDataData {
  locked?: boolean;
}

/**
 * Delete all data (PROJECT-PLAN P13): typing DELETE confirms it, then every table is cleared in one transaction and the
 * dialog closes with true. The first-run dialog then shows, as on a first visit. From the lock screen (P15) it's the way
 * out of a forgotten passphrase, and the lock goes with the data.
 */
@Component({
  selector: 'ss-delete-data-dialog',
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
  templateUrl: './delete-data-dialog.html',
  styleUrl: './delete-data-dialog.scss',
})
export class DeleteDataDialog {
  private readonly backups = inject(BackupService);
  private readonly dialogRef = inject<MatDialogRef<DeleteDataDialog, boolean>>(MatDialogRef);

  protected readonly word = confirmWord;
  protected readonly locked =
    inject<DeleteDataData | null>(MAT_DIALOG_DATA, { optional: true })?.locked === true;
  protected readonly busy = signal(false);
  private readonly model = signal({ confirm: '' });
  protected readonly form = form(
    this.model,
    (path) =>
      validate(path.confirm, ({ value }) =>
        value().trim() === confirmWord
          ? undefined
          : { kind: 'confirm', message: `Type ${confirmWord} in capitals to delete everything` },
      ),
    { submission: { action: () => this.delete(), onInvalid: focusFirstError } },
  );

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  private async delete(): Promise<void> {
    this.busy.set(true);
    try {
      await this.backups.deleteAll();
      this.dialogRef.close(true);
    } finally {
      this.busy.set(false);
    }
  }
}
