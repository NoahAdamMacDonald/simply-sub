import { describe, expect, it } from 'vitest';
import {
  filterRanking,
  keyUsage,
  rankingSections,
  type Category,
  type Feature,
  type ProfileRanks,
  type RankingEntry,
  type RankingSection,
} from '../../src';

// The Features page's model (PROJECT-PLAN P9) over a small registry: VPN (a parent, with its devices' tiers and a kill
// switch), streaming's video quality and Ad free, a password manager (a parent, with a set of item types), dark web
// monitoring, and includes-subscription, which isn't rankable.

const registry: Feature[] = [
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
  {
    id: 'vpn.included',
    name: 'VPN',
    category: 'vpn',
    type: 'boolean',
    aliases: ['virtual private network'],
  },
  {
    id: 'vpn.devices',
    parent: 'vpn.included',
    name: 'VPN devices',
    category: 'vpn',
    type: 'number',
    tiers: [
      { id: '1-5', name: '1 to 5 devices', min: 1, max: 5 },
      { id: '6+', name: '6 or more devices', min: 6 },
    ],
  },
  {
    id: 'vpn.kill-switch',
    parent: 'vpn.included',
    name: 'Kill switch',
    category: 'vpn',
    type: 'boolean',
  },
  { id: 'password-manager', name: 'Password manager', category: 'security', type: 'boolean' },
  {
    id: 'password-manager.item-types',
    parent: 'password-manager',
    name: 'Storable item types',
    category: 'security',
    type: 'set',
    values: [
      { id: 'login', name: 'Logins' },
      { id: 'passkey', name: 'Passkeys' },
    ],
  },
  {
    id: 'security.dark-web-monitoring',
    name: 'Dark web monitoring',
    category: 'security',
    type: 'boolean',
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

const categories: Category[] = [
  { id: 'vpn', name: 'VPN' },
  { id: 'streaming', name: 'Streaming' },
  { id: 'security', name: 'Security & passwords' },
  { id: 'ai', name: 'AI' },
  { id: 'bundle', name: 'Included services' },
];

const sections = rankingSections(registry, categories);

/** A section's entries as "name: keys", children indented under their parent. */
function outline(section: RankingSection | undefined): string[] {
  const lines = (entry: RankingEntry, indent: string): string[] => [
    `${indent}${entry.name}: ${entry.rows.map((row) => row.name).join(', ')}`,
    ...entry.children.flatMap((child) => lines(child, `${indent}  `)),
  ];
  return section?.entries.flatMap((entry) => lines(entry, '')) ?? [];
}

const filtered = (text: string, ranks: ProfileRanks = new Map(), rankedOnly = false) =>
  filterRanking(sections, { text, rankedOnly, ranks }).map(
    (section) => `${section.category.name} | ${outline(section).join(' | ')}`,
  );

describe('rankingSections', () => {
  it('has a section per category with something to rank, in the categories’ order', () => {
    expect(sections.map((section) => section.category.id)).toEqual([
      'vpn',
      'streaming',
      'security',
    ]);
  });

  it('puts children under their parent, and gives values and tiers a row each', () => {
    expect(outline(sections[0])).toEqual([
      'VPN: VPN',
      '  VPN devices: 1 to 5 devices, 6 or more devices',
      '  Kill switch: Kill switch',
    ]);
    expect(outline(sections[1])).toEqual([
      'Video quality: 1080p (Full HD), 4K (Ultra HD)',
      'Ad free: Ad free',
    ]);
    expect(outline(sections[2])).toEqual([
      'Password manager: Password manager',
      '  Storable item types: Logins, Passkeys',
      'Dark web monitoring: Dark web monitoring',
    ]);
  });

  it('names each row alone for its dropdown, and marks a boolean as one row', () => {
    const [quality, adFree] = sections[1].entries;
    expect(quality.rows.map((row) => [row.key, row.label])).toEqual([
      ['video.quality=1080p', 'Video quality: 1080p (Full HD)'],
      ['video.quality=4k', 'Video quality: 4K (Ultra HD)'],
    ]);
    expect([quality.single, adFree.single]).toEqual([false, true]);
    expect(adFree.rows[0].label).toBe('Ad free');
  });

  it('lists the keys a parent’s Set all ranks, and every key of a section', () => {
    expect(sections[0].entries[0].childKeys).toEqual([
      'vpn.devices=1-5',
      'vpn.devices=6+',
      'vpn.kill-switch',
    ]);
    expect(sections[1].entries[0].childKeys).toEqual([]);
    expect(sections[2].keys).toEqual([
      'password-manager',
      'password-manager.item-types=login',
      'password-manager.item-types=passkey',
      'security.dark-web-monitoring',
    ]);
  });

  it('puts a child whose parent isn’t rankable on its own', () => {
    const orphan = rankingSections(
      [
        {
          id: 'pm',
          name: 'Password manager',
          category: 'security',
          type: 'boolean',
          rankable: false,
        },
        { id: 'pm.sharing', parent: 'pm', name: 'Sharing', category: 'security', type: 'boolean' },
      ],
      categories,
    );
    expect(outline(orphan[0])).toEqual(['Sharing: Sharing']);
  });
});

describe('filterRanking', () => {
  it('keeps everything with no text and Ranked only off', () => {
    expect(filterRanking(sections, { text: '  ', ranks: new Map() })).toEqual(sections);
  });

  it('keeps the rows a value’s name or alias matches, under their feature', () => {
    expect(filtered('4k')).toEqual(['Streaming | Video quality: 4K (Ultra HD)']);
    expect(filtered('uhd')).toEqual(['Streaming | Video quality: 4K (Ultra HD)']);
    expect(filtered('passkeys')).toEqual([
      'Security & passwords | Password manager:  |   Storable item types: Passkeys',
    ]);
  });

  it('keeps all of a feature its name or alias matches, a parent’s children too', () => {
    expect(filtered('video')).toEqual([
      'Streaming | Video quality: 1080p (Full HD), 4K (Ultra HD)',
    ]);
    expect(filtered('virtual private')).toEqual([
      'VPN | VPN: VPN |   VPN devices: 1 to 5 devices, 6 or more devices |   Kill switch: Kill switch',
    ]);
  });

  it('keeps a parent as a heading over a child that matches', () => {
    expect(filtered('kill')).toEqual(['VPN | VPN:  |   Kill switch: Kill switch']);
  });

  it('matches from the start of a word, and finds nothing for text nothing has', () => {
    // "web" starts a word of Dark web monitoring; "eb" starts none.
    expect(filtered('web')).toEqual([
      'Security & passwords | Dark web monitoring: Dark web monitoring',
    ]);
    expect(filtered('eb')).toEqual([]);
  });

  it('keeps only ranked keys with Ranked only, with or without text', () => {
    const ranks: ProfileRanks = new Map([
      ['video.quality=4k', 'needed'],
      ['vpn.kill-switch', 'wanted'],
      ['password-manager', 'uses'],
    ]);
    expect(filtered('', ranks, true)).toEqual([
      'VPN | VPN:  |   Kill switch: Kill switch',
      'Streaming | Video quality: 4K (Ultra HD)',
      'Security & passwords | Password manager: Password manager',
    ]);
    expect(filtered('vpn', ranks, true)).toEqual(['VPN | VPN:  |   Kill switch: Kill switch']);
  });

  it('keeps only the keys an item provides, for the item dialog', () => {
    const keys = new Set(['vpn.included', 'video.quality=1080p', 'streaming.ad-free']);
    expect(
      filterRanking(sections, { ranks: new Map(), keys }).map(
        (section) => `${section.category.name} | ${outline(section).join(' | ')}`,
      ),
    ).toEqual(['VPN | VPN: VPN', 'Streaming | Video quality: 1080p (Full HD) | Ad free: Ad free']);
  });

  it('leaves Set all’s keys and a section’s keys whole', () => {
    const [vpn] = filterRanking(sections, { text: 'kill', ranks: new Map() });
    expect(vpn.entries[0].childKeys).toEqual(sections[0].entries[0].childKeys);
    expect(vpn.keys).toEqual(sections[0].keys);
  });
});

describe('keyUsage', () => {
  it('counts the items that provide each key, a plan listed twice twice', () => {
    const usage = keyUsage([
      { providedKeys: ['vpn.included', 'vpn.kill-switch'] },
      { providedKeys: ['vpn.included'] },
      { providedKeys: [] },
    ]);
    expect([...usage]).toEqual([
      ['vpn.included', 2],
      ['vpn.kill-switch', 1],
    ]);
  });
});
