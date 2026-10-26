import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { IsoMonth, Settings } from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { MiniCalendar, type CalendarCharge } from './mini-calendar';

const ontario: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

@Component({
  imports: [MiniCalendar],
  template: `
    <ss-mini-calendar
      [(month)]="month"
      [charges]="charges"
      (dayClick)="clicked.push('day ' + $event)"
      (monthClick)="clicked.push('month ' + $event)"
    />
  `,
})
class Host {
  readonly month = signal<IsoMonth>('2026-10');
  readonly clicked: string[] = [];
  readonly charges: CalendarCharge[] = [
    {
      date: '2026-10-03',
      name: 'Mullvad VPN',
      amount: 7.53,
      currency: 'CAD',
      converted: true,
      manual: true,
    },
    { date: '2026-10-12', name: 'Netflix', amount: 18.99, currency: 'CAD' },
    { date: '2026-10-12', name: 'Crave', amount: 22, currency: 'CAD' },
  ];
}

describe('MiniCalendar', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsStore, useValue: { saved: signal(ontario) } },
        { provide: ClockService, useValue: { today: signal('2026-10-26') } },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const day = (date: string) => element().querySelector<HTMLButtonElement>(`[data-date="${date}"]`);
  const tabStops = () =>
    Array.from(element().querySelectorAll<HTMLButtonElement>('.day[tabindex="0"]')).map(
      (button) => button.dataset['date'],
    );

  async function press(key: string): Promise<void> {
    const target = document.activeElement as HTMLElement;
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await fixture.whenStable();
  }

  it("shows the month from Sunday, with today marked and named by the grid's title", () => {
    expect(element().querySelector('.title')?.textContent?.trim()).toBe('October 2026');
    expect(element().querySelectorAll('.day')).toHaveLength(31);
    // Oct 1, 2026 is a Thursday: the first week has four blank days.
    const firstWeek = element().querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect(Array.from(firstWeek).map((cell) => cell.textContent?.trim())).toEqual([
      '',
      '',
      '',
      '',
      '1',
      '2',
      '3',
    ]);
    expect(day('2026-10-26')?.getAttribute('aria-current')).toBe('date');
    const grid = element().querySelector('table');
    expect(grid?.getAttribute('role')).toBe('grid');
    expect(
      document.getElementById(grid?.getAttribute('aria-labelledby') ?? '')?.textContent?.trim(),
    ).toBe('October 2026');
  });

  it('marks payment days, and names them with their count', () => {
    expect(day('2026-10-12')?.querySelector('.dot')).not.toBeNull();
    expect(day('2026-10-13')?.querySelector('.dot')).toBeNull();
    expect(day('2026-10-12')?.getAttribute('aria-label')).toBe('Monday, October 12, 2 payments');
    expect(day('2026-10-03')?.getAttribute('aria-label')).toBe('Saturday, October 3, 1 payment');
    expect(day('2026-10-13')?.getAttribute('aria-label')).toBe('Tuesday, October 13');
  });

  it('is one tab stop, on today', () => {
    expect(tabStops()).toEqual(['2026-10-26']);
  });

  it('moves by day and week with the arrow keys, and to the week ends with Home and End', async () => {
    day('2026-10-26')?.focus();
    await press('ArrowRight');
    expect(document.activeElement).toBe(day('2026-10-27'));
    await press('ArrowUp');
    expect(document.activeElement).toBe(day('2026-10-20'));
    await press('Home');
    expect(document.activeElement).toBe(day('2026-10-18'));
    await press('End');
    expect(document.activeElement).toBe(day('2026-10-24'));
    expect(tabStops()).toEqual(['2026-10-24']);
  });

  it('turns the month when focus moves past its end', async () => {
    day('2026-10-26')?.focus();
    await press('ArrowDown');
    expect(fixture.componentInstance.month()).toBe('2026-11');
    expect(document.activeElement).toBe(day('2026-11-02'));
  });

  it("moves a month with Page Up and Page Down, to the month's last day when it's shorter", async () => {
    fixture.componentInstance.month.set('2027-01');
    await fixture.whenStable();
    day('2027-01-31')?.focus();
    await press('PageDown');
    expect(fixture.componentInstance.month()).toBe('2027-02');
    expect(document.activeElement).toBe(day('2027-02-28'));
  });

  it('keeps up with keys pressed before the grid shows the new month', async () => {
    day('2026-10-26')?.focus();
    const button = document.activeElement as HTMLElement;
    // Oct 26 → Nov 2 → Dec 2 → Nov 2 → Nov 1, all on the October button.
    for (const key of ['ArrowDown', 'PageDown', 'PageUp', 'ArrowLeft']) {
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    await fixture.whenStable();
    expect(fixture.componentInstance.month()).toBe('2026-11');
    expect(document.activeElement).toBe(day('2026-11-01'));
    expect(tabStops()).toEqual(['2026-11-01']);
  });

  it('changes the month with ‹ and ›, keeping the tab stop on a day of it', async () => {
    (element().querySelector('[aria-label="Next month"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.month()).toBe('2026-11');
    expect(tabStops()).toEqual(['2026-11-01']);
    (element().querySelector('[aria-label="Previous month"]') as HTMLButtonElement).click();
    (element().querySelector('[aria-label="Previous month"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(fixture.componentInstance.month()).toBe('2026-09');
  });

  it('emits the day and the month clicked', async () => {
    day('2026-10-12')?.click();
    (element().querySelector('.title') as HTMLButtonElement).click();
    expect(fixture.componentInstance.clicked).toEqual(['day 2026-10-12', 'month 2026-10']);
  });

  it("describes a payment day's payments in its tooltip", () => {
    const describedBy = day('2026-10-03')?.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(
      'Mullvad VPN ≈ $7.53 (renew manually)',
    );
    const twoPayments = day('2026-10-12')?.getAttribute('aria-describedby');
    expect(document.getElementById(twoPayments ?? '')?.textContent).toBe(
      'Netflix $18.99 · Crave $22.00',
    );
    expect(day('2026-10-13')?.getAttribute('aria-describedby')).toBeNull();
  });
});
