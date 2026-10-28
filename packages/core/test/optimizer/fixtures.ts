import {
  actionTitle,
  optimize,
  resolveItem,
  type Billing,
  type Bundle,
  type CatalogData,
  type Feature,
  type ListItem,
  type OptimizerResult,
  type Price,
  type ProfileRank,
  type ResolvedItem,
  type SnapshotProvider,
} from '../../src';

// A small catalog for the optimizer's fixtures (BLUEPRINT §10.5), with prices that never change: streaming services
// with an extra-member add-on, yearly prices and a bundle; Proton's plans with a suite; and Mullvad, priced in euros
// with tax included. Today is fixed; the buyer is in Alberta (5% GST).

export const today = '2026-10-28';
export const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';

function price(
  amount: number,
  interval: Price['interval'] = 'month',
  extra: Partial<Price> = {},
): Price {
  return {
    region: 'CA',
    currency: 'CAD',
    amount,
    interval,
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-01',
    ...extra,
  };
}

const features: Feature[] = [
  {
    id: 'video.quality',
    name: 'Video quality',
    category: 'streaming',
    type: 'enum',
    values: [
      { id: '1080p', name: '1080p (Full HD)' },
      { id: '4k', name: '4K (Ultra HD)' },
    ],
  },
  { id: 'video.hdr', name: 'HDR', category: 'streaming', type: 'boolean' },
  { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
  { id: 'vpn.included', name: 'VPN', category: 'vpn', type: 'boolean' },
  { id: 'vpn.multi-hop', name: 'Multi-hop', category: 'vpn', type: 'boolean' },
  {
    id: 'email.addresses',
    name: 'Email addresses',
    category: 'email',
    type: 'number',
    tiers: [
      { id: '1', name: '1 address', min: 1 },
      { id: '10-plus', name: '10 or more', min: 10 },
    ],
  },
  {
    id: 'storage.cloud',
    name: 'Cloud storage',
    category: 'storage',
    type: 'number',
    unit: 'GB',
    tiers: [{ id: '100-plus', name: '100 GB or more', min: 100 }],
  },
  { id: 'password-manager', name: 'Password manager', category: 'security', type: 'boolean' },
  {
    id: 'account.users',
    name: 'Users',
    category: 'account',
    type: 'number',
    tiers: [{ id: '2-plus', name: '2 or more', min: 2 }],
  },
  {
    id: 'includes-subscription',
    name: 'Includes another subscription',
    category: 'bundle',
    type: 'set',
    valuesFrom: 'providers',
    rankable: false,
  },
];

function provider(
  id: string,
  name: string,
  category: string,
  plans: SnapshotProvider['plans'],
  extra: Partial<SnapshotProvider> = {},
): SnapshotProvider {
  return {
    id,
    name,
    website: `https://${id}.example.com`,
    category,
    spendCategory: 'streaming',
    cancelUrl: `https://${id}.example.com/cancel`,
    plans,
    ...extra,
  };
}

function plan(
  id: string,
  name: string,
  planFeatures: SnapshotProvider['plans'][number]['features'],
  prices: Price[],
  extra: Partial<SnapshotProvider['plans'][number]> = {},
): SnapshotProvider['plans'][number] {
  return { id, name, link: `https://example.com/${id}`, features: planFeatures, prices, ...extra };
}

const unlimitedFeatures = {
  'email.addresses': 15,
  'vpn.included': true,
  'vpn.multi-hop': true,
  'password-manager': true,
  'storage.cloud': 500,
};

const providers: SnapshotProvider[] = [
  provider(
    'netflix',
    'Netflix',
    'streaming',
    [
      plan('netflix.standard-ads', 'Standard with ads', { 'video.quality': '1080p' }, [
        price(7.99),
      ]),
      plan(
        'netflix.standard',
        'Standard',
        { 'video.quality': '1080p', 'streaming.ad-free': true },
        [price(18.99)],
        { addOnIds: ['netflix.extra-member-ads', 'netflix.extra-member'], addOnLimit: 1 },
      ),
      plan(
        'netflix.premium',
        'Premium',
        { 'video.quality': '4k', 'video.hdr': true, 'streaming.ad-free': true },
        [price(23.99)],
        { addOnIds: ['netflix.extra-member-ads', 'netflix.extra-member'], addOnLimit: 2 },
      ),
    ],
    {
      addOns: [
        {
          id: 'netflix.extra-member-ads',
          name: 'Extra member (with ads)',
          grantsPlan: 'netflix.standard-ads',
          prices: [price(5.99)],
        },
        {
          id: 'netflix.extra-member',
          name: 'Extra member',
          grantsPlan: 'netflix.standard',
          prices: [price(7.99)],
        },
      ],
    },
  ),
  provider('disney-plus', 'Disney+', 'streaming', [
    plan(
      'disney-plus.standard',
      'Standard',
      { 'video.quality': '1080p', 'streaming.ad-free': true },
      [price(12.99), price(129.99, 'year')],
    ),
    plan(
      'disney-plus.premium',
      'Premium',
      { 'video.quality': '4k', 'video.hdr': true, 'streaming.ad-free': true },
      [price(16.99), price(169.99, 'year')],
    ),
  ]),
  provider('crave', 'Crave', 'streaming', [
    plan('crave.premium', 'Premium', { 'video.quality': '4k', 'streaming.ad-free': true }, [
      price(22),
    ]),
  ]),
  provider('proton', 'Proton', 'privacy-suite', [
    plan('proton.free', 'Free', { 'email.addresses': 1 }, [price(0)]),
    plan('proton.mail-plus', 'Mail Plus', { 'email.addresses': 10 }, [
      price(6.24),
      price(59.88, 'year'),
    ]),
    plan('proton.vpn-plus', 'VPN Plus', { 'vpn.included': true, 'vpn.multi-hop': true }, [
      price(12.49),
      price(104.88, 'year'),
    ]),
    plan('proton.pass-plus', 'Pass Plus', { 'password-manager': true }, [
      price(6.24),
      price(47.88, 'year'),
    ]),
    plan(
      'proton.unlimited',
      'Unlimited',
      {
        ...unlimitedFeatures,
        'includes-subscription': ['proton.mail-plus', 'proton.vpn-plus', 'proton.pass-plus'],
      },
      [price(16.49), price(155.88, 'year')],
    ),
    plan(
      'proton.duo',
      'Duo',
      { ...unlimitedFeatures, 'account.users': 2, 'includes-subscription': ['proton.unlimited'] },
      [price(29.99), price(287.88, 'year')],
    ),
  ]),
  provider('ivpn', 'IVPN', 'vpn', [
    plan('ivpn.standard', 'Standard', { 'vpn.included': true }, [price(8.1)]),
    plan('ivpn.pro', 'Pro', { 'vpn.included': true, 'vpn.multi-hop': true }, [price(12.2)]),
  ]),
  provider(
    'mullvad',
    'Mullvad',
    'vpn',
    [
      plan('mullvad.vpn', 'VPN', { 'vpn.included': true }, [
        price(5, 'month', {
          region: 'GLOBAL',
          currency: 'EUR',
          taxIncluded: { quote: 'Including VAT.' },
        }),
      ]),
    ],
    { billingCurrency: { GLOBAL: 'EUR' } },
  ),
];

const bundles: Bundle[] = [
  {
    id: 'bundle.disney-crave-premium',
    name: 'Disney+ and Crave Premium Bundle',
    soldBy: 'crave',
    includes: ['disney-plus.premium', 'crave.premium'],
    link: 'https://crave.example.com/bundle',
    prices: [price(29.25)],
  },
];

export const catalog: CatalogData = {
  schemaVersion: 1,
  features,
  categories: {
    service: [
      { id: 'streaming', name: 'Streaming video', icon: 'live_tv' },
      { id: 'vpn', name: 'VPN', icon: 'vpn_lock' },
      { id: 'privacy-suite', name: 'Privacy & security suites', icon: 'shield' },
    ],
    feature: [{ id: 'streaming', name: 'Streaming' }],
    spend: [{ id: 'streaming', name: 'Streaming & digital media' }],
  },
  providers,
  bundles,
  resellers: [],
  policyTopics: [],
};

/** 1 EUR is 1.5625 CAD. */
export const fx = { base: 'CAD', date: '2026-10-27', source: 'ECB', rates: { EUR: 0.64 } };

let nextId = 0;

/** A list item on a catalog plan or bundle, billed monthly from Nov 10 unless `billing` says otherwise. */
export function item(
  plan: string,
  billing: Partial<Billing> = {},
  extra: Partial<ListItem> = {},
): ListItem {
  return {
    id: `0192f1c5-1c2d-7e3f-8a4b-${String(++nextId).padStart(12, '0')}`,
    listId,
    source: plan.startsWith('bundle.')
      ? { kind: 'bundle', bundleId: plan }
      : { kind: 'catalog', planId: plan },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-10',
      autoRenew: true,
      ...billing,
    } as Billing,
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...extra,
  };
}

