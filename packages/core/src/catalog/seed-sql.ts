import type { Feature, FeatureValue } from './feature';
import { monthlyEquivalent } from './monthly-equivalent';
import type { CatalogSnapshot } from './snapshot';

// seed.sql for the D1 catalog cache (BLUEPRINT §5.3, §6.3): it empties every table, then inserts the snapshot.
// Each statement is on one line and under D1's 100 KB statement limit.

/** D1 rejects a statement longer than this many bytes. */
const maxStatementBytes = 100_000;

/**
 * The snapshot's JSON goes into its row in pieces of this many characters, so each statement stays under the
 * limit even if every character took 4 bytes.
 */
const snapshotPieceLength = 20_000;

/** The snapshots row that holds the full catalog. Per-region rows come with GET /catalog?region= (M2.1). */
export const fullSnapshotRegion = 'ALL';

/** rank_value for `unlimited`: above any real number, and still a finite number in JSON. */
export const unlimitedRankValue = 1e308;

/** Parents last, though the ON DELETE CASCADE keys would clear the children anyway. */
const tables = [
  'snapshots',
  'bundle_plans',
  'bundles',
  'plan_features',
  'features',
  'prices',
  'plans',
  'providers',
];

type SqlValue = string | number | null;

/**
 * The SQL that replaces D1's catalog with `snapshot`, one statement per line. The snapshot row holds
 * `JSON.stringify(snapshot)`, the same text as data/catalog.json.
 */
export function buildSeedSql(snapshot: CatalogSnapshot): string {
  const { data, meta } = snapshot;
  const features = new Map(data.features.map((feature) => [feature.id, feature]));
  const statements = tables.map((table) => `DELETE FROM ${table};`);
  const insert = (table: string, row: Record<string, SqlValue>) =>
    statements.push(
      `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(sqlValue).join(', ')});`,
    );

  for (const provider of data.providers) {
    insert('providers', {
      id: provider.id,
      name: provider.name,
      category: provider.category,
      spend_category: provider.spendCategory,
      json: JSON.stringify(provider),
    });
    for (const plan of provider.plans) {
      insert('plans', {
        id: plan.id,
        provider_id: provider.id,
        name: plan.name,
        json: JSON.stringify(plan),
      });
      for (const price of plan.prices) {
        insert('prices', {
          plan_id: plan.id,
          region: price.region,
          currency: price.currency,
          amount: price.amount,
          interval: price.interval,
          interval_count: price.intervalCount,
          monthly_equiv: monthlyEquivalent(price),
        });
      }
    }
  }
  for (const feature of data.features) {
    insert('features', {
      id: feature.id,
      category: feature.category,
      json: JSON.stringify(feature),
    });
  }
  for (const plan of data.providers.flatMap((provider) => provider.plans)) {
    for (const [featureId, value] of Object.entries(plan.features)) {
      const feature = features.get(featureId);
      if (!feature) {
        throw new Error(
          `${plan.id} lists ${featureId}, which isn't a feature: run npm run data:validate`,
        );
      }
      for (const row of featureRows(feature, value, plan.id)) {
        insert('plan_features', { plan_id: plan.id, feature_id: featureId, ...row });
      }
    }
  }
  for (const bundle of data.bundles) {
    insert('bundles', { id: bundle.id, json: JSON.stringify(bundle) });
    for (const planId of bundle.includes) {
      insert('bundle_plans', { bundle_id: bundle.id, plan_id: planId });
    }
  }

  const [first = '', ...rest] = pieces(JSON.stringify(snapshot), snapshotPieceLength);
  insert('snapshots', {
    region: fullSnapshotRegion,
    sha: meta.catalogVersion,
    built_at: meta.generatedAt,
    json: first,
  });
  for (const piece of rest) {
    statements.push(
      `UPDATE snapshots SET json = json || ${sqlValue(piece)} WHERE region = ${sqlValue(fullSnapshotRegion)};`,
    );
  }

  for (const statement of statements) {
    if (utf8Length(statement) > maxStatementBytes) {
      throw new Error(
        `A seed statement is over D1's ${maxStatementBytes}-byte limit: ${statement.slice(0, 80)}…`,
      );
    }
  }
  return `${statements.join('\n')}\n`;
}

/**
 * A plan's value as plan_features rows (BLUEPRINT §5.3): an enum's position, the number itself (unlimited is
 * above every number), 1 or 0 for a boolean, and one row per member of a set, with no rank_value.
 */
function featureRows(
  feature: Feature,
  value: FeatureValue,
  planId: string,
): { value: string; rank_value: number | null }[] {
  const wrongType = () =>
    new Error(
      `${planId}: ${JSON.stringify(value)} isn't a ${feature.id} value: run npm run data:validate`,
    );
  switch (feature.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw wrongType();
      return [{ value: String(value), rank_value: value ? 1 : 0 }];
    case 'number':
      if (value === 'unlimited') return [{ value, rank_value: unlimitedRankValue }];
      if (typeof value !== 'number') throw wrongType();
      return [{ value: String(value), rank_value: value }];
    case 'enum': {
      const position = feature.values.findIndex((option) => option.id === value);
      if (typeof value !== 'string' || position < 0) throw wrongType();
      return [{ value, rank_value: position }];
    }
    case 'set':
      if (!Array.isArray(value)) throw wrongType();
      return value.map((member) => ({ value: member, rank_value: null }));
  }
}

/** A SQL literal. SQLite strings have no escapes, so a quote is doubled and a line break is spliced in. */
function sqlValue(value: SqlValue): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${value} can't be stored in D1`);
    }
    return String(value);
  }
  const quoted = `'${value.replaceAll("'", "''")}'`;
  return quoted.replaceAll('\r', "' || char(13) || '").replaceAll('\n', "' || char(10) || '");
}

/** `text` in pieces of at most `length` characters, never splitting a character in two. */
function pieces(text: string, length: number): string[] {
  const characters = Array.from(text);
  const result: string[] = [];
  for (let start = 0; start < characters.length; start += length) {
    result.push(characters.slice(start, start + length).join(''));
  }
  return result;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
