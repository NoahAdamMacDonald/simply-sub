import { describe, expect, it } from 'vitest';
import { customType, typeCounts, type ServiceCategory } from '../../src';

// What types of subscriptions a list has (P3, P4): its items' service categories, most first.

const categories: ServiceCategory[] = [
  { id: 'streaming', name: 'Streaming video', icon: 'live_tv' },
  { id: 'vpn', name: 'VPN', icon: 'vpn_lock' },
  { id: 'privacy-suite', name: 'Privacy & security suites', icon: 'shield' },
];

describe('typeCounts', () => {
  it('counts each item in each of its categories, most first, then by name', () => {
    expect(
      typeCounts(
        [
          { categories: ['streaming'] },
          { categories: ['privacy-suite', 'vpn'] },
          { categories: ['streaming', 'streaming'] },
          { categories: ['vpn'] },
        ],
        categories,
      ),
    ).toEqual([
      { id: 'streaming', name: 'Streaming video', icon: 'live_tv', count: 2 },
      { id: 'vpn', name: 'VPN', icon: 'vpn_lock', count: 2 },
      { id: 'privacy-suite', name: 'Privacy & security suites', icon: 'shield', count: 1 },
    ]);
  });

  it('counts a custom subscription as Custom, and leaves out a category the registry doesn’t name', () => {
    expect(
      typeCounts(
        [
          { categories: [], customSubId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c50' },
          { categories: ['gone'] },
        ],
        categories,
      ),
    ).toEqual([{ ...customType, count: 1 }]);
    expect(typeCounts([], categories)).toEqual([]);
  });
});
