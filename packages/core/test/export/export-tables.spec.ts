import { describe, expect, it } from 'vitest';
import {
  currencyDigits,
  exportCharges,
  exportWorkbook,
  itemTable,
  paymentTable,
  roundMoney,
  sheetNames,
  summaryTable,
} from '../../src';
import { context, crave, disney, familyList, mullvad, netflix, workList } from './fixtures';

// The CSV files' and the workbook's tables (BLUEPRINT §11.2, M7.5), on Oct 28, 2026 for an Albertan.

describe('itemTable', () => {
  it('has a row for each item: what it is, what a charge costs as charged, how it renews, and its live tags', () => {
    const table = itemTable([workList, familyList], context);
    expect(table.columns.map((column) => column.header)).toEqual([
      'List',
      'Service',
      'Plan',
      'Nickname',
      'Cost',
      'Tax',
      'Currency',
      'Converted',
      'Billed',
      'Renews',
      'Next charge',
      'Ends',
      'Status',
      'Tags',
    ]);
    // prettier-ignore
    expect(table.rows).toEqual([
      // Netflix's tag deleted since isn't named.
      ['Work Related', 'Netflix', 'Standard', null, 19.94, 0.95, 'CAD', null, 'Monthly', 'Automatically', '2026-11-12', null, 'Active', 'Family'],
      ['Work Related', 'Crave', 'Premium', null, 23.1, 1.1, 'CAD', null, 'Monthly', 'Automatically', '2026-10-31', null, 'Active', 'Work'],
      // Converted from euros, with tax included: none added.
      ['Family', 'Mullvad VPN', 'Mullvad VPN', null, 94.16, 0, 'CAD', 'yes', 'Yearly', 'Manually', '2027-01-20', null, 'Active', null],
      ['Family', 'Disney+', 'Standard', "Kids'", 12.59, 0.6, 'CAD', null, 'Monthly', 'Automatically', '2026-11-05', '2027-02-01', 'Active', null],
      // What's known of an item that can't be priced, and why.
      ['Family', 'netflix.basic', null, 'Old plan', null, null, null, null, 'Monthly', 'Automatically', null, null, 'This plan is no longer in the catalog', 'Family'],
    ]);
  });

  it('leaves the List column out of a list’s own sheet', () => {
    const table = itemTable([workList], context, { withList: false });
    expect(table.columns[0].header).toBe('Service');
    expect(table.rows[0].slice(0, 2)).toEqual(['Netflix', 'Standard']);
  });

  it('writes a window plan’s billing, and says Inactive between its windows', () => {
    const window = {
      ...netflix,
      item: {
        ...netflix.item,
        billing: {
          mode: 'limited' as const,
          windows: [{ start: '2026-12-01', end: '2027-02-01', repeatYearly: false }],
          interval: 'month' as const,
          intervalCount: 1,
        },
      },
      status: { kind: 'inactive' as const, activeFrom: '2026-12-01', manual: false },
    };
    const [row] = itemTable([{ ...workList, resolved: [window] }], context).rows;
    expect(row.slice(8, 13)).toEqual([
      'Specific dates, billed monthly',
      'Automatically',
      '2026-11-12',
      null,
      'Inactive',
    ]);
  });
});

describe('paymentTable', () => {
  const table = paymentTable([workList, familyList], context);

  it('has a row for each charge in the next 12 months, in date order, across the lists', () => {
    expect(table.columns.map((column) => column.header)).toEqual([
      'Date',
      'List',
      'Service',
      'Plan',
      'Nickname',
      'Amount',
      'Tax',
      'Currency',
      'Converted',
      'Renews',
      'Last charge',
    ]);
    // prettier-ignore
    expect(table.rows.slice(0, 3)).toEqual([
      ['2026-10-31', 'Work Related', 'Crave', 'Premium', null, 23.1, 1.1, 'CAD', null, 'Automatically', null],
      ['2026-11-05', 'Family', 'Disney+', 'Standard', "Kids'", 12.59, 0.6, 'CAD', null, 'Automatically', null],
      ['2026-11-12', 'Work Related', 'Netflix', 'Standard', null, 19.94, 0.95, 'CAD', null, 'Automatically', null],
    ]);
    const dates = table.rows.map((row) => row[0] as string);
    expect(dates).toEqual([...dates].sort());
    // Crave 12, Netflix 12, Mullvad 1, Disney+ 3 before it ends.
    expect(table.rows).toHaveLength(28);
    expect(dates[0] >= '2026-10-28' && dates.at(-1)! < '2027-10-28').toBe(true);
  });

  it('has a charge in every month for a plan billed on the 31st', () => {
    const craves = table.rows.filter((row) => row[2] === 'Crave').map((row) => row[0]);
    expect(craves).toEqual([
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
      '2027-06-30',
      '2027-07-31',
      '2027-08-31',
      '2027-09-30',
    ]);
  });

  it('marks a manual renewal, a converted amount and the last charge before an item ends', () => {
    const mullvads = table.rows.filter((row) => row[2] === 'Mullvad VPN');
    // prettier-ignore
    expect(mullvads).toEqual([
      ['2027-01-20', 'Family', 'Mullvad VPN', 'Mullvad VPN', null, 94.16, 0, 'CAD', 'yes', 'Manually', null],
    ]);
    const disneys = table.rows.filter((row) => row[2] === 'Disney+');
    expect(disneys.map((row) => [row[0], row[10]])).toEqual([
      ['2026-11-05', null],
      ['2026-12-05', null],
      ['2027-01-05', 'yes'],
    ]);
  });
});

