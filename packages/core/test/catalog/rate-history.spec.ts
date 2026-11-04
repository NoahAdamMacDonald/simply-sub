import { describe, expect, it } from 'vitest';
import {
  accountSchema,
  bankOfCanadaFileSchema,
  buildCatalogData,
  followedChanges,
  formatCatalogIssue,
  readCatalogSource,
  validateCatalog,
  type AccountRates,
  type CatalogSourceFile,
} from '../../src';
import { today } from './catalog-files';
import { bank, chequing, fintech, rates, withFinance } from './finance-files';
import { issues } from './helpers';

// Rate history (M11.14, the owner's choice: in the provider file) and how soon a rate that follows the Bank of
// Canada's followed its changes, which data:build puts on the account for its card.

/** The Bank's changes for these tests, newest first, as data/bank-of-canada.yaml lists them. */
const bankChanges = [
  { on: '2026-06-04', rate: 2.25 },
  { on: '2026-03-12', rate: 2.5 },
  { on: '2026-01-29', rate: 2.75 },
];
const bankFile: CatalogSourceFile = {
  file: 'data/bank-of-canada.yaml',
  data: {
    source: 'https://www.bankofcanada.ca/valet/observations/V39079/json',
    lastVerified: '2026-10-20',
    changes: bankChanges,
  },
};

/** Rates that follow the Bank's, with what they paid before. */
function following(changes: Partial<AccountRates> = {}): AccountRates {
  return {
    ...rates({ from: 0, rate: 1.75 }),
    follows: 'boc-overnight',
    lastVerified: '2026-10-20',
    ...changes,
  };
}
const tiers = (rate: number) => [{ from: 0, rate }];

describe('accountSchema: rate history (M11.14)', () => {
  it('takes the day the rates took over and the rates before, newest first', () => {
    const history = following({
      since: '2026-06-05',
      history: [
        { since: '2026-03-13', until: '2026-06-05', tiers: tiers(2) },
        { until: '2026-03-13', tiers: tiers(2.25) },
      ],
    });
    expect(issues(accountSchema, { ...chequing, rates: history })).toEqual([]);
  });

  it('refuses history out of order, one ending after the rates above it began, and a since after lastVerified', () => {
    const outOfOrder = following({
      since: '2026-06-05',
      history: [
        { until: '2026-03-13', tiers: tiers(2.25) },
        { since: '2026-03-13', until: '2026-06-05', tiers: tiers(2) },
      ],
    });
    expect(issues(accountSchema, { ...chequing, rates: outOfOrder })).toEqual([
      'rates.history.1.until: List the history newest first, each ending before the one above it',
    ]);
    const overlapping = following({
      since: '2026-06-05',
      history: [{ since: '2026-06-10', until: '2026-06-20', tiers: tiers(2) }],
    });
    expect(issues(accountSchema, { ...chequing, rates: overlapping })).toEqual([
      'rates.history.0.until: Must be no later than the day the rates after it took over',
    ]);
    expect(
      issues(accountSchema, { ...chequing, rates: following({ since: '2026-10-21' }) }),
    ).toEqual(['rates.since: Must be no later than lastVerified']);
    expect(
      issues(accountSchema, {
        ...chequing,
        rates: following({
          history: [{ since: '2026-03-13', until: '2026-03-13', tiers: tiers(2) }],
        }),
      }),
    ).toEqual(['rates.history.0.since: Must be before its until']);
  });
});

describe('bankOfCanadaFileSchema', () => {
  it('takes the changes newest first, and refuses them out of order or to the same rate', () => {
    expect(issues(bankOfCanadaFileSchema, bankFile.data)).toEqual([]);
    expect(
      issues(bankOfCanadaFileSchema, {
        ...(bankFile.data as object),
        changes: [...bankChanges].reverse(),
      }),
    ).toHaveLength(2);
    expect(
      issues(bankOfCanadaFileSchema, {
        ...(bankFile.data as object),
        changes: [{ on: '2026-06-04', rate: 2.5 }, bankChanges[1]],
      }),
    ).toEqual(['changes.0.rate: A change is to another rate than the one before it']);
    expect(
      issues(bankOfCanadaFileSchema, { ...(bankFile.data as object), lastVerified: '2026-06-01' }),
    ).toEqual(['lastVerified: Must be no earlier than the newest change']);
  });
});

