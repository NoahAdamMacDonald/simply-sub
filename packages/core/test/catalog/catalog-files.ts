import type { Bundle, CatalogSourceFile, Categories, Feature, Price, Provider } from '../../src';
import { pngBytes, withValue } from './helpers';

// A small catalog that passes validateCatalog, with the data patterns of the real one: GLOBAL prices in several
// currencies, a plan sold in one region only, a free plan, a prepaid service, an add-on without grantsPlan and
// suites that include other plans (BLUEPRINT §4.4).

export const today = '2026-10-23';

function price(
  region: string,
  currency: string,
  amount: number,
  interval: Price['interval'] = 'month',
): Price {
  return {
    region,
    currency,
    amount,
    interval,
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
  };
}

const features = [
  {
    id: 'video.quality',
    name: 'Video quality',
    category: 'streaming',
    type: 'enum',
    values: [
      { id: '480p', name: '480p (SD)' },
      { id: '720p', name: '720p (HD)' },
      { id: '1080p', name: '1080p (Full HD)' },
      { id: '4k', name: '4K (Ultra HD)' },
    ],
  },
  { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
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
    id: 'streaming.live',
    name: 'Live TV and sports',
    category: 'streaming',
    type: 'set',
    values: [
      { id: 'tv-channels', name: 'Live TV channels' },
      { id: 'sports', name: 'Live sports' },
    ],
  },
  { id: 'vpn.included', name: 'VPN', category: 'vpn', type: 'boolean' },
  {
    id: 'vpn.devices',
    parent: 'vpn.included',
    name: 'VPN devices',
    category: 'vpn',
    type: 'number',
    unit: 'devices',
    tiers: [
      { id: '1-5', name: '1 to 5 devices', min: 1, max: 5 },
      { id: '6-10', name: '6 to 10 devices', min: 6, max: 10 },
    ],
  },
  {
    id: 'vpn.unlimited-traffic',
    parent: 'vpn.included',
    name: 'Unlimited VPN traffic',
    category: 'vpn',
    type: 'boolean',
  },
  { id: 'storage.cloud', name: 'Cloud storage', category: 'storage', type: 'number', unit: 'GB' },
  {
    id: 'account.users',
    name: 'People included',
    category: 'account',
    type: 'number',
    tiers: [{ id: '2-5', name: '2 to 5 people', min: 2, max: 5 }],
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

const categories = {
  service: [
    { id: 'streaming', name: 'Streaming video', icon: 'live_tv' },
    { id: 'vpn', name: 'VPN', icon: 'vpn_lock' },
    { id: 'privacy-suite', name: 'Privacy & security suites', icon: 'shield' },
  ],
  feature: [
    { id: 'streaming', name: 'Streaming' },
    { id: 'vpn', name: 'VPN' },
    { id: 'storage', name: 'Storage' },
    { id: 'account', name: 'Accounts & sharing' },
    { id: 'bundle', name: 'Included services' },
  ],
  spend: [
    { id: 'streaming', name: 'Streaming & digital media' },
    { id: 'software', name: 'Software & online services' },
  ],
} satisfies Categories;

const streaming = {
  website: 'https://example.com',
  category: 'streaming',
  spendCategory: 'streaming',
};

const netflix = {
  id: 'netflix',
  name: 'Netflix',
  ...streaming,
  cancelUrl: 'https://www.netflix.com/cancelplan',
  billingCurrency: { CA: 'CAD', US: 'USD' },
  plans: [
    {
      id: 'netflix.standard-ads',
      name: 'Standard with ads',
      link: 'https://www.netflix.com/signup',
      features: { 'video.quality': '1080p', 'streaming.concurrent-streams': 2 },
      prices: [price('CA', 'CAD', 7.99), price('US', 'USD', 8.99)],
    },
    {
      id: 'netflix.standard',
      name: 'Standard',
      link: 'https://www.netflix.com/signup',
      features: {
        'video.quality': '1080p',
        'streaming.ad-free': true,
        'streaming.concurrent-streams': 2,
      },
      featureLabels: { 'streaming.concurrent-streams=2-4': 'Two screens' },
      prices: [price('CA', 'CAD', 18.99), price('US', 'USD', 19.99)],
      addOnIds: ['netflix.extra-member'],
      addOnLimit: 1,
    },
    {
      // Sold in the US only.
      id: 'netflix.premium',
      name: 'Premium',
      link: 'https://www.netflix.com/signup',
      features: { 'video.quality': '4k', 'streaming.ad-free': true },
      prices: [price('US', 'USD', 26.99)],
    },
  ],
  addOns: [
    {
      id: 'netflix.extra-member',
      name: 'Extra member',
      grantsPlan: 'netflix.standard-ads',
      prices: [price('CA', 'CAD', 7.99)],
    },
  ],
} satisfies Provider;

const crave = {
  id: 'crave',
  name: 'Crave',
  ...streaming,
  cancelUrl: 'https://www.crave.ca/en/account',
  billingCurrency: { CA: 'CAD' },
  plans: [
    {
      id: 'crave.standard',
      name: 'Standard With Ads',
      link: 'https://www.crave.ca/en/subscribe',
      features: { 'streaming.live': ['sports'] },
      prices: [price('CA', 'CAD', 11.99), price('CA', 'CAD', 119.99, 'year')],
      addOnIds: ['crave.starz'],
    },
    {
      id: 'crave.premium',
      name: 'Premium',
      link: 'https://www.crave.ca/en/subscribe',
      features: { 'video.quality': '4k', 'streaming.live': ['tv-channels', 'sports'] },
      prices: [price('CA', 'CAD', 22)],
      addOnIds: ['crave.starz'],
    },
  ],
  // An add-on that gives no plan of its own.
  addOns: [{ id: 'crave.starz', name: 'STARZ', prices: [price('CA', 'CAD', 7.99)] }],
} satisfies Provider;

const mullvad = {
  id: 'mullvad',
  name: 'Mullvad VPN',
  website: 'https://mullvad.net',
  cancelUrl: 'https://mullvad.net/en/help/refunds',
  category: 'vpn',
  spendCategory: 'software',
  billingCurrency: { GLOBAL: 'EUR' },
  plans: [
    {
      id: 'mullvad.vpn',
      name: 'Mullvad VPN',
      link: 'https://mullvad.net/en/pricing',
      features: { 'vpn.included': true, 'vpn.devices': 5, 'vpn.unlimited-traffic': true },
      prices: [
        { ...price('GLOBAL', 'EUR', 5), autoRenew: false },
        { ...price('GLOBAL', 'EUR', 60, 'year'), autoRenew: false },
      ],
    },
  ],
} satisfies Provider;

const vpnPlus = { 'vpn.included': true, 'vpn.devices': 10 };

const proton = {
  id: 'proton',
  name: 'Proton',
  website: 'https://proton.me',
  cancelUrl: 'https://account.proton.me/dashboard',
  category: 'privacy-suite',
  spendCategory: 'software',
  billingCurrency: { GLOBAL: 'USD' },
  plans: [
    {
      id: 'proton.free',
      name: 'Proton Free',
      link: 'https://proton.me/pricing',
      features: { 'storage.cloud': 5, 'vpn.included': true, 'vpn.devices': 1 },
      prices: [price('GLOBAL', 'USD', 0)],
    },
    {
      id: 'proton.vpn-plus',
      name: 'VPN Plus',
      link: 'https://proton.me/pricing',
      features: { 'storage.cloud': 5, ...vpnPlus },
      featureLabels: { 'vpn.devices=6-10': '10 devices' },
      prices: [
        price('GLOBAL', 'USD', 9.99),
        price('GLOBAL', 'CAD', 12.49),
        price('GLOBAL', 'EUR', 9.99),
        price('GLOBAL', 'CHF', 9.99),
      ],
    },
    {
      id: 'proton.unlimited',
      name: 'Proton Unlimited',
      link: 'https://proton.me/pricing',
      features: {
        'storage.cloud': 500,
        ...vpnPlus,
        'includes-subscription': ['proton.vpn-plus'],
      },
      prices: [price('GLOBAL', 'USD', 12.99), price('GLOBAL', 'CAD', 16.24)],
    },
    {
      // Includes Unlimited, and through it VPN Plus.
      id: 'proton.duo',
      name: 'Proton Duo',
      link: 'https://proton.me/pricing',
      features: {
        'account.users': 2,
        'storage.cloud': 2000,
        ...vpnPlus,
        'includes-subscription': ['proton.unlimited'],
      },
      prices: [price('GLOBAL', 'USD', 19.99)],
    },
  ],
} satisfies Provider;

const bundle = {
  id: 'bundle.netflix-crave',
  name: 'Netflix and Crave',
  soldBy: 'crave',
  includes: ['netflix.standard', 'crave.premium'],
  link: 'https://www.crave.ca/en/subscribe',
  prices: [price('CA', 'CAD', 35)],
} satisfies Bundle;

const files: Record<string, unknown> = {
  'data/bundles/netflix-crave.yaml': bundle,
  'data/categories.yaml': categories,
  'data/features.yaml': features,
  'data/providers/crave.yaml': crave,
  'data/providers/mullvad.yaml': mullvad,
  'data/providers/netflix.yaml': netflix,
  'data/providers/proton.yaml': proton,
};

/** A fresh copy of the valid catalog, with a 64-pixel logo for every provider. */
export function catalog(): CatalogSourceFile[] {
  return [
    ...Object.entries(files).map(([file, data]) => ({
      file,
      data: JSON.parse(JSON.stringify(data)) as unknown,
    })),
    ...['crave', 'mullvad', 'netflix', 'proton'].map((id) => ({
      file: `data/logos/${id}.png`,
      bytes: pngBytes(64, 64),
    })),
  ];
}

/** `files` with the value at `path` in one file set, or removed when `value` is undefined. */
export function edited(
  files: readonly CatalogSourceFile[],
  file: string,
  path: (string | number)[],
  value: unknown,
): CatalogSourceFile[] {
  return files.map((source) =>
    source.file === file && 'data' in source
      ? { file, data: withValue(source.data, path, value) }
      : source,
  );
}

/** The valid catalog with one value changed. */
export function catalogWith(file: string, path: (string | number)[], value: unknown) {
  return edited(catalog(), file, path, value);
}
