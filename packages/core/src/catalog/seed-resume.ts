import * as z from 'zod';
import type { IsoDate } from '../dates/iso-date';
import { bundleSchema } from './bundle';
import { featuresFileSchema } from './feature';
import {
  bundleInserts,
  catalogRow,
  combine,
  deleteIds,
  featureRow,
  insertStatement,
  inserts,
  maxStatementBytes,
  providerDiff,
  providerInserts,
  providerRows,
  rankMoves,
  rankRowWrites,
  rankStatement,
  rowCount,
  sqlValue,
  sqlTable,
  storedLinks,
  updateStatement,
  utf8Length,
  type Change,
  type SeedRow,
  type SeedTable,
  type StoredProvider,
} from './seed-rows';
import {
  partialCatalogVersion,
  readSeedState,
  readStoredRows,
  seedDiff,
  seedFormat,
  seedShape,
  seedShapes,
  seedStateQueries,
  storedHash,
  storedRowQueries,
  viewChange,
  type SeedDiff,
  type SeedFormat,
  type SeedState,
  type SeedTarget,
} from './seed-sql';
import { catalogMetaSchema, type CatalogSnapshot, type SnapshotProvider } from './snapshot';

// Seeding what waits, a step at a time (M11.8, BLUEPRINT §5.3): when a deploy's seed went over the day's budget, the
// catalog row says how many providers and bundles wait, and each night the bot brings them in through its Workflow,
// one step each (a step has 10 ms of CPU). It reads the build from the files data:build publishes, never the whole
// catalog: /data/seed/index.json, each provider's hash in the catalog's order with the features and bundles, and
// /data/seed/providers/<id>.json, a provider as catalog.json has it. The next deploy carries on the same way.

/** /data/seed/index.json: what the build brings D1 to, without the providers themselves. */
export const seedIndexSchema = z.strictObject({
  catalogVersion: catalogMetaSchema.shape.catalogVersion,
  generatedAt: catalogMetaSchema.shape.generatedAt,
  counts: catalogMetaSchema.shape.counts,
  seedFormat: z
    .int()
    .describe("The seedFormat in core that built it: another one's rows are the deploy's to write"),
  providers: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        hash: z.string().regex(/^[0-9a-f]{64}$/, 'A SHA-256 of the provider file'),
      }),
    )
    .describe("Each provider's id and the SHA-256 of its file, in the catalog's order"),
  features: featuresFileSchema,
  bundles: z.array(bundleSchema),
});
export type SeedIndex = z.infer<typeof seedIndexSchema>;

/** The seed index's path under the site's root. */
export const seedIndexPath = 'data/seed/index.json';

/** A provider's file under the site's root: its JSON as catalog.json has it, which its hash is of. */
export function seedProviderPath(providerId: string): string {
  return `data/seed/providers/${providerId}.json`;
}

/** The seed index of a build, from its snapshot and each provider's hash (a SHA-256 of its JSON), for a format. */
export function buildSeedIndex(
  { data, meta }: CatalogSnapshot,
  providerHashes: ReadonlyMap<string, string>,
  format = seedFormat,
): SeedIndex {
  return {
    catalogVersion: meta.catalogVersion,
    generatedAt: meta.generatedAt,
    counts: meta.counts,
    seedFormat: format,
    providers: data.providers.map((provider) => {
      const hash = providerHashes.get(provider.id);
      if (hash === undefined) throw new Error(`No hash for provider ${provider.id}`);
      return { id: provider.id, hash };
    }),
    features: data.features,
    bundles: data.bundles,
  };
}

/** The D1 catalog database, as the seed uses it: reads, and writes in one transaction. */
export interface SeedDatabase {
  /** Each query's rows, in order. */
  read(queries: readonly string[]): Promise<unknown[]>;
  /** Runs the statements together: all of them, or none if one fails. */
  write(statements: readonly string[]): Promise<void>;
}

/** The build, as data:build publishes it for the bot. */
export interface SeedSource {
  /** The seed index, read only when something waits. */
  index(): Promise<SeedIndex>;
  /** A provider's file, as text. */
  provider(id: string): Promise<string>;
  /** A SHA-256 of `text`, in hex: core has no crypto. */
  sha256(text: string): Promise<string>;
}

