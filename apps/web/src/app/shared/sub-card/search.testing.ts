import { signal } from '@angular/core';
import type { Provider } from '@angular/core';
import type { CatalogData, FxRates, ListItem, Price, Settings } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { FxStore } from '../../core/fx/fx-store';
import { SettingsStore } from '../../core/settings/settings-store';

// A small catalog file for Search's specs, as the app reads it for Canada: Netflix (Premium sold in the US only, an
// extra member add-on), Crave (a bundle with Netflix Standard), Mullvad (one EUR price, cheaper at Amazon.ca in
// Alberta), Proton (a suite, and a price checked long ago) and Hulu (sold in the US only).

export const today = '2026-10-26';

export const alberta: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-AB',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

/** Rates per Canadian dollar: €60 a year is CA$94.16. */
export const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-26',
  source: 'European Central Bank via Frankfurter',
  rates: { EUR: 0.6372, USD: 0.7243 },
};

function price(
  region: string,
  currency: string,
  amount: number,
  extra: Partial<Price> = {},
): Price {
  return {
    region,
    currency,
    amount,
    interval: 'month',
    intervalCount: 1,
    autoRenew: true,
    lastVerified: '2026-10-20',
    ...extra,
  };
}

const streaming = { category: 'streaming', spendCategory: 'streaming' };

/** One rubric for every test topic: the card shows a tier's name, not its rubric. */
const policyTiersText = {
  great: 'Great.',
  good: 'Good.',
  neutral: 'Neutral.',
  poor: 'Poor.',
  bad: 'Bad.',
};

