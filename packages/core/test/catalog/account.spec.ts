import { describe, expect, it } from 'vitest';
import {
  accountSchema,
  formatCatalogIssue,
  validateCatalog,
  type CatalogSourceFile,
} from '../../src';
import { edited, today } from './catalog-files';
import {
  bank,
  chequing,
  fintech,
  netflixFile,
  protection,
  rates,
  withFinance,
} from './finance-files';
import { issues } from './helpers';

// M11.10's acceptance: the account block refuses a rate tier out of order, a waiver with no condition and protection
// without a quote, and two fixture providers validate: a bank whose fee a balance waives, and a fintech whose better
// rate is a paid tier.

describe('accountSchema', () => {
  it('takes an account’s kind, waivers, rates, limits and protection', () => {
    expect(issues(accountSchema, chequing)).toEqual([]);
    expect(
      issues(accountSchema, {
        ...chequing,
        kind: 'savings',
        waivers: undefined,
        rates: {
          ...rates({ from: 0, rate: 1.5 }),
          bonus: { rate: 3, when: { directDeposit: 2000 } },
        },
      }),
    ).toEqual([]);
  });

  it('refuses a rate tier out of order, or a first tier above 0', () => {
    expect(
      issues(accountSchema, {
        ...chequing,
        rates: rates({ from: 0, rate: 1.25 }, { from: 5000, rate: 2 }, { from: 5000, rate: 2.5 }),
      }),
    ).toEqual([
      'rates.tiers.2.from: List the tiers from the lowest balance up, each from a higher balance than the one before',
    ]);
    expect(issues(accountSchema, { ...chequing, rates: rates({ from: 100, rate: 1 }) })).toEqual([
      'rates.tiers.0.from: Start the first tier at a balance of 0',
    ]);
  });

  it('refuses a waiver with no condition, and protection without a quote', () => {
    expect(issues(accountSchema, { ...chequing, waivers: [{}] })).toEqual([
      'waivers.0: Say what it takes: a balance, a direct deposit, an age… (one or more of its fields)',
    ]);
    expect(
      issues(accountSchema, { ...chequing, protection: { ...protection, quotes: [] } }),
    ).toEqual(['protection.quotes: Quote its words about who protects the money']);
    expect(issues(accountSchema, { ...chequing, protection: undefined })).toHaveLength(1);
  });
});

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

describe('validateCatalog, for finance accounts (M11.10)', () => {
  it('passes a bank whose fee a balance waives and a fintech whose better rate is a paid tier', () => {
    expect(errors(withFinance([bank, fintech]))).toEqual([]);
  });

  it('needs an account on every finance plan and regulators of every finance provider, and neither elsewhere', () => {
    // Undefined fields are dropped when the fixtures are copied in as data.
    const plain = { ...bank.plans[0], account: undefined };
    const unregulated = { ...bank, regulators: undefined, plans: [plain] };
    expect(errors(withFinance([unregulated]))).toEqual([
      "data/providers/example-bank.yaml plans.0: Give its account's terms (account): a finance provider's plans are accounts",
      'data/providers/example-bank.yaml: Say who regulates it (regulators), each with its register’s page for it',
    ]);
    const netflixAccount = edited(withFinance([]), netflixFile, ['plans', 0, 'account'], chequing);
    expect(errors(netflixAccount)).toEqual([
      "data/providers/netflix.yaml plans.0.account: Only a finance provider's plans are accounts: leave account out",
    ]);
  });

  it('takes its rates and protection from its own sites, and a regulator from the regulator’s', () => {
    const elsewhere = {
      ...bank,
      regulators: [{ name: 'OSFI', url: 'https://example.com/regulated', lastVerified: today }],
      plans: [
        {
          ...bank.plans[0],
          account: {
            ...chequing,
            protection: { ...protection, url: 'https://www.reddit.com/r/banking' },
          },
        },
      ],
    };
    expect(errors(withFinance([elsewhere]))).toEqual([
      "data/providers/example-bank.yaml plans.0.account.protection.url: Must be a page of Example Bank's own sites (example.com)",
      "data/providers/example-bank.yaml regulators.0.url: Must be the regulator's own register, not the provider's site",
    ]);
  });
});
