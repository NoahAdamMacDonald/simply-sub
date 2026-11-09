import { describe, expect, it } from 'vitest';
import {
  currenciesEntrySchema,
  currenciesIn,
  formatCatalogIssue,
  namesCurrency,
  namesRenewalAnchor,
  renewalAnchorKind,
  renewalAnchorSchema,
  repositoryLabel,
  validateCatalog,
  type CatalogSourceFile,
  type CurrenciesEntry,
  type RenewalAnchor,
  type SourceRepo,
} from '../../src';
import { catalog, catalogWith, edited, price, today } from './catalog-files';
import { issues } from './helpers';

// A provider's facts beside its ways to pay (M11.5, the guide's §3.1): the day it renews on, the currencies it takes
// beyond its price lists, and where its source code is, each quoted from its own pages.

const netflix = 'data/providers/netflix.yaml';
const mullvad = 'data/providers/mullvad.yaml';
const features = 'data/features.yaml';

const cash = {
  codes: ['EUR', 'USD', 'CAD'],
  methods: ['cash'],
  page: 'Terms of service',
  url: 'https://mullvad.net/en/help/terms-service',
  quotes: ['We accept payment by cash in bills (EUR, USD, CAD) sent by regular mail'],
} satisfies CurrenciesEntry;

const onSignUp = {
  kind: 'same-date',
  page: 'How to check your Netflix billing date',
  url: 'https://example.com/billing-date',
  quotes: [
    'Your billing cycle starts on the date you sign up.',
    'If your billing date does not occur on the last day of each month (for example, the 31st), you will be billed on the last day of that month instead.',
  ],
  lastVerified: '2026-10-20',
} satisfies RenewalAnchor;

const repo = {
  url: 'https://github.com/mullvad/mullvadvpn-app',
  page: { name: 'Why Mullvad VPN?', url: 'https://mullvad.net/en/why-mullvad-vpn' },
  quotes: ['Code is open source'],
  lastVerified: '2026-10-20',
} satisfies SourceRepo;

/** software.open-source as features.yaml has it: provider-wide, worst to best. */
const openSource = {
  id: 'software.open-source',
  name: 'Open source',
  category: 'vpn',
  type: 'enum',
  values: [
    { id: 'proprietary', name: 'Closed source' },
    { id: 'source-available', name: 'Source available' },
    { id: 'open-clients', name: 'Open-source apps' },
    { id: 'fully-open', name: 'Fully open source' },
  ],
  providerWide: true,
};

/** The catalog with software.open-source in the registry. */
function withOpenSource(files: readonly CatalogSourceFile[]): CatalogSourceFile[] {
  return files.map((source) =>
    source.file === features && 'data' in source
      ? { file: features, data: [...(source.data as unknown[]), openSource] }
      : source,
  );
}

function messages(
  files: readonly CatalogSourceFile[],
  options: Parameters<typeof validateCatalog>[2] = {},
  on = today,
): string[] {
  return validateCatalog(files, on, options).map(
    (issue) => `${issue.severity === 'warning' ? 'warning: ' : ''}${formatCatalogIssue(issue)}`,
  );
}

describe('currenciesEntrySchema', () => {
  it('accepts a page whose quotes name each currency, by code, name or sign', () => {
    expect(issues(currenciesEntrySchema, cash)).toEqual([]);
    const named = { ...cash, quotes: ['Pay in euros (€), US dollars or Canadian dollars'] };
    expect(issues(currenciesEntrySchema, named)).toEqual([]);
  });

  it('needs a quote naming each one', () => {
    const gbp = { ...cash, codes: ['EUR', 'GBP'] };
    expect(issues(currenciesEntrySchema, gbp)).toEqual([
      "codes.1: No quote names GBP: quote the page's words for it (its code, name or sign)",
    ]);
  });

  it('lists a code, a method and a region once', () => {
    const twice = { ...cash, codes: ['EUR', 'EUR'], methods: ['cash', 'cash'] };
    expect(issues(currenciesEntrySchema, twice)).toEqual([
      'codes.1: "EUR" is listed more than once',
      'methods.1: "cash" is listed more than once',
    ]);
  });
});

describe('namesCurrency', () => {
  it.each([
    ['(EUR, USD, GBP)', 'GBP', true],
    ['€5 a month', 'EUR', true],
    ['CA$7.84', 'CAD', true],
    ['Canadian dollars', 'CAD', true],
    ['dollars canadiens', 'CAD', true],
    ['$7.84', 'CAD', false],
    ['$7.84', 'USD', false],
    ['US$5.59', 'USD', true],
    ['Swedish kronor', 'SEK', true],
    ['EURO', 'EUR', true],
    ['NEURO', 'EUR', false],
  ] as const)('reads "%s" as naming %s: %s', (text, code, named) => {
    expect(namesCurrency(text, code)).toBe(named);
  });
});

