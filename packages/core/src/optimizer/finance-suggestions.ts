import type { Account, AccountKind } from '../catalog/account';
import { availability } from '../catalog/availability';
import { subdivisionIn } from '../catalog/regions';
import { pickPrice, type PickedPrice } from '../catalog/pick-price';
import type { Plan } from '../catalog/provider';
import { isRetired } from '../catalog/retired';
import type { SnapshotProvider } from '../catalog/snapshot';
import type { IsoDate } from '../dates/iso-date';
import { conditionMet } from '../user/account-facts';
import { interestAYear, waiverMet } from '../user/account-money';
import { itemTitle } from '../user/item-text';
import type { ItemAccount } from '../user/list-item';
import type { ResolvedItem } from '../user/resolved';
import type { OptimizerInput } from './model';

// The finance optimizer (BLUEPRINT §10.6, M11.13): with the balances of a list's accounts (M11.11), it weighs their fees
// against their interest (PROJECT-PLAN §3.1, M11.12): a paid rate's break-even, a waiver's minimum against its fee,
// moving savings to a better account the user has or one sold where they live, and a balance its insurer doesn't
// cover. Each is information, not financial advice: the page says so on every one. Amounts are a year, in the user's
// currency; accounts in another currency are left out, but for their insurer's limit. The cost-only suggestions leave
// accounts alone (model.ts), since a fee can't be judged without the interest it earns.

/** The least a year a finance suggestion is worth, in the user's currency. */
export const financeEpsilon = 1;

/** An account item a suggestion is about. */
export interface FinanceItem {
  itemId: string;
  /** "Example Bank Unlimited Chequing", or its nickname's form. */
  title: string;
  /** Its balance, and the rate it earns there, the tiers as they apply (0 without posted rates). */
  balance: number;
  rate: number;
}

/** A plan sold where the user lives, priced for them. */
export interface FinancePlan {
  providerId: string;
  planId: string;
  /** "Example Fintech", "Everything". */
  name: string;
  planName: string;
  price: PickedPrice;
  /** The rate the balance would earn there. */
  rate: number;
}

/**
 * - `paid-rate`: another of the account's provider's plans earns more after fees with this balance: a dearer one that
 *   pays for itself above `breakEven`, or a cheaper one that earns more below it. No break-even when it's better at
 *   any balance.
 * - `pay-fee`: the waiver's `minimum` held at this rate gives up more interest than the fee it waives costs, against
 *   `better`'s rate. `top-up`: moving `amount` in from `better` meets the minimum, and the fee it waives costs more
 *   than the interest the amount earned there.
 * - `move-savings`: the balance earns more in another savings account: one the user has (`to.itemId`), or a plan sold
 *   where they live (switching banks: never a free saving).
 * - `over-limit`: the balances at one institution in one insured category pass the insurer's limit. `uninsured`: an
 *   account no insurer covers.
 */
export type FinanceSuggestion =
  | {
      kind: 'paid-rate';
      item: FinanceItem;
      to: FinancePlan;
      /** Its fee a month now, after waivers, and the other plan's. */
      fee: number;
      toFee: number;
      breakEven?: number;
      gain: number;
    }
  | {
      kind: 'pay-fee' | 'top-up';
      item: FinanceItem;
      better: FinanceItem;
      minimum: number;
      /** What moves: the minimum out of the account, or the shortfall into it. */
      amount: number;
      /** The fee a year the minimum waives, and the interest the amount gives up a year where it is. */
      fee: number;
      givenUp: number;
      gain: number;
    }
  | {
      kind: 'move-savings';
      item: FinanceItem;
      to: { item: FinanceItem } | { plan: FinancePlan };
      gain: number;
    }
  | {
      kind: 'over-limit';
      items: FinanceItem[];
      providerName: string;
      insurer: Account['protection']['insurer'];
      currency: string;
      held: number;
      limit: number;
    }
  | { kind: 'uninsured'; item: FinanceItem; providerName: string; currency: string };

export type FinanceSuggestionKind = FinanceSuggestion['kind'];

/** The kinds of account whose money the optimizer moves: never a registered account, a GIC or an investing one. */
const movable: ReadonlySet<AccountKind> = new Set(['savings']);

/** An account item with its plan and facts, in the user's currency or not. */
interface Holding {
  resolved: ResolvedItem;
  account: Account;
  facts: ItemAccount;
  provider: SnapshotProvider;
  plan: Plan;
  /** Its fee a month before waivers: the price the user pays for it. */
  fee: number;
  /** In the user's currency, so its money can be weighed against the others'. */
  comparable: boolean;
  item: FinanceItem;
}

