import {
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form, validateTree, type FieldTree } from '@angular/forms/signals';
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
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { readScannedCode, type FormIssue, type JoinLink } from '@simply-sub/core';
import { firstValueFrom } from 'rxjs';
import { toBase64 } from '../../core/crypto/passphrase-crypto';
import { completeWord, isCodeWord, seedFromWords } from '../../core/crypto/sync-code';
import { ThemeService } from '../../core/theme/theme-service';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { focusFirstError } from '../../shared/focus-first-error';
import { issueErrors } from '../../shared/form-issues';
import { QrScanner } from '../../shared/qr-scanner/qr-scanner';
import { JoinLinks } from '../../shared/sync/join-links';
import { SyncService, type JoinPreview, type SyncOutcome } from '../../shared/sync/sync-service';
import { countLines } from './backup-text';
import { linkTexts, previewTexts, scannedTexts } from './sync-text';

const wordCount = 24;

/** How Join opens: from the first run's dialog on a new device (M10.15), or with a join link to take (M10.14). */
export interface JoinSyncData {
  firstRun?: boolean;
  link?: JoinLink;
}

/**
 * Join with a code (PROJECT-PLAN P13, M10.9): the 24 words, each completed from its first letters as the user leaves its
 * box, or all pasted at once into one, or the other device's QR code, scanned here or opened as a link (M10.14); then
 * what the synced copy holds, as Import shows a backup's, and Merge (the default) or Replace this device's data, which
 * asks first. On a new device in its first run there's nothing to merge or replace: its settings start from the copy's
 * (M10.15). Closes with the first sync's outcome.
 */
@Component({
  selector: 'ss-join-sync-dialog',
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
    MatRadioButton,
    MatRadioGroup,
    QrScanner,
  ],
  templateUrl: './join-sync-dialog.html',
  styleUrl: './join-sync-dialog.scss',
})
export class JoinSyncDialog {
  private readonly sync = inject(SyncService);
  private readonly links = inject(JoinLinks);
  private readonly theme = inject(ThemeService);
  private readonly confirm = inject(ConfirmService);
  private readonly injector = inject(Injector);
  private readonly origin = inject(DOCUMENT).location.origin;
  private readonly dialogRef = inject<MatDialogRef<JoinSyncDialog, SyncOutcome>>(MatDialogRef);
  /** Once the dialog has opened, and put focus where it starts: a link can be read sooner. */
  private readonly opened = firstValueFrom(this.dialogRef.afterOpened());
  private readonly data = inject<JoinSyncData | null>(MAT_DIALOG_DATA, { optional: true }) ?? {};
  private readonly title = viewChild<ElementRef<HTMLElement>>('copyTitle');
  private readonly scanButton = viewChild<MatButton, ElementRef<HTMLElement>>('scanButton', {
    read: ElementRef,
  });

  /** A new device in its first run: no data to merge or replace, and no settings yet. */
  protected readonly firstRun = this.data.firstRun === true;
  protected readonly indexes = Array.from({ length: wordCount }, (_, index) => index);
  /**
   * Taking a link, looking for the copy, joining it, or asking first. Back, Join and Scan then only say they're
   * disabled (disabledInteractive), and can still be clicked, so they do nothing while it's busy. Continue submits the
   * form, which Signal Forms doesn't submit again until the last submission is done.
   */
  protected readonly busy = signal(false);
  /** What's under way, for screen readers too. */
  protected readonly status = signal('');
  protected readonly error = signal('');
  /** The camera is scanning for the other device's QR code. */
  protected readonly scanning = signal(false);
  /** What the code found: shown once it's read. */
  protected readonly found = signal<Extract<JoinPreview, { kind: 'copy' }> | undefined>(undefined);
  /** Sync is on here with another copy, which joining leaves. */
  protected readonly moving = signal(false);
  protected readonly mode = signal<'merge' | 'replace'>('merge');
  private seed?: Uint8Array<ArrayBuffer>;
  private readonly model = signal({ words: Array<string>(wordCount).fill('') });
  protected readonly form = form(
    this.model,
    (path) =>
      validateTree(path, ({ value, fieldTree }) =>
        issueErrors(fieldTree, wordIssues(value().words)),
      ),
    { submission: { action: () => this.find(), onInvalid: focusFirstError } },
  );

  constructor() {
    if (this.data.link) void this.takeLink(this.data.link);
  }

