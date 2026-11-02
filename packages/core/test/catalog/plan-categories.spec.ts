import { describe, expect, it } from 'vitest';
import { featureNamedCategories, planCategories, providerCategories } from '../../src';

const proton = {
  category: 'privacy-suite',
  plans: [
    { categories: ['privacy-suite', 'vpn', 'storage'] },
    { categories: ['vpn'] },
    {},
    { categories: ['storage'] },
  ],
};

describe('planCategories', () => {
  it('is the plan’s own list, else its provider’s category', () => {
    expect(planCategories(proton.plans[1], proton)).toEqual(['vpn']);
    expect(planCategories(proton.plans[2], proton)).toEqual(['privacy-suite']);
  });
});

describe('providerCategories', () => {
  it('lists every category its plans are in, once, in the order they name them', () => {
    expect(providerCategories(proton)).toEqual(['privacy-suite', 'vpn', 'storage']);
    expect(providerCategories({ category: 'vpn', plans: [{}] })).toEqual(['vpn']);
  });

  it('leaves out the provider’s own category when no plan is in it', () => {
    expect(
      providerCategories({ category: 'privacy-suite', plans: [{ categories: ['vpn'] }] }),
    ).toEqual(['vpn']);
  });
});

describe('featureNamedCategories', () => {
  it('names the categories a plan’s features give, each once with its first feature', () => {
    const unlimited = {
      features: {
        'vpn.included': true,
        'password-manager': true,
        'email.addresses': 15,
        'email.aliases': 'unlimited',
        'storage.cloud': 500,
        'ai.assistant': true,
      },
    };
    expect(featureNamedCategories(unlimited)).toEqual([
      { category: 'vpn', feature: 'vpn.included' },
      { category: 'passwords', feature: 'password-manager' },
      { category: 'email', feature: 'email.addresses' },
      { category: 'storage', feature: 'storage.cloud' },
      { category: 'ai', feature: 'ai.assistant' },
    ]);
  });

  it('leaves out a feature the plan doesn’t give, and one the registry lacks', () => {
    const plan = {
      features: { 'vpn.included': false, 'storage.cloud': 0, 'antivirus.included': true },
    };
    expect(featureNamedCategories(plan)).toEqual([
      { category: 'security', feature: 'antivirus.included' },
    ]);
    expect(featureNamedCategories(plan, (id) => id !== 'antivirus.included')).toEqual([]);
  });
});
