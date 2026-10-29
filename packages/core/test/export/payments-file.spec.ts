import { describe, expect, it } from 'vitest';
import { paymentsFile, paymentsText } from '../../src';
import { context, familyList, format, mullvad, netflix, today, workList } from './fixtures';

// The Calendar's JSON and Text exports (P10, M7.9): the next 12 months' payments of the lists shown.

describe('paymentsFile', () => {
  const file = paymentsFile([workList, familyList], context);

  it('says what it is, for which lists and months, and lists every charge in date order', () => {
    expect(file).toMatchObject({
      app: 'simply-sub',
      file: 'payments',
      exportedOn: today,
      from: '2026-10-28',
      lists: ['Work Related', 'Family'],
    });
    expect(file.payments).toHaveLength(28);
    const dates = file.payments.map((payment) => payment.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('gives each charge as charged, with its tax, how it renews and its live tags', () => {
    expect(file.payments.find((payment) => payment.name === 'Netflix')).toEqual({
      date: '2026-11-12',
      list: 'Work Related',
      name: 'Netflix',
      plan: 'Standard',
      amount: 19.94,
      tax: 0.95,
      currency: 'CAD',
      renews: 'automatically',
      tags: ['Family'],
    });
    const renewal = file.payments.find((payment) => payment.name === mullvad.name);
    expect(renewal).toMatchObject({ renews: 'manually', converted: true, list: 'Family' });
    expect(netflix.item.tagIds.length).toBeGreaterThan(1);
  });
});

describe('paymentsText', () => {
  const text = paymentsText([workList, familyList], context, format);

  it('heads the schedule with the lists and the day, then each month with its total and charges', () => {
    const lines = text.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      'Simply Sub payments',
      'Exported on Oct 28, 2026, for the next 12 months',
      'Lists: Work Related, Family',
    ]);
    expect(lines).toContain(
      '  Nov 12, 2026: Netflix Standard (Work Related), $19.94, with $0.95 tax',
    );
    expect(lines.some((line) => /^November 2026: /.test(line))).toBe(true);
    expect(lines.find((line) => line.includes(mullvad.name))).toMatch(/≈ .*; renew manually/);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('says so when there are no payments', () => {
    expect(paymentsText([], context, format)).toBe(
      'Simply Sub payments\nExported on Oct 28, 2026, for the next 12 months\nLists: \n\nNo payments.\n',
    );
  });
});
