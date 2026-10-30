import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormField, FormRoot, form, validateTree, type FieldTree } from '@angular/forms/signals';
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
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import type { FormIssue } from '@simply-sub/core';
import { completeWord, isCodeWord, seedFromWords } from '../../core/crypto/sync-code';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { focusFirstError } from '../../shared/focus-first-error';
import { issueErrors } from '../../shared/form-issues';
import { SyncService, type JoinPreview, type SyncOutcome } from '../../shared/sync/sync-service';
import { countLines } from './backup-text';
import { previewTexts } from './sync-text';

const wordCount = 24;

/**
 * Join with a code (PROJECT-PLAN P13, M10.9): the 24 words, each completed from its first letters as the user leaves its
 * box, or all pasted at once into one; then what the synced copy holds, as Import shows a backup's, and Merge (the
 * default) or Replace this device's data, which asks first. Closes with the first sync's outcome.
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
    MatInput,
    MatLabel,
    MatRadioButton,
    MatRadioGroup,
  ],
  templateUrl: './join-sync-dialog.html',
  styleUrl: './join-sync-dialog.scss',
})
export class JoinSyncDialog {
  private readonly sync = inject(SyncService);
  private readonly confirm = inject(ConfirmService);
  private readonly dialogRef = inject<MatDialogRef<JoinSyncDialog, SyncOutcome>>(MatDialogRef);
  private readonly title = viewChild<ElementRef<HTMLElement>>('copyTitle');

  protected readonly indexes = Array.from({ length: wordCount }, (_, index) => index);
  /**
   * Looking for the copy, joining it, or asking first. Back and Join then only say they're disabled (disabledInteractive),
   * and can still be clicked, so they do nothing while it's busy. Continue submits the form, which Signal Forms doesn't
   * submit again until the last submission is done.
   */
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** What the code found: shown once it's read. */
  protected readonly found = signal<Extract<JoinPreview, { kind: 'copy' }> | undefined>(undefined);
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
      this.dialogRef.close(await this.sync.join(this.seed, found, this.mode()));
    } finally {
      this.busy.set(false);
      this.dialogRef.disableClose = false;
    }
  }

  private async find(): Promise<void> {
    const seed = seedFromWords(this.model().words);
    if (!seed) {
      this.error.set(
        'These words aren’t a sync code: one may be mistyped. Check each against the other device’s.',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const found = await this.sync.preview(seed);
      if (found.kind !== 'copy') {
        this.error.set(previewTexts[found.kind]);
        return;
      }
      this.seed = seed;
      this.found.set(found);
      setTimeout(() => this.title()?.nativeElement.focus());
    } finally {
      this.busy.set(false);
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
