import { DOCUMENT, DestroyRef, Service, inject, signal } from '@angular/core';
import { IsoDate, Timestamp, toIsoDate } from '@simply-sub/core';

/**
 * The only place the app reads the device clock (CLAUDE.md). Code that needs the date gets
 * `today` here and passes it to packages/core, so a test can fix the date by providing its own.
 */
@Service()
export class ClockService {
  private readonly document = inject(DOCUMENT);
  private readonly date = signal<IsoDate>(toIsoDate(new Date()));
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * The local date. It moves on at midnight, so a page left open overnight (the Calendar, M7.4) shows the new day, and
   * when a hidden tab is shown again: timers in a hidden tab run late.
   */
  readonly today = this.date.asReadonly();

  constructor() {
    const check = () => this.date.set(toIsoDate(new Date()));
    const atMidnight = () => {
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      // A second past midnight, so the clock has surely turned.
      this.timer = setTimeout(
        () => {
          check();
          atMidnight();
        },
        tomorrow.getTime() - now.getTime() + 1000,
      );
    };
    atMidnight();
    const shown = () => {
      if (this.document.visibilityState === 'visible') check();
    };
    this.document.addEventListener('visibilitychange', shown);
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.document.removeEventListener('visibilitychange', shown);
    });
  }

  /** This moment, as stored records' timestamps write it (`2026-10-22T18:30:00.000Z`). */
  now(): Timestamp {
    return new Date().toISOString();
  }
}
