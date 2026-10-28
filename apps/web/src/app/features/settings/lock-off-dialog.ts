import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormField, FormRoot, form, required, type FieldTree } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { AppLockRepository } from '../../core/storage/app-lock-repository';

/**
 * Turn off the lock (PROJECT-PLAN P13; BLUEPRINT §11.5): the passphrase, then every user table is decrypted in one
 * transaction. A wrong passphrase changes nothing and says so, with focus kept in the field. Closes with true once
 * it's off.
 */
@Component({
  selector: 'ss-lock-off-dialog',
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
  templateUrl: './lock-off-dialog.html',
  styleUrl: './lock-off-dialog.scss',
})
export class LockOffDialog {
  private readonly lock = inject(AppLockRepository);
  private readonly dialogRef = inject<MatDialogRef<LockOffDialog, boolean>>(MatDialogRef);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('passphraseInput');

  protected readonly busy = signal(false);
  /** The last passphrase tried was wrong. */
  protected readonly wrong = signal(false);
  private readonly model = signal({ passphrase: '' });
  protected readonly form = form(
    this.model,
    (path) => required(path.passphrase, { message: 'Enter your passphrase' }),
    { submission: { action: () => this.turnOff(), onInvalid: () => this.focusField() } },
  );

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  private async turnOff(): Promise<void> {
    this.busy.set(true);
    this.wrong.set(false);
    this.dialogRef.disableClose = true;
    try {
      if (await this.lock.turnOff(this.model().passphrase)) {
        this.dialogRef.close(true);
        return;
      }
      this.wrong.set(true);
      this.focusField();
      this.input().nativeElement.select();
    } finally {
      this.busy.set(false);
      this.dialogRef.disableClose = false;
    }
  }

  private focusField(): void {
    this.input().nativeElement.focus();
  }
}
