import { Component, inject } from '@angular/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import type { ShownAndSpoken } from '../../shared/charge-text';

/** What Assign best cards would do (P11), as the dialog shows it. */
export interface AssignPreview {
  /** The lists with changes, in the order they were made. */
  lists: {
    listId: string;
    name: string;
    changes: {
      itemId: string;
      title: string;
      /** The card it's paid with now ("No card"), and the one it moves to, by name. */
      from: string;
      to: string;
      /** Over the next 12 months. */
      savings: ShownAndSpoken;
    }[];
  }[];
  /** The lists with unsaved edits, which keep their cards. Two lists can have one name. */
  skipped: { listId: string; name: string }[];
  /** What the changes save together over the next 12 months; none without changes. */
  total?: ShownAndSpoken;
}

/**
 * Assign best cards' preview (PROJECT-PLAN P11, M9.4): each list's subscriptions that move to a better card, from which
 * card to which and what each saves over the next 12 months, the lists skipped for their unsaved edits, and Apply,
 * which closes it with true.
 */
@Component({
  selector: 'ss-assign-cards-dialog',
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    MatIconButton,
  ],
  templateUrl: './assign-cards-dialog.html',
  styleUrl: './assign-cards-dialog.scss',
})
export class AssignCardsDialog {
  protected readonly preview = inject<AssignPreview>(MAT_DIALOG_DATA);
}
