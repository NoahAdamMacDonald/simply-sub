import { describe, expect, it } from 'vitest';
import { addRequestParams, readAddRequest, type AddRequest } from '../../src';

const standard: AddRequest = {
  kind: 'plan',
  planId: 'netflix.standard',
  interval: 'month',
  intervalCount: 1,
};

describe('addRequestParams', () => {
  it("writes a plan's id and the period clicked, as P7's URL has them", () => {
    expect(addRequestParams(standard)).toEqual({ add: 'netflix.standard', interval: 'month' });
    expect(addRequestParams({ ...standard, interval: 'year' })).toEqual({
      add: 'netflix.standard',
      interval: 'year',
    });
  });

  it('writes a bundle as addBundle, and a count for a period of more than one', () => {
    expect(
      addRequestParams({
        kind: 'bundle',
        bundleId: 'bundle.crave-ads-tsn',
        interval: 'month',
        intervalCount: 3,
      }),
    ).toEqual({ addBundle: 'bundle.crave-ads-tsn', interval: 'month', count: '3' });
  });
});

describe('readAddRequest', () => {
  it('reads back what addRequestParams writes', () => {
    const bundle: AddRequest = {
      kind: 'bundle',
      bundleId: 'bundle.disney-hulu',
      interval: 'month',
      intervalCount: 3,
    };
    for (const request of [standard, { ...standard, interval: 'year' as const }, bundle]) {
      expect(readAddRequest(addRequestParams(request))).toEqual(request);
    }
  });

  it('takes a missing period as a month, and the first of a repeated parameter', () => {
    expect(readAddRequest({ add: 'netflix.standard' })).toEqual(standard);
    expect(
      readAddRequest({ add: ['netflix.standard', 'crave.premium'], interval: 'month' }),
    ).toEqual(standard);
  });

  it('reads nothing from a URL without one, with both, or with a value that isn’t one', () => {
    expect(readAddRequest({})).toBeUndefined();
    expect(
      readAddRequest({ add: 'netflix.standard', addBundle: 'bundle.disney-hulu' }),
    ).toBeUndefined();
    expect(readAddRequest({ add: 'Netflix Standard' })).toBeUndefined();
    expect(readAddRequest({ addBundle: 'disney-hulu' })).toBeUndefined();
    expect(readAddRequest({ add: 'netflix.standard', interval: 'fortnight' })).toBeUndefined();
    for (const count of ['0', '-1', '1.5', 'three', '121']) {
      expect(readAddRequest({ add: 'netflix.standard', count }), count).toBeUndefined();
    }
  });
});

describe('a reseller’s price in the request', () => {
  const amazon: AddRequest = {
    kind: 'plan',
    planId: 'mullvad.vpn',
    interval: 'month',
    intervalCount: 12,
    price: { amount: 87, currency: 'CAD', plusTax: true },
  };

  it('is written after the period, with plusTax only when tax is added to it', () => {
    expect(addRequestParams(amazon)).toEqual({
      add: 'mullvad.vpn',
      interval: 'month',
      count: '12',
      price: '87',
      currency: 'CAD',
      plusTax: '1',
    });
    const included = { ...amazon, price: { amount: 27.5, currency: 'EUR', plusTax: false } };
    expect(addRequestParams(included)).toEqual({
      add: 'mullvad.vpn',
      interval: 'month',
      count: '12',
      price: '27.5',
      currency: 'EUR',
    });
  });

  it('reads back as it was written', () => {
    expect(readAddRequest(addRequestParams(amazon))).toEqual(amazon);
    const included = { ...amazon, price: { amount: 27.5, currency: 'EUR', plusTax: false } };
    expect(readAddRequest(addRequestParams(included))).toEqual(included);
  });

  it('rejects a price that isn’t above 0, one without a currency, and one on a bundle', () => {
    const params = addRequestParams(amazon);
    for (const broken of [
      { ...params, price: '0' },
      { ...params, price: '-5' },
      { ...params, price: '8,7' },
      { ...params, price: 'free' },
      { ...params, currency: 'cad' },
      { add: 'mullvad.vpn', price: '87' },
      { add: 'mullvad.vpn', currency: 'CAD' },
      { addBundle: 'bundle.disney-hulu', price: '87', currency: 'CAD' },
    ]) {
      expect(readAddRequest(broken)).toBeUndefined();
    }
  });
});
