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
    const expected = {
      ...fields,
      key: 'settings',
      // New settings: every shared one has just changed (M10.7).
      sharedUpdatedAt: '2026-10-25T12:00:00.000Z',
      updatedAt: '2026-10-25T12:00:00.000Z',
    };
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
      // The budget, a shared setting, went too.
      sharedUpdatedAt: '2026-10-25T12:00:00.001Z',
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
      {
        ...fields,
        key: 'settings',
        sharedUpdatedAt: '2026-10-25T12:00:00.000Z',
        updatedAt: '2026-10-25T12:00:00.000Z',
      },
    ]);
  });

  describe('update', () => {
    it('changes some settings, keeps the rest, and clears one set to undefined', async () => {
      await repository.save(fields);
      storage.clock.time = '2026-10-26T08:00:00.000Z';
      const updated = await repository.update({ theme: 'dark', monthlyBudget: undefined });
      expect(updated).toEqual({
        country: 'CA',
        subdivision: 'CA-ON',
        currency: 'CAD',
        theme: 'dark',
        key: 'settings',
        // The budget, shared, was cleared with it.
        sharedUpdatedAt: '2026-10-26T08:00:00.000Z',
        updatedAt: '2026-10-26T08:00:00.000Z',
      });
      expect(await storedRows(storage.indexedDB, 'settings')).toEqual([updated]);
    });

    it('keeps when the shared settings last changed through a change to the theme alone (M10.7)', async () => {
      await repository.save(fields);
      storage.clock.time = '2026-10-26T08:00:00.000Z';
      const updated = await repository.update({ theme: 'dark' });
      expect(updated).toMatchObject({
        sharedUpdatedAt: '2026-10-25T12:00:00.000Z',
        updatedAt: '2026-10-26T08:00:00.000Z',
      });
    });

    it('writes nothing before the first run', async () => {
      expect(await repository.update({ theme: 'dark' })).toBeUndefined();
      expect(await storedRows(storage.indexedDB, 'settings')).toEqual([]);
    });

    it('writes nothing over settings it cannot read, and leaves them for the first run', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const unreadable = { key: 'settings', country: 'Canada' };
      await plantRows(storage.indexedDB, 'settings', [unreadable]);
      expect(await repository.update({ theme: 'dark' })).toBeUndefined();
      expect(await storedRows(storage.indexedDB, 'settings')).toEqual([unreadable]);
    });

    it('refuses a change that makes the settings invalid', async () => {
      const saved = await repository.save(fields);
      await expect(repository.update({ subdivision: 'US-NY' })).rejects.toThrow(
        'Invalid settings record settings: subdivision: custom',
      );
      expect(await storedRows(storage.indexedDB, 'settings')).toEqual([saved]);
    });
  });
});
