import { describe, expect, it } from 'vitest';
import {
  customFeatureChoices,
  customIconUrl,
  customSubChange,
  customSubFormFor,
  customSubFormIssues,
  customSubFromForm,
  customSubscriptionSchema,
  customSubUsage,
  featureMatches,
  isFeatureValue,
  newCustomPlan,
  newCustomSubForm,
  parseAmount,
  type CustomSubForm,
  type CustomSubscription,
  type Feature,
  type ListItem,
} from '../../src';
import { listId } from './fixtures';

const gymId = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c';
const basicId = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d';
const premiumId = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1e';
const otherList = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

/** Local Gym: Basic at $29.99 a month, ad free, and Premium at $49.99 every 3 months. */
const gym: CustomSubscription = {
  id: gymId,
  name: 'Local Gym',
  link: 'https://www.localgym.ca/join',
  plans: [
    {
      id: basicId,
      name: 'Basic',
      features: { 'streaming.ad-free': true },
      price: { amount: 29.99, currency: 'CAD', interval: 'month', intervalCount: 1 },
      autoRenewAvailable: true,
    },
    {
      id: premiumId,
      name: 'Premium',
      features: {},
      price: { amount: 49.99, currency: 'CAD', interval: 'month', intervalCount: 3, plusTax: true },
      autoRenewAvailable: false,
    },
  ],
  ...stamps,
};

