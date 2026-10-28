import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ListMetrics, Settings } from '@simply-sub/core';
import { ClockService } from '../../core/clock/clock-service';
import { SettingsStore } from '../../core/settings/settings-store';
import { BudgetTotals } from './budget-totals';

// This month's and this year's totals against the budgets (P2, P3, P4, M7.2).

const alberta: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-AB',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

const metrics: ListMetrics = {
  thisMonth: 100,
  thisYear: 250,
  next12: 1200,
  approx: true,
  converted: { thisMonth: false, thisYear: true, next12: true },
  notCounted: 0,
  shares: new Map(),
  rankCounts: {
    essential: 0,
    critical: 0,
    needed: 0,
    wanted: 0,
    uses: 0,
    sometimes: 0,
    unused: 0,
    unwanted: 0,
  },
  featureSummary: [],
  warnings: {},
};

describe('BudgetTotals', () => {
  let saved: ReturnType<typeof signal<Settings | undefined>>;

  beforeEach(() => {
    saved = signal<Settings | undefined>({ ...alberta, monthlyBudget: 200, annualBudget: 1000 });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SettingsStore, useValue: { saved } },
        { provide: ClockService, useValue: { today: signal('2026-10-28') } },
      ],
    });
  });

  function render(
    inputs: Partial<Record<'metrics' | 'compact' | 'prompt' | 'name', unknown>> = {},
  ) {
    const fixture = TestBed.createComponent(BudgetTotals);
    fixture.componentRef.setInput('metrics', metrics);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (element: Element | null | undefined) =>
    element?.textContent?.replace(/\s+/g, ' ').trim();
  const totals = (element: HTMLElement) =>
    Array.from(element.querySelectorAll('.total [aria-hidden]')).map((total) => text(total));

  it('shows each budget as a bar named by its heading, with the total of the budget beside it', () => {
    const element = render();
    expect(Array.from(element.querySelectorAll('h2')).map((heading) => text(heading))).toEqual([
      'Monthly budget',
      'Annual budget',
    ]);
    // ≈ only on the total with a converted amount.
    expect(totals(element)).toEqual([
      '$100.00 of $200.00 this month',
      '≈ $250.00 of $1,000.00 in 2026',
    ]);
    expect(
      Array.from(element.querySelectorAll('.total .visually-hidden')).map((total) => text(total)),
    ).toEqual(['$100.00 of $200.00 this month', 'about $250.00 of $1,000.00 in 2026']);
    const bars = element.querySelectorAll('ss-budget-bar');
    expect(bars).toHaveLength(2);
    const heading = element.querySelector('h2')?.id;
    expect(bars[0].getAttribute('aria-labelledby')).toBe(heading);
    expect(bars[0].getAttribute('aria-valuetext')).toBe('50%, $100.00 of $200.00');
    expect(bars[1].getAttribute('aria-valuenow')).toBe('25');
  });

  it('shows a total alone without its budget, with a way to set one on Home', () => {
    saved.set({ ...alberta, annualBudget: 1000 });
    const home = render({ prompt: true });
    expect(totals(home)).toEqual(['$100.00 this month', '≈ $250.00 of $1,000.00 in 2026']);
    expect(home.querySelectorAll('ss-budget-bar')).toHaveLength(1);
    const link = home.querySelector('a.prompt');
    expect([text(link), link?.getAttribute('href')]).toEqual([
      'Set a monthly budget →',
      '/settings',
    ]);

    saved.set(alberta);
    const page = render();
    expect(totals(page)).toEqual(['$100.00 this month', '≈ $250.00 in 2026']);
    expect(page.querySelector('a.prompt')).toBeNull();
    expect(page.querySelector('h2')).toBeNull();
  });

  it('shows a card’s bars with no headings, named for its list, and its totals alone', () => {
    const card = render({ compact: true, name: 'Work Related' });
    expect(card.querySelector('h2')).toBeNull();
    expect(
      Array.from(card.querySelectorAll('ss-budget-bar')).map((bar) =>
        bar.getAttribute('aria-label'),
      ),
    ).toEqual(['Work Related, monthly budget', 'Work Related, annual budget']);
    expect(totals(card)).toEqual(['$100.00 this month', '≈ $250.00 this year']);
  });

  it('shows a total over its budget as a full bar with the real percent', () => {
    const element = render({ metrics: { ...metrics, thisMonth: 224 } });
    const bar = element.querySelector('ss-budget-bar');
    expect(bar?.getAttribute('data-level')).toBe('over');
    expect(text(bar?.querySelector('.label'))).toBe('112%');
  });

  it('says how many subscriptions it couldn’t count', () => {
    expect(render().querySelector('.not-counted')).toBeNull();
    expect(
      text(render({ metrics: { ...metrics, notCounted: 2 } }).querySelector('.not-counted')),
    ).toBe('2 subscriptions not counted');
  });
});
