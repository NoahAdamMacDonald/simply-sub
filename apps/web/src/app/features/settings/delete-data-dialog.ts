import { Component, Injector, inject, signal } from '@angular/core';
import { MatCheckbox } from '@angular/material/checkbox';
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
import { LiveCalendarRepository } from '../../core/storage/live-calendar-repository';
import { SyncRepository } from '../../core/storage/sync-repository';
import { focusFirstError } from '../../shared/focus-first-error';

/** What the user types to delete everything (P13). */
const confirmWord = 'DELETE';

/** Where it starts: Settings, or the lock screen (P15), where a backup can't be exported first. */
export interface DeleteDataData {
  locked?: boolean;
}

/**
 * Delete all data (PROJECT-PLAN P13): typing DELETE confirms it, then every table is cleared in one transaction and the
 * dialog closes with true. The first-run dialog then shows, as on a first visit. With sync on (M10.9) it asks whether to
 * delete the synced copy too; either way sync turns off here. From the lock screen (P15) it's the way out of a
 * forgotten passphrase, and the lock goes with the data.
 */
@Component({
  selector: 'ss-delete-data-dialog',
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
    MatInput,
    MatLabel,
  ],
  templateUrl: './delete-data-dialog.html',
  styleUrl: './delete-data-dialog.scss',
})
export class DeleteDataDialog {
  private readonly backups = inject(BackupService);
  private readonly liveCalendar = inject(LiveCalendarRepository);
  private readonly syncRepository = inject(SyncRepository);
  private readonly injector = inject(Injector);
  private readonly dialogRef = inject<MatDialogRef<DeleteDataDialog, boolean>>(MatDialogRef);

  protected readonly word = confirmWord;
  protected readonly locked =
    inject<DeleteDataData | null>(MAT_DIALOG_DATA, { optional: true })?.locked === true;
  protected readonly busy = signal(false);
  /** Sync is on here (M10.9), so the synced copy can go too. */
  protected readonly syncOn = signal(false);
  protected readonly deleteSynced = signal(false);
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

  constructor() {
    if (!this.locked) {
      this.syncRepository
        .readOnce()
        .then((record) => this.syncOn.set(record !== undefined && record.problem === undefined))
        .catch(() => undefined);
    }
  }

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  private async delete(): Promise<void> {
    this.busy.set(true);
    try {
      // The live calendar's links go first, while their manage key is here (M10.3). Offline, or locked, when it can't
      // be read, they stop updating, and the server deletes them after 180 days.
      if (!this.locked) {
        const record = await this.liveCalendar.readOnce().catch(() => undefined);
        if (record) {
          const { revokeFeedSet } = await import('../../shared/live-calendar/live-calendar-client');
          await revokeFeedSet(record.setId, record.manageKey).catch(() => undefined);
        }
      }
      // The synced copy, when asked, while its code is here. Offline, it stays for the other devices.
      if (this.deleteSynced()) {
        const { SyncService } = await import('../../shared/sync/sync-service');
        await this.injector
          .get(SyncService)
          .deleteCopy()
          .catch(() => undefined);
      }
      await this.backups.deleteAll();
      this.dialogRef.close(true);
    } finally {
      this.busy.set(false);
    }
  }
}
