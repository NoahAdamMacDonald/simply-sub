import {
  catalogFilePath,
  catalogIndexPath,
  catalogIndexSchema,
  checkRecord,
  planCatalogSync,
  type CatalogCache,
  type Timestamp,
} from '@simply-sub/core';

// Loaded by CatalogStore on its first check, as a chunk of its own, so the schemas it checks the files with stay out
// of the initial bundle.

/** How long a request may take before the server counts as out of reach. A slow phone link still gets 40 kB in. */
const requestTimeout = 30_000;

/** What a check for a new catalog found. */
export type CatalogDownload =
  /** The server couldn't be reached: the browser is offline, or a request timed out. */
  | { outcome: 'offline' }
  /** Something else went wrong (a server error, a file that fails its schema), and it went to the console. */
  | { outcome: 'failed' }
  /**
   * `files`: what was downloaded, checked against its schema, all at index.json's version ('updated' when there's
   * any). `remove`: cached files that none of the regions needs any more.
   */
  | { outcome: 'current' | 'updated'; files: CatalogCache[]; remove: string[] };

/**
 * Checks index.json's catalogVersion and downloads the files `regions` need that `cached` doesn't hold at that
 * version (planCatalogSync). Without regions (before the first run) it only checks that the server is there. The
 * browser revalidates index.json with its ETag, so an unchanged catalog costs a 304.
 */
export async function downloadCatalog(
  regions: readonly string[],
  cached: readonly CatalogCache[],
  now: Timestamp,
): Promise<CatalogDownload> {
  try {
    const index = catalogIndexSchema.parse(await getJson(catalogIndexPath));
    if (regions.length === 0) return { outcome: 'current', files: [], remove: [] };
    const plan = planCatalogSync(index, regions, cached);
    const files = await Promise.all(
      plan.fetch.map(async (key) => {
        const path = catalogFilePath(key);
        const file = checkRecord('catalogCache', {
          key,
          snapshot: await getJson(path),
          fetchedAt: now,
        });
        if (file.snapshot.meta.catalogVersion !== index.catalogVersion) {
          // A deploy between the two requests. The next check gets the new index and files.
          throw new Error(
            `${path} is version ${file.snapshot.meta.catalogVersion}, but index.json is ${index.catalogVersion}`,
          );
        }
        return file;
      }),
    );
    return { outcome: files.length > 0 ? 'updated' : 'current', files, remove: plan.remove };
  } catch (error) {
    if (error instanceof Unreachable) return { outcome: 'offline' };
    console.error("The catalog couldn't be checked for updates:", error);
    return { outcome: 'failed' };
  }
}

class Unreachable extends Error {}

/**
 * The JSON at `path`, revalidated with the server (`no-cache`: the browser sends the ETag it has). A missing file is
 * answered with the app's index.html, which fails to parse here, so files are looked up in index.json first.
 */
async function getJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: 'no-cache',
      signal: AbortSignal.timeout(requestTimeout),
    });
  } catch (error) {
    throw new Unreachable(`${path} couldn't be reached`, { cause: error });
  }
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return response.json();
}
