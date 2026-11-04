import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { FinanceItem, FinanceSuggestion, PickedPrice } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { alberta } from '../../shared/sub-card/search.testing';
import { FinanceSuggestions } from './finance-suggestions';

// Optimizations' finance cards (M11.13): each kind's words, warnings marked, and every one information only.

const item = (title: string, balance: number, rate: number): FinanceItem => ({
  itemId: `0192f1c4-7b2e-7c3a-9d41-${String(balance).padStart(12, '0')}`,
  title,
  balance,
  rate,
});
const price = (amount: number): PickedPrice => ({
  interval: 'month',
  intervalCount: 1,
  amount,
  currency: 'CAD',
  monthlyEquivalent: amount,
  autoRenew: true,
  native: true,
  taxIncluded: true,
  taxFree: true,
  source: { region: 'CA', amount, currency: 'CAD' },
});
const basic = item('Example Savings Basic', 9000, 2);
const plus = {
  providerId: 'example-savings',
  planId: 'example-savings.plus',
  name: 'Example Savings',
  planName: 'Plus',
  price: price(10),
  rate: 3.5,
};

function render(suggestions: FinanceSuggestion[]) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: SettingsStore, useValue: { saved: signal(alberta) } },
    ],
  });
  const fixture = TestBed.createComponent(FinanceSuggestions);
  fixture.componentRef.setInput('suggestions', suggestions);
  fixture.componentRef.setInput('currency', 'CAD');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const cards = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('li.card')).map((card) =>
    Array.from(card.querySelectorAll('p')).map((line) => line.textContent?.trim()),
  );

describe('FinanceSuggestions', () => {
  it('says a paid rate pays for itself above its break-even, and the cheaper plan earns more below it', () => {
    const element = render([
      { kind: 'paid-rate', item: basic, to: plus, fee: 0, toFee: 10, breakEven: 8000, gain: 15 },
      {
        kind: 'paid-rate',
        item: item('Example Savings Plus', 7000, 3.5),
        to: {
          ...plus,
          planId: 'example-savings.basic',
          planName: 'Basic',
          price: price(0),
          rate: 2,
        },
        fee: 10,
        toFee: 0,
        breakEven: 8000,
        gain: 15,
      },
    ]);
    expect(cards(element)).toEqual([
      [
        'Example Savings Plus would earn $15.00 more a year than Example Savings Basic',
        'At 3.50% instead of 2.00%, its $10.00 more a month pays for itself above $8,000, and Example Savings Basic has $9,000.',
        'Information, not financial advice.',
      ],
      [
        'Example Savings Basic would earn $15.00 more a year than Example Savings Plus',
        "Example Savings Plus's 3.50% pays for its $10.00 more a month only above $8,000, and it has $7,000.",
        'Information, not financial advice.',
      ],
    ]);
  });

  it('weighs a waiver’s minimum against its fee, both ways', () => {
    const chequing = item('Example Bank Unlimited Chequing', 12_000, 0);
    const savings = item('Example Fintech Everything', 20_000, 3.5);
    const element = render([
      {
        kind: 'pay-fee',
        item: chequing,
        better: savings,
        minimum: 10_000,
        amount: 10_000,
        fee: 120,
        givenUp: 350,
        gain: 230,
      },
      {
        kind: 'top-up',
        item: { ...chequing, balance: 1000 },
        better: { ...savings, rate: 2 },
        minimum: 4000,
        amount: 3000,
        fee: 215.4,
        givenUp: 60,
        gain: 155.4,
      },
    ]);
    expect(cards(element).map((card) => card.slice(0, 2))).toEqual([
      [
        "Paying Example Bank Unlimited Chequing's fee would earn $230.00 more a year",
        "Keeping its $10,000 minimum there gives up $350.00 a year that Example Fintech Everything would pay at 3.50%, more than its fee's $120.00 a year.",
      ],
      [
        'Moving $3,000 to Example Bank Unlimited Chequing would save $155.40 a year',
        'With $4,000 in it, its fee of $215.40 a year is waived, and that $3,000 earns $60.00 a year in Example Fintech Everything.',
      ],
    ]);
  });

  it('names a better savings account, linking one sold elsewhere to Search', () => {
    const element = render([
      {
        kind: 'move-savings',
        item: basic,
        to: { item: item('Example Fintech Everything', 10_000, 3.5) },
        gain: 75,
      },
      {
        kind: 'move-savings',
        item: { ...basic, itemId: 'other' },
        to: { plan: { ...plus, price: price(0), rate: 4 } },
        gain: 180,
      },
    ]);
    expect(cards(element).map((card) => card.slice(0, 2))).toEqual([
      [
        'Moving $9,000 to Example Fintech Everything would earn $75.00 more a year',
        'It pays 3.50%, and Example Savings Basic 2.00%.',
      ],
      [
        'Example Savings Plus would earn $180.00 more a year than Example Savings Basic',
        'On your $9,000, it pays 4.00% with no monthly fee, against 2.00%. Opening an account elsewhere takes time: check its terms first.',
      ],
    ]);
    const links = element.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(
      '/search?q=Example%20Savings&plan=example-savings.plus',
    );
  });

  it('marks a balance over its insurer’s limit, or with none, as a warning', () => {
    const element = render([
      {
        kind: 'over-limit',
        items: [
          item('Example Fintech Essential', 60_000, 2),
          item('Example Fintech Everything', 50_000, 3.5),
        ],
        providerName: 'Example Fintech',
        insurer: 'cdic',
        currency: 'CAD',
        held: 110_000,
        limit: 100_000,
      },
      { kind: 'uninsured', item: basic, providerName: 'Example Savings', currency: 'CAD' },
    ]);
    expect(cards(element).map((card) => card.slice(0, 2))).toEqual([
      [
        "$110,000 at Example Fintech is over CDIC's $100,000 limit",
        "CDIC covers up to $100,000 of these deposits at one institution, so $10,000 isn't covered (Example Fintech Essential, Example Fintech Everything).",
      ],
      [
        '$9,000 in Example Savings Basic has no deposit insurance',
        "Example Savings's own page says no insurer covers it.",
      ],
    ]);
    expect(element.querySelectorAll('li.card.warning')).toHaveLength(2);
    expect(
      Array.from(element.querySelectorAll('mat-icon')).map((icon) => icon.textContent),
    ).toEqual(['gpp_maybe', 'gpp_maybe']);
  });
});