describe('followedChanges', () => {
  it('gives, for the Bank’s last changes, the day the rates next changed', () => {
    const followed = following({
      since: '2026-06-05',
      history: [
        { since: '2026-03-13', until: '2026-06-05', tiers: tiers(2) },
        { since: '2026-01-31', until: '2026-03-13', tiers: tiers(2.25) },
      ],
    });
    expect(followedChanges(followed, bankChanges)).toEqual([
      { change: '2026-06-04', rate: 2.25, on: '2026-06-05' },
      { change: '2026-03-12', rate: 2.5, on: '2026-03-13' },
      { change: '2026-01-29', rate: 2.75, on: '2026-01-31' },
    ]);
  });

  it('says when they didn’t follow a change before the next, or haven’t yet', () => {
    expect(followedChanges(following({ since: '2026-01-31' }), bankChanges)).toEqual([
      { change: '2026-06-04', rate: 2.25 },
      { change: '2026-03-12', rate: 2.5 },
      { change: '2026-01-29', rate: 2.75, on: '2026-01-31' },
    ]);
  });

  it('leaves out a change since the rates were last read, and those before the record begins', () => {
    const read = following({ since: '2026-03-13', lastVerified: '2026-06-01' });
    expect(followedChanges(read, bankChanges)).toEqual([
      { change: '2026-03-12', rate: 2.5, on: '2026-03-13' },
    ]);
    // The record begins with rates that took over on Mar 20: what came before Mar 12 is unknown.
    expect(followedChanges(following({ since: '2026-03-20' }), bankChanges)).toEqual([
      { change: '2026-06-04', rate: 2.25 },
      { change: '2026-03-12', rate: 2.5, on: '2026-03-20' },
    ]);
  });

  it('is empty without a day the rates took over, or for rates that follow nothing', () => {
    expect(followedChanges(following(), bankChanges)).toEqual([]);
    expect(
      followedChanges(following({ since: '2026-06-05', follows: 'none' }), bankChanges),
    ).toEqual([]);
  });
});

describe('the catalog, with rate history (M11.14)', () => {
  const followingFintech = {
    ...fintech,
    plans: fintech.plans.map((plan, index) =>
      index === 0
        ? {
            ...plan,
            account: {
              ...plan.account,
              rates: following({
                since: '2026-06-05',
                history: [{ since: '2026-03-13', until: '2026-06-05', tiers: tiers(2) }],
              }),
            },
          }
        : plan,
    ),
  };

  /** The errors, leaving out the topics the test catalog's providers and the fixtures don't rate. */
  function errors(files: readonly CatalogSourceFile[]): string[] {
    return validateCatalog(files, today, {
      awaitingRegrade: new Set([
        'crave',
        'mullvad',
        'netflix',
        'proton',
        'example-bank',
        'example-fintech',
      ]),
    })
      .filter((issue) => issue.severity !== 'warning')
      .map((issue) => formatCatalogIssue(issue));
  }

  it('needs the Bank of Canada’s changes once a rate follows them, and never a written followed', () => {
    expect(errors([...withFinance([bank, followingFintech]), bankFile])).toEqual([]);
    expect(errors(withFinance([bank, followingFintech]))).toEqual([
      "data/bank-of-canada.yaml: Missing: the Bank of Canada's changes, which an account's rates follow, go here (M11.14)",
    ]);
    const written = {
      ...followingFintech,
      plans: followingFintech.plans.map((plan, index) =>
        index === 0
          ? {
              ...plan,
              account: {
                ...plan.account,
                rates: { ...plan.account.rates, followed: [{ change: '2026-06-04', rate: 2.25 }] },
              },
            }
          : plan,
      ),
    };
    expect(errors([...withFinance([written]), bankFile])).toEqual([
      'data/providers/example-fintech.yaml plans.0.account.rates.followed: data:build works it out from the history and data/bank-of-canada.yaml: leave followed out (M11.14)',
    ]);
  });

  it('gives the app how soon a rate followed the Bank, and not its history: after a change of the Bank’s rate, its lag', () => {
    const data = buildCatalogData(
      readCatalogSource([...withFinance([followingFintech]), bankFile]),
      'https://sub.simplely.ca/icons/',
    );
    const [essential, everything] =
      data.providers.find((provider) => provider.id === 'example-fintech')?.plans ?? [];
    expect(essential.account?.rates).not.toHaveProperty('history');
    expect(essential.account?.rates?.followed).toEqual([
      { change: '2026-06-04', rate: 2.25, on: '2026-06-05' },
      { change: '2026-03-12', rate: 2.5, on: '2026-03-13' },
    ]);
    // Its rates follow nothing.
    expect(everything.account?.rates).not.toHaveProperty('followed');
  });
});
