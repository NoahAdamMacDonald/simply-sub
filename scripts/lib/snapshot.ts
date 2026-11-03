// The catalog snapshot data:build publishes (BLUEPRINT §6.3), from data/'s files, and the provider hashes the seed
// compares (BLUEPRINT §5.3): shared by build-catalog.ts, seed-d1.ts and seed-writes.ts, which builds main's catalog the
// same way to estimate what a pull request writes to D1 (M11.8).
import {
  buildCatalogData,
  buildCatalogMeta,
  readCatalogSource,
  type CatalogSnapshot,
  type CatalogSource,
  type CatalogSourceFile,
} from '@simply-sub/core';
import { createHash } from 'node:crypto';

/** Where the icons are published: a provider's and a reseller's iconUrl starts with it. */
export const iconBaseUrl = 'https://sub.simplely.ca/icons/';

/**
 * The snapshot of `files`, data/'s as read (and checked), built at `generatedAt`, with the source it was built from.
 * Its version is the start of a SHA-256 of its data, so it changes only when the catalog does.
 */
export function buildSnapshot(
  files: readonly CatalogSourceFile[],
  generatedAt: string,
): { source: CatalogSource; snapshot: CatalogSnapshot } {
  const source = readCatalogSource(files);
  const data = buildCatalogData(source, iconBaseUrl);
  const catalogVersion = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 7);
  return {
    source,
    snapshot: { data, meta: buildCatalogMeta(data, { catalogVersion, generatedAt }) },
  };
}

/** Each provider's hash, as D1's providers.hash keeps it: a SHA-256 of its JSON, its json column. */
export function providerHashes(snapshot: CatalogSnapshot): Map<string, string> {
  return new Map(
    snapshot.data.providers.map((provider) => [
      provider.id,
      createHash('sha256').update(JSON.stringify(provider)).digest('hex'),
    ]),
  );
}
