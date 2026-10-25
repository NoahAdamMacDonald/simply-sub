import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { Settings } from '@simply-sub/core';
import { SettingsRepository } from './settings-repository';
import { plantRows, storedRows, testStorage, until, type TestStorage } from './storage.testing';

const fields: Omit<Settings, 'key' | 'updatedAt'> = {
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  monthlyBudget: 200,
  theme: 'system',
};

describe('SettingsRepository', () => {
  let storage: TestStorage;
  let repository: SettingsRepository;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    repository = TestBed.inject(SettingsRepository);
    await until(() => repository.status() === 'ready');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has no settings before the first run saves them', () => {
    expect(repository.settings()).toBeUndefined();
  });

  it('saves the settings as one record', async () => {
    const saved = await repository.save(fields);
    const expected = { ...fields, key: 'settings', updatedAt: '2026-10-25T12:00:00.000Z' };
    expect(saved).toEqual(expected);
    await until(() => repository.settings() !== undefined);
    expect(repository.settings()).toEqual(expected);
    expect(await storedRows(storage.indexedDB, 'settings')).toEqual([expected]);
  });

  it('replaces the saved settings, and drops fields that are left out', async () => {
    await repository.save(fields);
    storage.clock.time = '2026-10-24T12:00:00.000Z';
    await repository.save({ ...fields, monthlyBudget: undefined, theme: 'dark' });
    await until(() => repository.settings()?.theme === 'dark');
    expect(repository.settings()).toEqual({
      country: 'CA',
      subdivision: 'CA-ON',
      currency: 'CAD',
      theme: 'dark',
      key: 'settings',
      // The clock went back, so updatedAt moves a millisecond forward.
      updatedAt: '2026-10-25T12:00:00.001Z',
    });
  });

  it('refuses invalid settings and keeps the saved ones', async () => {
    const saved = await repository.save(fields);
    await expect(repository.save({ ...fields, subdivision: 'US-NY' })).rejects.toThrow(
      'Invalid settings record settings: subdivision: custom',
    );
    expect(await storedRows(storage.indexedDB, 'settings')).toEqual([saved]);
  });

  it('hides settings it cannot read, so the first run asks again, and replaces them', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await plantRows(storage.indexedDB, 'settings', [{ key: 'settings', country: 'Canada' }]);
    await until(() => repository.status() === 'ready');
    expect(repository.settings()).toBeUndefined();
    await repository.save(fields);
    await until(() => repository.settings() !== undefined);
    expect(await storedRows(storage.indexedDB, 'settings')).toEqual([
      { ...fields, key: 'settings', updatedAt: '2026-10-25T12:00:00.000Z' },
    ]);
  });
});
