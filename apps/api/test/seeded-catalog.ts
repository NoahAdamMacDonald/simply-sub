import {
  buildCatalogData,
  buildCatalogIndex,
  buildCatalogMeta,
  buildSeedSql,
  catalogIds,
  categoriesBody,
  featuresBody,
  regionSnapshot,
  readCatalogSource,
  type CatalogSnapshot,
  type CatalogSourceFile,
} from '@simply-sub/core';
import { env } from 'cloudflare:workers';

// The real catalog in data/, for tests that run the Worker on it (test/contract.spec.ts, test/middleware.spec.ts):
// its snapshot, D1 seeded the way the deploy seeds it, and the static files data:build writes.

/** The snapshot of data/, under `catalogVersion`. */
export function catalogSnapshot(catalogVersion: string): CatalogSnapshot {
  const files: CatalogSourceFile[] = [
    ...structuredClone(env.TEST_CATALOG.files),
    ...env.TEST_CATALOG.logos.map((file) => ({ file, bytes: new Uint8Array() })),
  ];
  const data = buildCatalogData(readCatalogSource(files), 'https://sub.simplely.ca/icons/');
  return {
    data,
    meta: buildCatalogMeta(data, { catalogVersion, generatedAt: '2026-10-22T03:12:45Z' }),
  };
}

/** Seeds D1 with the snapshot in full, as the first deploy does. */
export async function seedCatalog(snapshot: CatalogSnapshot): Promise<void> {
  const sql = buildSeedSql(snapshot, {
    providerHashes: new Map(snapshot.data.providers.map((provider) => [provider.id, 'hash'])),
  });
  await env.DB.batch(
    sql
      .trimEnd()
      .split('\n')
      .map((statement) => env.DB.prepare(statement)),
  );
}

/**
 * An ASSETS binding that serves the snapshot's static files, as data:build writes them. Anything else is missing,
 * which the app's index.html stands for.
 */
export function catalogAssets(snapshot: CatalogSnapshot): Fetcher {
  const index = buildCatalogIndex(snapshot.meta);
  const files: Record<string, unknown> = {
    '/data/catalog.json': snapshot,
    '/data/catalog/index.json': index,
    '/data/catalog/features.json': featuresBody(snapshot),
    '/data/catalog/categories.json': categoriesBody(snapshot),
    '/data/catalog/ids.json': catalogIds(snapshot),
    ...Object.fromEntries(
      index.regions.map((region) => [
        `/data/catalog/${region}.json`,
        regionSnapshot(snapshot, region),
      ]),
    ),
  };
  return {
    fetch: async (input: RequestInfo | URL) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      return Object.hasOwn(files, path)
        ? Response.json(files[path])
        : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
    },
  } as unknown as Fetcher;
}
