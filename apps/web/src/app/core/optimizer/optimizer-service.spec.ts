import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CatalogData, Settings } from '@simply-sub/core';
import { alberta, fx, searchCatalogData } from '../../shared/sub-card/search.testing';
import { CatalogStore } from '../catalog/catalog-store';
import { FxStore } from '../fx/fx-store';
import { SettingsStore } from '../settings/settings-store';
import { ItemsRepository } from '../storage/items-repository';
import { ListsRepository } from '../storage/lists-repository';
import { testStorage, until } from '../storage/storage.testing';
import { MetricsService } from '../metrics/metrics-service';
import { OptimizerService, inlineLimit } from './optimizer-service';

// The optimizer for a list (P14, P4): its input from the stores, run on the page for a small list and in the worker
// for a bigger one. Tests have no Web Workers, so a big list runs on the page too.

describe('OptimizerService', () => {
  const saved = signal<Settings | undefined>(alberta);

  beforeEach(() => {
    saved.set(alberta);
    TestBed.configureTestingModule({
      providers: [
        testStorage().providers,
        { provide: SettingsStore, useValue: { saved } },
        {
          provide: CatalogStore,
          useValue: {
            catalog: signal<CatalogData | undefined>(searchCatalogData),
            catalogFor: () => searchCatalogData,
          },
        },
        { provide: FxStore, useValue: { rates: signal(fx) } },
      ],
    });
  });

  async function listOf(count: number): Promise<string> {
    const list = await TestBed.inject(ListsRepository).create({ name: 'Work Related' });
    for (let index = 0; index < count; index++) {
      await TestBed.inject(ItemsRepository).create({
        listId: list.id,
        source: { kind: 'catalog', planId: 'netflix.standard' },
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-11-12',
          autoRenew: true,
        },
        tagIds: [],
        rankOverrides: {},
        pinned: false,
      });
    }
    const metrics = TestBed.inject(MetricsService);
    await until(() => metrics.list(list.id).resolved.length === count);
    return list.id;
  }

  it('gives a list’s input once its items are priced: the user’s place, currency and rates, nothing else', async () => {
    const service = TestBed.inject(OptimizerService);
    const listId = await listOf(1);
    const input = service.input(listId);
    expect(input?.items).toHaveLength(1);
    expect(input?.catalogs.get('CA')).toBe(searchCatalogData);
    expect(input?.context).toMatchObject({
      today: '2026-10-25',
      country: 'CA',
      currency: 'CAD',
      fx,
      place: { country: 'CA', subdivision: 'CA-AB' },
    });
    // Only what tax needs of the settings goes to a worker.
    expect(Object.keys(input?.context.place ?? {})).toEqual(['country', 'subdivision']);
    saved.set(undefined);
    expect(service.input(listId)).toBeUndefined();
  });

  it('finds the suggestions of a small list on the page, and of a big one without a worker too', async () => {
    const service = TestBed.inject(OptimizerService);
    const small = service.input(await listOf(1));
    if (!small) throw new Error('No input');
    expect((await service.run(small)).suggestions.length).toBeGreaterThan(0);

    const big = service.input(await listOf(inlineLimit + 1));
    if (!big) throw new Error('No input');
    expect(big.items.length).toBeGreaterThan(inlineLimit);
    const result = await service.run(big);
    expect(result.search).toBeDefined();
    expect(result.next12).toBeGreaterThan(0);
  });
});
