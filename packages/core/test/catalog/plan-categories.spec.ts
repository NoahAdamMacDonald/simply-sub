import { describe, expect, it } from 'vitest';
import { planCategories, providerCategories } from '../../src';

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
