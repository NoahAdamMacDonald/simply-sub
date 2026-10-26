import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import type { ConfirmOptions } from './confirm-service';

export interface ConfirmData extends ConfirmOptions {
  /** The message's id, which the dialog's aria-describedby names. */
  messageId: string;
}

/** ConfirmService's dialog: closes with true from the confirm button, and nothing otherwise. */
@Component({
  selector: 'ss-confirm-dialog',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}