export const searchCatalogData: CatalogData = {
  schemaVersion: 1,
  features: [
    {
      id: 'video.quality',
      name: 'Video quality',
      category: 'streaming',
      type: 'enum',
      values: [
        { id: '1080p', name: '1080p (Full HD)' },
        { id: '4k', name: '4K (Ultra HD)', aliases: ['uhd'] },
      ],
    },
    { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
    { id: 'vpn.included', name: 'VPN', category: 'vpn', type: 'boolean' },
    {
      id: 'includes-subscription',
      name: 'Includes another subscription',
      category: 'bundle',
      type: 'set',
      valuesFrom: 'providers',
      rankable: false,
    },
  ],
  categories: {
    service: [
      { id: 'streaming', name: 'Streaming video', icon: 'live_tv' },
      { id: 'vpn', name: 'VPN', icon: 'vpn_lock' },
    ],
    feature: [
      { id: 'streaming', name: 'Streaming' },
      { id: 'vpn', name: 'VPN' },
      { id: 'bundle', name: 'Included services' },
    ],
    spend: [{ id: 'streaming', name: 'Streaming' }],
  },
  providers: [
    {
      id: 'crave',
      name: 'Crave',
      website: 'https://www.crave.ca',
      cancelUrl: 'https://www.crave.ca/cancel',
      ...streaming,
      plans: [
        {
          id: 'crave.basic',
          name: 'Basic',
          link: 'https://example.com/crave.basic',
          features: { 'video.quality': '1080p' },
          prices: [price('CA', 'CAD', 11.99)],
        },
        {
          id: 'crave.premium',
          name: 'Premium',
          link: 'https://example.com/crave.premium',
          features: { 'video.quality': '4k', 'streaming.ad-free': true },
          perks: ['HBO Max originals'],
          prices: [price('CA', 'CAD', 22)],
        },
      ],
    },
    {
      id: 'hulu',
      name: 'Hulu',
      website: 'https://www.hulu.com',
      cancelUrl: 'https://www.hulu.com/cancel',
      ...streaming,
      availableIn: ['US'],
      plans: [
        {
          id: 'hulu.basic',
          name: 'Basic',
          link: 'https://example.com/hulu.basic',
          features: { 'video.quality': '4k' },
          prices: [price('US', 'USD', 9.99)],
        },
      ],
    },
    {
      id: 'mullvad',
      name: 'Mullvad VPN',
      website: 'https://mullvad.net',
      cancelUrl: 'https://mullvad.net/cancel',
      iconUrl: 'https://sub.simplely.ca/icons/mullvad.webp',
      category: 'vpn',
      spendCategory: 'software',
      plans: [
        {
          id: 'mullvad.vpn',
          name: 'Mullvad VPN',
          link: 'https://example.com/mullvad.vpn',
          features: { 'vpn.included': true },
          prices: [
            price('GLOBAL', 'EUR', 60, {
              interval: 'year',
              autoRenew: false,
              taxIncluded: { quote: 'Including VAT.' },
            }),
          ],
        },
      ],
      resellers: [
        {
          reseller: 'amazon',
          approvedBy: {
            url: 'https://mullvad.net/en/help/partnerships-and-resellers',
            quotes: ['Amazon - CA'],
          },
          offers: [
            {
              plan: 'mullvad.vpn',
              prices: [
                {
                  ...price('CA', 'CAD', 87, { intervalCount: 12, autoRenew: false }),
                  sourceUrl: 'https://www.amazon.ca/dp/B092M5G1G7/',
                },
              ],
            },
          ],
        },
      ],
      policies: {
        links: [
          { name: 'Terms of service', url: 'https://mullvad.net/en/help/terms-service' },
          { name: 'No-logging policy', url: 'https://mullvad.net/en/help/no-logging-data-policy' },
        ],
        ratings: [
          {
            topic: 'service.vpn-logging',
            tier: 'great',
            reason: 'No connection logs, and an audit found none.',
            sources: [
              {
                url: 'https://mullvad.net/en/help/no-logging-data-policy',
                quote: 'We do not keep activity logs of any kind.',
              },
            ],
            lastVerified: '2026-10-22',
          },
          {
            topic: 'legal.disputes',
            tier: 'great',
            reason: 'Swedish courts or the consumer disputes board.',
            sources: [
              {
                url: 'https://mullvad.net/en/help/terms-service',
                quote:
                  'shall be handled by the National Board for Consumer Disputes (ARN) or the Swedish courts',
              },
            ],
            lastVerified: '2026-10-22',
          },
          {
            topic: 'legal.disputes',
            tier: 'bad',
            reason: 'A made-up US rule, for the test.',
            regions: ['US'],
            sources: [{ url: 'https://mullvad.net/en/help/terms-service', quote: 'Any dispute' }],
            lastVerified: '2026-10-22',
          },
        ],
      },
    },
    {
      id: 'netflix',
      name: 'Netflix',
      website: 'https://www.netflix.com',
      cancelUrl: 'https://www.netflix.com/cancelplan',
      iconUrl: 'https://sub.simplely.ca/icons/netflix.webp',
      ...streaming,
      plans: [
        {
          id: 'netflix.standard-ads',
          name: 'Standard with ads',
          link: 'https://example.com/netflix.standard-ads',
          features: { 'video.quality': '1080p' },
          prices: [price('CA', 'CAD', 7.99)],
        },
        {
          id: 'netflix.standard',
          name: 'Standard',
          link: 'https://www.netflix.com/signup/standard',
          features: { 'video.quality': '1080p', 'streaming.ad-free': true },
          prices: [price('CA', 'CAD', 18.99), price('CA', 'CAD', 189.99, { interval: 'year' })],
          addOnIds: ['netflix.extra-member'],
        },
        {
          id: 'netflix.premium',
          name: 'Premium',
          link: 'https://example.com/netflix.premium',
          features: { 'video.quality': '4k', 'streaming.ad-free': true },
          prices: [price('US', 'USD', 26.99)],
        },
      ],
      addOns: [
        { id: 'netflix.extra-member', name: 'Extra member', prices: [price('CA', 'CAD', 7.99)] },
      ],
    },
    {
      id: 'proton',
      name: 'Proton',
      website: 'https://proton.me',
      cancelUrl: 'https://proton.me/cancel',
      category: 'vpn',
      spendCategory: 'software',
      notes: 'One Proton account holds one paid plan.',
      plans: [
        {
          id: 'proton.vpn-plus',
          name: 'VPN Plus',
          link: 'https://example.com/proton.vpn-plus',
          features: { 'vpn.included': true },
          prices: [price('GLOBAL', 'CAD', 12.49)],
        },
        {
          id: 'proton.unlimited',
          name: 'Proton Unlimited',
          link: 'https://example.com/proton.unlimited',
          features: { 'vpn.included': true, 'includes-subscription': ['proton.vpn-plus'] },
          notes: 'Every Proton app, at its paid tier.',
          prices: [price('GLOBAL', 'CAD', 10, { lastVerified: '2026-06-01' })],
        },
      ],
    },
  ],
  bundles: [
    {
      id: 'bundle.netflix-crave',
      name: 'Netflix and Crave',
      soldBy: 'crave',
      includes: ['netflix.standard', 'crave.premium'],
      link: 'https://example.com/bundle',
      prices: [price('CA', 'CAD', 35)],
    },
  ],
  resellers: [
    {
      id: 'amazon',
      name: 'Amazon',
      website: 'https://www.amazon.com',
      domains: ['amazon.ca'],
      iconUrl: 'https://sub.simplely.ca/icons/amazon.webp',
    },
  ],
  policyTopics: [
    {
      id: 'privacy.data-collection',
      name: 'Data collection',
      group: 'privacy',
      question: 'What it collects beyond what the service needs to work.',
      tiers: policyTiersText,
    },
    {
      id: 'legal.disputes',
      name: 'Disputes',
      group: 'legal',
      question: 'Whether you can take a dispute to court.',
      tiers: policyTiersText,
    },
    {
      id: 'service.vpn-logging',
      name: 'VPN logging',
      group: 'service',
      question: 'Whether the VPN keeps logs.',
      tiers: policyTiersText,
      categories: ['vpn'],
    },
  ],
};

let itemCount = 0;

/** A list item for a catalog plan: active, or ended. */
export function listItem(planId: string, listId: string, ended = false): ListItem {
  itemCount += 1;
  return {
    id: `0192f1c4-7b2e-7c3a-9d41-${String(itemCount).padStart(12, '0')}`,
    listId,
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-09-10',
      autoRenew: true,
      ...(ended && { endDate: '2026-10-01' }),
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  };
}

/** The stores a card reads: an Albertan's settings, the catalog above and the rates. */
export function searchStores(): Provider[] {
  return [
    { provide: SettingsStore, useValue: { saved: signal<Settings | undefined>(alberta) } },
    {
      provide: CatalogStore,
      useValue: { catalog: signal<CatalogData | undefined>(searchCatalogData) },
    },
    { provide: FxStore, useValue: { rates: signal<FxRates | undefined>(fx) } },
  ];
}