const context = (ranks: Record<string, ProfileRank>) => ({
  today,
  country: 'CA',
  currency: 'CAD',
  fx,
  place: { country: 'CA', subdivision: 'CA-AB' },
  profileRanks: new Map(Object.entries(ranks)),
});

/** The items resolved as MetricsService would, with the profile's ranks. */
export function resolveAll(
  items: readonly ListItem[],
  ranks: Record<string, ProfileRank> = {},
): ResolvedItem[] {
  return items.map((listItem) => {
    const resolution = resolveItem(listItem, {
      catalog,
      customSubs: new Map(),
      ...context(ranks),
      taxPlace: context(ranks).place,
    });
    if (!resolution.ok) throw new Error(`${listItem.id}: ${resolution.unresolved.reason}`);
    return resolution.resolved;
  });
}

/** optimize for a list of `items`, with the profile's ranks. */
export function run(
  items: readonly ListItem[],
  ranks: Record<string, ProfileRank> = {},
): OptimizerResult {
  return optimize({
    items: resolveAll(items, ranks),
    catalogs: new Map([['CA', catalog]]),
    context: context(ranks),
  });
}

/** Each card in a line: its section, its changes, what it saves and what it loses or gains. */
export function cards(result: OptimizerResult): string[] {
  return result.suggestions.map((suggestion) => {
    const lost = [
      ...suggestion.lostServices.map((service) => service.name),
      ...suggestion.lost.map((change) => `${change.key} (${change.rank})`),
    ];
    const gained = suggestion.gained.map((change) => change.key);
    return [
      suggestion.severity,
      suggestion.actions.map(actionTitle).join(' + '),
      `save ${suggestion.savings.toFixed(2)}`,
      ...(suggestion.estimated ? ['estimated'] : []),
      ...(lost.length > 0 ? [`lose ${lost.join(', ')}`] : []),
      ...(gained.length > 0 ? [`gain ${gained.join(', ')}`] : []),
    ].join(' | ');
  });
}
