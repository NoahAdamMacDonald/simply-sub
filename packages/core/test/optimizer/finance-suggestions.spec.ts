import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  financeSuggestions,
  optimize,
  readCatalogSource,
  resolveItem,
  type Account,
  type FinanceSuggestion,
  type ItemAccount,
  type ListItem,
  type OptimizerInput,
  type Provider,
  type ResolvedItem,
} from '../../src';
import { price } from '../catalog/catalog-files';
import { bank, chequing, fintech, protection, rates, withFinance } from '../catalog/finance-files';

// The finance optimizer (BLUEPRINT §10.6, M11.13) on the finance fixtures: Example Bank's $17.95 chequing that $4,000
// waives, Example Fintech's savings at 2% free or 3.5% for $22, and the providers each test adds.

const today = '2026-11-04';
const place = { country: 'CA', subdivision: 'CA-ON' };

/** A savings provider's plans, each a fee a month and a rate, its money insured as `insurer` says. */
function savingsProvider(
  id: string,
  plans: { slug: string; fee: number; rate: number }[],
  insurer: Account['protection']['insurer'] = 'cdic',
): Provider {
  return {
    ...fintech,
    id,
    name: id === 'example-hisa' ? 'Example HISA' : 'Example Savings',
    plans: plans.map(({ slug, fee, rate }) => ({
      id: `${id}.${slug}`,
      name: slug[0].toUpperCase() + slug.slice(1),
      link: 'https://example.com/plans',
      features: {},
      prices: [price('CA', 'CAD', fee)],
      account: {
        kind: 'savings',
        currency: 'CAD',
        rates: rates({ from: 0, rate }),
        protection:
          insurer === 'none'
            ? { ...protection, insurer: 'none', limit: undefined }
            : { ...protection, held: 'trust' },
      },
    })),
  };
}

/** $10 a month for 1.5 points more: the acceptance's plans. */
const paidTier = savingsProvider('example-savings', [
  { slug: 'basic', fee: 0, rate: 2 },
  { slug: 'plus', fee: 10, rate: 3.5 },
]);

let count = 0;
function setup(providers: readonly object[]) {
  const data = buildCatalogData(
    readCatalogSource(withFinance(providers)),
    'https://sub.simplely.ca/icons/',
  );
  const context = {
    today,
    country: 'CA',
    currency: 'CAD',
    place,
    profileRanks: new Map(),
  };
  const holding = (planId: string, amount: number, facts: Partial<ItemAccount> = {}) => {
    count += 1;
    const item: ListItem = {
      id: `0192f1c4-7b2e-7c3a-9d41-${String(count).padStart(12, '0')}`,
      listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
      source: { kind: 'catalog', planId },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-20',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      account: { balance: { amount, currency: 'CAD' }, asOf: today, ...facts },
      createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
    };
    const result = resolveItem(item, {
      ...context,
      catalog: data,
      customSubs: new Map(),
      taxPlace: place,
    });
    if (!result.ok) throw new Error(result.unresolved.reason);
    return result.resolved;
  };
  const input = (items: readonly ResolvedItem[]): OptimizerInput => ({
    items,
    catalogs: new Map([['CA', data]]),
    context,
  });
  return {
    holding,
    input,
    suggest: (items: readonly ResolvedItem[]) => financeSuggestions(input(items)),
  };
}

const kinds = (suggestions: readonly FinanceSuggestion[]) => suggestions.map(({ kind }) => kind);

