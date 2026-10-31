import { describe, expect, it } from 'vitest';
import {
  formatCatalogIssue,
  missingIdIssue,
  missingIds,
  publishedIds,
  publishedRedirects,
  type CatalogSourceFile,
} from '../../src';
import { catalog, edited } from './catalog-files';

// The ids guard (BLUEPRINT §4.3, M10.27): an id main publishes that the branch loses fails, unless it's retired (and so
// still there) or redirected.

const netflix = 'data/providers/netflix.yaml';
const features = 'data/features.yaml';

/** The guard's errors for a branch `branch` against `main`, as data:validate prints them. */
function guard(main: CatalogSourceFile[], branch: CatalogSourceFile[]): string[] {
  return missingIds(publishedIds(main), publishedIds(branch), publishedRedirects(branch)).map(
    (id) => formatCatalogIssue(missingIdIssue(id)),
  );
}

/** The catalog without Netflix Premium. */
function withoutPremium(files = catalog()): CatalogSourceFile[] {
  return files.map((source) =>
    source.file === netflix && 'data' in source
      ? {
          file: netflix,
          data: {
            ...(source.data as object),
            plans: (source.data as { plans: { id: string }[] }).plans.filter(
              (plan) => plan.id !== 'netflix.premium',
            ),
          },
        }
      : source,
  );
}

describe('publishedIds', () => {
  it('lists providers, plans, add-ons, bundles and rank keys, each with its file', () => {
    const ids = publishedIds(catalog());
    expect(ids).toEqual(
      expect.arrayContaining([
        { kind: 'provider', id: 'netflix', file: netflix },
        { kind: 'plan', id: 'netflix.premium', file: netflix },
        { kind: 'add-on', id: 'netflix.extra-member', file: netflix },
        { kind: 'bundle', id: 'bundle.netflix-crave', file: 'data/bundles/netflix-crave.yaml' },
        { kind: 'feature', id: 'video.quality=4k', file: features },
      ]),
    );
  });

  it('reads what it can of a file that doesn’t match today’s schema', () => {
    const odd = edited(catalog(), netflix, ['plans', 0, 'oldField'], true);
    expect(publishedIds(odd)).toEqual(publishedIds(catalog()));
  });
});

describe('the guard', () => {
  it('passes a branch that keeps every id', () => {
    expect(guard(catalog(), catalog())).toEqual([]);
  });

  it('fails a plan removed, naming it and the three ways to keep it', () => {
    expect(guard(catalog(), withoutPremium())).toEqual([
      `${netflix}: The plan id "netflix.premium" is published on main and gone here. Ids are permanent, since users' lists, ranks and links point at them (BLUEPRINT §4.3): keep the id with its new name (formerNames on a plan, aliases on a provider), retire it (retired: <date>, with its last prices), or redirect it in data/redirects.yaml ({ kind: plan, from: netflix.premium, to: <new id>, on: <date> })`,
    ]);
  });

  it('passes a plan retired, since it stays, and one redirected', () => {
    expect(
      guard(catalog(), edited(catalog(), netflix, ['plans', 2, 'retired'], '2026-10-01')),
    ).toEqual([]);
    const redirected = [
      ...withoutPremium(),
      {
        file: 'data/redirects.yaml',
        data: [{ kind: 'plan', from: 'netflix.premium', to: 'netflix.standard', on: '2026-10-01' }],
      },
    ];
    expect(guard(catalog(), redirected)).toEqual([]);
  });

  it('fails a rank key gone from the registry, unless its feature is redirected', () => {
    const files = catalog();
    const registry = files.find(({ file }) => file === features);
    const renamed = (registry && 'data' in registry ? (registry.data as { id: string }[]) : []).map(
      (feature) =>
        feature.id === 'video.quality' ? { ...feature, id: 'video.resolution' } : feature,
    );
    const branch = files.map((source) =>
      source.file === features ? { file: features, data: renamed } : source,
    );
    expect(guard(files, branch)).toEqual(
      expect.arrayContaining([expect.stringContaining('Rank key "video.quality=4k" is published')]),
    );
    const redirected = [
      ...branch,
      {
        file: 'data/redirects.yaml',
        data: [
          { kind: 'feature', from: 'video.quality', to: 'video.resolution', on: '2026-10-01' },
        ],
      },
    ];
    expect(guard(files, redirected)).toEqual([]);
  });
});
