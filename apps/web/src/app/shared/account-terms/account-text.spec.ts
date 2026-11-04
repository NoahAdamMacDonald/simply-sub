import type { Account } from '@simply-sub/core';
import { conditionText, limitLines, protectionText, ratesText, waiversText } from './account-text';

const rates: NonNullable<Account['rates']> = {
  follows: 'none',
  applies: 'whole',
  tiers: [{ from: 0, rate: 1.5 }],
  sourceUrl: 'https://example.com/rates',
  lastVerified: '2026-11-03',
};

describe('account text (M11.10)', () => {
  it('writes each condition, joined by "and"', () => {
    expect(conditionText({ minBalance: 4000 }, 'CAD', 'CA')).toBe('you keep $4,000 in it');
    expect(conditionText({ directDeposit: 2000, student: true }, 'CAD', 'CA')).toBe(
      'you have $2,000 of direct deposits a month and you’re a student',
    );
    expect(conditionText({ directDeposit: true }, 'CAD', 'CA')).toBe('you have a direct deposit');
    expect(conditionText({ maxAge: 24, newcomer: true }, 'CAD', 'CA')).toBe(
      'you’re 24 or under and you’re new to Canada',
    );
  });

  it('writes the rates, a tier at a time, with what they move with and a bonus', () => {
    expect(ratesText(rates, 'CAD', 'CA')).toBe('1.50% a year');
    expect(
      ratesText(
        {
          ...rates,
          follows: 'prime',
          applies: 'portion',
          tiers: [
            { from: 0, rate: 1.25 },
            { from: 5000, rate: 2 },
          ],
        },
        'CAD',
        'CA',
      ),
    ).toBe(
      '1.25% a year, 2.00% from $5,000, on each part of the balance. It moves with the prime rate',
    );
    expect(
      ratesText({ ...rates, bonus: { rate: 3, when: { directDeposit: 2000 } } }, 'CAD', 'CA'),
    ).toBe('1.50% a year. 3.00% instead if you have $2,000 of direct deposits a month');
  });

  it('writes the waivers joined by "or", the limits a line each, and the protection', () => {
    expect(waiversText([{ minBalance: 4000 }, { student: true }], 'CAD', 'CA')).toBe(
      'No monthly fee if you keep $4,000 in it or you’re a student',
    );
    expect(limitLines({ debits: 25, eTransfer: { day: 3000, week: 10_000 } }, 'CAD', 'CA')).toEqual(
      ['25 transactions a month included', 'e-Transfers: up to $3,000 a day, $10,000 a week'],
    );
    const protection: Account['protection'] = {
      insurer: 'cdic',
      held: 'own-name',
      limit: 100_000,
      url: 'https://example.com/cdic',
      quotes: ['Protected by CDIC.'],
      lastVerified: '2026-11-03',
    };
    expect(protectionText(protection, 'CAD', 'CA')).toBe('CDIC, up to $100,000, in your name');
    expect(
      protectionText(
        { ...protection, insurer: 'none', held: 'trust', limit: undefined },
        'CAD',
        'CA',
      ),
    ).toBe('No deposit insurance, held in trust for you');
  });
});