describe('financeSuggestions: a paid rate (§10.6)', () => {
  const { holding, suggest } = setup([paidTier]);

  it('finds that a $10 monthly fee for 1.5 points more pays for itself above $8,000', () => {
    const [upgrade] = suggest([holding('example-savings.basic', 9000)]);
    expect(upgrade).toMatchObject({
      kind: 'paid-rate',
      item: { title: 'Example Savings Basic', balance: 9000, rate: 2 },
      to: { planId: 'example-savings.plus', planName: 'Plus', rate: 3.5 },
      fee: 0,
      toFee: 10,
    });
    expect(upgrade.kind === 'paid-rate' && upgrade.breakEven).toBeCloseTo(8000, 6);
    // $135 more interest less $120 of fees.
    expect(upgrade.kind === 'paid-rate' && upgrade.gain).toBeCloseTo(15, 6);
  });

  it('suggests nothing below it, and the cheaper plan to one paying for it there', () => {
    expect(suggest([holding('example-savings.basic', 7000)])).toEqual([]);
    const [downgrade] = suggest([holding('example-savings.plus', 7000)]);
    expect(downgrade).toMatchObject({
      kind: 'paid-rate',
      to: { planId: 'example-savings.basic' },
      fee: 10,
      toFee: 0,
    });
    expect(downgrade.kind === 'paid-rate' && downgrade.breakEven).toBeCloseTo(8000, 6);
    expect(downgrade.kind === 'paid-rate' && downgrade.gain).toBeCloseTo(15, 6);
  });

  it('gives no break-even when the other plan is better at any balance', () => {
    const { holding: own, suggest: suggestHere } = setup([
      savingsProvider('example-savings', [
        { slug: 'basic', fee: 5, rate: 2 },
        { slug: 'plus', fee: 0, rate: 3 },
      ]),
    ]);
    const [better] = suggestHere([own('example-savings.basic', 1000)]);
    expect(better).toMatchObject({ kind: 'paid-rate', to: { planId: 'example-savings.plus' } });
    expect(better).not.toHaveProperty('breakEven');
  });
});

describe('financeSuggestions: a waiver’s minimum (§10.6)', () => {
  /** Example Bank with a $10 fee that $10,000 waives. */
  const bigMinimum: Provider = {
    ...bank,
    plans: [
      {
        ...bank.plans[0],
        prices: [price('CA', 'CAD', 10)],
        account: { ...chequing, waivers: [{ minBalance: 10_000 }, { directDeposit: 2000 }] },
      },
    ],
  };

  it('says paying the fee costs less than the interest its minimum gives up', () => {
    const { holding, suggest } = setup([bigMinimum, fintech]);
    const suggestions = suggest([
      holding('example-bank.unlimited', 12_000),
      holding('example-fintech.everything', 20_000),
    ]);
    const payFee = suggestions.find(({ kind }) => kind === 'pay-fee');
    // $10,000 at 0% instead of 3.5% gives up $350 a year, against $120 of fees.
    expect(payFee).toMatchObject({
      item: { title: 'Example Bank Unlimited Chequing', rate: 0 },
      better: { title: 'Example Fintech Everything', rate: 3.5 },
      minimum: 10_000,
      amount: 10_000,
      fee: 120,
      givenUp: 350,
      gain: 230,
    });
  });

  it('keeps quiet when something else waives the fee, or the minimum costs less than it', () => {
    const { holding, suggest } = setup([bigMinimum, fintech]);
    expect(
      kinds(
        suggest([
          holding('example-bank.unlimited', 12_000, { directDeposit: 2500 }),
          holding('example-fintech.everything', 20_000),
        ]),
      ),
    ).not.toContain('pay-fee');
    // Example Bank's own $4,000 minimum gives up $140 at 3.5%, less than its $215.40 fee.
    const { holding: own, suggest: suggestHere } = setup([bank, fintech]);
    expect(
      kinds(
        suggestHere([
          own('example-bank.unlimited', 5000),
          own('example-fintech.everything', 20_000),
        ]),
      ),
    ).not.toContain('pay-fee');
  });

  it('says moving the shortfall in waives a fee that costs more than the interest it gives up', () => {
    const { holding, suggest } = setup([bank, fintech]);
    const topUp = suggest([
      holding('example-bank.unlimited', 1000),
      holding('example-fintech.essential', 20_000),
    ]).find(({ kind }) => kind === 'top-up');
    // $3,000 more meets $4,000: it gives up $60 at 2%, against $17.95 a month.
    expect(topUp).toMatchObject({
      item: { title: 'Example Bank Unlimited Chequing', balance: 1000 },
      better: { title: 'Example Fintech Essential', rate: 2 },
      minimum: 4000,
      amount: 3000,
      givenUp: 60,
    });
    expect(topUp && 'fee' in topUp && topUp.fee).toBeCloseTo(215.4, 6);
    expect(topUp && 'gain' in topUp && topUp.gain).toBeCloseTo(155.4, 6);
  });
});

