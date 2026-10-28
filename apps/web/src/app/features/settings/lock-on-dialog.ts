import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, validateTree, type FieldTree } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatOption } from '@angular/material/core';
import {
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  defaultLockIdleChoice,
  lockIdleChoices,
  lockIdleLabel,
  minPassphraseLength,
  passphraseIssues,
  type LockIdleChoice,
  type PassphraseForm,
} from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { AppLockRepository } from '../../core/storage/app-lock-repository';
import { focusFirstError } from '../../shared/focus-first-error';
import { issueErrors } from '../../shared/form-issues';

/**
 * Lock with a passphrase (PROJECT-PLAN P13; BLUEPRINT §11.5): the passphrase typed twice (at least 8 characters, never
 * trimmed) and Lock after, then every user table is encrypted in one transaction. It says nobody can recover a
 * forgotten passphrase, and offers an encrypted backup first. Closes with true once the lock is on.
 */
@Component({
  selector: 'ss-lock-on-dialog',
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
    MatHint,
    MatIcon,
    MatInput,
    MatLabel,
    MatOption,
    MatSelect,
  ],
  templateUrl: './lock-on-dialog.html',
  styleUrl: './lock-on-dialog.scss',
})
export class LockOnDialog {
  private readonly lock = inject(AppLockRepository);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject<MatDialogRef<LockOnDialog, boolean>>(MatDialogRef);

  protected readonly minLength = minPassphraseLength;
  protected readonly idleChoices = lockIdleChoices.map((value) => ({
    value,
    label: lockIdleLabel(value),
  }));
  /** Lock after: a choice, so nothing to check. */
  protected readonly idle = signal<LockIdleChoice>(defaultLockIdleChoice);
  protected readonly busy = signal(false);
  private readonly model = signal<PassphraseForm>({ passphrase: '', confirm: '' });
  protected readonly form = form(
    this.model,
    (path) =>
      validateTree(path, ({ value, fieldTree }) =>
        issueErrors(fieldTree, passphraseIssues(value())),
      ),
    { submission: { action: () => this.turnOn(), onInvalid: focusFirstError } },
  );

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** Export a backup first, encrypted if the user likes, in its own dialog over this one. */
  protected async exportFirst(): Promise<void> {
    const { ExportBackupDialog } = await import('./export-backup-dialog');
    const name = await firstValueFrom(
      this.dialog
        .open(ExportBackupDialog, {
          maxWidth: 'min(480px, calc(100vw - 32px))',
          width: '480px',
        })
        .afterClosed(),
    );
    if (name) this.snackBar.open(`Saved ${name}`, undefined, { duration: 5000 });
  }

  private async turnOn(): Promise<void> {
    this.busy.set(true);
    // Closing now wouldn't stop it.
    this.dialogRef.disableClose = true;
    try {
      await this.lock.turnOn(this.model().passphrase, this.idle());
      this.dialogRef.close(true);
    } finally {
      this.busy.set(false);
      this.dialogRef.disableClose = false;
    }
  }
}
