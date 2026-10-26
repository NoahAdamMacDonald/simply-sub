import { describe, expect, it } from 'vitest';
import { featureValueText, planFeatureRows, type Feature } from '../../src';

const quality = {
  id: 'video.quality',
  name: 'Video quality',
  category: 'streaming',
  type: 'enum',
  values: [
    { id: '1080p', name: '1080p (Full HD)' },
    { id: '4k', name: '4K (Ultra HD)' },
  ],
} satisfies Feature;

const adFree = {
  id: 'streaming.ad-free',
  name: 'Ad free',
  category: 'streaming',
  type: 'boolean',
} satisfies Feature;

const streams = {
  id: 'streaming.concurrent-streams',
  name: 'Simultaneous streams',
  category: 'streaming',
  type: 'number',
  unit: 'devices',
  tiers: [
    { id: '1', name: 'Single device', min: 1, max: 1 },
    { id: '2-4', name: '2 to 4 devices', min: 2, max: 4 },
  ],
} satisfies Feature;

const vpn = { id: 'vpn.included', name: 'VPN', category: 'vpn', type: 'boolean' } satisfies Feature;

const protocols = {
  id: 'vpn.protocols',
  parent: 'vpn.included',
  name: 'VPN protocols',
  category: 'vpn',
  type: 'set',
  values: [
    { id: 'wireguard', name: 'WireGuard' },
    { id: 'openvpn', name: 'OpenVPN' },
  ],
} satisfies Feature;

const countries = {
  id: 'vpn.server-countries',
  parent: 'vpn.included',
  name: 'Server countries',
  category: 'vpn',
  type: 'number',
  unit: 'countries',
} satisfies Feature;

const storage = {
  id: 'storage.cloud',
  name: 'Cloud storage',
  category: 'storage',
  type: 'number',
  unit: 'GB',
} satisfies Feature;

const profiles = {
  id: 'streaming.profiles',
  name: 'Profiles',
  category: 'streaming',
  type: 'number',
} satisfies Feature;

const includes = {
  id: 'includes-subscription',
  name: 'Includes another subscription',
  category: 'bundle',
  type: 'set',
  valuesFrom: 'providers',
  rankable: false,
} satisfies Feature;

const registry: Feature[] = [
  quality,
  adFree,
  streams,
  vpn,
  protocols,
  countries,
  storage,
  includes,
];

describe('planFeatureRows', () => {
  it('lists the features in registry order, with their values and the keys they provide', () => {
    const rows = planFeatureRows(
      { 'streaming.concurrent-streams': 4, 'streaming.ad-free': true, 'video.quality': '4k' },
      registry,
    );
    expect(rows).toEqual([
      {
        feature: quality,
        value: '4K (Ultra HD)',
        keys: [
          { key: 'video.quality=1080p', option: '1080p (Full HD)' },
          { key: 'video.quality=4k', option: '4K (Ultra HD)' },
        ],
        children: [],
      },
      { feature: adFree, keys: [{ key: 'streaming.ad-free' }], children: [] },
      {
        feature: streams,
        value: '4 devices',
        keys: [
          { key: 'streaming.concurrent-streams=1', option: 'Single device' },
          { key: 'streaming.concurrent-streams=2-4', option: '2 to 4 devices' },
        ],
        children: [],
      },
    ]);
  });

  it('puts features under their parent when the plan lists it', () => {
    const [row] = planFeatureRows(
      {
        'vpn.included': true,
        'vpn.protocols': ['openvpn', 'wireguard'],
        'vpn.server-countries': 1,
      },
      registry,
    );
    expect(row.feature).toBe(vpn);
    expect(row.children).toEqual([
      {
        feature: protocols,
        value: 'OpenVPN, WireGuard',
        keys: [
          { key: 'vpn.protocols=wireguard', option: 'WireGuard' },
          { key: 'vpn.protocols=openvpn', option: 'OpenVPN' },
        ],
        children: [],
      },
      { feature: countries, value: '1 country', keys: [], children: [] },
    ]);
  });

  it("keeps a child at the top when the plan doesn't list its parent", () => {
    expect(planFeatureRows({ 'vpn.protocols': ['wireguard'] }, registry)).toMatchObject([
      { feature: protocols, children: [] },
    ]);
  });

  it("leaves out values that provide nothing, and features that aren't rankable", () => {
    expect(
      planFeatureRows(
        {
          'streaming.ad-free': false,
          'streaming.concurrent-streams': 0,
          'vpn.protocols': [],
          'includes-subscription': ['proton.mail-plus'],
        },
        registry,
      ),
    ).toEqual([]);
  });

  it('ignores features the registry no longer has', () => {
    expect(planFeatureRows({ 'video.hdr': true }, registry)).toEqual([]);
  });
});

describe('featureValueText', () => {
  it.each([
    { feature: storage, value: 500, expected: '500 GB' },
    { feature: storage, value: 1, expected: '1 GB' },
    { feature: storage, value: 2000, expected: '2,000 GB' },
    { feature: streams, value: 1, expected: '1 device' },
    { feature: streams, value: 'unlimited', expected: 'Unlimited' },
    { feature: countries, value: 140, expected: '140 countries' },
    { feature: countries, value: 1, expected: '1 country' },
    { feature: { ...storage, unit: 'aliases' }, value: 1, expected: '1 alias' },
    { feature: { ...storage, unit: 'addresses' }, value: 1, expected: '1 address' },
    { feature: { ...storage, unit: 'people' }, value: 1, expected: '1 person' },
    { feature: { ...storage, unit: 'people' }, value: 6, expected: '6 people' },
    { feature: { ...storage, id: 'account.users', unit: 'users' }, value: 3, expected: '3 users' },
    { feature: profiles, value: 3, expected: '3' },
    { feature: quality, value: '1080p', expected: '1080p (Full HD)' },
    { feature: protocols, value: ['wireguard', 'stealth'], expected: 'WireGuard, stealth' },
    { feature: adFree, value: true, expected: 'Yes' },
  ])('$feature.id $value: $expected', ({ feature, value, expected }) => {
    expect(featureValueText(feature, value)).toBe(expected);
  });
});
