import type { Account, CatalogSourceFile, Provider } from '../../src';
import { catalog, price, today } from './catalog-files';
import { pngBytes } from './helpers';

// Finance fixtures (M11.10): two providers for the test catalog, with finance categories and features of their own,
// which account.spec.ts validates and search-catalog.spec.ts filters.

export const protection: Account['protection'] = {
  insurer: 'cdic',
  held: 'own-name',
  limit: 100_000,
  url: 'https://example.com/deposit-insurance',
  quotes: ['Your eligible deposits are protected by CDIC.'],
  lastVerified: today,
};

export const chequing: Account = {
  kind: 'chequing',
  currency: 'CAD',
  waivers: [{ minBalance: 4000 }],
  limits: { eTransfer: { day: 3000, week: 10_000 }, debits: 25 },
  protection,
};

export const rates = (
  ...tiers: { from: number; rate: number }[]
): NonNullable<Account['rates']> => ({
  follows: 'none',
  applies: 'whole',
  tiers,
  sourceUrl: 'https://example.com/rates',
  lastVerified: today,
});

// ── Two fixture providers in the test catalog, with finance categories and features of their own ─────────────────

export const netflixFile = 'data/providers/netflix.yaml';
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
export const bank = {
  id: 'example-bank',
  name: 'Example Bank',
  ...finance,
  freeUse: { kind: 'none', pages: ['https://example.com/plans'], lastVerified: today },
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
export const fintech = {
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
      features: {
        'finance.card': ['prepaid-mastercard'],
        'finance.registered-accounts': ['tfsa'],
        'finance.fractional-shares': true,
      },
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

export function withFinance(providers: readonly object[]): CatalogSourceFile[] {
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
        id: 'finance.fractional-shares',
        name: 'Fractional shares',
        category: 'finance',
        type: 'boolean',
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