  /** "3 lists, 12 subscriptions": what the copy holds. */
  protected countText(): string {
    const found = this.found();
    if (!found) return '';
    const lines = countLines(found.counts);
    return lines.length === 0 ? 'nothing yet' : lines.join(', ');
  }

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  /** Words pasted at once fill the boxes from this one on. */
  protected paste(index: number, event: ClipboardEvent): void {
    const pasted = (event.clipboardData?.getData('text') ?? '').trim().split(/\s+/);
    if (pasted.length < 2) return;
    event.preventDefault();
    this.model.update(({ words }) => ({
      words: words.map((word, at) =>
        at >= index && at - index < pasted.length ? pasted[at - index].toLowerCase() : word,
      ),
    }));
  }

  /** A word's first letters, once they tell it, complete it as the user leaves the box. */
  protected complete(index: number): void {
    const typed = this.model().words[index];
    const word = completeWord(typed);
    if (word === undefined || word === typed) return;
    this.model.update(({ words }) => ({
      words: words.map((each, at) => (at === index ? word : each)),
    }));
  }

  protected startScanning(): void {
    if (this.busy()) return;
    this.error.set('');
    this.scanning.set(true);
  }

  /** Stop scanning: focus goes back to the button that started it. */
  protected stopScanning(): void {
    this.scanning.set(false);
    afterNextRender(() => this.scanButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /** A QR code the camera read: a join link is taken, a code's words looked up; any other is said to be wrong. */
  protected scanned(text: string): void {
    if (this.busy()) return;
    const code = readScannedCode(text, this.origin);
    if (code.kind === 'link') {
      this.stopScanning();
      void this.takeLink(code.link);
    } else if (code.kind === 'words') {
      this.stopScanning();
      this.model.set({ words: code.words });
      void this.find();
    } else {
      this.error.set(scannedTexts[code.kind]);
    }
  }

  protected back(): void {
    if (this.busy()) return;
    this.found.set(undefined);
    this.error.set('');
  }

  protected async join(): Promise<void> {
    const found = this.found();
    if (!found || !this.seed || this.busy()) return;
    this.busy.set(true);
    this.dialogRef.disableClose = true;
    try {
      if (
        !this.firstRun &&
        this.mode() === 'replace' &&
        !(await this.confirm.confirm({
          title: 'Replace this device’s data?',
          message:
            'Its lists, subscriptions, custom subscriptions, feature ranks, cards and tags give way to the ' +
            'synced copy’s. This can’t be undone.',
          confirmText: 'Replace',
          danger: true,
        }))
      ) {
        return;
      }
      this.dialogRef.close(
        await this.sync.join(
          this.seed,
          found,
          this.firstRun ? 'merge' : this.mode(),
          this.theme.mode(),
        ),
      );
    } finally {
      this.busy.set(false);
      this.dialogRef.disableClose = false;
    }
  }

  /** The form's Continue: the words as a code, then what its copy holds. */
  private async find(): Promise<void> {
    const seed = seedFromWords(this.model().words);
    if (!seed) {
      this.error.set(
        'These words aren’t a sync code: one may be mistyped. Check each against the other device’s.',
      );
      return;
    }
    await this.lookUp(seed);
  }

  /** A join link's code, which taking deletes on the server, then what its copy holds. */
  private async takeLink(link: JoinLink): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.status.set('Opening the link from your other device…');
    try {
      const taken = await this.links.take(link);
      if (taken.kind === 'code') {
        await this.lookUp(taken.seed);
      } else {
        this.error.set(linkTexts[taken.kind]);
      }
    } finally {
      this.busy.set(false);
      this.status.set('');
    }
  }

  /** What the synced copy with this code holds, shown for Merge or Replace (or, in the first run, Join). */
  private async lookUp(seed: Uint8Array<ArrayBuffer>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.status.set('Looking for the synced copy…');
    try {
      const record = this.sync.record();
      if (record && !record.problem && record.seed === toBase64(seed)) {
        this.error.set('This device already syncs with this copy: there’s nothing to join.');
        return;
      }
      const found = await this.sync.preview(seed);
      if (found.kind !== 'copy') {
        this.error.set(previewTexts[found.kind]);
        return;
      }
      if (this.firstRun && !found.copy.settings) {
        this.error.set(
          'This synced copy has no settings to start from yet. Get started here, then join from Settings.',
        );
        return;
      }
      this.seed = seed;
      this.moving.set(record !== undefined && !record.problem);
      this.found.set(found);
      // After the dialog's own first focus, which a link read at once would come before.
      await this.opened;
      setTimeout(() => this.title()?.nativeElement.focus());
    } finally {
      this.busy.set(false);
      this.status.set('');
    }
  }
}

/** Each box that's empty, or holds what isn't a word of a code. */
function wordIssues(words: readonly string[]): FormIssue[] {
  return words.flatMap((word, index) =>
    word.trim() === ''
      ? [{ path: ['words', index], message: 'Type this word' }]
      : isCodeWord(word)
        ? []
        : [{ path: ['words', index], message: 'Not a word of a sync code' }],
  );
}
