import {
  buildCatalogData,
  buildCatalogMeta,
  readCatalogSource,
  regionSnapshot,
  type CatalogSnapshot,
} from '../../src';
import { catalog } from '../catalog/catalog-files';
import { withValue } from '../catalog/helpers';

// One valid record of each user table, with every optional field set. Specs change one field at a time with
// withValue (../catalog/helpers).

export const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
export const itemId = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
export const customSubId = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c';
export const customPlanId = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d';
export const tagId = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
export const cardId = '0192f1c8-4f50-7162-bd7e-8f9a0b1c2d3e';

const stamps = { createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-20T09:15:00.000Z' };

export const list = { id: listId, name: 'Work Related', ...stamps };

export const item = {
  id: itemId,
  listId,
  source: {
    kind: 'catalog',
    planId: 'netflix.standard',
    addOns: [{ id: 'netflix.extra-member', quantity: 2 }],
  },
  region: 'US',
  billing: {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-02-28',
    billingDay: 31,
    startDate: '2025-01-31',
    endDate: '2027-01-31',
    autoRenew: true,
  },
  priceOverride: { amount: 15.99, currency: 'CAD', until: '2027-01-01', plusTax: true },
  cardId,
  tagIds: [tagId],
  rankOverrides: { 'streaming.ad-free': 'essential', 'video.quality=1080p': 'not-ranked' },
  pinned: true,
  nickname: "Mom's",
  note: 'Shared with the kids',
  ...stamps,
  deletedAt: '2026-10-20T09:15:00.000Z',
};

const savedItem = withValue(item, ['deletedAt'], undefined) as Omit<typeof item, 'deletedAt'>;

/** Work Related's draft: renamed, with its item unpinned (a list's items aren't deleted). */
export const draft = {
  listId,
  isNew: false,
  name: 'Work',
  startName: 'Work Related',
  items: [{ item: { ...savedItem, pinned: false }, saved: savedItem }],
  startedAt: '2026-10-21T08:00:00.000Z',
};

export const limitedBilling = {
  mode: 'limited',
  windows: [{ start: '2026-09-02', end: '2026-11-01', repeatYearly: true }],
  interval: 'month',
  intervalCount: 1,
};

export const customSub = {
  id: customSubId,
  name: 'Local Gym',
  link: 'https://gym.example.com',
  cancelUrl: 'https://gym.example.com/cancel',
  plans: [
    {
      id: customPlanId,
      name: 'Basic',
      features: { 'streaming.ad-free': true, 'streaming.concurrent-streams': 2 },
      price: { amount: 29.99, currency: 'CAD', interval: 'month', intervalCount: 1, plusTax: true },
      autoRenewAvailable: true,
    },
  ],
  ...stamps,
};

export const ranking = { rankKey: 'video.quality=4k', rank: 'unwanted', ...stamps };

export const tag = { id: tagId, name: 'Family', color: '#1e88e5', ...stamps };

export const card = {
  id: cardId,
  name: 'Simplii Cashback Mastercard',
  nickname: 'Everyday',
  type: 'credit',
  network: 'mastercard',
  currency: 'CAD',
  cashbackPercent: 1.5,
  fxFeePercent: 2.5,
  monthlyLimit: 500,
  ...stamps,
};

export const settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  salesTaxPercent: 13,
  monthlyBudget: 200,
  annualBudget: 1000,
  theme: 'system',
  updatedAt: '2026-10-20T09:15:00.000Z',
};

const fullCatalog: CatalogSnapshot = (() => {
  const data = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');
  return {
    data,
    meta: buildCatalogMeta(data, {
      catalogVersion: 'abc1234',
      generatedAt: '2026-10-23T12:00:00Z',
    }),
  };
})();

/** The test catalog's Canadian file, data/catalog/CA.json, as the app caches it. */
export const catalogCache = {
  key: 'CA',
  snapshot: regionSnapshot(fullCatalog, 'CA'),
  fetchedAt: '2026-10-23T12:30:00.000Z',
};

/** The full data/catalog.json, cached for a buyer whose region has no file of its own. */
export const fullCatalogCache = {
  key: 'catalog',
  snapshot: fullCatalog,
  fetchedAt: '2026-10-23T12:30:00.000Z',
};

/** The last exchange rates fetched, for a Canadian (GET /fx's example). */
export const fxCache = {
  key: 'fx',
  rates: {
    base: 'CAD',
    date: '2026-10-21',
    source: 'European Central Bank via Frankfurter',
    rates: { EUR: 0.664, USD: 0.7243 },
  },
  fetchedAt: '2026-10-22T06:00:02.000Z',
};