/** What a step did. */
export interface SeedStep {
  /**
   * idle: nothing waits (or D1 or the build is another seed format, the deploy's to seed); more: a step was written
   * and more may wait; budget: the next one doesn't fit in what's left of the day; done: D1 holds the build.
   */
  result: 'idle' | 'more' | 'budget' | 'done';
  /** The rows it wrote, as D1 counts them. */
  writes: number;
  /** What it wrote: the registry's changes, a provider's id, or the bundles and the catalog row. */
  wrote?: string;
}

/**
 * The next step of bringing D1 to the build, within the day's budget (`daily` rows, less what the day's seeds wrote,
 * which the catalog row counts): first the registry's changes and what the build no longer has (features upserted,
 * enum values that moved, removed providers and bundles), then each changed provider in the catalog's order, its
 * rows compared with D1's, then the changed bundles, the removed features and the catalog row with the build's
 * version. Each step writes the catalog row with what's left and the day's count in the same transaction. It works on
 * the shape's tables (`format`: the code's, but for tests), a new shape's beside the live ones, which the last step
 * points the API's views at.
 */
export async function seedNext(
  db: SeedDatabase,
  source: SeedSource,
  { today, daily }: { today: IsoDate; daily: number },
  format: SeedFormat = { seedFormat, shape: seedShape },
): Promise<SeedStep> {
  const { shape } = format;
  const state = readSeedState(await db.read(seedStateQueries(shape)));
  const catalog = state.catalog;
  if (!catalog || catalog.waiting === 0) return { result: 'idle', writes: 0 };
  const liveShape =
    catalog.seedFormat === format.seedFormat ? format.shape : seedShapes[catalog.seedFormat];
  // A format from before shapes is the deploy's to seed.
  if (liveShape === undefined) return { result: 'idle', writes: 0 };
  const index = await source.index();
  if (index.seedFormat !== format.seedFormat) return { result: 'idle', writes: 0 };
  const switchViews = liveShape !== shape || catalog.version === partialCatalogVersion;
  const providers = index.providers.map(({ id, hash }) => ({
    id,
    sha256: hash,
    hash: storedHash(format.seedFormat, hash),
  }));
  const target: SeedTarget = {
    meta: index,
    providers,
    features: index.features,
    bundles: index.bundles,
  };
  const diff = seedDiff(target, state);
  const used = catalog.writtenOn === today ? catalog.written : 0;
  const room = daily - used;
  const waiting = diff.changedProviders.length + diff.changedBundles.length;
  const featureDeletes: Change = {
    statements: deleteIds(shape, 'features', diff.removedFeatures),
    writes: diff.removedFeatures.length,
  };
  /** Writes `change` with the catalog row's count of what's left, if they fit. */
  const step = async (rows: Change, left: number, wrote: string): Promise<SeedStep> => {
    const done = left === 0;
    // Whole at last: the API's views go to these tables, and the catalog row names the build.
    const change = done && switchViews ? combine([rows, viewChange(shape)]) : rows;
    const writes = change.writes + 1;
    if (writes > room) return { result: 'budget', writes: 0 };
    const counted = { today, written: used + writes };
    const statements = [
      ...change.statements,
      done
        ? insertStatement(shape, 'catalog', catalogRow(index, format.seedFormat, counted), 'upsert')
        : updateStatement(
            shape,
            'catalog',
            { id: 1, waiting: left, written_on: today, written: counted.written },
            ['waiting', 'written_on', 'written'],
          ),
    ];
    for (const statement of statements) {
      if (utf8Length(statement) > maxStatementBytes) {
        throw new Error(
          `A seed statement is over D1's ${maxStatementBytes}-byte limit: ${statement.slice(0, 80)}…`,
        );
      }
    }
    await db.write(statements);
    return { result: done ? 'done' : 'more', writes, wrote };
  };

  // The registry's changes and the removals, which the providers' rows may need first.
  const fixed = await fixedChange(db, diff, state, shape);
  if (fixed.statements.length > 0) return step(fixed, waiting, 'the registry and removals');

  const [next] = diff.changedProviders;
  if (next) {
    const sha256 = providers.find(({ id }) => id === next.id)?.sha256 ?? '';
    const text = await source.provider(next.id);
    if ((await source.sha256(text)) !== sha256) {
      throw new Error(
        `${seedProviderPath(next.id)} isn't the file the seed index names: a deploy since?`,
      );
    }
    const provider = JSON.parse(text) as SnapshotProvider;
    const features = new Map(index.features.map((feature) => [feature.id, feature]));
    const rows = providerRows(provider, next.hash, (featureId, listedBy) => {
      const feature = features.get(featureId);
      if (!feature) throw new Error(`${listedBy} lists ${featureId}, which isn't a feature`);
      return feature;
    });
    const stored = state.providers.has(next.id)
      ? readStoredRows([next.id], await db.read(storedRowQueries([next.id], shape))).get(next.id)
      : undefined;
    const change = stored ? providerDiff(shape, rows, stored) : providerInserts(shape, rows);
    // The last of what waits takes the removed features with it, and the catalog row then names the build.
    const left = waiting - 1;
    return step(left === 0 ? combine([change, featureDeletes]) : change, left, next.id);
  }

  // The bundles, the removed features, and the catalog row with the build's version.
  const replaced = diff.changedBundles.filter((bundle) => state.bundles.has(bundle.id));
  return step(
    combine([
      {
        statements: deleteIds(
          shape,
          'bundles',
          replaced.map(({ id }) => id),
        ),
        writes: replaced.reduce(
          (sum, bundle) => sum + 1 + storedLinks(state.bundles.get(bundle.id)),
          0,
        ),
      },
      ...diff.changedBundles.map((bundle) => bundleInserts(shape, bundle)),
      featureDeletes,
    ]),
    0,
    'the bundles and the catalog row',
  );
}

