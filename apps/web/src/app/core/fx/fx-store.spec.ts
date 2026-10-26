import { TestBed } from '@angular/core/testing';
import type { FxCache, FxRates, Settings } from '@simply-sub/core';
import { SettingsStore } from '../settings/settings-store';
import { FxRatesRepository } from '../storage/fx-rates-repository';
import { RejectedRecords } from '../storage/rejected-records';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../storage/storage.testing';
import { FxStore } from './fx-store';

const canadian: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

/** GET /fx's data on a given day: the example's CAD rates, or the USD ones. */
function ratesIn(base: string, date = '2026-10-21'): FxRates {
  const rates: Record<string, number> =
    base === 'CAD' ? { EUR: 0.664, USD: 0.7243 } : { CAD: 1.3806, EUR: 0.9167 };
  return { base, date, source: 'European Central Bank via Frankfurter', rates };
}

function stored(rates: FxRates, fetchedAt = '2026-10-24T12:00:00.000Z'): FxCache {
  return { key: 'fx', rates, fetchedAt };
}

/** The Worker's /fx: the rates of the day per base, or an error, and the requests the app made. */
class FakeFx {
  readonly requests: string[] = [];
  date = '2026-10-21';
  down = false;
  status = 200;
  hold?: Promise<void>;

  readonly fetch = async (url: string): Promise<Response> => {
    this.requests.push(url);
    await this.hold;
    if (this.down) throw new TypeError('Failed to fetch');
    if (this.status !== 200) {
      return Response.json({ error: { code: 'upstream_unavailable' } }, { status: this.status });
    }
    const base = new URLSearchParams(url.split('?')[1]).get('base') ?? '';
    return Response.json({
      data: ratesIn(base, this.date),
      meta: { fetchedAt: '2026-10-22T06:00:02Z', stale: false },
    });
  };
}

describe('FxStore', () => {
  let storage: TestStorage;
  let server: FakeFx;

  beforeEach(() => {
    storage = testStorage();
    server = new FakeFx();
    vi.stubGlobal('fetch', server.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function start({
    settings,
    rates,
  }: { settings?: Settings; rates?: FxCache } = {}): Promise<FxStore> {
    if (settings) await plantRows(storage.indexedDB, 'settings', [settings]);
    if (rates) await plantRows(storage.indexedDB, 'fxRates', [rates]);
    TestBed.configureTestingModule({ providers: storage.providers });
    return TestBed.inject(FxStore);
  }

  const storedRates = async () =>
    ((await storedRows(storage.indexedDB, 'fxRates')) as FxCache[]).map(
      ({ rates }) => `${rates.base} ${rates.date}`,
    );

  it('fetches nothing before the first run, then the rates in the chosen currency', async () => {
    const store = await start();
    await until(() => TestBed.inject(SettingsStore).status() === 'ready');
    expect(server.requests).toEqual([]);

    await TestBed.inject(SettingsStore).save({ country: 'CA', currency: 'CAD', theme: 'system' });
    await until(() => store.rates() !== undefined);
    expect(store.rates()).toEqual(ratesIn('CAD'));
    expect(server.requests).toEqual(['api/v1/fx?base=CAD']);
    await vi.waitFor(async () => expect(await storedRates()).toEqual(['CAD 2026-10-21']));
  });

  it('gives the stored rates at once, before the fetch answers', async () => {
    server.hold = new Promise(() => undefined);
    const store = await start({ settings: canadian, rates: stored(ratesIn('CAD', '2026-10-20')) });
    await until(() => store.rates() !== undefined && server.requests.length === 1);
    expect(store.rates()?.date).toBe('2026-10-20');
  });

  it("writes nothing when the rates haven't changed", async () => {
    const save = vi.spyOn(FxRatesRepository.prototype, 'save');
    const store = await start({ settings: canadian, rates: stored(ratesIn('CAD')) });
    await until(() => server.requests.length === 1);
    await store.refresh();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps a new day's rates", async () => {
    server.date = '2026-10-22';
    const store = await start({ settings: canadian, rates: stored(ratesIn('CAD')) });
    await until(() => store.rates()?.date === '2026-10-22');
    await vi.waitFor(async () => expect(await storedRates()).toEqual(['CAD 2026-10-22']));
  });

  it("fetches the new currency's rates, converting with the old ones meanwhile", async () => {
    const store = await start({ settings: canadian, rates: stored(ratesIn('CAD')) });
    await until(() => server.requests.length === 1);
    server.hold = new Promise(() => undefined);
    await TestBed.inject(SettingsStore).update({ currency: 'USD' });
    await until(() => server.requests.length === 2);
    expect(server.requests[1]).toBe('api/v1/fx?base=USD');
    expect(store.rates()?.base).toBe('CAD');
  });

  it('keeps the stored rates offline, and fetches again when back online', async () => {
    server.down = true;
    const store = await start({ settings: canadian, rates: stored(ratesIn('CAD', '2026-10-20')) });
    await until(() => server.requests.length === 1);
    await store.refresh();
    expect(store.rates()?.date).toBe('2026-10-20');

    server.down = false;
    window.dispatchEvent(new Event('online'));
    await until(() => store.rates()?.date === '2026-10-21');
  });

  it('keeps the stored rates when the Worker has none to give', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    server.status = 502;
    const store = await start({ settings: canadian, rates: stored(ratesIn('CAD', '2026-10-20')) });
    await until(() => server.requests.length === 1);
    await store.refresh();
    expect(store.rates()?.date).toBe('2026-10-20');
    expect(warn).toHaveBeenCalledWith("Exchange rates for CAD aren't available: 502");
  });

  it('fetches again when a tab is shown, and the browser cache decides whether that sends anything', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const store = await start({ settings: canadian });
    await until(() => store.rates() !== undefined);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(server.requests).toHaveLength(2));
  });

  it("keeps rates it couldn't save in this tab", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(FxRatesRepository.prototype, 'save').mockRejectedValue(
      new DOMException('Quota exceeded', 'QuotaExceededError'),
    );
    const store = await start({ settings: canadian });
    await until(() => store.rates() !== undefined);
    expect(store.rates()).toEqual(ratesIn('CAD'));
    expect(await storedRates()).toEqual([]);
  });

  it("fetches again in place of stored rates that fail their schema, and doesn't tell the user", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = { ...stored(ratesIn('CAD')), fetchedAt: 'yesterday' };
    const store = await start({ settings: canadian, rates: broken as FxCache });
    await until(() => store.rates() !== undefined);
    await vi.waitFor(async () => expect(await storedRates()).toEqual(['CAD 2026-10-21']));
    expect(TestBed.inject(RejectedRecords).count()).toBe(0);
  });
});
