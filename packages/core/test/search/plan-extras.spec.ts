import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  planExtras,
  readCatalogSource,
  regionSnapshot,
  type CatalogData,
  type CatalogSourceFile,
  type ExtrasContext,
  type FxRates,
} from '../../src';
import { catalog, edited } from '../catalog/catalog-files';

// The fixture catalog (catalog-files.ts): Netflix Standard has an extra-member add-on priced in Canada only, the
// bundle is Netflix Standard with Crave Premium for CA$35, and Proton Unlimited is a suite that includes VPN Plus.

const fx: FxRates = {
  base: 'CAD',
  date: '2026-10-26',
  source: 'European Central Bank via Frankfurter',
  rates: { CHF: 0.581, EUR: 0.664, USD: 0.7243 },
};

const canada: ExtrasContext = { region: 'CA', currency: 'CAD', fx };

function regionData(region: string, files: CatalogSourceFile[] = catalog()): CatalogData {
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  const meta = buildCatalogMeta(data, {
    catalogVersion: '1234567',
    generatedAt: '2026-10-26T12:00:00.000Z',
  });
  return regionSnapshot({ data, meta }, region).data;
}

function extras(
  planId: string,
  context: ExtrasContext = canada,
  data: CatalogData = regionData(context.region),
) {
  const provider = data.providers.find(({ id }) => planId.startsWith(`${id}.`));
  const plan = provider?.plans.find(({ id }) => id === planId);
  if (!provider || !plan) throw new Error(`No plan ${planId}`);
  return planExtras(provider, plan, data, context);
}

describe('planExtras', () => {
  it('prices the add-ons sold with the plan, and leaves out one not sold in the user’s country', () => {
    const { addOns } = extras('netflix.standard');

    expect(
      addOns.map(({ addOn, availability, pricing }) => [addOn.id, availability, pricing[0].amount]),
    ).toEqual([['netflix.extra-member', 'offered', 7.99]]);
    // Netflix has US prices, and the add-on has none there.
    expect(extras('netflix.standard', { region: 'US', currency: 'USD' }).addOns).toEqual([]);
  });

  it('lists the bundles that include the plan, with their plans and what they save', () => {
    const [bundle, ...others] = extras('crave.premium').bundles;

    expect(others).toEqual([]);
    expect(bundle.bundle.id).toBe('bundle.netflix-crave');
    expect(bundle.seller.id).toBe('crave');
    expect(bundle.plans.map(({ provider, plan }) => [provider.id, plan.id])).toEqual([
      ['netflix', 'netflix.standard'],
      ['crave', 'crave.premium'],
    ]);
    expect(bundle.pricing.map((price) => price.amount)).toEqual([35]);
    // CA$18.99 and CA$22 a month, separately.
    expect(bundle.savings).toEqual([
      expect.objectContaining({ interval: 'month', bundlePrice: 35, currency: 'CAD' }),
    ]);
    expect(bundle.savings[0].standaloneTotal).toBeCloseTo(40.99, 10);
    expect(bundle.savings[0].amount).toBeCloseTo(5.99, 10);
    expect(extras('netflix.standard-ads').bundles).toEqual([]);
  });

  it('shows a bundle of unknown availability with its fallback price, and no savings', () => {
    // Crave has no US prices and no availableIn, so its bundle may be sold there.
    const [bundle] = extras('crave.premium', {
      region: 'US',
      currency: 'USD',
      fx: { ...fx, base: 'USD', rates: { CAD: 1.3806 } },
    }).bundles;

    expect(bundle.availability).toBe('unknown');
    expect(bundle.pricing[0]).toMatchObject({
      currency: 'USD',
      source: { region: 'CA', amount: 35 },
    });
    expect(bundle.savings).toEqual([]);
  });

  it('lists what a suite includes, with its savings only when it costs less', () => {
    expect(extras('proton.unlimited').suite).toEqual({
      includes: [
        {
          provider: expect.objectContaining({ id: 'proton' }),
          plan: expect.objectContaining({ id: 'proton.vpn-plus' }),
        },
      ],
      // CA$16.24 is more than VPN Plus's CA$12.49.
      savings: [],
    });

    const cheaper = edited(
      catalog(),
      'data/providers/proton.yaml',
      ['plans', 2, 'prices', 1, 'amount'],
      10,
    );
    const [saving] =
      extras('proton.unlimited', canada, regionData('CA', cheaper)).suite?.savings ?? [];
    expect(saving).toMatchObject({
      interval: 'month',
      standaloneTotal: 12.49,
      bundlePrice: 10,
      currency: 'CAD',
    });
    expect(saving.amount).toBeCloseTo(2.49, 10);
  });

  it('lists a whole provider a suite includes, without savings, and skips what the catalog doesn’t have', () => {
    const files = edited(
      catalog(),
      'data/providers/proton.yaml',
      ['plans', 2, 'features', 'includes-subscription'],
      ['proton.vpn-plus', 'mullvad'],
    );
    const suite = extras('proton.unlimited', canada, regionData('CA', files)).suite;

    expect(suite?.includes.map(({ provider, plan }) => [provider.id, plan?.id])).toEqual([
      ['proton', 'proton.vpn-plus'],
      ['mullvad', undefined],
    ]);
    expect(suite?.savings).toEqual([]);
    expect(extras('netflix.standard').suite).toBeUndefined();
  });
});
