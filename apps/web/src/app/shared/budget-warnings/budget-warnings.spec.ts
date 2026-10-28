import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { BudgetWarnings as Warnings, Settings } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { testStorage } from '../../core/storage/storage.testing';
import { alberta } from '../sub-card/search.testing';
import { BudgetWarnings } from './budget-warnings';

// The budget warning banners (M7.6), for an Albertan with a $200 monthly and $1,000 annual budget, on Oct 25, 2026.

@Component({
  imports: [BudgetWarnings],
  template: '<ss-budget-warnings [warnings]="warnings()" [listId]="listId()" />',
})
class Host {
  readonly warnings = signal<Warnings | undefined>(undefined);
  readonly listId = signal<string | undefined>(undefined);
}

describe('BudgetWarnings', () => {
  let fixture: ComponentFixture<Host>;
  let saved: ReturnType<typeof signal<Settings | undefined>>;

  beforeEach(() => {
    saved = signal<Settings | undefined>({ ...alberta, monthlyBudget: 200, annualBudget: 1000 });
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: SettingsStore, useValue: { saved } },
        provideRouter([]),
      ],
    });
    fixture = TestBed.createComponent(Host);
  });

  async function show(warnings: Warnings, listId?: string): Promise<void> {
    fixture.componentInstance.warnings.set(warnings);
    fixture.componentInstance.listId.set(listId);
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();
  const warnings = () =>
    Array.from(element().querySelectorAll('.warning')).map((warning) => ({
      shown: text(warning.querySelector('.text [aria-hidden="true"]')),
      spoken: text(warning.querySelector('.text .visually-hidden')),
      link: warning.querySelector('a')
        ? [text(warning.querySelector('a')), warning.querySelector('a')?.getAttribute('href')]
        : undefined,
    }));

  it('names the first month over the monthly budget, with a link to it in the Calendar', async () => {
    await show({ month: { month: '2026-11', amount: 212.4, approx: false } });
    expect(warnings()).toEqual([
      {
        shown:
          'Your payments in November 2026 add up to $212.40, over your $200.00 monthly budget.',
        spoken:
          'Warning: Your payments in November 2026 add up to $212.40, over your $200.00 monthly budget.',
        link: ['See November 2026 in the Calendar', '/calendar?month=2026-11'],
      },
    ]);
    // A status region, there before any warning, so one that appears is read out.
    expect(element().querySelector('[role="status"] .warning')).not.toBeNull();
  });

  it('says this month, and "about" a total with a converted amount', async () => {
    await show({ month: { month: '2026-10', amount: 212.4, approx: true } });
    const [warning] = warnings();
    expect(warning.shown).toBe(
      'Your payments this month add up to ≈ $212.40, over your $200.00 monthly budget.',
    );
    expect(warning.spoken).toBe(
      'Warning: Your payments this month add up to about $212.40, over your $200.00 monthly budget.',
    );
    expect(warning.link).toEqual(['See this month in the Calendar', '/calendar?month=2026-10']);
  });

  it('warns when this year’s payments, past and to come, go over the annual budget', async () => {
    await show({
      month: { month: '2026-11', amount: 212.4, approx: false },
      year: { year: 2026, amount: 1212.4, approx: false },
    });
    expect(warnings().map((warning) => warning.shown)).toEqual([
      'Your payments in November 2026 add up to $212.40, over your $200.00 monthly budget.',
      'Your payments this year, past and to come, add up to $1,212.40, over your $1,000.00 annual budget.',
    ]);
    expect(warnings()[1].link).toBeUndefined();
  });

  it('speaks of List view’s list alone, and opens the Calendar showing it', async () => {
    const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
    await show({ month: { month: '2027-01', amount: 137.2, approx: true } }, listId);
    const [warning] = warnings();
    expect(warning.shown).toBe(
      'This list’s payments in January 2027 add up to ≈ $137.20, over your $200.00 monthly budget.',
    );
    expect(warning.link).toEqual([
      'See January 2027 in the Calendar',
      `/calendar?month=2027-01&lists=${listId}`,
    ]);
  });

  it('shows nothing with nothing over budget, or no budget to be over', async () => {
    await show({});
    expect(warnings()).toEqual([]);
    expect(element().querySelector('[role="status"]')).not.toBeNull();
    saved.set(alberta);
    await show({ month: { month: '2026-11', amount: 212.4, approx: false } });
    expect(warnings()).toEqual([]);
  });
});
