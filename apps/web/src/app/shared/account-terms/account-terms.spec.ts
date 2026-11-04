import { TestBed } from '@angular/core/testing';
import type { Account } from '@simply-sub/core';
import { AccountTerms } from './account-terms';

const account: Account = {
  kind: 'chequing',
  currency: 'CAD',
  waivers: [{ minBalance: 4000 }],
  rates: {
    follows: 'none',
    applies: 'whole',
    tiers: [{ from: 0, rate: 0.5 }],
    sourceUrl: 'https://example.com/rates',
    lastVerified: '2026-11-03',
  },
  limits: { eTransfer: { day: 3000 } },
  protection: {
    insurer: 'cdic',
    held: 'own-name',
    limit: 100_000,
    url: 'https://example.com/cdic',
    quotes: ['Protected by CDIC.'],
    lastVerified: '2026-11-03',
  },
  eligibility: { minAssets: 100_000 },
};

function render(value: Account) {
  const fixture = TestBed.createComponent(AccountTerms);
  fixture.componentRef.setInput('account', value);
  fixture.componentRef.setInput('country', 'CA');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AccountTerms (M11.10)', () => {
  it('lists the account’s kind, interest, waiver, limits, protection and who may open it', () => {
    const lines = [...render(account).querySelectorAll('li')].map((li) =>
      li.textContent?.replace(/\s+/g, ' ').replace('open_in_new', '').trim(),
    );
    expect(lines).toEqual([
      'Chequing account, in CAD',
      'Interest: 0.50% a year posted rates',
      'No monthly fee if you keep $4,000 in it',
      'e-Transfers: up to $3,000 a day',
      'Protection: CDIC, up to $100,000, in your name, according to its page',
      'Open to you if you hold $100,000 with it',
    ]);
  });

  it('links the posted rates, and the protection page scrolled to its words', () => {
    const links = [...render(account).querySelectorAll('a')];
    expect(
      links.map((link) => [link.getAttribute('href'), link.getAttribute('aria-label')]),
    ).toEqual([
      ['https://example.com/rates', 'Its posted rates, opens in a new tab'],
      [
        'https://example.com/cdic#:~:text=Protected%20by%20CDIC.',
        'Page on who protects the money, opens in a new tab',
      ],
    ]);
  });

  it('leaves out what an account doesn’t have', () => {
    const lines = render({
      ...account,
      rates: undefined,
      waivers: undefined,
      limits: undefined,
      eligibility: undefined,
    }).querySelectorAll('li');
    expect(lines).toHaveLength(2);
  });
});
