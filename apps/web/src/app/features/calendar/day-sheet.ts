import { Component, inject, type Signal } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import type { CalendarDay } from './calendar-entries';
import { DayPanel } from './day-panel';

/** What the bottom sheet shows: the day, as the page has it now, and the charge it was opened on. */
export interface DaySheetData {
  day: Signal<CalendarDay>;
  focusKey?: string;
}

/** A Calendar day's panel as a bottom sheet, on a phone's agenda (P10). */
@Component({
  selector: 'ss-day-sheet',
  imports: [DayPanel],
  templateUrl: './day-sheet.html',
})
export class DaySheet {
  private readonly ref = inject(MatBottomSheetRef);
  protected readonly data = inject<DaySheetData>(MAT_BOTTOM_SHEET_DATA);

  protected close(): void {
    this.ref.dismiss();
  }
}
