import { TestBed } from '@angular/core/testing';
import { ClockService } from './clock-service';

describe('ClockService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives the date on the device clock as an ISO date', () => {
    // Late evening, local time. The time-zone cases are tested in packages/core.
    vi.setSystemTime(new Date(2026, 9, 23, 23, 30));

    expect(TestBed.inject(ClockService).today()).toBe('2026-10-23');
  });

  it('moves on at midnight, for a page left open overnight (M7.4)', () => {
    // Mid-month, where no time zone changes its clocks: the specs run in the machine's own.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 14, 23, 59, 30));
    const clock = TestBed.inject(ClockService);
    expect(clock.today()).toBe('2026-10-14');

    vi.advanceTimersByTime(29_000);
    expect(clock.today()).toBe('2026-10-14');
    // A second past midnight.
    vi.advanceTimersByTime(2_000);
    expect(clock.today()).toBe('2026-10-15');
    // And the next night.
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(clock.today()).toBe('2026-10-16');
  });

  it('checks again when a hidden tab is shown, as timers there run late', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 22, 0));
    const clock = TestBed.inject(ClockService);
    // The tab sleeps through midnight with its timer held back.
    vi.setSystemTime(new Date(2026, 9, 24, 8, 0));
    expect(clock.today()).toBe('2026-10-23');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(clock.today()).toBe('2026-10-24');
  });
});
