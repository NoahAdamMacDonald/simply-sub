import { describe, expect, it } from 'vitest';
import { planFeatures, withPlanFeatures, withProviderFeatures, type Plan } from '../../src';

const plan = (id: string, features: Plan['features']) =>
  ({ id, name: id, link: 'https://example.com', features, prices: [] }) satisfies Plan;

describe('provider-wide features (M11.4)', () => {
  const provider = {
    features: { platforms: ['web', 'ios'], 'support.channels': ['email'] },
    plans: [
      plan('proton.free', { 'vpn.included': true }),
      plan('proton.unlimited', { 'support.channels': ['email', 'chat'] }),
    ],
  };

  it("gives each plan its provider's features, its own winning", () => {
    expect(planFeatures(provider.plans[0], provider)).toEqual({
      platforms: ['web', 'ios'],
      'support.channels': ['email'],
      'vpn.included': true,
    });
    expect(planFeatures(provider.plans[1], provider)).toEqual({
      platforms: ['web', 'ios'],
      'support.channels': ['email', 'chat'],
    });
    expect(planFeatures(provider.plans[0], {})).toBe(provider.plans[0].features);
  });

  it('merges every plan, keeps the provider’s own, and changes nothing a second time', () => {
    const merged = withPlanFeatures(provider);
    expect(merged.features).toBe(provider.features);
    expect(merged.plans[0].features['platforms']).toEqual(['web', 'ios']);
    expect(withPlanFeatures(merged)).toEqual(merged);
    const without = { plans: provider.plans };
    expect(withPlanFeatures(without)).toBe(without);
  });

  it('merges a catalog once, and leaves one without provider features as it is', () => {
    const catalog = { providers: [provider], version: 1 };
    const merged = withProviderFeatures(catalog);
    expect(merged.version).toBe(1);
    expect(merged.providers[0].plans[1].features['platforms']).toEqual(['web', 'ios']);
    expect(withProviderFeatures(catalog)).toBe(merged);
    expect(withProviderFeatures(merged)).toBe(merged);
    const plain = { providers: [{ plans: provider.plans }] };
    expect(withProviderFeatures(plain)).toBe(plain);
  });
});
