import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  catalogIds,
  catalogIdsSchema,
  readCatalogSource,
  suggestedPlanId,
  suggestedProviderId,
  type CatalogSnapshot,
} from '../../src';
import { catalog } from './catalog-files';
import { issues } from './helpers';

function snapshot(): CatalogSnapshot {
  const data = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');
  return {
    data,
    meta: buildCatalogMeta(data, {
      catalogVersion: 'abc1234',
      generatedAt: '2026-10-24T00:00:00Z',
    }),
  };
}

describe('catalogIds', () => {
  const ids = catalogIds(snapshot());

  it('lists every provider by id with its plan ids, in file order, and the catalog version', () => {
    expect(ids).toEqual({
      data: {
        crave: ['crave.standard', 'crave.premium'],
        mullvad: ['mullvad.vpn'],
        netflix: ['netflix.standard-ads', 'netflix.standard', 'netflix.premium'],
        proton: ['proton.free', 'proton.vpn-plus', 'proton.unlimited', 'proton.duo'],
      },
      meta: { catalogVersion: 'abc1234' },
    });
    expect(issues(catalogIdsSchema, ids)).toEqual([]);
  });

  it('suggests the provider or plan an unknown id looks like a typo of', () => {
    expect(suggestedProviderId('netflx', ids)).toBe('netflix');
    expect(suggestedProviderId('Proton', ids)).toBe('proton');
    expect(suggestedProviderId('streamco', ids)).toBeUndefined();
    expect(suggestedPlanId('netflix.premum', ids)).toBe('netflix.premium');
    expect(suggestedPlanId('netflx.premium', ids)).toBe('netflix.premium');
    expect(suggestedPlanId('proton.business', ids)).toBeUndefined();
  });
});
