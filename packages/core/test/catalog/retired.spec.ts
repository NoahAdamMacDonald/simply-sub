import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  formatCatalogIssue,
  isRetired,
  planExtras,
  planSchema,
  providerSchema,
  readCatalogSource,
  retirementOf,
  searchProviders,
  validateCatalog,
  type CatalogSourceFile,
} from '../../src';
import { catalog, catalogWith, edited, today } from './catalog-files';
import { at, issues } from './helpers';

// A plan or provider no longer sold is retired, never deleted (BLUEPRINT §4.3, M10.27): its last prices stay without
// a warning that they're old, and Search and the bundle offers leave it out.

const netflix = 'data/providers/netflix.yaml';
const crave = 'data/providers/crave.yaml';

function data(files: CatalogSourceFile[]) {
  const source = readCatalogSource(files);
  return { source, data: buildCatalogData(source, 'https://sub.simplely.ca/icons/') };
}

describe('retired and endsOn', () => {
  const plan = at(
    catalog().find(({ file }) => file === netflix),
    'data',
    'plans',
    1,
  );

  it('need endsOn on or after retired, and retired for endsOn', () => {
    expect(issues(planSchema, { ...(plan as object), retired: '2026-10-01' })).toEqual([]);
    expect(
      issues(planSchema, { ...(plan as object), retired: '2026-10-01', endsOn: '2027-01-01' }),
    ).toEqual([]);
    expect(issues(planSchema, { ...(plan as object), endsOn: '2027-01-01' })).toEqual([
      'endsOn: endsOn needs retired: the day it stopped being sold',
    ]);
    expect(
      issues(planSchema, { ...(plan as object), retired: '2026-10-01', endsOn: '2026-09-01' }),
    ).toEqual(['endsOn: Must be on or after retired (2026-10-01)']);
    const provider = at(
      catalog().find(({ file }) => file === netflix),
      'data',
    );
    expect(issues(providerSchema, { ...(provider as object), endsOn: '2027-01-01' })).toEqual([
      'endsOn: endsOn needs retired: the day it stopped being sold',
    ]);
  });

  it('a retired plan’s last prices aren’t flagged as old', () => {
    const messages = (files: CatalogSourceFile[]) =>
      validateCatalog(files, '2027-06-01').map((issue) => formatCatalogIssue(issue));
    const stale = messages(catalog()).filter((message) => message.startsWith(netflix));
    expect(stale).toEqual([expect.stringContaining('were last verified more than 90 days ago')]);
    const retired = edited(catalog(), netflix, ['retired'], '2026-11-01');
    expect(messages(retired).filter((message) => message.startsWith(netflix))).toEqual([]);
  });

  it('a plan takes its own retirement, else its provider’s', () => {
    expect(retirementOf({ retired: '2026-10-01' }, { retired: '2025-01-01' })).toEqual({
      since: '2026-10-01',
    });
    expect(retirementOf({}, { retired: '2025-01-01', endsOn: '2026-01-01' })).toEqual({
      since: '2025-01-01',
      endsOn: '2026-01-01',
    });
    expect(isRetired({ retired: '2026-10-24' }, {}, today)).toBe(false);
    expect(isRetired({ retired: today }, {}, today)).toBe(true);
  });
});

describe('Search and retired plans', () => {
  it('never offers a retired plan, by name or otherwise', () => {
    const { source, data: built } = data(
      catalogWith(netflix, ['plans', 2, 'retired'], '2026-10-01'),
    );
    const search = (q: string) =>
      searchProviders(
        built.providers,
        { q, sort: 'relevance' },
        { features: source.features, categories: source.categories, today },
      ).flatMap((match) => match.plans.map(({ plan }) => plan.id));
    expect(search('netflix')).toEqual(['netflix.standard-ads', 'netflix.standard']);
    expect(search('netflix premium')).toEqual([]);
  });

  it('never offers a retired provider', () => {
    const { source, data: built } = data(edited(catalog(), crave, ['retired'], '2026-10-01'));
    expect(
      searchProviders(
        built.providers,
        { q: 'crave', sort: 'relevance' },
        { features: source.features, categories: source.categories, today },
      ),
    ).toEqual([]);
  });
});

describe('planExtras and retired plans', () => {
  it('leaves out a bundle with a retired plan', () => {
    const offers = (files: CatalogSourceFile[]) => {
      const built = data(files).data;
      const provider = built.providers.find(({ id }) => id === 'crave');
      const premium = provider?.plans.find(({ id }) => id === 'crave.premium');
      if (!provider || !premium) throw new Error('No Crave Premium');
      return planExtras(provider, premium, built, { region: 'CA', currency: 'CAD' }, today).bundles;
    };
    expect(offers(catalog())).toHaveLength(1);
    expect(offers(catalogWith(netflix, ['plans', 1, 'retired'], '2026-10-01'))).toEqual([]);
  });
});