/** The finance suggestions for a list's accounts: warnings first, then the most a year first. */
export function financeSuggestions(input: OptimizerInput): FinanceSuggestion[] {
  const { today } = input.context;
  const holdings = input.items.flatMap((resolved) => holdingOf(resolved, input));
  const comparable = holdings.filter((holding) => holding.comparable);
  const suggestions: FinanceSuggestion[] = [
    ...protectionWarnings(holdings),
    ...comparable.flatMap((holding) => paidRate(holding, input)),
    ...comparable.flatMap((holding) => waiverMinimum(holding, comparable, today)),
    ...comparable.flatMap((holding) => moveSavings(holding, comparable, input)),
  ];
  const warning = (suggestion: FinanceSuggestion) =>
    suggestion.kind === 'over-limit' || suggestion.kind === 'uninsured';
  const gain = (suggestion: FinanceSuggestion) => ('gain' in suggestion ? suggestion.gain : 0);
  return suggestions.sort((a, b) => Number(warning(b)) - Number(warning(a)) || gain(b) - gain(a));
}

function holdingOf(resolved: ResolvedItem, input: OptimizerInput): Holding[] {
  const { account } = resolved;
  const facts = resolved.item.account;
  const catalog = input.catalogs.get(resolved.region);
  const provider = catalog?.providers.find(({ id }) => id === resolved.providerId);
  const plan = provider?.plans.find(({ id }) => id === resolved.planId);
  if (!account || !facts || !provider || !plan) return [];
  const fee = (resolved.feeWaived?.fee ?? resolved.override ?? resolved.price).monthlyEquivalent;
  const { today, currency } = input.context;
  return [
    {
      resolved,
      account,
      facts,
      provider,
      plan,
      fee,
      comparable: facts.balance.currency === currency && account.currency === currency,
      item: {
        itemId: resolved.item.id,
        title: itemTitle(resolved),
        balance: facts.balance.amount,
        rate: interestAYear(account, facts, today)?.rate ?? 0,
      },
    },
  ];
}

/** Interest less fees a year, on `account` priced `fee` a month, with `facts`. */
function netAYear(account: Account, facts: ItemAccount, fee: number, today: IsoDate): number {
  const interest = interestAYear(account, facts, today)?.amount ?? 0;
  return interest - (waiverMet(account, facts, today) ? 0 : fee * 12);
}

/** Its fee a month after waivers, with `facts`. */
function feeAfterWaivers(account: Account, facts: ItemAccount, fee: number, today: IsoDate) {
  return waiverMet(account, facts, today) ? 0 : fee;
}

/** `facts` with another balance. */
function withBalance(facts: ItemAccount, amount: number): ItemAccount {
  return { ...facts, balance: { ...facts.balance, amount } };
}

/** May the user, by their facts, open `account`? Not when its eligibility can't be told. */
function eligible(account: Account, facts: ItemAccount, today: IsoDate): boolean {
  return !account.eligibility || conditionMet(account.eligibility, facts, today) === true;
}

/**
 * `provider`'s account plans sold where the item was bought, of one kind and currency, priced for the user: in the
 * user's own country, sold in their province (M11.17), so a credit union of another province isn't suggested.
 */
function soldAccounts(
  provider: SnapshotProvider,
  kind: AccountKind,
  region: string,
  input: OptimizerInput,
): { plan: Plan & { account: Account }; price: PickedPrice }[] {
  const { today, currency, fx, place } = input.context;
  const subdivision = subdivisionIn(region, place);
  return provider.plans.flatMap((plan) => {
    const { account } = plan;
    if (!account || account.kind !== kind || account.currency !== currency) return [];
    if (isRetired(plan, provider, today)) return [];
    if (availability(plan.prices, provider, region, subdivision) === 'not-offered') return [];
    const [price] = pickPrice(plan.prices, {
      region,
      ...(subdivision !== undefined && { subdivision }),
      currency,
      ...(provider.billingCurrency && { billingCurrency: provider.billingCurrency }),
      ...(fx && { fx }),
      taxFree: true,
    }).filter((picked) => picked.currency === currency);
    return price ? [{ plan: { ...plan, account }, price }] : [];
  });
}

