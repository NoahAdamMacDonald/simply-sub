import type { CatalogIndex } from './region-files';
import { groupsOf } from './regions';
import type { CatalogMeta } from './snapshot';

// Which of the static catalog files (BLUEPRINT §6.3) a buyer is served, which ones the app downloads and keeps, and
// when it checks for a new version (M4.3). No Zod here: the app's CatalogStore is in the initial bundle and uses
// these, while Zod loads later, with the storage chunk.

/** The key of the full data/catalog.json, for buyers whose region has no file of its own. */
export const fullCatalogKey = 'catalog';

/** data/catalog/index.json: the catalog version and the regions with a file of their own. */
export const catalogIndexPath = 'data/catalog/index.json';

/**
 * How long a check for a new catalog version stays recent: a tab that's shown again after this long checks again.
 * The catalog changes at most daily, when price PRs are merged.
 */
export const catalogCheckInterval = 60 * 60 * 1000;

/**
 * The region whose file serves a buyer in `region`: its own, else its group's (EU for a Swede without Swedish
 * prices), or undefined for the full catalog.json, which every other country needs, since any region's price can
 * be the one pickPrice falls back to.
 */
export function regionFileFor(
  region: string,
  { regions }: Pick<CatalogIndex, 'regions'>,
): string | undefined {
  return [region, ...groupsOf(region)].find((code) => regions.includes(code));
}

/**
 * The key of the file that serves a buyer in `region`: the region with the file (CA, EU), or `catalog` for the full
 * catalog.json. `regions` can be index.json's, or a snapshot's `meta.regions`, which adds GLOBAL, never a buyer's
 * region.
 */
export function catalogFileKey(region: string, index: Pick<CatalogIndex, 'regions'>): string {
  return regionFileFor(region, index) ?? fullCatalogKey;
}

/** Where a catalog file is, relative to the app. */
export function catalogFilePath(key: string): string {
  return key === fullCatalogKey ? 'data/catalog.json' : `data/catalog/${key}.json`;
}

/** A cached catalog file (a catalogCache record), as far as planning goes. */
export interface CachedCatalogFile {
  key: string;
  snapshot: { meta: Pick<CatalogMeta, 'catalogVersion'> };
}

/** What to download, and what to drop, so the cache holds the files a buyer needs at index.json's version. */
export interface CatalogSyncPlan {
  /** Needed files that aren't cached, or are cached at another version, sorted. */
  fetch: string[];
  /** Cached files that none of the regions needs any more. */
  remove: string[];
}

/**
 * The plan for `regions`, the user's country and the region of every list item bought elsewhere: one file per
 * region, its own or its fallback (`catalogFileKey`). A file several regions share (EU.json for a Swede and a Dane)
 * is fetched once.
 */
export function planCatalogSync(
  index: Pick<CatalogIndex, 'catalogVersion' | 'regions'>,
  regions: readonly string[],
  cached: readonly CachedCatalogFile[],
): CatalogSyncPlan {
  const needed = new Set(regions.map((region) => catalogFileKey(region, index)));
  const current = new Set(
    cached
      .filter(({ snapshot }) => snapshot.meta.catalogVersion === index.catalogVersion)
      .map(({ key }) => key),
  );
  return {
    fetch: [...needed].filter((key) => !current.has(key)).sort(),
    remove: cached.map(({ key }) => key).filter((key) => !needed.has(key)),
  };
}

/**
 * Whether a tab that's shown again checks for a new catalog version: it hasn't checked yet, or not for
 * `catalogCheckInterval`. A clock that went back counts as due too.
 */
export function catalogCheckDue(lastCheckedAt: string | undefined, now: string): boolean {
  if (lastCheckedAt === undefined) return true;
  const elapsed = Date.parse(now) - Date.parse(lastCheckedAt);
  return elapsed < 0 || elapsed >= catalogCheckInterval;
}
