import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  formatCatalogIssue,
  planSchema,
  readCatalogSource,
  searchProviders,
  validateCatalog,
  itemFormerName,
  type ListItem,
} from '../../src';
import { catalogWith, today } from './catalog-files';
import { issues } from './helpers';

// A renamed plan keeps its id (BLUEPRINT §4.3, M10.27): its former names are matched by Search, and shown on its cards
// on an item until its renewal (M10.28).

const netflix = 'data/providers/netflix.yaml';
const standard = { formerNames: [{ name: 'Basic', until: '2026-05-31' }] };

describe('formerNames', () => {
  const plan = {
    id: 'netflix.standard',
    name: 'Standard',
    link: 'https://www.netflix.com/signup',
    features: {},
    prices: [
      {
        region: 'CA',
        currency: 'CAD',
        amount: 18.99,
        interval: 'month',
        intervalCount: 1,
        autoRenew: true,
        lastVerified: '2026-10-21',
      },
    ],
  };

  it('takes names the plan had, newest first, never its own name or one twice', () => {
    expect(issues(planSchema, { ...plan, ...standard })).toEqual([]);
    expect(
      issues(planSchema, {
        ...plan,
        formerNames: [
          { name: 'Standard', until: '2026-05-31' },
          { name: 'Basic', until: '2026-01-31' },
          { name: 'Basic', until: '2026-06-30' },
        ],
      }),
    ).toEqual([
      'formerNames.2.name: "Basic" is listed more than once',
      "formerNames.0.name: That's its name now: list only the names it had before",
      'formerNames.2.until: List former names newest first',
    ]);
    expect(issues(planSchema, { ...plan, formerNames: [] })).toEqual([
      'formerNames: Leave formerNames out instead of listing none',
    ]);
  });

  it('refuses a rename dated after today', () => {
    const files = catalogWith(
      netflix,
      ['plans', 1, 'formerNames'],
      [{ name: 'Basic', until: '2099-01-01' }],
    );
    expect(validateCatalog(files, today).map((issue) => formatCatalogIssue(issue))).toEqual([
      `${netflix} plans.1.formerNames.0.until: 2099-01-01 is after today (${today}): use the last day the plan had that name`,
    ]);
  });
});

describe('itemFormerName', () => {
  const billing: ListItem['billing'] = {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-06-12',
    autoRenew: true,
  };
  const item = { billing, createdAt: '2026-01-15T12:00:00.000Z' };

  it('shows the old name until the item’s first renewal after the rename', () => {
    expect(itemFormerName(standard, item, '2026-06-11')).toBe('Basic');
    expect(itemFormerName(standard, item, '2026-06-12')).toBeUndefined();
  });

  it('shows nothing on an item added since, or with no charge to come', () => {
    expect(
      itemFormerName(standard, { ...item, createdAt: '2026-06-01T08:00:00.000Z' }, '2026-06-05'),
    ).toBeUndefined();
    expect(
      itemFormerName(
        standard,
        { ...item, billing: { ...billing, endDate: '2026-06-01' } },
        '2026-06-05',
      ),
    ).toBeUndefined();
    expect(itemFormerName({}, item, '2026-06-05')).toBeUndefined();
  });
});

describe('Search and former names', () => {
  it('finds a renamed plan by its old name, as a plan match', () => {
    const files = catalogWith(netflix, ['plans', 1, 'formerNames'], standard.formerNames);
    const source = readCatalogSource(files);
    const { providers } = buildCatalogData(source, 'https://sub.simplely.ca/icons/');
    const [match, ...rest] = searchProviders(
      providers,
      { q: 'basic', sort: 'relevance' },
      { features: source.features, categories: source.categories, today },
    );
    expect(rest).toEqual([]);
    expect(match.plans.map(({ plan }) => plan.id)).toEqual(['netflix.standard']);
    expect(match.matchedOn).toEqual(['plan:netflix.standard']);
  });
});