/** A plan as a suggestion names it, with the rate `facts` would earn there. */
function financePlan(
  provider: SnapshotProvider,
  plan: Plan & { account: Account },
  price: PickedPrice,
  facts: ItemAccount,
  today: IsoDate,
): FinancePlan {
  return {
    providerId: provider.id,
    planId: plan.id,
    name: provider.name,
    planName: plan.name,
    price,
    rate: interestAYear(plan.account, facts, today)?.rate ?? 0,
  };
}

/**
 * Another of the provider's plans of the same kind that earns more after fees with this balance (§10.6): the best
 * one. Paying `F` more a month for `r₁` instead of `r₀` pays for itself above `12F / (r₁ − r₀)`; a cheaper plan that
 * pays less earns more below it.
 */
function paidRate(holding: Holding, input: OptimizerInput): FinanceSuggestion[] {
  const { account, facts, provider, resolved, fee } = holding;
  const { today } = input.context;
  const here = netAYear(account, facts, fee, today);
  const feeHere = feeAfterWaivers(account, facts, fee, today);
  const best = soldAccounts(provider, account.kind, resolved.region, input)
    .filter(({ plan }) => plan.id !== resolved.planId && eligible(plan.account, facts, today))
    .map(({ plan, price }) => ({
      plan,
      price,
      gain: netAYear(plan.account, facts, price.monthlyEquivalent, today) - here,
      toFee: feeAfterWaivers(plan.account, facts, price.monthlyEquivalent, today),
    }))
    .filter(({ gain }) => gain >= financeEpsilon)
    .sort((a, b) => b.gain - a.gain)[0];
  if (!best) return [];
  const to = financePlan(provider, best.plan, best.price, facts, today);
  const extraFee = best.toFee - feeHere;
  const extraRate = to.rate - holding.item.rate;
  const breakEven =
    extraFee !== 0 && extraRate !== 0 && Math.sign(extraFee) === Math.sign(extraRate)
      ? (12 * extraFee) / (extraRate / 100)
      : undefined;
  return [
    {
      kind: 'paid-rate',
      item: holding.item,
      to,
      fee: feeHere,
      toFee: best.toFee,
      ...(breakEven !== undefined && { breakEven }),
      gain: best.gain,
    },
  ];
}

/**
 * A waiver's minimum balance against its fee (§10.6): held in an account paying `r_here`, a minimum `M` gives up
 * `M × (r_best − r_here)` a year against the `12F` it waives. When the fee is waived by the minimum and the interest
 * given up is more, paying the fee and moving the minimum to the best of the user's other accounts earns more; when
 * the fee is paid, moving the shortfall in from one of them, which keeps its own waiver, can cost less than the fee.
 */
function waiverMinimum(
  holding: Holding,
  holdings: readonly Holding[],
  today: IsoDate,
): FinanceSuggestion[] {
  const { account, facts, fee, item } = holding;
  if (fee <= 0) return [];
  const minimum = Math.min(
    ...(account.waivers ?? []).flatMap((waiver) =>
      Object.keys(waiver).length === 1 && waiver.minBalance !== undefined
        ? [waiver.minBalance]
        : [],
    ),
  );
  if (!Number.isFinite(minimum)) return [];
  const others = holdings.filter((other) => other !== holding && movable.has(other.account.kind));
  const waived = waiverMet(account, facts, today) !== undefined;
  const feeAYear = fee * 12;
  if (waived) {
    // Paying the fee: only when nothing but the balance waives it.
    if (waiverMet(account, withBalance(facts, 0), today)) return [];
    const better = others.sort((a, b) => b.item.rate - a.item.rate)[0];
    if (!better || better.item.rate <= item.rate) return [];
    const givenUp = (minimum * (better.item.rate - item.rate)) / 100;
    const gain = givenUp - feeAYear;
    return gain >= financeEpsilon
      ? [
          {
            kind: 'pay-fee',
            item,
            better: better.item,
            minimum,
            amount: minimum,
            fee: feeAYear,
            givenUp,
            gain,
          },
        ]
      : [];
  }
  const shortfall = minimum - item.balance;
  if (shortfall <= 0) return [];
  // From the account that loses least for it, and keeps its own waiver.
  const donors = others
    .filter(
      (other) =>
        other.item.balance >= shortfall &&
        (!waiverMet(other.account, other.facts, today) ||
          waiverMet(
            other.account,
            withBalance(other.facts, other.item.balance - shortfall),
            today,
          )),
    )
    .sort((a, b) => a.item.rate - b.item.rate);
  const donor = donors[0];
  if (!donor) return [];
  const givenUp = Math.max(0, (shortfall * (donor.item.rate - item.rate)) / 100);
  const gain = feeAYear - givenUp;
  return gain >= financeEpsilon
    ? [
        {
          kind: 'top-up',
          item,
          better: donor.item,
          minimum,
          amount: shortfall,
          fee: feeAYear,
          givenUp,
          gain,
        },
      ]
    : [];
}

