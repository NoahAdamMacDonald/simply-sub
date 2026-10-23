import { Service, signal } from '@angular/core';
import { IsoDate, toIsoDate } from '@simply-sub/core';

/**
 * The only place the app reads the device clock (CLAUDE.md). Code that needs the date gets
 * `today` here and passes it to packages/core, so a test can fix the date by providing its own.
 */
@Service()
export class ClockService {
  /**
   * The local date when the app started. It doesn't move on at midnight yet; that comes with the
   * first page that stays open across days (Calendar, M7.4).
   */
  readonly today = signal<IsoDate>(toIsoDate(new Date())).asReadonly();
}
