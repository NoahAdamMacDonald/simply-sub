import { TestBed } from '@angular/core/testing';
import { IDBKeyRange } from 'fake-indexeddb';
import { INDEXED_DB } from '../storage/storage-service';
import { testStorage, until } from '../storage/storage.testing';
import { SettingsStore, type SettingsValues } from './settings-store';

const ontario: SettingsValues = {
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  theme: 'system',
};

describe('SettingsStore', () => {
  let store: SettingsStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testStorage().providers });
    store = TestBed.inject(SettingsStore);
  });

  it("doesn't ask for the first run while the settings load", () => {
    TestBed.tick();
    expect(store.status()).toBe('loading');
    expect(store.needsFirstRun()).toBe(false);
  });

  it('asks for the first run once they have loaded and none are saved', async () => {
    await until(() => store.status() === 'ready');
    expect(store.needsFirstRun()).toBe(true);
    await store.save(ontario);
    await until(() => store.saved() !== undefined);
    expect(store.needsFirstRun()).toBe(false);
  });

  it('gives the sales tax the saved settings lead to', async () => {
    await until(() => store.status() === 'ready');
    expect(store.salesTax()).toBeUndefined();

    await store.save(ontario);
    await until(() => store.salesTax() !== undefined);
    expect(store.salesTax()).toEqual({ percent: 13, source: 'built-in' });

    await store.update({ salesTaxPercent: 5 });
    await until(() => store.salesTax()?.source === 'own');
    expect(store.salesTax()).toEqual({ percent: 5, source: 'own' });

    await store.update({ country: 'GB', subdivision: undefined, currency: 'GBP' });
    await until(() => store.saved()?.country === 'GB');
    expect(store.salesTax()).toBeUndefined();
  });

  it('has an error status, and asks nothing, when IndexedDB is blocked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.resetTestingModule();
    const blocked = {
      open: () => {
        throw new DOMException('The user denied permission', 'SecurityError');
      },
    };
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: INDEXED_DB, useValue: { indexedDB: blocked, IDBKeyRange } },
      ],
    });
    store = TestBed.inject(SettingsStore);
    await until(() => store.status() === 'error');
    expect(store.needsFirstRun()).toBe(false);
    vi.restoreAllMocks();
  });
});
