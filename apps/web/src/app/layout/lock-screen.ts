import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { FormField, FormRoot, form, required, type FieldTree } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AppLockRepository } from '../core/storage/app-lock-repository';
import { Logo } from './logo';
import { openSnack, snackMillis } from '../shared/snack/snack';

/** The backup dialogs' size, as Settings opens them. */
const backupDialog = { maxWidth: 'min(480px, calc(100vw - 32px))', width: '480px' };

/**
 * The lock screen (PROJECT-PLAN P15; BLUEPRINT §11.5): in place of the app while the app lock is locked, on each visit
 * and after the idle time. The passphrase unlocks it; a wrong one unlocks nothing and says so, with focus kept in the
 * field. "Forgot it?" offers the two ways out, which both turn the lock off: import a backup in place of everything
 * here, or delete all data. Loaded only when the lock is on.
 */
@Component({
  selector: 'ss-lock-screen',
  imports: [
    FormField,
    FormRoot,
    Logo,
    MatButton,
    MatError,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
  ],
  templateUrl: './lock-screen.html',
  styleUrl: './lock-screen.scss',
})
export class LockScreen {
  private readonly lock = inject(AppLockRepository);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('passphraseInput');

  protected readonly busy = signal(false);
  /** The last passphrase tried was wrong. */
  protected readonly wrong = signal(false);
  protected readonly forgotOpen = signal(false);
  private readonly model = signal({ passphrase: '' });
  protected readonly form = form(
    this.model,
    (path) => required(path.passphrase, { message: 'Enter your passphrase' }),
    { submission: { action: () => this.unlock(), onInvalid: () => this.focusField() } },
  );

  constructor() {
    afterNextRender(() => this.focusField());
  }

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** Import a backup: it replaces everything here, and the lock goes with it. */
  protected async importBackup(): Promise<void> {
    const { ImportBackupDialog } = await import('../features/settings/import-backup-dialog');
    const result = await firstValueFrom(
      this.dialog
        .open(ImportBackupDialog, { ...backupDialog, data: { locked: true } })
        .afterClosed(),
    );
    if (!result) return;
    openSnack(this.snackBar, 'Imported the backup', undefined, { duration: snackMillis });
    void this.router.navigateByUrl('/');
  }

  /** Delete all data: everything goes, the lock with it, and the first-run dialog shows. */
  protected async deleteAll(): Promise<void> {
    const { DeleteDataDialog } = await import('../features/settings/delete-data-dialog');
    const deleted = await firstValueFrom(
      this.dialog.open(DeleteDataDialog, { ...backupDialog, data: { locked: true } }).afterClosed(),
    );
    if (deleted) void this.router.navigateByUrl('/');
  }

  private async unlock(): Promise<void> {
    this.busy.set(true);
    // Shown again after each wrong try, so a screen reader hears it each time.
    this.wrong.set(false);
    try {
      // Unlocked, the app takes this screen's place.
      if (await this.lock.unlock(this.model().passphrase)) return;
      this.wrong.set(true);
      this.focusField();
      this.input().nativeElement.select();
    } finally {
      this.busy.set(false);
    }
  }

  private focusField(): void {
    this.input().nativeElement.focus();
  }
}