describe('renewalAnchorSchema', () => {
  it('accepts a kind its quotes state, or not-stated with the pages read', () => {
    expect(issues(renewalAnchorSchema, onSignUp)).toEqual([]);
    expect(
      issues(renewalAnchorSchema, {
        kind: 'not-stated',
        pages: ['https://example.com/terms', 'https://example.com/help/billing'],
        lastVerified: '2026-10-20',
      }),
    ).toEqual([]);
  });

  it('needs quotes that say which day', () => {
    const first = { ...onSignUp, kind: 'first-of-month' };
    expect(issues(renewalAnchorSchema, first)).toEqual([
      'quotes: No quote says it renews on the 1st of each month: quote the words that do',
    ]);
  });

  it('takes no quotes with not-stated, and no pages with a kind', () => {
    expect(
      issues(renewalAnchorSchema, {
        kind: 'not-stated',
        pages: ['https://example.com/terms'],
        quotes: ['Billed monthly.'],
        lastVerified: '2026-10-20',
      }),
    ).toEqual([': Unrecognized key: "quotes"']);
    expect(issues(renewalAnchorSchema, { ...onSignUp, pages: ['https://example.com'] })).toEqual([
      ': Unrecognized key: "pages"',
    ]);
  });
});

describe('namesRenewalAnchor', () => {
  it.each([
    ['Netflix membership plans are billed monthly on the date you signed up.', 'same-date', true],
    ['Your billing cycle starts on the date you sign up.', 'same-date', true],
    ['Renews on the same day each month', 'same-date', true],
    // What implies it (M11.9): Disney's and Bell Media's terms, in English and French, and Claude's billing help.
    [
      'the timing of a recurring charge may change, such as if your subscription began on a date not contained in a given month.',
      'same-date',
      true,
    ],
    ['if your subscription began on a day not contained in a given month', 'same-date', true],
    [
      'si votre abonnement a commencé à une date non comprise dans un mois donné.',
      'same-date',
      true,
    ],
    [
      'resubscribe on your preferred billing date to establish your new monthly billing cycle on a different date.',
      'same-date',
      true,
    ],
    // YouTube TV's trial article (M11.15): the first charge's date recurs each month.
    [
      'The date of this charge will become your monthly billing date going forward.',
      'same-date',
      true,
    ],
    // Viki's help centre (M11.15): the day bought recurs, by example.
    [
      "if you purchased a monthly Viki Pass plan on the 1st of the month, you'll continue to be billed on the 1st of each month.",
      'same-date',
      true,
    ],
    ['If you purchased on the 3rd, you are billed on the 1st of each month.', 'same-date', false],
    // discovery+'s help centre (M11.15): the sign-up date sets each month's.
    [
      'You will be billed in monthly intervals, based on the date when you signed up.',
      'same-date',
      true,
    ],
    ['Your subscription began on a Tuesday.', 'same-date', false],
    // iQIYI's help centre (M11.15): each period a calendar month from the one before.
    [
      'Auto-renewing recurrent monthly, quarterly, and yearly subscriptions are charged on a calendar month, quarter, and year basis, with the validity of each period aligning with the billing cycle.',
      'same-date',
      true,
    ],
    ['Charged on a calendar month basis.', 'same-date', false],
    ['Charged on a calendar month basis.', 'first-of-month', false],
    ['Your plan renews every 30 days.', 'every-30-days', true],
    ['Un forfait de 30 jours', 'every-30-days', true],
    ['You’re billed on the 1st of each month.', 'first-of-month', true],
    ['Facturé le premier jour de chaque mois', 'first-of-month', true],
    ['Charged on the last day of each month', 'end-of-month', true],
    ['you will be billed on the last day of that month instead', 'end-of-month', false],
    ['Billed monthly.', 'same-date', false],
  ] as const)('reads "%s" as %s: %s', (text, kind, named) => {
    expect(namesRenewalAnchor(text, kind)).toBe(named);
  });
});

describe('renewalAnchorKind', () => {
  it('is the kind its pages state, else undefined', () => {
    expect(renewalAnchorKind({ renewalAnchor: onSignUp })).toBe('same-date');
    expect(
      renewalAnchorKind({
        renewalAnchor: { kind: 'not-stated', pages: ['https://example.com'], lastVerified: today },
      }),
    ).toBeUndefined();
    expect(renewalAnchorKind({})).toBeUndefined();
    expect(renewalAnchorKind(undefined)).toBeUndefined();
  });
});

