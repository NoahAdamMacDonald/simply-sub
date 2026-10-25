import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  buildCatalogMeta,
  catalogIds,
  maxBundlePlans,
  readBundlesQuery,
  readCatalogSource,
  readPricingQuery,
  unknownPlans,
} from '../../src';
import { catalog } from '../catalog/catalog-files';

const currencies = ['CAD', 'EUR', 'USD'];

/** A query string's parameters, as Hono's c.req.queries() gives them. Core has no URLSearchParams. */
function queries(search: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const pair of search.split('&').filter(Boolean)) {
    const at = pair.indexOf('=');
    const key = decodeURIComponent(at < 0 ? pair : pair.slice(0, at));
    (result[key] ??= []).push(at < 0 ? '' : decodeURIComponent(pair.slice(at + 1)));
  }
  return result;
}

function pricing(search: string, rates?: string[]) {
  return readPricingQuery(queries(search), {
    route: 'GET /providers/:id',
    ...(rates && { currencies: rates }),
  });
}

function bundles(search: string, rates?: string[]) {
  return readBundlesQuery(queries(search), { ...(rates && { currencies: rates }) });
}

describe('readPricingQuery', () => {
  it("reads nothing as no prices, and a region as its own currency's prices", () => {
    expect(pricing('')).toEqual({ query: {} });
    expect(pricing('region=CA', currencies)).toEqual({ query: { region: 'CA', currency: 'CAD' } });
    expect(pricing('region=CA&currency=USD', currencies)).toEqual({
      query: { region: 'CA', currency: 'USD' },
    });
  });

  it("follows GET /providers' rules: US dollars where the ECB has no rate for the region's currency", () => {
    expect(pricing('region=AE', currencies)).toEqual({ query: { region: 'AE', currency: 'USD' } });
    expect(pricing('region=EU', currencies)).toEqual({ query: { region: 'EU', currency: 'EUR' } });
  });

  it('refuses a currency without a region, an unknown region or currency, and anything else', () => {
    expect(pricing('currency=CAD')).toEqual({
      problems: [
        { param: 'currency', issue: 'Needs region: prices are picked for a region, such as CA.' },
      ],
    });
    expect(pricing('region=CA&currency=JPY&limit=5', currencies)).toEqual({
      problems: [
        { param: 'currency', issue: 'The ECB has no rate for JPY: use one of CAD, EUR, USD.' },
        {
          param: 'limit',
          issue: 'Unknown parameter. GET /providers/:id takes region and currency.',
        },
      ],
    });
    expect(pricing('region=CA&region=US')).toEqual({
      problems: [{ param: 'region', issue: 'Give one value.' }],
    });
    expect(pricing('region=UK')).toMatchObject({
      problems: [{ param: 'region', issue: expect.stringContaining('GB') }],
    });
  });
});

describe('readBundlesQuery', () => {
  it('reads each plan id once, trimmed, with the region and currency', () => {
    expect(bundles('plans=%20netflix.standard,crave.premium,,netflix.standard')).toEqual({
      query: { plans: ['netflix.standard', 'crave.premium'] },
    });
    expect(bundles('region=CA&plans=crave.premium', currencies)).toEqual({
      query: { plans: ['crave.premium'], region: 'CA', currency: 'CAD' },
    });
  });

  it('needs plans: present, not empty, well formed, and at most a few', () => {
    const many = Array.from({ length: maxBundlePlans + 1 }, (_, index) => `netflix.plan-${index}`);

    expect(bundles('region=CA', currencies)).toEqual({
      problems: [
        {
          param: 'plans',
          issue: 'Needed: the plan ids to find bundles for, such as netflix.standard.',
        },
      ],
    });
    expect(bundles('plans=,')).toEqual({
      problems: [{ param: 'plans', issue: 'List at least one plan id, such as netflix.standard.' }],
    });
    expect(bundles('plans=netflix,Crave.Premium')).toEqual({
      problems: [
        {
          param: 'plans',
          issue:
            '"netflix" isn\'t a plan id: use <provider id>.<slug>, such as netflix.standard; "Crave.Premium" isn\'t a plan id: use <provider id>.<slug>, such as netflix.standard.',
        },
      ],
    });
    expect(bundles(`plans=${many.join(',')}`)).toEqual({
      problems: [{ param: 'plans', issue: `List at most ${maxBundlePlans} plan ids.` }],
    });
    expect(bundles('plans=crave.premium&plans=netflix.standard')).toEqual({
      problems: [
        {
          param: 'plans',
          issue: 'Give one plans parameter, with the plan ids separated by commas.',
        },
      ],
    });
  });

  it('names its own parameters when refusing another one', () => {
    expect(bundles('plans=crave.premium&q=crave')).toEqual({
      problems: [
        { param: 'q', issue: 'Unknown parameter. GET /bundles takes plans, region and currency.' },
      ],
    });
  });
});

describe('unknownPlans', () => {
  const data = buildCatalogData(readCatalogSource(catalog()), 'https://sub.simplely.ca/icons/');
  const ids = catalogIds({
    data,
    meta: buildCatalogMeta(data, {
      catalogVersion: 'abc1234',
      generatedAt: '2026-10-24T00:00:00Z',
    }),
  });

  it('names each plan the catalog lacks, with the one it looks like a typo of', () => {
    expect(unknownPlans(['netflix.standrd', 'netflix.ultra'], ids)).toEqual({
      param: 'plans',
      issue:
        '"netflix.standrd" isn\'t a plan (did you mean netflix.standard?); "netflix.ultra" isn\'t a plan.',
    });
  });

  it('names them without suggestions when the ids file is missing', () => {
    expect(unknownPlans(['netflix.standrd'])).toEqual({
      param: 'plans',
      issue: '"netflix.standrd" isn\'t a plan.',
    });
  });
});
