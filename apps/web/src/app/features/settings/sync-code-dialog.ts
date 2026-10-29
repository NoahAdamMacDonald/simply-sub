import { Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { syncWords } from '../../core/crypto/sync-code';
import { QrCode } from '../../shared/qr-code/qr-code';

/** Why the code shows: a new one to keep, for Turn on or Start over, or the one in use, to add a device. */
export interface SyncCodeData {
  mode: 'turn-on' | 'start-over' | 'show';
  seed: Uint8Array<ArrayBuffer>;
}

/**
 * The sync code (PROJECT-PLAN P13, M10.9): its 24 words, numbered, with Copy, and a QR code of them, which a phone's
 * camera reads. A new code asks the user to keep it first and closes with true on "I've saved it"; the one in use just
 * shows.
 */
@Component({
  selector: 'ss-sync-code-dialog',
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    QrCode,
  ],
  templateUrl: './sync-code-dialog.html',
  styleUrl: './sync-code-dialog.scss',
})
export class SyncCodeDialog {
  protected readonly data = inject<SyncCodeData>(MAT_DIALOG_DATA);
  protected readonly words = syncWords(this.data.seed);
  protected readonly copied = signal('');

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.words.join(' '));
      this.copied.set('Copied the 24 words.');
    } catch {
      this.copied.set('The words couldn’t be copied: select them instead.');
    }
  }
}
