import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Settings } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { BudgetBar } from './budget-bar';

const ontario: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

describe('BudgetBar', () => {
  let fixture: ComponentFixture<BudgetBar>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: SettingsStore, useValue: { saved: signal(ontario) } }],
    });
    fixture = TestBed.createComponent(BudgetBar);
  });

  async function show(inputs: Record<string, unknown>): Promise<HTMLElement> {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const label = (bar: HTMLElement) => bar.querySelector('.label')?.textContent?.trim();

  it('is a progressbar with the percent inside the fill', async () => {
    const bar = await show({ value: 100, max: 200 });
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(label(bar)).toBe('50%');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.getAttribute('aria-valuetext')).toBe('50%, $100.00 of $200.00');
    expect(bar.dataset['level']).toBe('ok');
    expect(bar.style.getPropertyValue('--fill')).toBe('0.5');
  });

  it('turns amber from 75%', async () => {
    expect((await show({ value: 150, max: 200 })).dataset['level']).toBe('warn');
  });

  it('is full and red over the budget, with the real percent', async () => {
    const bar = await show({ value: 224, max: 200 });
    expect(bar.dataset['level']).toBe('over');
    expect(label(bar)).toBe('112%');
    expect(bar.style.getPropertyValue('--fill')).toBe('1');
    // aria-valuenow stays within 0–100; the text says how far over.
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('112%, $224.00 of $200.00');
  });

  it("shows the amount paid, a tick at the budget, and the month's total against it (Calendar)", async () => {
    const bar = await show({ value: 44.45, max: 66.45, marker: 60, labelMode: 'amount' });
    expect(label(bar)).toBe('$44.45');
    expect(bar.dataset['level']).toBe('over');
    expect(bar.querySelector('.marker')).not.toBeNull();
    expect(Number(bar.style.getPropertyValue('--marker'))).toBeCloseTo(60 / 66.45);
    expect(bar.getAttribute('aria-valuetext')).toBe('$44.45 of $66.45, budget $60.00');
  });

  it('draws no tick when the budget is past the end of the bar', async () => {
    const bar = await show({ value: 10, max: 50, marker: 60, labelMode: 'amount' });
    expect(bar.querySelector('.marker')).toBeNull();
    expect(bar.style.getPropertyValue('--marker')).toBe('');
  });

  it('takes a currency of its own', async () => {
    const bar = await show({ value: 5, max: 10, labelMode: 'amount', currency: 'EUR' });
    expect(label(bar)).toBe('€5.00');
  });
});
