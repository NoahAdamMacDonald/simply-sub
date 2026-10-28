import { Service, inject } from '@angular/core';
import {
  optimize,
  type CatalogData,
  type OptimizerInput,
  type OptimizerResult,
} from '@simply-sub/core';
import { CatalogStore } from '../catalog/catalog-store';
import { ClockService } from '../clock/clock-service';
import { FxStore } from '../fx/fx-store';
import { MetricsService } from '../metrics/metrics-service';
import { SettingsStore } from '../settings/settings-store';
import { RankingsRepository } from '../storage/rankings-repository';
import type { OptimizerRequest, OptimizerResponse } from './optimizer-messages';
import { startOptimizerWorker } from './optimizer-worker';

/**
 * The most items optimized on the main thread. Up to 12 take under 10 ms in Node, and well under 50 ms on a slow
 * phone; bigger lists need greedy search, which takes longer (BLUEPRINT §14, M8.1), so they go to the Web Worker.
 */
export const inlineLimit = 12;

interface Waiting {
  input: OptimizerInput;
  resolve(result: OptimizerResult): void;
  reject(error: unknown): void;
}

/**
 * Runs core's optimizer for a list (PROJECT-PLAN P14, P4): its input from MetricsService's priced items, the catalog
 * files of their regions, the rates, the settings and the ranks; on the main thread for a small list, in a Web Worker
 * for a bigger one. If the worker can't start or load (no file offline, a blocked script), it runs here instead.
 */
@Service()
export class OptimizerService {
  private readonly metrics = inject(MetricsService);
  private readonly catalog = inject(CatalogStore);
  private readonly fx = inject(FxStore);
  private readonly settings = inject(SettingsStore);
  private readonly rankings = inject(RankingsRepository);
  private readonly clock = inject(ClockService);
  /** Undefined until it's needed; null once it's failed. */
  private worker?: Worker | null;
  private nextId = 0;
  private readonly waiting = new Map<number, Waiting>();

  /**
   * What the optimizer needs for a list: undefined before the first run, and while any of its items waits for its
   * catalog file. Items that can't be priced are left out, as totals leave them out. Called in a computed(), it follows
   * the list, the catalog, the rates, the settings, the ranks and the date.
   */
  input(listId: string): OptimizerInput | undefined {
    const saved = this.settings.saved();
    if (!saved || this.metrics.status() !== 'ready') return undefined;
    const { resolved, unresolved } = this.metrics.list(listId);
    if (unresolved.some((item) => item.reason === 'pending')) return undefined;
    const catalogs = new Map<string, CatalogData>();
    for (const { region } of resolved) {
      const catalog = this.catalog.catalogFor(region);
      if (catalog) catalogs.set(region, catalog);
    }
    const fx = this.fx.rates();
    return {
      items: resolved,
      catalogs,
      context: {
        today: this.clock.today(),
        country: saved.country,
        currency: saved.currency,
        ...(fx && { fx }),
        place: {
          country: saved.country,
          ...(saved.subdivision !== undefined && { subdivision: saved.subdivision }),
          ...(saved.salesTaxPercent !== undefined && { salesTaxPercent: saved.salesTaxPercent }),
        },
        profileRanks: this.rankings.ranks(),
      },
    };
  }

  /** The list's suggestions: from the main thread for up to `inlineLimit` items, else from the worker. */
  run(input: OptimizerInput): Promise<OptimizerResult> {
    const worker = input.items.length > inlineLimit ? this.startWorker() : undefined;
    if (!worker) return Promise.resolve().then(() => optimize(input));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.waiting.set(id, { input, resolve, reject });
      worker.postMessage({ id, input } satisfies OptimizerRequest);
    });
  }

  private startWorker(): Worker | undefined {
    if (this.worker === undefined) {
      try {
        this.worker = startOptimizerWorker() ?? null;
      } catch (error) {
        console.error('The optimizer’s worker couldn’t start, so it runs on the page', error);
        this.worker = null;
      }
      this.worker?.addEventListener('message', ({ data }: MessageEvent<OptimizerResponse>) =>
        this.settle(data),
      );
      this.worker?.addEventListener('error', () => this.fallBack());
    }
    return this.worker ?? undefined;
  }

  private settle(response: OptimizerResponse): void {
    const waiting = this.waiting.get(response.id);
    if (!waiting) return;
    this.waiting.delete(response.id);
    if ('result' in response) waiting.resolve(response.result);
    else waiting.reject(new Error(response.error));
  }

  /** The worker failed to load: what's waiting runs here, and so does everything after. */
  private fallBack(): void {
    console.error('The optimizer’s worker failed to load, so it runs on the page');
    this.worker?.terminate();
    this.worker = null;
    for (const { input, resolve, reject } of this.waiting.values()) {
      try {
        resolve(optimize(input));
      } catch (error) {
        reject(error);
      }
    }
    this.waiting.clear();
  }
}
