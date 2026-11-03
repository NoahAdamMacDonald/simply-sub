import { describe, expect, it } from 'vitest';
import {
  accountSchema,
  formatCatalogIssue,
  validateCatalog,
  type Account,
  type CatalogSourceFile,
  type Provider,
} from '../../src';
import { catalog, edited, price, today } from './catalog-files';
import { issues, pngBytes } from './helpers';

// M11.10's acceptance: the account block refuses a rate tier out of order, a waiver with no condition and protection
// without a quote, and two fixture providers validate: a bank whose fee a balance waives, and a fintech whose better
// rate is a paid tier.

const protection: Account['protection'] = {
  insurer: 'cdic',
  held: 'own-name',
  limit: 100_000,
  url: 'https://example.com/deposit-insurance',
  quotes: ['Your eligible deposits are protected by CDIC.'],
  lastVerified: today,
};

const chequing: Account = {
  kind: 'chequing',
  currency: 'CAD',
  waivers: [{ minBalance: 4000 }],
  limits: { eTransfer: { day: 3000, week: 10_000 }, debits: 25 },
  protection,
};

const rates = (...tiers: { from: number; rate: number }[]): NonNullable<Account['rates']> => ({
  follows: 'none',
  applies: 'whole',
  tiers,
  sourceUrl: 'https://example.com/rates',
  lastVerified: today,
});

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

// ── Two fixture providers in the test catalog, with finance categories and features of their own ─────────────────

const netflixFile = 'data/providers/netflix.yaml';
const netflixData = catalog().find((source) => source.file === netflixFile) as {
  data: Pick<Provider, 'owner' | 'paymentMethods' | 'renewalAnchor'>;
};
const facts = {
  owner: netflixData.data.owner,
  paymentMethods: netflixData.data.paymentMethods,
  renewalAnchor: netflixData.data.renewalAnchor,
};
const finance = {
  website: 'https://example.com',
  category: 'finance',
  spendCategory: 'finance',
  cancelUrl: 'https://example.com/close',
  ...facts,
  regulators: [
    {
      name: 'OSFI',
      url: 'https://www.osfi-bsif.gc.ca/en/supervision/financial-institutions',
      lastVerified: today,
    },
  ],
};

/** A bank whose monthly fee a balance waives (TD's Unlimited Chequing, simplified). */
const bank = {
  id: 'example-bank',
  name: 'Example Bank',
  ...finance,
  plans: [
    {
      id: 'example-bank.unlimited',
      name: 'Unlimited Chequing',
      link: 'https://example.com/chequing',
      features: { 'finance.e-transfer': true, 'finance.card': ['interac-debit', 'visa-debit'] },
      prices: [price('CA', 'CAD', 17.95)],
      account: chequing,
    },
  ],
} satisfies Provider;

/** A fintech whose better rate is a paid tier (KOHO's Essential and Everything, simplified). */
const fintech = {
  id: 'example-fintech',
  name: 'Example Fintech',
  ...finance,
  plans: [
    {
      id: 'example-fintech.essential',
      name: 'Essential',
      link: 'https://example.com/plans',
      features: { 'finance.card': ['prepaid-mastercard'] },
      prices: [price('CA', 'CAD', 0)],
      account: {
        kind: 'savings',
        currency: 'CAD',
        rates: rates({ from: 0, rate: 2 }),
        protection: { ...protection, held: 'trust' },
      },
    },
    {
      id: 'example-fintech.everything',
      name: 'Everything',
      link: 'https://example.com/plans',
      features: { 'finance.card': ['prepaid-mastercard'], 'finance.registered-accounts': ['tfsa'] },
      prices: [price('CA', 'CAD', 22)],
      account: {
        kind: 'savings',
        currency: 'CAD',
        rates: rates({ from: 0, rate: 3.5 }),
        protection: { ...protection, held: 'trust' },
      },
    },
  ],
} satisfies Provider;

/** The catalog with a file's data replaced whole. */
function replaced(
  files: readonly CatalogSourceFile[],
  file: string,
  data: unknown,
): CatalogSourceFile[] {
  return files.map((source) => (source.file === file ? { file, data } : source));
}

function withFinance(providers: readonly object[]): CatalogSourceFile[] {
  const files = catalog();
  const categories = files.find((source) => source.file === 'data/categories.yaml') as {
    data: { service: object[]; feature: object[]; spend: object[] };
  };
  const features = files.find((source) => source.file === 'data/features.yaml') as {
    data: object[];
  };
  const withCategories = replaced(files, 'data/categories.yaml', {
    service: [
      ...categories.data.service,
      { id: 'finance', name: 'Banking & investing', icon: 'account_balance' },
    ],
    feature: [...categories.data.feature, { id: 'finance', name: 'Banking & investing' }],
    spend: [...categories.data.spend, { id: 'finance', name: 'Bank & account fees' }],
  });
  return [
    ...replaced(withCategories, 'data/features.yaml', [
      ...features.data,
      {
        id: 'finance.e-transfer',
        name: 'Free Interac e-Transfers',
        category: 'finance',
        type: 'boolean',
      },
      {
        id: 'finance.card',
        name: 'Card',
        category: 'finance',
        type: 'set',
        values: [
          { id: 'interac-debit', name: 'Interac debit card' },
          { id: 'visa-debit', name: 'Visa Debit' },
          { id: 'prepaid-mastercard', name: 'Prepaid Mastercard' },
        ],
      },
      {
        id: 'finance.registered-accounts',
        name: 'Registered accounts',
        category: 'finance',
        type: 'set',
        values: [{ id: 'tfsa', name: 'TFSA' }],
      },
    ]),
    ...providers.map((data) => ({
      file: `data/providers/${(data as { id: string }).id}.yaml`,
      data: JSON.parse(JSON.stringify(data)) as unknown,
    })),
    ...providers.map((data) => ({
      file: `data/logos/${(data as { id: string }).id}.png`,
      bytes: pngBytes(64, 64),
    })),
  ];
}

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
