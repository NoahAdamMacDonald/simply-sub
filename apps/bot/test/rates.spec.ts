import {
  accountRatesSchema,
  bankOfCanadaFileSchema,
  bankOfCanadaSeriesUrl,
  type SnapshotProvider,
} from '@simply-sub/core';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkBankOfCanada, readSeries } from '../src/bank-of-canada';
import { checkPages } from '../src/check-pages';
import { proposal } from '../src/proposal';
import { rateTargets } from '../src/targets';
import type { Finding, RateTarget } from '../src/types';
import { withBankChanges, withRates, withRatesLastVerified } from '../src/yaml-edit';
import { fakeDeps, files, type Calls, type World } from './fakes';

// Rates read like prices (M11.14): an account's posted rates on their page, a change by Workers AI with the page's
// words, the old rates into the account's history, and the Bank of Canada's series.

const today = '2026-10-29';
const budget = { browserPages: 5, neurons: 8_000 };
const ratesUrl = 'https://example.com/rates';

/** A savings bank's file, as people write one: comments and all. */
const bankYaml = `id: example-bank
name: Example Bank
plans:
  - id: example-bank.savings
    name: High Interest Savings
    link: https://example.com/savings
    features: {}
    prices:
      - { region: CA, currency: CAD, amount: 0, interval: month, intervalCount: 1, autoRenew: true, lastVerified: 2026-10-20 }
    account:
      kind: savings
      currency: CAD
      rates:
        follows: boc-overnight
        applies: whole
        tiers:
          - { from: 0, rate: 2 }
        # Posted after the Bank's June cut.
        since: 2026-06-05
        sourceUrl: ${ratesUrl}
        lastVerified: 2026-10-20
      protection:
        insurer: cdic
        held: own-name
        url: https://example.com/cdic
        quotes: ['Protected by CDIC.']
        lastVerified: 2026-10-20
`;
const bank = parse(bankYaml) as SnapshotProvider;
const [savings] = rateTargets(bank);

/** The file's rates once edited, read back as the catalog would. */
const ratesOf = (text: string) => parse(text).plans[0].account.rates;

describe('rateTargets', () => {
  it('gives each account’s posted rates, its page and what the page may call it', () => {
    expect(savings).toEqual({
      file: 'data/providers/example-bank.yaml',
      planId: 'example-bank.savings',
      label: 'Example Bank High Interest Savings',
      names: ['High Interest Savings', 'Example Bank High Interest Savings'],
      rates: { tiers: [{ from: 0, rate: 2 }], sourceUrl: ratesUrl, lastVerified: '2026-10-20' },
    });
  });
});

describe('withRates', () => {
  it('puts the new rates in, and the old ones first in the history, since kept, until today', () => {
    const text = withRates(bankYaml, 'example-bank.savings', [{ from: 0, rate: 2.25 }], today);
    expect(text).toContain("        # Posted after the Bank's June cut.");
    const rates = ratesOf(text ?? '');
    expect(rates).toEqual({
      follows: 'boc-overnight',
      applies: 'whole',
      tiers: [{ from: 0, rate: 2.25 }],
      since: today,
      sourceUrl: ratesUrl,
      lastVerified: today,
      history: [{ since: '2026-06-05', until: today, tiers: [{ from: 0, rate: 2 }] }],
    });
    expect(accountRatesSchema.safeParse(rates).success).toBe(true);

    // Again a month later: the newest first, the history kept.
    const later = withRates(
      text ?? '',
      'example-bank.savings',
      [{ from: 0, rate: 2.5 }],
      '2026-11-30',
    );
    expect(ratesOf(later ?? '').history).toEqual([
      { since: today, until: '2026-11-30', tiers: [{ from: 0, rate: 2.25 }] },
      { since: '2026-06-05', until: today, tiers: [{ from: 0, rate: 2 }] },
    ]);
  });

  it('starts a history without since, and keeps a bonus with the rates it went with', () => {
    const plain = bankYaml.replace(
      "        # Posted after the Bank's June cut.\n        since: 2026-06-05\n",
      '',
    );
    const withBonus = plain.replace(
      '          - { from: 0, rate: 2 }\n',
      '          - { from: 0, rate: 2 }\n        bonus:\n          rate: 3\n          when: { directDeposit: 2000 }\n',
    );
    const text =
      withRates(withBonus, 'example-bank.savings', [{ from: 0, rate: 2.25 }], today) ?? '';
    const rates = ratesOf(text);
    expect(rates.since).toBe(today);
    expect(rates.bonus).toEqual({ rate: 3, when: { directDeposit: 2000 } });
    expect(rates.history).toEqual([
      {
        until: today,
        tiers: [{ from: 0, rate: 2 }],
        bonus: { rate: 3, when: { directDeposit: 2000 } },
      },
    ]);
    expect(accountRatesSchema.safeParse(rates).success).toBe(true);
  });

  it('sets only lastVerified for rates confirmed, and finds no plan that isn’t there', () => {
    expect(
      ratesOf(withRatesLastVerified(bankYaml, 'example-bank.savings', today) ?? ''),
    ).toMatchObject({ tiers: [{ from: 0, rate: 2 }], since: '2026-06-05', lastVerified: today });
    expect(
      withRates(bankYaml, 'example-bank.chequing', [{ from: 0, rate: 1 }], today),
    ).toBeUndefined();
  });
});

