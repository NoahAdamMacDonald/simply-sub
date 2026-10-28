import {
  buildCatalogData,
  readCatalogSource,
  resolveItem,
  type ListItem,
  type PaymentCard,
  type ResolveContext,
  type ResolvedItem,
} from '../../src';
import { catalog } from '../catalog/catalog-files';
import { listId } from '../user/fixtures';

// Items and cards for the rewards specs: the real catalog, a Canadian in Ontario, and the ECB's rates of 2026-10-21.

export const today = '2026-10-26';
export const ontario = { country: 'CA', subdivision: 'CA-ON' };

export const canadian: ResolveContext = {
  catalog: buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/'),
  customSubs: new Map(),
  country: 'CA',
  currency: 'CAD',
  fx: {
    base: 'CAD',
    date: '2026-10-21',
    source: 'European Central Bank via Frankfurter',
    rates: { EUR: 0.664, USD: 0.7243 },
  },
  today,
  profileRanks: new Map(),
  taxPlace: ontario,
};
export const noRates: ResolveContext = { ...canadian, fx: undefined };

export const otherListId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';

let nextId = 0x60;

/** A monthly item of `planId`, renewing on Nov 12, resolved for the Canadian. */
export function resolved(
  planId: string,
  extra: Partial<ListItem> = {},
  context: ResolveContext = canadian,
): ResolvedItem {
  const result = resolveItem(
    {
      id: `0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c${(nextId++).toString(16).padStart(2, '0')}`,
      listId,
      source: { kind: 'catalog', planId },
      billing: {
        mode: 'recurring',
        interval: 'month',
        intervalCount: 1,
        anchorDate: '2026-11-12',
        autoRenew: true,
      },
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      createdAt: '2026-10-20T12:00:00.000Z',
      updatedAt: '2026-10-20T12:00:00.000Z',
      ...extra,
    },
    context,
  );
  if (!result.ok) throw new Error(result.unresolved.reason);
  return result.resolved;
}

export const yearly: ListItem['billing'] = {
  mode: 'recurring',
  interval: 'year',
  intervalCount: 1,
  anchorDate: '2026-11-12',
  autoRenew: false,
};

const stamps = { createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-20T09:15:00.000Z' };

/** A CAD Mastercard with 1.5% back, a 2.5% FX fee and a $500 limit. */
export const simplii: PaymentCard = {
  id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e',
  name: 'Simplii Cashback Mastercard',
  type: 'credit',
  network: 'mastercard',
  currency: 'CAD',
  cashbackPercent: 1.5,
  fxFeePercent: 2.5,
  monthlyLimit: 500,
  ...stamps,
};

/** A USD Visa with 1% back and no FX fee, and no limit. */
export const dollarCard: PaymentCard = {
  id: '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d40',
  name: 'US Dollar Visa',
  type: 'credit',
  network: 'visa',
  currency: 'USD',
  cashbackPercent: 1,
  fxFeePercent: 0,
  ...stamps,
};
