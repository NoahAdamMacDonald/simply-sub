import { Component, computed, resource, signal } from '@angular/core';
import {
  bundlesBodySchema,
  catalogIndexSchema,
  catalogSnapshotSchema,
  fxBodySchema,
  healthBodySchema,
  providersBodySchema,
  regionFileFor,
} from '@simply-sub/core';
import { money, providerCards } from './progress-preview-view';

/**
 * TEMPORARY progress preview, so what's built so far can be seen in the running app: the catalog the app downloads
 * (M1, M2.1), priced with core's pickPrice and the live /fx rates, and the live API (M2.2–M2.8): health, search,
 * bundles with savings and custom-subscription icons. It lives only on the preview branch and never goes to main
 * (.claude/skills/progress-preview/SKILL.md).
 */
@Component({
  selector: 'ss-progress-preview',
  templateUrl: './progress-preview.html',
  styleUrl: './progress-preview.scss',
})
export class ProgressPreview {
  protected readonly regions = ['CA', 'US', 'GB', 'DE', 'AU'];
  protected readonly currencies = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];
  protected readonly region = signal('CA');
  protected readonly currency = signal('CAD');
  protected readonly search = signal('vpn');
  protected readonly iconDomain = signal('');
  /** Whether /icon answered 404 for iconDomain: the app then shows the first letter. */
  protected readonly iconMissing = signal(false);

  /** The catalog version and region files, then the region's file (or the full catalog), as the app will load it. */
  protected readonly catalog = resource({
    params: () => ({ region: this.region() }),
    loader: async ({ params, abortSignal }) => {
      const index = catalogIndexSchema.parse(await json('/data/catalog/index.json', abortSignal));
      const file = regionFileFor(params.region, index);
      const path = file ? `/data/catalog/${file}.json` : '/data/catalog.json';
      return { path, snapshot: catalogSnapshotSchema.parse(await json(path, abortSignal)) };
    },
  });

  protected readonly fx = resource({
    params: () => ({ currency: this.currency() }),
    loader: async ({ params, abortSignal }) =>
      fxBodySchema.parse(await json(`/api/v1/fx?base=${params.currency}`, abortSignal)),
  });

  protected readonly health = resource({
    loader: async ({ abortSignal }) =>
      healthBodySchema.parse(await json('/api/v1/health', abortSignal)),
  });

  protected readonly results = resource({
    params: () => ({ q: this.search().trim(), region: this.region(), currency: this.currency() }),
    loader: async ({ params, abortSignal }) => {
      if (params.q === '') {
        return undefined;
      }
      const query = new URLSearchParams(params);
      return providersBodySchema.parse(await json(`/api/v1/providers?${query}`, abortSignal));
    },
  });

  protected readonly bundles = resource({
    params: () => ({
      plans: this.catalog.hasValue()
        ? this.catalog
            .value()
            .snapshot.data.bundles.flatMap((bundle) => bundle.includes.slice(0, 1))
        : undefined,
      region: this.region(),
      currency: this.currency(),
    }),
    loader: async ({ params, abortSignal }) => {
      if (!params.plans || params.plans.length === 0) {
        return undefined;
      }
      const query = new URLSearchParams({
        plans: params.plans.join(','),
        region: params.region,
        currency: params.currency,
      });
      return bundlesBodySchema.parse(await json(`/api/v1/bundles?${query}`, abortSignal));
    },
  });

  protected readonly cards = computed(() => {
    if (!this.catalog.hasValue()) {
      return [];
    }
    const fx = this.fx.hasValue() ? this.fx.value().data : undefined;
    return providerCards(this.catalog.value().snapshot, this.region(), this.currency(), fx);
  });

  protected readonly money = money;

  protected showIcon(domain: string): void {
    this.iconMissing.set(false);
    this.iconDomain.set(domain.trim());
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

/** A same-origin JSON file or API answer; a non-2xx answer is an error, with the API's message when it has one. */
async function json(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = (body as { error?: { message?: string } } | undefined)?.error?.message;
    throw new Error(message ?? `${path}: HTTP ${response.status}`);
  }
  return body;
}
