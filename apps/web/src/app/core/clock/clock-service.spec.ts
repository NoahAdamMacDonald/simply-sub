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
});