let itemCount = 0;
function item(customPlanId: string, list = listId, extra: Partial<ListItem> = {}): ListItem {
  itemCount++;
  return {
    id: `0192f1c4-7b2e-7c3a-9d41-${String(itemCount).padStart(12, '0')}`,
    listId: list,
    source: { kind: 'custom', customSubId: gymId, customPlanId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-01',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...stamps,
    ...extra,
  };
}

const registry: Feature[] = [
  { id: 'streaming.ad-free', name: 'Ad free', category: 'streaming', type: 'boolean' },
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
  {
    id: 'streaming.concurrent-streams',
    name: 'Simultaneous streams',
    aliases: ['screens'],
    category: 'streaming',
    type: 'number',
    unit: 'devices',
  },
  {
    id: 'vpn.protocols',
    name: 'VPN protocols',
    category: 'vpn',
    type: 'set',
    values: [
      { id: 'wireguard', name: 'WireGuard' },
      { id: 'openvpn', name: 'OpenVPN' },
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
];

describe('the custom subscription form', () => {
  it('starts with one plan to fill in, monthly, in the user’s currency', () => {
    expect(newCustomSubForm(basicId, 'CAD')).toEqual({
      name: '',
      link: '',
      cancelUrl: '',
      plans: [newCustomPlan(basicId, 'CAD')],
    });
    expect(newCustomPlan(basicId, 'CAD')).toMatchObject({
      amount: '',
      interval: 'month',
      intervalCount: 1,
      autoRenewAvailable: true,
    });
  });

  it('gives back the custom subscription it was made from', () => {
    const { name, link, plans } = gym;
    expect(customSubFromForm(customSubFormFor(gym))).toEqual({ name, link, plans });
  });

  it('saves the name, links and plan names trimmed, and leaves out links not given', () => {
    const form: CustomSubForm = {
      name: '  Local Gym ',
      link: ' ',
      cancelUrl: ' https://www.localgym.ca/cancel ',
      plans: [{ ...newCustomPlan(basicId, 'CAD'), name: ' Basic ', amount: ' 0 ' }],
    };
    const fields = customSubFromForm(form);
    expect(fields).toEqual({
      name: 'Local Gym',
      cancelUrl: 'https://www.localgym.ca/cancel',
      plans: [
        {
          id: basicId,
          name: 'Basic',
          features: {},
          price: { amount: 0, currency: 'CAD', interval: 'month', intervalCount: 1 },
          autoRenewAvailable: true,
        },
      ],
    });
    expect(customSubscriptionSchema.safeParse({ id: gymId, ...stamps, ...fields }).success).toBe(
      true,
    );
  });
});

describe('customSubFormIssues', () => {
  it('passes a subscription with a name and a plan with a name, cost and period', () => {
    expect(customSubFormIssues(customSubFormFor(gym))).toEqual([]);
  });

  it('needs a name, and links that are full https:// addresses', () => {
    const form = {
      ...customSubFormFor(gym),
      name: ' ',
      link: 'localgym.ca',
      cancelUrl: 'http://localgym.ca',
    };
    expect(customSubFormIssues(form)).toEqual([
      { path: ['name'], message: 'Give it a name' },
      { path: ['link'], message: 'Use a full address that starts with https://' },
      { path: ['cancelUrl'], message: 'Use a full address that starts with https://' },
    ]);
  });

  it('needs at least one plan', () => {
    expect(customSubFormIssues({ ...customSubFormFor(gym), plans: [] })).toEqual([
      { path: ['plans'], message: 'Add at least one plan' },
    ]);
  });

  it('needs each plan’s name, once, a cost of 0 or more, a currency and a period of 1 to 120', () => {
    const [basic, premium] = customSubFormFor(gym).plans;
    const form = {
      ...customSubFormFor(gym),
      plans: [
        { ...basic, name: '', amount: '' },
        { ...premium, name: 'premium ', amount: '-1', currency: '', intervalCount: 0 },
        { ...newCustomPlan(gymId, 'CAD'), name: 'Premium', amount: '0', intervalCount: 1.5 },
      ],
    };
    expect(customSubFormIssues(form)).toEqual([
      { path: ['plans', 0, 'name'], message: 'Give the plan a name' },
      { path: ['plans', 0, 'amount'], message: 'Enter what it costs, 0 or more' },
      { path: ['plans', 1, 'amount'], message: 'Enter what it costs, 0 or more' },
      { path: ['plans', 1, 'currency'], message: 'Choose a currency' },
      { path: ['plans', 1, 'intervalCount'], message: 'Enter a whole number from 1 to 120' },
      { path: ['plans', 2, 'name'], message: 'Another plan has this name' },
      { path: ['plans', 2, 'intervalCount'], message: 'Enter a whole number from 1 to 120' },
    ]);
  });
});

describe('parseAmount', () => {
  it('reads digits with a decimal point at most, as typed', () => {
    expect(parseAmount('29.99')).toBe(29.99);
    expect(parseAmount(' 29 ')).toBe(29);
    expect(parseAmount('29.')).toBe(29);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('0')).toBe(0);
  });

  it('reads nothing else', () => {
    for (const typed of ['', '.', '-1', '1,99', '1e3', '0x10', 'ten', '1.2.3']) {
      expect(parseAmount(typed)).toBeUndefined();
    }
  });
});

describe('customSubUsage', () => {
  it('counts the items and lists that use it, and each plan’s items, leaving deleted items out', () => {
    const items = [
      item(basicId),
      item(basicId, otherList),
      item(premiumId),
      item(premiumId, listId, { deletedAt: '2026-10-21T12:00:00.000Z' }),
      { ...item(basicId), source: { kind: 'catalog' as const, planId: 'netflix.standard' } },
    ];
    const usage = customSubUsage(gymId, items);
    expect(usage.items).toBe(3);
    expect(usage.lists).toBe(2);
    expect([...usage.plans]).toEqual([
      [basicId, 2],
      [premiumId, 1],
    ]);
    expect(customSubUsage(premiumId, items)).toEqual({ items: 0, lists: 0, plans: new Map() });
  });
});

describe('customSubChange', () => {
  const items = [item(basicId), item(basicId, otherList), item(premiumId)];

  it('counts the items whose plan changed, and the ones whose plan was removed, with their lists', () => {
    const [basic] = gym.plans;
    const after = { plans: [{ ...basic, price: { ...basic.price, amount: 31.99 } }] };
    expect(customSubChange(gym, after, items)).toEqual({ changed: 2, removed: 1, removedLists: 1 });
  });

  it('counts nothing for plans that are the same, whatever their features’ order, or that no item uses', () => {
    const [basic, premium] = gym.plans;
    const after = {
      plans: [
        { ...basic, features: { 'streaming.ad-free': true } },
        premium,
        {
          ...premium,
          id: '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1f',
          name: 'Family',
        },
      ],
    };
    expect(customSubChange(gym, after, items)).toEqual({ changed: 0, removed: 0, removedLists: 0 });
    expect(customSubChange(gym, { plans: [basic] }, [item(basicId)])).toEqual({
      changed: 0,
      removed: 0,
      removedLists: 0,
    });
  });

  it('counts a change of features, renewal or tax as a change', () => {
    const [basic, premium] = gym.plans;
    for (const changed of [
      { ...basic, features: {} },
      { ...basic, autoRenewAvailable: false },
      { ...basic, price: { ...basic.price, plusTax: true } },
      { ...basic, name: 'Basic+' },
    ]) {
      expect(customSubChange(gym, { plans: [changed, premium] }, items).changed).toBe(2);
    }
  });
});

describe('the features a custom plan lists', () => {
  it('can be any rankable feature but a set of provider ids', () => {
    expect(customFeatureChoices(registry).map((feature) => feature.id)).toEqual([
      'streaming.ad-free',
      'video.quality',
      'streaming.concurrent-streams',
      'vpn.protocols',
    ]);
  });

  it('are found as Search finds them, leaving out the ones listed already', () => {
    const choices = customFeatureChoices(registry);
    const ids = (text: string, listed = {}) =>
      featureMatches(choices, text, listed).map((feature) => feature.id);
    expect(ids('')).toHaveLength(4);
    expect(ids('ad')).toEqual(['streaming.ad-free']);
    expect(ids('screen')).toEqual(['streaming.concurrent-streams']);
    expect(ids('vpn')).toEqual(['vpn.protocols']);
    expect(ids('', { 'streaming.ad-free': true })).not.toContain('streaming.ad-free');
  });

  it('take a value their type allows', () => {
    const [adFree, quality, streams, protocols] = customFeatureChoices(registry);
    expect(isFeatureValue(adFree, true)).toBe(true);
    expect(isFeatureValue(adFree, false)).toBe(false);
    expect(isFeatureValue(quality, '4k')).toBe(true);
    expect(isFeatureValue(quality, '8k')).toBe(false);
    expect(isFeatureValue(streams, 2)).toBe(true);
    expect(isFeatureValue(streams, 'unlimited')).toBe(true);
    expect(isFeatureValue(streams, -1)).toBe(false);
    expect(isFeatureValue(protocols, ['wireguard'])).toBe(true);
    expect(isFeatureValue(protocols, [])).toBe(false);
    expect(isFeatureValue(protocols, ['wireguard', 'wireguard'])).toBe(false);
    expect(isFeatureValue(protocols, ['ikev2'])).toBe(false);
  });
});

describe('customIconUrl', () => {
  it('asks GET /icon for the link’s domain, or nothing without a link', () => {
    expect(customIconUrl('https://www.LocalGym.ca/join?x=1')).toBe(
      'api/v1/icon?domain=www.localgym.ca',
    );
    expect(customIconUrl('https://user@localgym.ca:8443/')).toBe('api/v1/icon?domain=localgym.ca');
    expect(customIconUrl(undefined)).toBeUndefined();
  });
});
