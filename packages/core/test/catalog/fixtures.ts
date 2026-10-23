import type { Bundle, Categories, Feature, Price, Provider } from '../../src';

// Valid catalog files, shaped like the examples in docs/api-output-examples.json. `satisfies` also checks
// that the types inferred from the schemas accept them.

function monthly(region: string, currency: string, amount: number): Price {
  return {
    region,
    currency,
    amount,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-14',
  };
}

export const features = [
  {
    id: 'streaming.ad-free',
    name: 'Ad free',
    category: 'streaming',
    type: 'boolean',
    aliases: ['no ads', 'ad-free'],
  },
  {
    id: 'video.quality',
    name: 'Video quality',
    category: 'streaming',
    type: 'enum',
    values: [
      { id: '720p', name: '720p (HD)' },
      { id: '1080p', name: '1080p (Full HD)', headline: true },
      { id: '4k', name: '4K (Ultra HD)', aliases: ['uhd', '2160p'], headline: true },
    ],
  },
  {
    id: 'streaming.concurrent-streams',
    name: 'Simultaneous streams',
    category: 'streaming',
    type: 'number',
    unit: 'devices',
    tiers: [
      { id: '1', name: 'Single device', min: 1, max: 1 },
      { id: '2-4', name: '2 to 4 devices', min: 2, max: 4 },
      { id: '5+', name: 'More than 4 devices', min: 5 },
    ],
  },
  {
    id: 'password-manager',
    name: 'Password manager',
    category: 'security',
    type: 'boolean',
    headline: true,
  },
  {
    id: 'password-manager.item-types',
    parent: 'password-manager',
    name: 'Storable item types',
    category: 'security',
    type: 'set',
    values: [
      { id: 'login', name: 'Logins', aliases: ['passwords'] },
      { id: 'passkey', name: 'Passkeys' },
      { id: 'email-alias', name: 'Email aliases' },
    ],
  },
  {
    id: 'includes-subscription',
    name: 'Includes another subscription',
    category: 'bundle',
    type: 'set',
    valuesFrom: 'providers',
    rankable: false,
  },
] satisfies Feature[];

export const categories = {
  service: [{ id: 'streaming', name: 'Streaming video', icon: 'live_tv' }],
  feature: [{ id: 'streaming', name: 'Streaming' }],
  spend: [{ id: 'streaming', name: 'Streaming & digital media' }],
} satisfies Categories;

export const provider = {
  id: 'netflix',
  name: 'Netflix',
  aliases: ['netflix'],
  website: 'https://www.netflix.com',
  category: 'streaming',
  spendCategory: 'streaming',
  acceptedNetworks: ['visa', 'mastercard', 'amex'],
  billingCurrency: { CA: 'CAD', US: 'USD' },
  cancelUrl: 'https://www.netflix.com/cancelplan',
  sources: { pricing: 'https://help.netflix.com/en/node/24926' },
  notes: 'Prices are illustrative.',
  plans: [
    {
      id: 'netflix.standard-ads',
      name: 'Standard with ads',
      link: 'https://www.netflix.com/signup',
      features: {
        'video.quality': '1080p',
        'streaming.ad-free': false,
        'streaming.concurrent-streams': 2,
      },
      prices: [
        { ...monthly('CA', 'CAD', 7.99), sourceUrl: 'https://help.netflix.com/en/node/24926' },
        monthly('US', 'USD', 7.99),
      ],
    },
    {
      id: 'netflix.premium',
      name: 'Premium',
      features: {
        'video.quality': '4k',
        'streaming.ad-free': true,
        'streaming.concurrent-streams': 'unlimited',
        'password-manager.item-types': ['login', 'email-alias'],
        'includes-subscription': ['proton.pass-plus'],
      },
      featureLabels: { 'password-manager.item-types=email-alias': 'Hide-my-email aliases' },
      perks: ['Mobile games'],
      notes: 'Ultra HD needs a 4K screen.',
      prices: [monthly('CA', 'CAD', 23.99), { ...monthly('CA', 'CAD', 239.88), interval: 'year' }],
      addOnIds: ['netflix.extra-member'],
      addOnLimit: 2,
    },
  ],
  addOns: [
    {
      id: 'netflix.extra-member',
      name: 'Extra member',
      grantsPlan: 'netflix.standard-ads',
      prices: [monthly('CA', 'CAD', 7.99)],
    },
  ],
} satisfies Provider;

export const bundle = {
  id: 'bundle.disney-crave-premium',
  name: 'Disney+ Premium & Crave Premium',
  soldBy: 'crave',
  includes: ['disney-plus.premium', 'crave.premium'],
  link: 'https://www.crave.ca/en/bundles',
  cancelUrl: 'https://www.crave.ca/en/account',
  prices: [monthly('CA', 'CAD', 29.99)],
} satisfies Bundle;
