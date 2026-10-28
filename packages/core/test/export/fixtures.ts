import {
  itemStatus,
  nextCharge,
  type Billing,
  type ExportContext,
  type ExportFormat,
  type ExportList,
  type ListItem,
  type PickedPrice,
  type ResolvedItem,
  type SubscriptionList,
  type Tag,
} from '../../src';

// Two lists to export, for an Albertan (5% GST) on Oct 28, 2026:
// - Work Related: Netflix Standard on the 12th, tagged Family and with a tag deleted since; Crave Premium billed on the
//   31st, tagged Work.
// - Family: Mullvad VPN yearly on Jan 20, converted from euros, tax included, renewed by hand; the kids' Disney+
//   Standard on the 5th, ending Feb 1, with a two-line note; and an old plan that's left the catalog.

export const today = '2026-10-28';

const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

export const work: SubscriptionList = {
  id: '0192f1c4-7b2e-7c3a-9d41-000000000001',
  name: 'Work Related',
  ...stamps,
};
export const family: SubscriptionList = {
  id: '0192f1c4-7b2e-7c3a-9d41-000000000002',
  name: 'Family',
  ...stamps,
};

export const familyTag: Tag = {
  id: '0192f1c7-3e4f-7051-ac6d-000000000001',
  name: 'Family',
  color: '#1e88e5',
  ...stamps,
};
export const workTag: Tag = {
  id: '0192f1c7-3e4f-7051-ac6d-000000000002',
  name: 'Work',
  color: '#43a047',
  ...stamps,
};
/** A tag deleted after its item was tagged: exports never name it. */
export const goneTagId = '0192f1c7-3e4f-7051-ac6d-000000000009';

export const context: ExportContext = {
  today,
  currency: 'CAD',
  place: { country: 'CA', subdivision: 'CA-AB' },
  tags: new Map([familyTag, workTag].map((tag) => [tag.id, tag])),
};

const day = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const monthName = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Money and dates as the app writes them for a Canadian. */
export const format: ExportFormat = {
  money: (amount, currency) => amount.toLocaleString('en-CA', { style: 'currency', currency }),
  date: (date) => day.format(new Date(`${date}T00:00:00Z`)),
  month: (month) => monthName.format(new Date(`${month}-01T00:00:00Z`)),
};

function picked(amount: number, extra: Partial<PickedPrice> = {}): PickedPrice {
  return {
    interval: 'month',
    intervalCount: 1,
    amount,
    currency: 'CAD',
    monthlyEquivalent: amount,
    autoRenew: true,
    native: true,
    source: { region: 'CA', amount, currency: 'CAD' },
    ...extra,
  };
}

let nextId = 0;

/** An item as resolveItem gives it, with its status and next charge worked out as the app's are. */
function resolved(
  list: SubscriptionList,
  names: { name: string; planName: string },
  billing: Partial<Billing>,
  price: PickedPrice,
  extra: Partial<ListItem> = {},
): ResolvedItem {
  const item: ListItem = {
    id: `0192f1c5-1c2d-7e3f-8a4b-${String(++nextId).padStart(12, '0')}`,
    listId: list.id,
    source: { kind: 'catalog', planId: 'netflix.standard' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
      ...billing,
    } as Billing,
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...stamps,
    ...extra,
  };
  const base = {
    item,
    listId: list.id,
    ...names,
    region: 'CA',
    price,
    addOns: [],
    monthlyEquivalent: price.monthlyEquivalent,
    features: {},
    categories: [],
    providedKeys: [],
    effectiveRanks: {},
  };
  const next = nextCharge(base, today, context.place);
  return {
    ...base,
    status: itemStatus(item, today, next),
    ...(next && { nextCharge: next }),
  };
}

export const netflix = resolved(
  work,
  { name: 'Netflix', planName: 'Standard' },
  {},
  picked(18.99),
  { tagIds: [familyTag.id, goneTagId] },
);

export const crave = resolved(
  work,
  { name: 'Crave', planName: 'Premium' },
  { anchorDate: '2026-10-31' },
  picked(22),
  { source: { kind: 'catalog', planId: 'crave.premium' }, tagIds: [workTag.id] },
);

export const mullvad = resolved(
  family,
  { name: 'Mullvad VPN', planName: 'Mullvad VPN' },
  { interval: 'year', anchorDate: '2027-01-20', autoRenew: false },
  picked(94.16, {
    interval: 'year',
    monthlyEquivalent: 94.16 / 12,
    native: false,
    taxIncluded: true,
    source: { region: 'EU', amount: 60, currency: 'EUR' },
    fx: { rate: 1.5693, date: '2026-10-21', source: 'ECB' },
  }),
  { source: { kind: 'catalog', planId: 'mullvad.vpn' } },
);

export const disney = resolved(
  family,
  { name: 'Disney+', planName: 'Standard' },
  { anchorDate: '2026-11-05', endDate: '2027-02-01' },
  picked(11.99),
  {
    source: { kind: 'catalog', planId: 'disney.standard' },
    nickname: "Kids'",
    note: 'Shared with\nthe cousins',
  },
);

/** An item whose plan has left the catalog. */
export const oldPlan: ExportList['unresolved'][number] = {
  item: {
    id: '0192f1c5-1c2d-7e3f-8a4b-000000000099',
    listId: family.id,
    source: { kind: 'catalog', planId: 'netflix.basic' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-20',
      autoRenew: true,
    },
    tagIds: [familyTag.id, goneTagId],
    rankOverrides: {},
    pinned: false,
    nickname: 'Old plan',
    ...stamps,
  },
  listId: family.id,
  reason: 'plan-gone',
};

export const workList: ExportList = { list: work, resolved: [netflix, crave], unresolved: [] };
export const familyList: ExportList = {
  list: family,
  resolved: [mullvad, disney],
  unresolved: [oldPlan],
};
