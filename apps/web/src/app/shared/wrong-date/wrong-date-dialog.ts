import { Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, validate, type FieldTree } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import {
  MatDatepicker,
  MatDatepickerInput,
  MatDatepickerToggle,
} from '@angular/material/datepicker';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatError, MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { reanchorIssue, type Billing, type IsoDate } from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { CalendarHeader } from '../calendar-header';
import { focusFirstError } from '../focus-first-error';
import { isoDateProviders } from '../iso-date-adapter';

/** What "Wrong date?" changes: an Ongoing item's billing, its name, and the date its next charge is on now. */
export interface WrongDateData {
  title: string;
  billing: Extract<Billing, { mode: 'recurring' }>;
  next: IsoDate;
}

/**
 * "Wrong date?" (P4, P10): the item's next charge on the right date, which becomes its anchor, so every later charge
 * follows it (core's reanchorIssue says what's wrong with a date). It closes with the date, or nothing on Cancel.
 */
@Component({
  selector: 'ss-wrong-date-dialog',
  imports: [
    FormField,
    FormRoot,
    MatButton,
    MatDatepicker,
    MatDatepickerInput,
    MatDatepickerToggle,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    MatSuffix,
  ],
  templateUrl: './wrong-date-dialog.html',
  styleUrl: './wrong-date-dialog.scss',
  providers: isoDateProviders,
})
export class WrongDateDialog {
  private readonly dialogRef = inject<MatDialogRef<WrongDateDialog, IsoDate>>(MatDialogRef);
  private readonly today = inject(ClockService).today;
  protected readonly data = inject<WrongDateData>(MAT_DIALOG_DATA);
  // No [min] on the field: the datepicker's own check would add an error with no message ahead of core's.
  protected readonly calendarHeader = CalendarHeader;

  private readonly model = signal<{ date: string | null }>({ date: this.data.next });
  protected readonly form = form(
    this.model,
    (path) =>
      validate(path.date, ({ value }) => {
        const message = reanchorIssue(this.data.billing, value(), this.today());
        return message === undefined ? undefined : { kind: 'reanchor', message };
      }),
    { submission: { action: async () => this.save(), onInvalid: focusFirstError } },
  );

  protected firstError(field: FieldTree<unknown>): string | undefined {
    return field().errors()[0]?.message;
  }

  private save(): void {
    const { date } = this.model();
    if (date !== null) this.dialogRef.close(date);
  }
}
