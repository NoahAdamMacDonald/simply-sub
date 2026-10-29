import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { calendarApps, type CalendarApp } from './calendar-apps';

/** What Sync calendar downloaded, and for which app. */
export interface SyncDialogData {
  app: CalendarApp;
  fileName: string;
  /** Downloads the file again, for a download the browser blocked or that went astray. */
  download: () => unknown;
}

/**
 * Sync calendar's steps (P10, Phase 3; BLUEPRINT §11.3): the .ics that downloaded, and how the app chosen imports it
 * into a calendar of its own, made first (M7.9), so the payments stay apart and take the colour chosen for it: these
 * apps colour a whole calendar, and Apple's drops an imported event's own colour. Each payment lists its tags. It's a
 * copy, so it says to export again after a change. Phase 5's live link replaces it.
 */
@Component({
  selector: 'ss-sync-dialog',
  imports: [MatButton, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle, MatIcon],
  templateUrl: './sync-dialog.html',
  styleUrl: './sync-dialog.scss',
})
export class SyncDialog {
  protected readonly data = inject<SyncDialogData>(MAT_DIALOG_DATA);
  protected readonly name = calendarApps.find((app) => app.id === this.data.app)?.name ?? '';
}