describe('exportCharges', () => {
  it('pairs each charge with its item and its list’s name', () => {
    const [first] = exportCharges([workList], context);
    expect(first.resolved).toBe(crave);
    expect(first.listName).toBe('Work Related');
    expect(exportCharges([familyList], context).map(({ resolved }) => resolved)).toEqual([
      disney,
      disney,
      disney,
      mullvad,
    ]);
  });
});

describe('summaryTable', () => {
  it('gives each list’s totals as its page does, then all of them together', () => {
    const table = summaryTable([workList, familyList], context);
    expect(table.columns.map((column) => column.header)).toEqual([
      'List',
      'This month',
      'This year',
      'Next 12 months',
      'Currency',
      'Converted',
      'Not counted',
    ]);
    // prettier-ignore
    expect(table.rows).toEqual([
      // October: Netflix on the 12th and Crave on the 31st. Each charges every month of the year.
      ['Work Related', 43.04, 516.47, 516.47, 'CAD', null, 0],
      // Disney+ on Oct 5; this year, its 12 and Mullvad's Jan 20; the next 12 months, 3 and Mullvad's. The old plan
      // isn't counted.
      ['Family', 12.59, 245.23, 131.93, 'CAD', 'yes', 1],
      ['Total', 55.63, 761.71, 648.4, 'CAD', 'yes', 1],
    ]);
  });

  it('has no Total row for one list', () => {
    expect(summaryTable([workList], context).rows).toHaveLength(1);
  });
});

describe('exportWorkbook', () => {
  it('has Summary, a sheet of each list’s items, then Payments', () => {
    const sheets = exportWorkbook([workList, familyList], context);
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Work Related',
      'Family',
      'Payments',
    ]);
    expect(sheets[1].columns[0].header).toBe('Service');
    expect(sheets[2].rows).toHaveLength(3);
    expect(sheets[3].rows).toHaveLength(28);
  });

  it('names a list’s sheet as Excel allows, apart from Summary and Payments', () => {
    const summary = { ...workList, list: { ...workList.list, name: 'summary' } };
    const sheets = exportWorkbook([summary], context);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Summary', 'summary (2)', 'Payments']);
  });
});

describe('sheetNames', () => {
  it('replaces what Excel doesn’t allow and trims apostrophes at either end', () => {
    expect(sheetNames(['Work: 2026/27', "'Kids'", 'A [b] *c* ?d\\'])).toEqual([
      'Work 2026 27',
      'Kids',
      'A b c d',
    ]);
  });

  it('cuts a name at 31 characters, without splitting a character', () => {
    const [long] = sheetNames(['Streaming services for the whole family']);
    expect(long).toBe('Streaming services for the whol');
    expect(long.length).toBeLessThanOrEqual(31);
    // The 31st unit would be the first half of 🎬.
    const [emoji] = sheetNames([`${'x'.repeat(30)}🎬`]);
    expect(emoji).toBe('x'.repeat(30));
  });

  it('numbers a name used already, in any case, or one Excel keeps for itself', () => {
    expect(sheetNames(['Family', 'family', 'FAMILY', 'History', 'Payments'], ['Payments'])).toEqual(
      ['Family', 'family (2)', 'FAMILY (3)', 'History (2)', 'Payments (2)'],
    );
    const long = 'L'.repeat(31);
    expect(sheetNames([long, long])).toEqual([long, `${'L'.repeat(27)} (2)`]);
  });

  it('names a list with nothing Excel can show "List"', () => {
    expect(sheetNames(['???', ''])).toEqual(['List', 'List (2)']);
  });
});

describe('currencyDigits', () => {
  it('is 2 for a currency with cents, 0 for one without', () => {
    expect(currencyDigits('CAD')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
  });
});

describe('roundMoney', () => {
  it('rounds to the currency’s minor unit as the app shows it', () => {
    expect(roundMoney(19.9395, 'CAD')).toBe(19.94);
    expect(roundMoney(0.125, 'CAD')).toBe(0.13);
    expect(roundMoney(1.005, 'CAD')).toBe(1);
    expect(roundMoney(2290.4, 'JPY')).toBe(2290);
    expect(roundMoney(0, 'EUR')).toBe(0);
  });
});
