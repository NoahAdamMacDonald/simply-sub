import { rankKeyOptions } from '../ranking/rank-keys';
import { featureSchema } from './feature';
import {
  idSpace,
  redirectMap,
  redirectedRankKey,
  redirectsFileSchema,
  type Redirect,
} from './redirects';
import { locateCatalogFile, type CatalogIssue, type CatalogSourceFile } from './validate-catalog';

// The ids guard (BLUEPRINT §4.3, M10.27): every id main publishes must still be in the branch, retired if it's no
// longer sold, or redirected. scripts/check-ids.ts reads main's data/ at the merge base through git, and the branch's
// from the working tree; both are read leniently here, since main's files follow main's schemas, which may differ.

export type PublishedIdKind = 'provider' | 'plan' | 'add-on' | 'bundle' | 'feature' | 'period';

/**
 * One id the catalog publishes, and the file it's in. A feature's are its rank keys; a period is a plan's or bundle's
 * billing period in a region (`netflix.standard CA month/1`), which items are billed on (M10.28).
 */
export interface PublishedId {
  kind: PublishedIdKind;
  id: string;
  file: string;
}

/**
 * Every provider, plan, add-on and bundle id, every plan's and bundle's billing period per region, and every rank key
 * of the registry, in the files given: what lists, ranks and links point at. A file that isn't readable gives what it
 * can.
 */
export function publishedIds(files: readonly CatalogSourceFile[]): PublishedId[] {
  const found: PublishedId[] = [];
  const add = (kind: PublishedIdKind, id: unknown, file: string) => {
    if (typeof id === 'string' && id !== '') found.push({ kind, id, file });
  };
  const addPeriods = (owner: Record<string, unknown>, file: string) => {
    const periods = new Set(
      records(owner['prices']).map(
        (price) =>
          `${String(owner['id'])} ${String(price['region'])} ${String(price['interval'])}/${String(price['intervalCount'])}`,
      ),
    );
    for (const period of periods) add('period', period, file);
  };
  for (const source of files) {
    if (!('data' in source)) continue;
    const { file, data } = source;
    const kind = locateCatalogFile(file)?.kind;
    if (kind === 'provider' && isRecord(data)) {
      add('provider', data['id'], file);
      for (const plan of records(data['plans'])) {
        add('plan', plan['id'], file);
        addPeriods(plan, file);
      }
      for (const addOn of records(data['addOns'])) add('add-on', addOn['id'], file);
    } else if (kind === 'bundle' && isRecord(data)) {
      add('bundle', data['id'], file);
      addPeriods(data, file);
    } else if (kind === 'features') {
      for (const entry of Array.isArray(data) ? data : []) {
        const feature = featureSchema.safeParse(entry);
        if (feature.success) {
          for (const option of rankKeyOptions(feature.data)) add('feature', option.key, file);
        }
      }
    }
  }
  return found;
}

/** The branch's redirects, as far as its data/redirects.yaml can be read. */
export function publishedRedirects(files: readonly CatalogSourceFile[]): Redirect[] {
  const source = files.find(({ file }) => locateCatalogFile(file)?.kind === 'redirects');
  return (source && 'data' in source && redirectsFileSchema.safeParse(source.data).data) || [];
}

/** The ids main published that the branch has lost: neither in it (retired ones are) nor redirected. */
export function missingIds(
  main: readonly PublishedId[],
  branch: readonly PublishedId[],
  redirects: readonly Redirect[],
): PublishedId[] {
  const kept = new Set(branch.map(({ kind, id }) => `${space(kind)} ${id}`));
  const map = redirectMap(redirects);
  const redirected = new Set(redirects.map(({ kind, from }) => `${idSpace(kind)} ${from}`));
  return main.filter(({ kind, id }) => {
    const key = `${space(kind)} ${id}`;
    if (kept.has(key) || redirected.has(key)) return false;
    // A period of a plan or bundle that's gone itself: that one is named, or redirected.
    if (kind === 'period') return kept.has(`${space('plan')} ${id.split(' ')[0]}`);
    // A feature redirected by its id takes its values' keys with it.
    return kind !== 'feature' || redirectedRankKey(map, id) === id;
  });
}

/** The error for a lost id, in the file main had it in: what it was, and the three ways to keep it. */
export function missingIdIssue({ kind, id, file }: PublishedId): CatalogIssue {
  if (kind === 'period') {
    const [owner, region, period] = id.split(' ');
    return {
      severity: 'error',
      file,
      path: [],
      message: `${owner}'s ${period} price in ${region} is published on main and gone here. Items are billed on it (BLUEPRINT §4.3): keep the price with retired: <date>, the day it stopped being sold (and endsOn when existing subscribers keep it longer), so their items switch at renewal`,
    };
  }
  const what = kind === 'feature' ? `Rank key "${id}"` : `The ${kind} id "${id}"`;
  const fixes =
    kind === 'feature'
      ? 'keep it in data/features.yaml under its new name, or redirect it in data/redirects.yaml ({ kind: feature, from: ' +
        `${id}, to: <new key>, on: <date> })`
      : `keep the id with its new name (formerNames on a plan, aliases on a provider), retire it (retired: <date>, ` +
        `with its last prices), or redirect it in data/redirects.yaml ({ kind: ${kind}, from: ${id}, to: <new id>, ` +
        'on: <date> })';
  return {
    severity: 'error',
    file,
    path: [],
    message: `${what} is published on main and gone here. Ids are permanent, since users' lists, ranks and links point at them (BLUEPRINT §4.3): ${fixes}`,
  };
}

function space(kind: PublishedIdKind): string {
  return kind === 'period' ? 'period' : idSpace(kind === 'feature' ? 'feature' : 'plan');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
