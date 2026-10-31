import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Charge, ItemResolution } from '@simply-sub/core';
import { MetricsService } from '../../core/metrics/metrics-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { alberta } from '../sub-card/search.testing';
import { CostBreakdown } from './cost-breakdown';

// A bar's cost breakdown (M10.30): what it adds up, on hover, a click or tap, and its button.

@Component({
  imports: [CostBreakdown],
  template: `<ss-cost-breakdown [range]="range" period="this month"
    ><div class="bar">bar</div></ss-cost-breakdown
  >`,
})
class Host {
  readonly range = { from: '2026-10-01', to: '2026-11-01' };
}

const charge = (itemId: string, extra: Partial<Charge>): Charge => ({
  date: '2026-10-12',
  amount: 0,
  tax: 0,
  currency: 'CAD',
  itemId,
  listId: 'list',
  converted: false,
  manual: false,
  charged: { amount: 0, currency: 'CAD' },
  ...extra,
});

const charges: Charge[] = [
  charge('netflix', { amount: 19.94, tax: 0.95, charged: { amount: 19.94, currency: 'CAD' } }),
  charge('mullvad', {
    amount: 8.04,
    fxFee: 0.2,
    converted: true,
    charged: { amount: 5, currency: 'EUR' },
  }),
];

const resolutions = new Map<string, ItemResolution>(
  [
    ['netflix', 'Netflix', 'Standard'],
    ['mullvad', 'Mullvad VPN', 'Mullvad VPN'],
  ].map(([id, name, planName]) => [
    id,
    {
      ok: true,
      resolved: { item: { id, source: { kind: 'catalog' } }, name, planName },
    } as unknown as ItemResolution,
  ]),
);

describe('CostBreakdown', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsStore, useValue: { saved: signal(alberta) } },
        {
          provide: MetricsService,
          useValue: { charges: () => charges, resolutions: signal(resolutions) },
        },
      ],
    });
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  const panel = () => document.querySelector<HTMLElement>('.cdk-overlay-container .panel');
  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const button = () =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button');

  it('shows each subscription with its price, tax, FX fee and rate, and the sums, on hover', async () => {
    (fixture.nativeElement as HTMLElement)
      .querySelector('.trigger')
      ?.dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    expect(text(panel()?.querySelector('h3'))).toBe('This month: ≈ $27.98');
    expect(Array.from(panel()?.querySelectorAll('li') ?? []).map(text)).toEqual([
      'Netflix Standard $19.94 $18.99 + $0.95 tax',
      'Mullvad VPN ≈ $8.04 ≈ $7.84 + ≈ $0.20 FX fee · €5.00 at 1.5680',
    ]);
    expect(text(panel()?.querySelector('.sums'))).toBe(
      'Prices ≈ $26.83 · Tax $0.95 · FX fees ≈ $0.20',
    );
  });

  it('opens from its button with focus in it, and Escape closes it with focus back', async () => {
    expect(button()?.getAttribute('aria-label')).toBe('Breakdown of this month');
    button()?.click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    expect(button()?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(panel());
    panel()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('stays open after a click or tap on the bar, and a second one closes it', async () => {
    const bar = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.trigger');
    bar?.dispatchEvent(new Event('pointerup'));
    await fixture.whenStable();
    bar?.dispatchEvent(new Event('pointerleave'));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await fixture.whenStable();
    expect(panel()).not.toBeNull();
    bar?.dispatchEvent(new Event('pointerup'));
    await fixture.whenStable();
    expect(panel()).toBeNull();
  });
});
