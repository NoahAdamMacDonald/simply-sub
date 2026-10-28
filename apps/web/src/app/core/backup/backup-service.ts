import { Service, inject } from '@angular/core';
import {
  backupApp,
  backupAssociatedData,
  backupFileName,
  backupRefusals,
  backupSchemaVersion,
  encryptedBackup,
  maxBackupBytes,
  plainBackup,
  readBackupPayload,
  readBackupText,
  type BackupData,
  type BackupPayload,
  type BackupReading,
  type EncryptedBackup,
} from '@simply-sub/core';
import { CatalogStore } from '../catalog/catalog-store';
import { ClockService } from '../clock/clock-service';
import { WrongPassphraseError, decryptText, encryptText } from '../crypto/passphrase-crypto';
import { BackupRepository, type ImportCounts } from '../storage/backup-repository';

/** A backup ready to save: its file name and text. */
export interface BackupFile {
  name: string;
  text: string;
}

/**
 * Backups (PROJECT-PLAN P13's Your data, M6.9): Export writes every backed-up record to a file, encrypted when the
 * user gives a passphrase (BLUEPRINT §11.5); Import reads one, opens it with its passphrase, checks it whole (core's
 * readBackupText) and then replaces or merges in one transaction; Delete all data clears everything. Core has the
 * rules, the crypto module the encryption and BackupRepository the database.
 */
@Service()
export class BackupService {
  private readonly repository = inject(BackupRepository);
  private readonly catalog = inject(CatalogStore);
  private readonly clock = inject(ClockService);

  /** Export: the file of every backed-up record, encrypted with `passphrase` if there's one. None before first run. */
  async export(passphrase?: string): Promise<BackupFile | undefined> {
    const data = await this.repository.read();
    if (!data) return undefined;
    const catalogVersion = this.catalog.version();
    const payload: BackupPayload = {
      exportedAt: this.clock.now(),
      ...(catalogVersion !== undefined && { catalogVersion }),
      data,
    };
    const file =
      passphrase === undefined
        ? plainBackup(payload)
        : encryptedBackup(
            await encryptText(
              JSON.stringify(payload),
              passphrase,
              backupAssociatedData({ app: backupApp, schemaVersion: backupSchemaVersion }),
            ),
          );
    return { name: backupFileName(this.clock.today()), text: `${JSON.stringify(file, null, 2)}\n` };
  }

  /** Reads a picked file: its records, checked; that it needs its passphrase; or why it's refused. */
  async read(file: Blob): Promise<BackupReading> {
    if (file.size > maxBackupBytes) return { kind: 'refused', reason: backupRefusals.tooBig };
    return readBackupText(await file.text());
  }

  /** Opens an encrypted file with its passphrase. A wrong one, or a changed file, is refused, and nothing is used. */
  async open(file: EncryptedBackup, passphrase: string): Promise<BackupReading> {
    let text: string;
    try {
      text = await decryptText(file.encrypted, passphrase, backupAssociatedData(file));
    } catch (error) {
      if (error instanceof WrongPassphraseError) {
        return { kind: 'refused', reason: backupRefusals.wrongPassphrase };
      }
      throw error;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { kind: 'refused', reason: backupRefusals.invalid };
    }
    return readBackupPayload(payload, file.schemaVersion);
  }

  /** Replace: everything backed up swapped for the backup's records. */
  replace(data: BackupData): Promise<ImportCounts> {
    return this.repository.replace(data);
  }

  /** Import from the lock screen: everything here deleted, the lock with it, and the backup's records written. */
  restore(data: BackupData): Promise<ImportCounts> {
    return this.repository.restore(data);
  }

  /** Merge: the backup's records that are newer, or aren't here. */
  merge(data: BackupData): Promise<ImportCounts> {
    return this.repository.merge(data);
  }

  /** Delete all data: every table cleared, after which the first-run dialog shows. */
  deleteAll(): Promise<void> {
    return this.repository.deleteAll();
  }
}
