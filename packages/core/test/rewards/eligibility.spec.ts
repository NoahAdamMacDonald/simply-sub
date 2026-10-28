import { describe, expect, it } from 'vitest';
import { acceptedNetworksIn, cardAcceptance, eligibleCards, type ListItem } from '../../src';
import { customPlanId, customSub, customSubId } from '../user/fixtures';
import { canadian, debitCard, discoverCard, dollarCard, resolved, simplii } from './fixtures';

// Which cards can pay for an item (BLUEPRINT §9.3): the networks its seller takes where it's bought, per region since
// M9.2, every card where they aren't known.

const network = (networks: string[]) => ({
  networks: networks as ('visa' | 'discover')[],
  url: 'https://example.com/payment-methods',
  quotes: ['Visa, Discover'],
});

describe('acceptedNetworksIn', () => {
  it('takes the region’s own, else its group’s, else GLOBAL’s', () => {
    const provider = {
      acceptedNetworks: {
        US: network(['visa', 'discover']),
        EU: network(['visa']),
        GLOBAL: network(['discover']),
      },
    };
    expect(acceptedNetworksIn(provider, 'US')).toEqual(['visa', 'discover']);
    expect(acceptedNetworksIn(provider, 'SE')).toEqual(['visa']);
    expect(acceptedNetworksIn(provider, 'CA')).toEqual(['discover']);
  });

  it('is undefined where they aren’t known', () => {
    expect(
      acceptedNetworksIn({ acceptedNetworks: { US: network(['visa']) } }, 'CA'),
    ).toBeUndefined();
    expect(acceptedNetworksIn({}, 'CA')).toBeUndefined();
  });
});

describe('a resolved item’s networks', () => {
  it('are its provider’s where it’s bought, or a bundle’s seller’s', () => {
    expect(resolved('netflix.standard').acceptedNetworks).toEqual(['visa', 'mastercard', 'amex']);
    expect(resolved('netflix.standard', { region: 'US' }).acceptedNetworks).toContain('discover');
    const bundle = resolved('', {
      source: { kind: 'bundle', bundleId: 'bundle.netflix-crave' },
    });
    expect(bundle.acceptedNetworks).toEqual(['visa', 'mastercard']);
    expect(resolved('proton.vpn-plus').acceptedNetworks).toEqual(['visa', 'mastercard', 'amex']);
  });

  it('aren’t known for a provider that names none, or a custom subscription', () => {
    expect(resolved('mullvad.vpn').acceptedNetworks).toBeUndefined();
    const custom = resolved(
      '',
      { source: { kind: 'custom', customSubId, customPlanId } as ListItem['source'] },
      { ...canadian, customSubs: new Map([[customSubId, customSub as never]]) },
    );
    expect(custom.acceptedNetworks).toBeUndefined();
  });
});

describe('cardAcceptance and eligibleCards', () => {
  it('take a card whose network the seller takes there, and every card where that isn’t known', () => {
    const canada = resolved('netflix.standard');
    const states = resolved('netflix.standard', { region: 'US' });
    expect(cardAcceptance(discoverCard, canada)).toBe('not-accepted');
    expect(cardAcceptance(discoverCard, states)).toBe('accepted');
    expect(cardAcceptance(debitCard, resolved('mullvad.vpn'))).toBe('unknown');
    const cards = [debitCard, simplii, discoverCard, dollarCard];
    expect(eligibleCards(cards, canada)).toEqual([
      { card: simplii, acceptance: 'accepted' },
      { card: dollarCard, acceptance: 'accepted' },
    ]);
    expect(
      eligibleCards(cards, resolved('mullvad.vpn')).map(({ acceptance }) => acceptance),
    ).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
  });
});