/**
 * The registry's changes and the removals: features upserted, the rows of enum values that moved (counted in D1),
 * and the providers and bundles the build no longer has (their rows read, to count what deleting them writes).
 */
async function fixedChange(
  db: SeedDatabase,
  diff: SeedDiff,
  state: SeedState,
  shape: number,
): Promise<Change> {
  const moves = diff.changedFeatures.flatMap((feature) =>
    rankMoves(feature, state.features.get(feature.id)),
  );
  const counts =
    moves.length > 0
      ? z
          .array(z.tuple([z.object({ n: z.int().nonnegative() })]))
          .parse(
            await db.read(
              moves.map(
                (move) =>
                  `SELECT COUNT(*) AS n FROM ${sqlTable(shape, move.table)} WHERE feature_id = ${sqlValue(move.featureId)} AND value = ${sqlValue(move.value)} AND rank_value IS NOT ${move.position}`,
              ),
            ),
          )
          .map(([{ n }]) => n)
      : [];
  const removed =
    diff.removedProviders.length > 0
      ? readStoredRows(
          diff.removedProviders,
          await db.read(storedRowQueries(diff.removedProviders, shape)),
        )
      : new Map<string, StoredProvider>();
  return combine([
    inserts(
      shape,
      diff.changedFeatures.map((feature): [SeedTable, SeedRow] => [
        'features',
        featureRow(feature),
      ]),
      'upsert',
      (row) => (state.features.has(String(row['id'])) ? 'update' : 'insert'),
    ),
    {
      statements: moves.map((move) => rankStatement(shape, move)),
      writes: moves.reduce((sum, move, n) => sum + (counts[n] ?? 0) * rankRowWrites(move), 0),
    },
    {
      statements: deleteIds(shape, 'providers', diff.removedProviders),
      writes: [...removed.values()].reduce((sum, rows) => sum + rowCount(rows), 0),
    },
    {
      statements: deleteIds(shape, 'bundles', diff.removedBundles),
      writes: diff.removedBundles.reduce(
        (sum, id) => sum + 1 + storedLinks(state.bundles.get(id)),
        0,
      ),
    },
  ]);
}