describe('checkPages, for posted rates', () => {
  const world = (html: string, ai?: World['ai']): World => ({
    pages: { [ratesUrl]: html },
    icons: {},
    ...(ai && { ai }),
  });
  const check = async (target: RateTarget, html: string, ai?: World['ai']) => {
    const calls: Calls = { pages: [], browser: [], ai: [] };
    const { findings } = await checkPages(
      { subject: 'example-bank', targets: [], rates: [target], approvals: [], networks: [] },
      fakeDeps(world(html, ai), calls),
      budget,
    );
    return { findings, calls };
  };
  const changedAnswer =
    (quote: string): World['ai'] =>
    () => ({
      response: {
        accounts: [{ account: 1, found: true, tiers: [{ from: 0, rate: 2.25, quote }] }],
      },
    });

  it('confirms rates still on their page without Workers AI', async () => {
    const { findings, calls } = await check(
      savings,
      '<h2>High Interest Savings</h2><p>Earn 2.00% interest on every dollar.</p>',
    );
    expect(findings).toEqual([{ kind: 'rates-confirmed', target: savings }]);
    expect(calls.ai).toEqual([]);
  });

  it('reads changed rates with Workers AI, taken only with the page’s own words', async () => {
    const page = '<h2>High Interest Savings</h2><p>Earn 2.25% interest on every dollar.</p>';
    const changed = await check(
      savings,
      page,
      changedAnswer('Earn 2.25% interest on every dollar.'),
    );
    expect(changed.findings).toEqual([
      { kind: 'rates-changed', target: savings, tiers: [{ from: 0, rate: 2.25 }] },
    ]);
    const unquoted = await check(savings, page, changedAnswer('Our best rate ever: 2.25%'));
    expect(unquoted.findings).toEqual([
      expect.objectContaining({
        kind: 'manual',
        reason: 'Workers AI’s quote for its rates isn’t on the page word for word',
      }),
    ]);
  });

  it('sends a bonus rate gone from the page to a person', async () => {
    const withBonus: RateTarget = {
      ...savings,
      rates: { ...savings.rates, bonus: { rate: 3, when: { directDeposit: 2000 } } },
    };
    const { findings, calls } = await check(
      withBonus,
      '<h2>High Interest Savings</h2><p>Earn 2.00% interest.</p>',
    );
    expect(findings).toEqual([
      expect.objectContaining({
        kind: 'manual',
        subject: 'Example Bank High Interest Savings (bonus 3.00%)',
        reason: 'Its bonus rate isn’t on the page: a person reads the new one, and what earns it',
      }),
    ]);
    expect(calls.ai).toEqual([]);
  });
});

describe('the Bank of Canada’s series', () => {
  const series = (days: [string, string][]) => ({
    observations: days.map(([d, v]) => ({ d, V39079: { v } })),
  });

  it('reads Valet’s days and rates', () => {
    expect(readSeries(series([['2026-11-03', '2.50']]))).toEqual([{ on: '2026-11-03', rate: 2.5 }]);
    expect(readSeries({ observations: [{ d: 'yesterday' }] })).toBeUndefined();
  });

  it('finds the changes after the file’s newest, each on its first day', async () => {
    const file = files['data/bank-of-canada.yaml'];
    const read = async (start: string) => {
      expect(start).toBe('2026-10-29');
      return (
        readSeries(
          series([
            ['2026-10-29', '2.50'],
            ['2026-12-09', '2.50'],
            ['2026-12-10', '2.75'],
            ['2026-12-11', '2.75'],
          ]),
        ) ?? []
      );
    };
    expect(await checkBankOfCanada(file, read)).toEqual({
      kind: 'bank-of-canada',
      changes: [{ on: '2026-12-10', rate: 2.75 }],
      lastVerified: '2026-11-04',
    });
    expect(await checkBankOfCanada(file, async () => [])).toMatchObject({ changes: [] });
    expect(await checkBankOfCanada(file, async () => ({ error: 'The page timed out' }))).toEqual({
      kind: 'manual',
      subject: 'The Bank of Canada’s rate',
      url: bankOfCanadaSeriesUrl,
      reason: 'The page timed out',
    });
    expect(await checkBankOfCanada('changes: []', read)).toMatchObject({ kind: 'manual' });
  });

  it('puts a new change first in the file, with today’s lastVerified', () => {
    const text =
      withBankChanges(
        files['data/bank-of-canada.yaml'],
        [{ on: '2026-12-10', rate: 2.75 }],
        '2026-12-10',
      ) ?? '';
    const read = bankOfCanadaFileSchema.parse(parse(text));
    expect(read.changes.slice(0, 2)).toEqual([
      { on: '2026-12-10', rate: 2.75 },
      { on: '2026-10-29', rate: 2.5 },
    ]);
    expect(read.lastVerified).toBe('2026-12-10');
  });
});

describe('proposal, for rates and the Bank of Canada', () => {
  it('edits the files, with a table of the rates and the Bank’s change', () => {
    const findings: Finding[] = [
      { kind: 'rates-changed', target: savings, tiers: [{ from: 0, rate: 2.25 }] },
      {
        kind: 'bank-of-canada',
        changes: [{ on: '2026-12-10', rate: 2.75 }],
        lastVerified: '2026-11-04',
      },
    ];
    const made = proposal(
      findings,
      new Map([
        ['data/providers/example-bank.yaml', bankYaml],
        ['data/bank-of-canada.yaml', files['data/bank-of-canada.yaml']],
      ]),
      '2026-12-10',
    );
    expect(made.changes.map((change) => change.path)).toEqual([
      'data/bank-of-canada.yaml',
      'data/providers/example-bank.yaml',
    ]);
    expect(made.body).toContain(
      '| Example Bank High Interest Savings | 2.00% | 2.25% | [example.com/rates](https://example.com/rates) |',
    );
    expect(made.body).toContain('### The Bank of Canada');
    expect(made.body).toContain('- From 2026-12-10: 2.75%, its first day in');
  });
});