/**
 * A savings balance in a better savings account (§10.6): another the user has, when the two earn more together after
 * fees with the money moved; else the best plan sold where they live from another provider, which the user may open,
 * when it earns more after fees than this one does now.
 */
function moveSavings(
  holding: Holding,
  holdings: readonly Holding[],
  input: OptimizerInput,
): FinanceSuggestion[] {
  const { account, facts, fee, item, resolved } = holding;
  const { today } = input.context;
  if (!movable.has(account.kind) || item.balance <= 0) return [];
  const here = netAYear(account, facts, fee, today);
  const own = holdings
    .filter((other) => other !== holding && other.account.kind === account.kind)
    .map((other) => {
      const before = here + netAYear(other.account, other.facts, other.fee, today);
      const after =
        netAYear(account, withBalance(facts, 0), fee, today) +
        netAYear(
          other.account,
          withBalance(other.facts, other.item.balance + item.balance),
          other.fee,
          today,
        );
      return { other, gain: after - before };
    })
    .filter(({ gain }) => gain >= financeEpsilon)
    .sort((a, b) => b.gain - a.gain)[0];
  if (own) {
    return [{ kind: 'move-savings', item, to: { item: own.other.item }, gain: own.gain }];
  }
  const held = new Set(holdings.map((other) => other.plan.id));
  const catalog = input.catalogs.get(resolved.region);
  const sold = (catalog?.providers ?? [])
    .filter((provider) => provider.id !== holding.provider.id)
    .flatMap((provider) =>
      soldAccounts(provider, account.kind, resolved.region, input)
        .filter(({ plan }) => !held.has(plan.id) && eligible(plan.account, facts, today))
        .map(({ plan, price }) => ({
          plan: financePlan(provider, plan, price, facts, today),
          gain: netAYear(plan.account, facts, price.monthlyEquivalent, today) - here,
        })),
    )
    .filter(({ gain }) => gain >= financeEpsilon)
    .sort((a, b) => b.gain - a.gain || a.plan.planId.localeCompare(b.plan.planId))[0];
  return sold ? [{ kind: 'move-savings', item, to: { plan: sold.plan }, gain: sold.gain }] : [];
}

/** The insured category a balance is in: each registered account apart, other deposits together, investments apart. */
function insuredCategory(kind: AccountKind): string {
  switch (kind) {
    case 'chequing':
    case 'savings':
    case 'usd':
    case 'gic':
      return 'deposits';
    default:
      return kind;
  }
}

/**
 * Balances an insurer doesn't cover (§10.6): together at one institution, in one insured category, past its insurer's
 * limit; or in an account with no insurer at all.
 */
function protectionWarnings(holdings: readonly Holding[]): FinanceSuggestion[] {
  const groups = new Map<string, Holding[]>();
  const warnings: FinanceSuggestion[] = [];
  for (const holding of holdings) {
    const { protection } = holding.account;
    if (holding.item.balance <= 0) continue;
    if (protection.insurer === 'none') {
      warnings.push({
        kind: 'uninsured',
        item: holding.item,
        providerName: holding.provider.name,
        currency: holding.facts.balance.currency,
      });
      continue;
    }
    if (protection.limit === undefined) continue;
    const key = [
      holding.provider.id,
      protection.insurer,
      insuredCategory(holding.account.kind),
      holding.facts.balance.currency,
    ].join(' ');
    groups.set(key, [...(groups.get(key) ?? []), holding]);
  }
  for (const group of groups.values()) {
    const [first] = group;
    const limit = Math.min(...group.map(({ account }) => account.protection.limit ?? Infinity));
    const held = group.reduce((total, { item }) => total + item.balance, 0);
    if (held > limit) {
      warnings.push({
        kind: 'over-limit',
        items: group.map(({ item }) => item),
        providerName: first.provider.name,
        insurer: first.account.protection.insurer,
        currency: first.facts.balance.currency,
        held,
        limit,
      });
    }
  }
  return warnings;
}
