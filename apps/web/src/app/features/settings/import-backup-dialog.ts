import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form, required, type FieldTree } from '@angular/forms/signals';
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
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import {
  backupCounts,
  type BackupPayload,
  type BackupReading,
  type EncryptedBackup,
} from '@simply-sub/core';
import { BackupService } from '../../core/backup/backup-service';
import { catalogDate } from '../../core/catalog/catalog-dates';
import type { ImportCounts } from '../../core/storage/backup-repository';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { countLines } from './backup-text';

/**
 * Where the import starts: Settings; the first-run dialog, where there's nothing to merge with; or the lock screen
 * (P15), where what's here can't be opened, so the backup replaces all of it and the lock goes too.
 */
export interface ImportBackupData {
  firstRun?: boolean;
  locked?: boolean;
}

/** What an import did. */
export interface ImportBackupResult {
  mode: 'replace' | 'merge';
  counts: ImportCounts;
}

/**
 * Import backup (PROJECT-PLAN P13): a file picked → its passphrase, when it's encrypted → the whole file checked
 * (core's readBackupText) → what it holds → Merge (the newer of each record) or Replace (after asking). A file that
 * can't be used says why, and nothing is written. From the first-run dialog it's one Import, since there's nothing
 * here yet. From the lock screen it's one Replace, after asking, which deletes everything here, the app lock too.
 */
@Component({
  selector: 'ss-import-backup-dialog',
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
    MatIcon,
    MatInput,
    MatLabel,
  ],
  templateUrl: './import-backup-dialog.html',
  styleUrl: './import-backup-dialog.scss',
})
export class ImportBackupDialog {
  private readonly backups = inject(BackupService);
  private readonly confirmer = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly dialogRef =
    inject<MatDialogRef<ImportBackupDialog, ImportBackupResult>>(MatDialogRef);
  private readonly data = inject<ImportBackupData | null>(MAT_DIALOG_DATA, { optional: true });
  protected readonly firstRun = this.data?.firstRun === true;
  protected readonly locked = this.data?.locked === true;

  private readonly passphraseInput = viewChild<ElementRef<HTMLInputElement>>('passphraseInput');
  private readonly previewHeading = viewChild<ElementRef<HTMLElement>>('previewHeading');

  protected readonly step = signal<'choose' | 'passphrase' | 'preview'>('choose');
  protected readonly fileName = signal('');
  /** Why the file picked can't be used. */
  protected readonly refusal = signal<string | undefined>(undefined);
  protected readonly busy = signal(false);
  private encrypted?: EncryptedBackup;
  private readonly backup = signal<BackupPayload | undefined>(undefined);

  private readonly model = signal({ passphrase: '' });
  protected readonly form = form(
    this.model,
    (path) => required(path.passphrase, { message: 'Enter the backup’s passphrase' }),
    { submission: { action: () => this.open() } },
  );

  /** "Exported Oct 27, 2026": the day in the user's time zone, as Settings writes the catalog's. Then "3 lists"… */
  protected readonly exported = computed(() => {
    const backup = this.backup();
    return backup && catalogDate(backup.exportedAt);
  });
  protected readonly lines = computed(() => {
    const backup = this.backup();
    return backup ? countLines(backupCounts(backup.data)) : [];
  });

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** A file picked: read and checked, then its passphrase or what it holds. */
  protected async pick(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    // Picking the same file again still fires a change.
    input.value = '';
    if (!file) return;
    this.fileName.set(file.name);
    this.refusal.set(undefined);
    this.busy.set(true);
    try {
      this.take(await this.backups.read(file));
    } finally {
      this.busy.set(false);
    }
  }

  /** Back to choosing a file. */
  protected chooseAgain(): void {
    this.encrypted = undefined;
    this.backup.set(undefined);
    this.model.set({ passphrase: '' });
    this.refusal.set(undefined);
    this.step.set('choose');
  }

  /**
   * Replace: everything here swapped for the backup's records, after asking (nothing to ask on first run). From the
   * lock screen, everything here is deleted first, the lock with it.
   */
  protected async replace(): Promise<void> {
    const backup = this.backup();
    if (!backup) return;
    if (
      !this.firstRun &&
      !(await this.confirmer.confirm({
        title: 'Replace everything here?',
        message: this.locked
          ? 'Everything saved in this browser is deleted, the lock is turned off, and the backup’s lists, subscriptions, custom subscriptions, feature ranks, tags and settings take their place. This can’t be undone.'
          : 'Your lists, subscriptions, custom subscriptions, feature ranks, tags and settings here are swapped for the backup’s. This can’t be undone.',
        confirmText: 'Replace',
        danger: true,
      }))
    ) {
      return;
    }
    await this.run(async () => ({
      mode: 'replace',
      counts: await (this.locked
        ? this.backups.restore(backup.data)
        : this.backups.replace(backup.data)),
    }));
  }

  /** Merge: each of the backup's records that's newer than the one here, or isn't here. */
  protected async merge(): Promise<void> {
    const backup = this.backup();
    if (!backup) return;
    await this.run(async () => ({ mode: 'merge', counts: await this.backups.merge(backup.data) }));
  }

  private async open(): Promise<void> {
    if (!this.encrypted) return;
    this.busy.set(true);
    try {
      this.take(await this.backups.open(this.encrypted, this.model().passphrase));
    } finally {
      this.busy.set(false);
    }
  }

  private take(reading: BackupReading): void {
    switch (reading.kind) {
      case 'refused':
        this.refusal.set(reading.reason);
        if (this.step() === 'passphrase') this.focus(() => this.passphraseInput());
        return;
      case 'encrypted':
        this.encrypted = reading.file;
        this.step.set('passphrase');
        this.focus(() => this.passphraseInput());
        return;
      case 'backup':
        this.refusal.set(undefined);
        this.backup.set(reading.backup);
        this.step.set('preview');
        this.focus(() => this.previewHeading());
        return;
    }
  }

  private async run(importing: () => Promise<ImportBackupResult>): Promise<void> {
    this.busy.set(true);
    try {
      this.dialogRef.close(await importing());
    } finally {
      this.busy.set(false);
    }
  }

  /** Moves focus to what the new step shows first, once it's there. */
  private focus(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }
}
