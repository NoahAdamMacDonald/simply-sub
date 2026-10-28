import { DOCUMENT } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, validateTree, type FieldTree } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { minPassphraseLength, passphraseIssues, type PassphraseForm } from '@simply-sub/core';
import { BackupService } from '../../core/backup/backup-service';
import { focusFirstError } from '../../shared/focus-first-error';
import { issueErrors } from '../../shared/form-issues';
import { saveTextFile } from '../../shared/save-file';

/**
 * Export backup (PROJECT-PLAN P13): every backed-up record as a file the browser downloads, encrypted when "Protect
 * with a passphrase" is on (BLUEPRINT §11.5). The passphrase is typed twice, and the dialog says nobody can recover
 * it. Closes with the file's name.
 */
@Component({
  selector: 'ss-export-backup-dialog',
  imports: [
    FormField,
    FormRoot,
    MatButton,
    MatCheckbox,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
  ],
  templateUrl: './export-backup-dialog.html',
  styleUrl: './export-backup-dialog.scss',
})
export class ExportBackupDialog {
  private readonly backups = inject(BackupService);
  private readonly document = inject(DOCUMENT);
  private readonly dialogRef = inject<MatDialogRef<ExportBackupDialog, string>>(MatDialogRef);

  protected readonly minLength = minPassphraseLength;
  protected readonly protect = signal(false);
  protected readonly busy = signal(false);
  private readonly model = signal<PassphraseForm>({ passphrase: '', confirm: '' });
  protected readonly form = form(
    this.model,
    (path) =>
      validateTree(path, ({ value, fieldTree }) =>
        this.protect() ? issueErrors(fieldTree, passphraseIssues(value())) : [],
      ),
    { submission: { action: () => this.export(), onInvalid: focusFirstError } },
  );

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  private async export(): Promise<void> {
    this.busy.set(true);
    try {
      const file = await this.backups.export(this.protect() ? this.model().passphrase : undefined);
      if (!file) return;
      saveTextFile(this.document, file.name, file.text);
      this.dialogRef.close(file.name);
    } finally {
      this.busy.set(false);
    }
  }
}