describe('currenciesIn', () => {
  const ca = {
    ...cash,
    codes: ['CAD'],
    quotes: ['CAD'],
    regions: ['CA'],
  } satisfies CurrenciesEntry;
  const eu = {
    ...cash,
    codes: ['SEK'],
    quotes: ['SEK'],
    regions: ['EU'],
  } satisfies CurrenciesEntry;
  const provider = { currencies: [cash, ca, eu] };

  it('gives every entry for the region, a group it’s in, and everywhere, in order', () => {
    expect(currenciesIn(provider, 'CA')).toEqual([cash, ca]);
    expect(currenciesIn(provider, 'SE')).toEqual([cash, eu]);
    expect(currenciesIn(provider, 'US')).toEqual([cash]);
    expect(currenciesIn({}, 'US')).toEqual([]);
  });
});

describe('repositoryLabel', () => {
  it('drops https:// and a trailing slash', () => {
    expect(repositoryLabel('https://github.com/mullvad/')).toBe('github.com/mullvad');
    expect(repositoryLabel(repo.url)).toBe('github.com/mullvad/mullvadvpn-app');
  });
});

describe('validateCatalog, for the renewal day', () => {
  const missing = `${netflix}: Say which day it renews on, quoted from its terms or billing help (renewalAnchor), or that they don’t say (kind: not-stated)`;

  it('needs it of a provider whose paid plans renew by the month or year', () => {
    expect(messages(catalogWith(netflix, ['renewalAnchor'], undefined))).toEqual([missing]);
    expect(
      messages(catalogWith(netflix, ['renewalAnchor'], undefined), {
        awaitingRenewal: new Set(['netflix']),
      }),
    ).toEqual([`warning: ${missing}`]);
  });

  it('needs none of a prepaid provider, or one that’s retired', () => {
    // The test catalog's Mullvad is prepaid, with no renewal day.
    expect(messages(catalog())).toEqual([]);
    const retired = catalogWith(netflix, ['renewalAnchor'], undefined).map((source) =>
      source.file === netflix && 'data' in source
        ? { file: netflix, data: { ...(source.data as object), retired: '2026-10-01' } }
        : source,
    );
    expect(messages(retired)).toEqual([]);
  });

  it('takes its pages from its own sites, and a read date no later than today', () => {
    const elsewhere = {
      ...onSignUp,
      url: 'https://www.reddit.com/r/netflix',
      lastVerified: '2026-10-24',
    };
    expect(messages(catalogWith(netflix, ['renewalAnchor'], elsewhere))).toEqual([
      `${netflix} renewalAnchor.url: Must be a page of Netflix's own sites, its policies' or its owner's (example.com)`,
      `${netflix} renewalAnchor.lastVerified: 2026-10-24 is after today (2026-10-23)`,
    ]);
    const unread = {
      kind: 'not-stated',
      pages: ['https://www.reddit.com/r/netflix'],
      lastVerified: today,
    };
    expect(messages(catalogWith(netflix, ['renewalAnchor'], unread))).toEqual([
      `${netflix} renewalAnchor.pages.0: Must be a page of Netflix's own sites, its policies' or its owner's (example.com)`,
    ]);
  });

  it('warns once it was read a year ago', () => {
    expect(messages(catalog(), {}, '2027-10-21')).toContain(
      `warning: ${netflix} renewalAnchor.lastVerified: Read on 2026-10-20, over a year ago: read the page again`,
    );
  });

  it('prices a provider that renews every 30 days by the day', () => {
    const every30 = {
      ...onSignUp,
      kind: 'every-30-days',
      quotes: ['Your plan renews every 30 days.'],
    };
    const files = catalogWith(netflix, ['renewalAnchor'], every30);
    expect(messages(files)).toEqual([
      `${netflix} plans.0.prices.0.interval: It renews every 30 days (renewalAnchor): price its months as interval day, intervalCount 30`,
      `${netflix} plans.0.prices.1.interval: It renews every 30 days (renewalAnchor): price its months as interval day, intervalCount 30`,
      `${netflix} plans.1.prices.0.interval: It renews every 30 days (renewalAnchor): price its months as interval day, intervalCount 30`,
      `${netflix} plans.1.prices.1.interval: It renews every 30 days (renewalAnchor): price its months as interval day, intervalCount 30`,
      `${netflix} plans.2.prices.0.interval: It renews every 30 days (renewalAnchor): price its months as interval day, intervalCount 30`,
    ]);
    const daily = { ...price('CA', 'CAD', 7.99, 'day'), intervalCount: 30 };
    const byDay = edited(
      edited(
        edited(files, netflix, ['plans', 0, 'prices'], [daily]),
        netflix,
        ['plans', 1, 'prices'],
        [daily],
      ),
      netflix,
      ['plans', 2, 'prices'],
      [daily],
    );
    expect(messages(byDay)).toEqual([]);
  });
});

