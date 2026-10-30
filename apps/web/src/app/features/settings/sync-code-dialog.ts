import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { joinLinkMinutes } from '@simply-sub/core';
import { syncWords } from '../../core/crypto/sync-code';
import { QrCode } from '../../shared/qr-code/qr-code';
import { JoinCallError } from '../../shared/sync/join-client';
import { JoinLinks, type MadeLink } from '../../shared/sync/join-links';

/** Why the code shows: a new one to keep, for Turn on or Start over, or the one in use, to add a device. */
export interface SyncCodeData {
  mode: 'turn-on' | 'start-over' | 'show';
  seed: Uint8Array<ArrayBuffer>;
}

/** Show the code's QR code: its link, being made, or why there's none. */
type QrState =
  { kind: 'making' } | { kind: 'made'; url: string } | { kind: 'expired' | 'offline' | 'failed' };

/** What the QR code's state says, in words. */
const qrTexts: Record<QrState['kind'], string> = {
  making: 'Making a QR code…',
  made: `It works once, for ${joinLinkMinutes} minutes.`,
  expired: 'This QR code has expired: make a new one.',
  offline: 'You’re offline, so there’s no QR code: type the words on the other device instead.',
  failed: 'The QR code couldn’t be made just now: make a new one, or type the words.',
};

/**
 * The sync code (PROJECT-PLAN P13, M10.9): its 24 words, numbered, with Copy. A new code asks the user to keep it first
 * and closes with true on "I've saved it". Show the code, to add a device, adds a QR code of a join link (M10.14): the
 * code sealed for 10 minutes, which one device can take, once, scanned with its camera or in Join. The link is
 * withdrawn when the dialog closes, and Make a new QR code replaces it.
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
  private readonly links = inject(JoinLinks);
  protected readonly data = inject<SyncCodeData>(MAT_DIALOG_DATA);
  protected readonly words = syncWords(this.data.seed);
  protected readonly copied = signal('');
  protected readonly qr = signal<QrState>({ kind: 'making' });
  protected readonly qrText = computed(() => qrTexts[this.qr().kind]);
  /** The link the QR code shows, until it's withdrawn or expires. */
  private made?: MadeLink;
  private expiry?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor() {
    if (this.data.mode === 'show') void this.makeLink();
    inject(DestroyRef).onDestroy(() => {
      this.closed = true;
      this.withdraw();
    });
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.words.join(' '));
      this.copied.set('Copied the 24 words.');
    } catch {
      this.copied.set('The words couldn’t be copied: select them instead.');
    }
  }

  /** A new link for the QR code, in place of the one shown. */
  protected async makeLink(): Promise<void> {
    // Its button shows only once the last one is made.
    this.withdraw();
    this.qr.set({ kind: 'making' });
    try {
      const made = await this.links.make(this.data.seed);
      if (this.closed) {
        void this.links.withdraw(made.id);
        return;
      }
      this.made = made;
      this.qr.set({ kind: 'made', url: made.url });
      this.expiry = setTimeout(() => {
        this.made = undefined;
        this.qr.set({ kind: 'expired' });
      }, joinLinkMinutes * 60_000);
    } catch (error) {
      this.qr.set({
        kind: error instanceof JoinCallError && error.problem === 'offline' ? 'offline' : 'failed',
      });
    }
  }

  /** Withdraws the link shown, if no device has taken it. */
  private withdraw(): void {
    clearTimeout(this.expiry);
    if (this.made) void this.links.withdraw(this.made.id);
    this.made = undefined;
  }
}
