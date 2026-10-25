import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { RankingsRepository } from './rankings-repository';
import { plantRows, storedRows, testStorage, until, type TestStorage } from './storage.testing';

describe('RankingsRepository', () => {
  let storage: TestStorage;
  let rankings: RankingsRepository;

  beforeEach(async () => {
    storage = testStorage();
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    rankings = TestBed.inject(RankingsRepository);
    await until(() => rankings.status() === 'ready');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with no ranks', () => {
    expect(rankings.ranks()).toEqual(new Map());
  });

  it('ranks a key, keyed by the rank key', async () => {
    await rankings.set('video.quality=4k', 'unwanted');
    await until(() => rankings.ranks().size === 1);
    expect(rankings.ranks().get('video.quality=4k')).toBe('unwanted');
    expect(await storedRows(storage.indexedDB, 'rankings')).toEqual([
      {
        rankKey: 'video.quality=4k',
        rank: 'unwanted',
        createdAt: '2026-10-25T12:00:00.000Z',
        updatedAt: '2026-10-25T12:00:00.000Z',
      },
    ]);
  });

  it('changes a rank', async () => {
    await rankings.set('streaming.ad-free', 'wanted');
    storage.clock.time = '2026-10-26T08:00:00.000Z';
    await rankings.set('streaming.ad-free', 'needed');
    await until(() => rankings.ranks().get('streaming.ad-free') === 'needed');
    expect(await storedRows(storage.indexedDB, 'rankings')).toEqual([
      expect.objectContaining({
        rank: 'needed',
        createdAt: '2026-10-25T12:00:00.000Z',
        updatedAt: '2026-10-26T08:00:00.000Z',
      }),
    ]);
  });

  it('clears a rank by soft-deleting it, never storing not-ranked', async () => {
    await rankings.set('streaming.ad-free', 'wanted');
    await until(() => rankings.ranks().size === 1);
    storage.clock.time = '2026-10-26T08:00:00.000Z';
    await rankings.clear('streaming.ad-free');
    await until(() => rankings.ranks().size === 0);
    expect(await storedRows(storage.indexedDB, 'rankings')).toEqual([
      expect.objectContaining({ rank: 'wanted', deletedAt: '2026-10-26T08:00:00.000Z' }),
    ]);
  });

  it('ranks a cleared key again', async () => {
    await rankings.set('streaming.ad-free', 'wanted');
    await rankings.clear('streaming.ad-free');
    storage.clock.time = '2026-10-27T08:00:00.000Z';
    await rankings.set('streaming.ad-free', 'unused');
    await until(() => rankings.ranks().get('streaming.ad-free') === 'unused');
    const [stored] = await storedRows(storage.indexedDB, 'rankings');
    expect(stored).toEqual({
      rankKey: 'streaming.ad-free',
      rank: 'unused',
      createdAt: '2026-10-25T12:00:00.000Z',
      updatedAt: '2026-10-27T08:00:00.000Z',
    });
  });

  it('refuses a rank that only an item can have', async () => {
    await expect(rankings.set('streaming.ad-free', 'essential' as never)).rejects.toThrow(
      'Invalid rankings record streaming.ad-free: rank: invalid_value',
    );
    expect(await storedRows(storage.indexedDB, 'rankings')).toEqual([]);
  });

  it('hides a ranking it cannot read, and replaces it when the key is ranked again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = { rankKey: 'streaming.ad-free', rank: 'loved', createdAt: 'x', updatedAt: 'x' };
    await plantRows(storage.indexedDB, 'rankings', [broken]);
    await until(() => rankings.ranks().size === 0);
    await rankings.set('streaming.ad-free', 'wanted');
    await until(() => rankings.ranks().get('streaming.ad-free') === 'wanted');
    expect(await storedRows(storage.indexedDB, 'rankings')).toEqual([
      expect.objectContaining({ rank: 'wanted', createdAt: '2026-10-25T12:00:00.000Z' }),
    ]);
  });
});