describe('financeSuggestions: moving savings (§10.6)', () => {
  it('moves a balance to a better savings account the user has', () => {
    const { holding, suggest } = setup([fintech]);
    const move = suggest([
      holding('example-fintech.essential', 5000),
      holding('example-fintech.everything', 10_000),
    ]).find(({ kind }) => kind === 'move-savings');
    // Before: $100, and $350 less $264. After: $0, and $525 less $264.
    expect(move).toMatchObject({
      item: { title: 'Example Fintech Essential', balance: 5000 },
      to: { item: { title: 'Example Fintech Everything' } },
      gain: 75,
    });
  });

  it('else names the best savings account sold where the user lives, from another provider', () => {
    const hisa = savingsProvider('example-hisa', [{ slug: 'hisa', fee: 0, rate: 4 }]);
    const { holding, suggest } = setup([fintech, hisa]);
    const move = suggest([holding('example-fintech.essential', 5000)]).find(
      ({ kind }) => kind === 'move-savings',
    );
    expect(move).toMatchObject({
      to: { plan: { providerId: 'example-hisa', planId: 'example-hisa.hisa', rate: 4 } },
      gain: 100,
    });
  });

  it('leaves out an account sold only in another province (M11.17)', () => {
    // A credit union of British Columbia: its availableIn names the province, its price is Canada's.
    const credit = {
      ...savingsProvider('example-hisa', [{ slug: 'hisa', fee: 0, rate: 4 }]),
      availableIn: ['CA-BC'],
    };
    const { holding, suggest } = setup([fintech, credit]);
    expect(kinds(suggest([holding('example-fintech.essential', 5000)]))).toEqual([]);
    // Someone in British Columbia is told about it.
    const { holding: inBc, input } = setup([fintech, credit]);
    const bc = { ...input([]).context, place: { country: 'CA', subdivision: 'CA-BC' } };
    const move = financeSuggestions({
      ...input([inBc('example-fintech.essential', 5000)]),
      context: bc,
    }).find(({ kind }) => kind === 'move-savings');
    expect(move).toMatchObject({ to: { plan: { planId: 'example-hisa.hisa', rate: 4 } } });
  });

  it('leaves out an account the user can’t open', () => {
    const studentsOnly: Provider = {
      ...savingsProvider('example-hisa', [{ slug: 'hisa', fee: 0, rate: 4 }]),
    };
    studentsOnly.plans[0].account = {
      ...studentsOnly.plans[0].account!,
      eligibility: { student: true },
    };
    const { holding, suggest } = setup([fintech, studentsOnly]);
    expect(kinds(suggest([holding('example-fintech.essential', 5000)]))).toEqual([]);
  });
});

describe('financeSuggestions: protection (§10.6)', () => {
  it('warns when one institution’s deposits pass its insurer’s limit, first', () => {
    const { holding, suggest } = setup([fintech]);
    const suggestions = suggest([
      holding('example-fintech.essential', 60_000),
      holding('example-fintech.everything', 50_000),
    ]);
    expect(suggestions[0]).toMatchObject({
      kind: 'over-limit',
      providerName: 'Example Fintech',
      insurer: 'cdic',
      currency: 'CAD',
      held: 110_000,
      limit: 100_000,
    });
    expect(suggestions[0].kind === 'over-limit' && suggestions[0].items).toHaveLength(2);
  });

  it('warns about money no insurer covers', () => {
    const { holding, suggest } = setup([
      savingsProvider('example-savings', [{ slug: 'basic', fee: 0, rate: 2 }], 'none'),
    ]);
    expect(suggest([holding('example-savings.basic', 500)])).toEqual([
      {
        kind: 'uninsured',
        item: expect.objectContaining({ title: 'Example Savings Basic', balance: 500 }),
        providerName: 'Example Savings',
        currency: 'CAD',
      },
    ]);
  });
});

describe('optimize, with accounts (M11.13)', () => {
  it('leaves accounts out of the cost-only suggestions and returns the finance ones', () => {
    const { holding, input } = setup([fintech]);
    // Everything costs $22 a month more than Essential, but pays more on $30,000 than it costs.
    const result = optimize(input([holding('example-fintech.everything', 30_000)]));
    expect(result.suggestions).toEqual([]);
    expect(result.finance).toEqual([]);
    const lower = optimize(input([holding('example-fintech.everything', 5000)]));
    expect(lower.suggestions).toEqual([]);
    expect(kinds(lower.finance)).toEqual(['paid-rate']);
  });
});