describe('validateCatalog, for inferred feature values (M11.9)', () => {
  const inferred = {
    reason: 'No page states it, but its help recommends a speed for HD content.',
    page: { name: 'Help Center', url: 'https://example.com/help/306' },
    lastVerified: today,
  };

  it('marks a value the plan states, inferred from its own pages', () => {
    expect(
      messages(catalogWith(netflix, ['plans', 0, 'inferred'], { 'video.quality': inferred })),
    ).toEqual([]);
  });

  it('refuses a feature the plan doesn’t state, a page off its sites and a page not read yet', () => {
    const wrong = {
      ...inferred,
      page: { ...inferred.page, url: 'https://www.reddit.com/r/netflix' },
      lastVerified: '2099-01-01',
    };
    expect(
      messages(catalogWith(netflix, ['plans', 0, 'inferred'], { 'vpn.kill-switch': wrong })),
    ).toEqual([
      `${netflix} plans.0.inferred.vpn.kill-switch: Names a feature the plan doesn’t state: give its value in features first`,
      `${netflix} plans.0.inferred.vpn.kill-switch.page.url: Must be a page of Netflix's own sites, its policies' or its owner's (example.com)`,
      `${netflix} plans.0.inferred.vpn.kill-switch.lastVerified: 2099-01-01 is after today (${today})`,
    ]);
  });
});

describe('validateCatalog, for currencies', () => {
  it('takes them from its own sites, for the ways to pay it lists', () => {
    expect(messages(catalogWith(mullvad, ['currencies'], [cash]))).toEqual([]);
    const elsewhere = {
      ...cash,
      url: 'https://www.reddit.com/r/mullvadvpn',
      methods: ['gift-card'],
    };
    expect(messages(catalogWith(mullvad, ['currencies'], [elsewhere]))).toEqual([
      `${mullvad} currencies.0.methods.0: Mullvad VPN's paymentMethods don't list gift-card: list it there, quoted, or leave it out here`,
      `${mullvad} currencies.0.url: Must be a page of Mullvad VPN's own sites, its policies' or its owner's (mullvad.net)`,
    ]);
  });

  it('needs real regions and real currencies', () => {
    const odd = { ...cash, codes: ['EUR', 'ABC'], quotes: ['EUR, ABC'], regions: ['UK'] };
    expect(messages(catalogWith(mullvad, ['currencies'], [odd]))).toEqual([
      `${mullvad} currencies.0.regions.0: "UK" isn't an ISO 3166-1 region code: use GB for the United Kingdom`,
      `${mullvad} currencies.0.codes.1: "ABC" isn't a real ISO 4217 currency code`,
    ]);
  });
});

describe('validateCatalog, for the source code', () => {
  it('links the repository of a provider whose apps are open, from its own page', () => {
    const files = withOpenSource(catalog());
    const open = edited(files, mullvad, ['features'], { 'software.open-source': 'open-clients' });
    expect(messages(edited(open, mullvad, ['sourceRepo'], repo))).toEqual([]);
    expect(messages(open)).toEqual([
      `${mullvad}: Its apps are open source (software.open-source): link the repository its own page links, in sourceRepo`,
    ]);
    const elsewhere = {
      ...repo,
      page: { name: 'A review', url: 'https://www.reddit.com/r/mullvadvpn' },
    };
    expect(messages(edited(open, mullvad, ['sourceRepo'], elsewhere))).toEqual([
      `${mullvad} sourceRepo.page.url: Must be a page of Mullvad VPN's own sites, its policies' or its owner's (mullvad.net)`,
    ]);
  });

  it('needs software.open-source with a repository: source-available or more', () => {
    const files = withOpenSource(catalog());
    const needs = `${mullvad} sourceRepo: A repository link needs software.open-source saying how open its code is (source-available or more)`;
    expect(messages(edited(files, mullvad, ['sourceRepo'], repo))).toEqual([needs]);
    const closed = edited(files, mullvad, ['features'], { 'software.open-source': 'proprietary' });
    expect(messages(edited(closed, mullvad, ['sourceRepo'], repo))).toEqual([needs]);
    const available = edited(files, mullvad, ['features'], {
      'software.open-source': 'source-available',
    });
    expect(messages(edited(available, mullvad, ['sourceRepo'], repo))).toEqual([]);
    expect(messages(available)).toEqual([]);
  });
});
