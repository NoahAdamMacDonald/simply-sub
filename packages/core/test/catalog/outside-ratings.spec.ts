import { describe, expect, it } from 'vitest';
import {
  buildCatalogData,
  citedFacts,
  citedPages,
  formatCatalogIssue,
  namesCountry,
  outsideRatings,
  ownerCitation,
  ownerSchema,
  quoteLink,
  ratersFileSchema,
  readCatalogSource,
  validateCatalog,
  type CatalogSourceFile,
  type Provider,
  type Rater,
} from '../../src';
import { catalog, edited, today } from './catalog-files';
import { issues } from './helpers';

// Outside ratings and owners (BLUEPRINT §4.10, M11.2): the raters registry, a provider's ratings from it, its owner
// quoted from its own pages, and what a card shows. No news outlet is in the catalog yet, so a fictional one and two
// fictional raters stand in for the news rules.

const leanings = ['Left', 'Lean left', 'Centre', 'Lean right', 'Right'];

const raters: Rater[] = [
  {
    id: 'bias-check',
    name: 'Bias Check',
    website: 'https://biascheck.example.org',
    scales: [
      { subject: 'news-bias', labels: leanings },
      { subject: 'news-reliability', labels: ['High', 'Mostly factual', 'Mixed', 'Low'] },
    ],
    terms: {
      url: 'https://biascheck.example.org/terms',
      quotes: ['You may show our rating of a source with a link to its page.'],
      checked: '2026-10-20',
    },
  },
  {
    id: 'second-look',
    name: 'Second Look',
    website: 'https://www.secondlook.example.com',
    domains: ['ratings.example.net'],
    scales: [
      { subject: 'news-bias', labels: leanings },
      { subject: 'news-reliability', labels: ['Reliable', 'Unreliable'] },
    ],
    terms: {
      url: 'https://www.secondlook.example.com/reuse',
      quotes: ['Labels may be reproduced with a link back.'],
      checked: '2026-10-20',
    },
  },
  {
    id: 'av-lab',
    name: 'AV Lab',
    website: 'https://www.avlab.example.org',
    scales: [{ subject: 'antivirus-protection', labels: ['6.0/6.0', '5.5/6.0', '5.0/6.0'] }],
    terms: {
      url: 'https://www.avlab.example.org/faq',
      quotes: ['You are also allowed to use data from the lab.'],
      checked: '2026-10-20',
    },
  },
];

const planet = 'data/providers/daily-planet.yaml';

const dailyPlanet = {
  id: 'daily-planet',
  name: 'Daily Planet',
  website: 'https://www.dailyplanet.example.com',
  cancelUrl: 'https://www.dailyplanet.example.com/cancel',
  category: 'news',
  spendCategory: 'software',
  paymentMethods: [
    {
      methods: ['card', 'paypal'],
      page: 'Ways to pay',
      url: 'https://www.dailyplanet.example.com/help/payment',
      quotes: ['We accept credit cards and PayPal.'],
    },
  ],
  owner: {
    name: 'Galaxy Communications',
    page: { name: 'About us', url: 'https://www.dailyplanet.example.com/about' },
    quotes: ['The Daily Planet is owned by Galaxy Communications, of Metropolis, New York.'],
    country: { code: 'US' },
    lastVerified: '2026-10-20',
  },
  renewalAnchor: {
    kind: 'not-stated',
    pages: ['https://www.dailyplanet.example.com/terms'],
    lastVerified: '2026-10-20',
  },
  freeUse: {
    kind: 'none',
    pages: ['https://www.dailyplanet.example.com/subscribe'],
    lastVerified: '2026-10-20',
  },
  ratings: [
    {
      rater: 'bias-check',
      subject: 'news-bias',
      label: 'Centre',
      date: '2026-09-14',
      url: 'https://biascheck.example.org/daily-planet',
    },
    {
      rater: 'second-look',
      subject: 'news-bias',
      label: 'Lean left',
      date: '2026-06',
      url: 'https://ratings.example.net/daily-planet',
    },
    {
      rater: 'second-look',
      subject: 'news-reliability',
      label: 'Reliable',
      date: '2026-06',
      url: 'https://ratings.example.net/daily-planet',
    },
    {
      rater: 'bias-check',
      subject: 'news-reliability',
      label: 'High',
      date: '2026-09-14',
      url: 'https://biascheck.example.org/daily-planet',
    },
  ],
  plans: [
    {
      id: 'daily-planet.digital',
      name: 'Digital',
      link: 'https://www.dailyplanet.example.com/subscribe',
      features: {},
      prices: [
        {
          region: 'CA',
          currency: 'CAD',
          amount: 12,
          interval: 'month',
          intervalCount: 1,
          autoRenew: true,
          lastVerified: '2026-10-20',
        },
      ],
    },
  ],
} satisfies Provider;

/** The test catalog with the news raters, a news category and the Daily Planet. */
function withRaters(planetChanges: [(string | number)[], unknown][] = []): CatalogSourceFile[] {
  let files: CatalogSourceFile[] = [
    ...edited(catalog(), 'data/categories.yaml', ['service', 3], {
      id: 'news',
      name: 'News & magazines',
      icon: 'newspaper',
    }),
    // The news raters: the lab would be a rater no provider shows.
    { file: 'data/raters.yaml', data: raters.slice(0, 2) },
    { file: planet, data: dailyPlanet },
  ];
  for (const [path, value] of planetChanges) files = edited(files, planet, path, value);
  return files;
}

/**
 * Each issue as data:validate prints it, but the Daily Planet's missing logo and the test catalog's prices going stale
 * on a later day, which have nothing to do with ratings.
 */
function messages(files: readonly CatalogSourceFile[], on = today): string[] {
  return validateCatalog(files, on)
    .filter((issue) => !/logo|last verified more than 90 days/.test(issue.message))
    .map(
      (issue) => `${issue.severity === 'warning' ? 'warning: ' : ''}${formatCatalogIssue(issue)}`,
    );
}

describe('the raters registry', () => {
  it('accepts raters with a scale for each subject and their terms', () => {
    expect(issues(ratersFileSchema, raters)).toEqual([]);
  });

  it('refuses a rater listed twice, a subject rated twice and a label repeated', () => {
    const twice = [...raters, raters[0]];
    expect(issues(ratersFileSchema, twice)).toEqual([
      '3.id: "bias-check" is listed more than once',
    ]);
    const scales = [...raters[2].scales, { subject: 'antivirus-protection', labels: ['A', 'A'] }];
    expect(issues(ratersFileSchema, [{ ...raters[2], scales }])).toEqual([
      '0.scales.1.labels.1: "A" is listed more than once',
      '0.scales.1.subject: "antivirus-protection" is listed more than once',
    ]);
  });

  it('needs its terms quoted, with the day they were read', () => {
    const terms = { url: 'https://biascheck.example.org/terms', quotes: [] };
    expect(issues(ratersFileSchema, [{ ...raters[0], terms }])).toEqual([
      '0.terms.quotes: Quote the words that allow it',
      '0.terms.checked: Use a real date written YYYY-MM-DD',
    ]);
  });
});

describe('validateCatalog, for outside ratings', () => {
  it('accepts two raters’ labels for a news outlet, and its owner', () => {
    expect(messages(withRaters())).toEqual([]);
  });

  it('refuses a rater not in the registry', () => {
    expect(messages(withRaters([[['ratings', 1, 'rater'], 'second-lok']]))).toEqual([
      `${planet} ratings.1.rater: "second-lok" isn't in data/raters.yaml (did you mean second-look?)`,
    ]);
  });

  it('refuses a news bias rating from one rater only', () => {
    const one = dailyPlanet.ratings.filter((rating) => rating.rater !== 'second-look');
    expect(messages(withRaters([[['ratings'], one]]))).toEqual([
      `${planet} ratings.0.subject: Bias (news-bias) needs 2 raters at least, so no single rater's view stands alone: add another or leave it out`,
      `${planet} ratings.1.subject: Reliability (news-reliability) needs 2 raters at least, so no single rater's view stands alone: add another or leave it out`,
      'warning: data/raters.yaml 1.id: No provider shows this rater: add its ratings to the providers it rates, or remove it',
    ]);
  });

  it('refuses a label off the rater’s scale, and a subject it doesn’t rate', () => {
    expect(messages(withRaters([[['ratings', 0, 'label'], 'Center']]))).toEqual([
      `${planet} ratings.0.label: "Center" isn't on Bias Check's scale for news-bias (Left, Lean left, Centre, Lean right, Right)`,
    ]);
    expect(
      messages(withRaters([[['ratings', 0, 'subject'], 'antivirus-protection']])).slice(0, 1),
    ).toEqual([
      `${planet} ratings.0.subject: Bias Check doesn't rate antivirus-protection (news-bias, news-reliability)`,
    ]);
  });

  it('refuses a date after today, a day or a month', () => {
    expect(messages(withRaters([[['ratings', 0, 'date'], '2026-10-24']]))).toEqual([
      `${planet} ratings.0.date: 2026-10-24 is after today (2026-10-23)`,
    ]);
    expect(messages(withRaters([[['ratings', 1, 'date'], '2026-11']]))).toEqual([
      `${planet} ratings.1.date: 2026-11 is after today (2026-10-23)`,
    ]);
    expect(messages(withRaters([[['ratings', 1, 'date'], '2026-13']]))).toEqual([
      `${planet} ratings.1.date: Invalid input`,
    ]);
  });

  it('warns once a rating is a year old', () => {
    expect(messages(withRaters(), '2027-06-02')).toEqual([
      `warning: ${planet} ratings.1.date: Rated 2026-06, over a year ago: look for Second Look's newer rating`,
      `warning: ${planet} ratings.2.date: Rated 2026-06, over a year ago: look for Second Look's newer rating`,
    ]);
  });

  it('needs the link on the rater’s own site', () => {
    expect(
      messages(withRaters([[['ratings', 0, 'url'], 'https://news.example.com/bias-check']])),
    ).toEqual([
      `${planet} ratings.0.url: Must be Bias Check's own page for it, on biascheck.example.org`,
    ]);
  });

  it('refuses the same rater twice on a subject', () => {
    expect(messages(withRaters([[['ratings', 1, 'rater'], 'bias-check']]))).toEqual([
      `${planet} ratings.1.subject: "bias-check news-bias" is listed more than once`,
    ]);
  });

  it('needs the raters file once a provider shows a rating', () => {
    const files = withRaters().filter(({ file }) => file !== 'data/raters.yaml');
    expect(messages(files)).toEqual([
      'data/raters.yaml: Missing: the outside raters whose labels providers show go here (BLUEPRINT §4.10)',
    ]);
  });
});

describe('validateCatalog, for owners', () => {
  it('needs an owner for every provider', () => {
    expect(messages(withRaters([[['owner'], undefined]]))).toEqual([
      `${planet}: Say who owns it: quote its about page, its owner’s own page about it, or its terms, in owner`,
    ]);
    const crave = edited(catalog(), 'data/providers/crave.yaml', ['owner'], undefined);
    expect(messages(crave)).toEqual([
      'data/providers/crave.yaml: Say who owns it: quote its about page, its owner’s own page about it, or its terms, in owner',
    ]);
  });

  it('takes the quote only from its own sites, its policies’ or its owner’s', () => {
    const elsewhere = 'https://en.wikipedia.org/wiki/Daily_Planet';
    expect(messages(withRaters([[['owner', 'page', 'url'], elsewhere]]))).toEqual([
      `${planet} owner.page.url: Must be a page of Daily Planet's own sites, its policies' or its owner's (dailyplanet.example.com): give the owner's site in website when the page is there`,
    ]);
    // Its owner's own page, with the owner's site given.
    const annualReport = 'https://investors.galaxy.example.com/annual-report';
    expect(
      messages(
        withRaters([
          [['owner', 'page', 'url'], annualReport],
          [['owner', 'website'], 'https://www.galaxy.example.com'],
        ]),
      ),
    ).toEqual([]);
    const galaxy = 'https://www.galaxy.example.com/legal/terms';
    expect(
      messages(
        withRaters([
          [['owner', 'page', 'url'], galaxy],
          [['domains'], ['galaxy.example.com']],
        ]),
      ),
    ).toEqual([]);
  });

  it('needs where the company is from, a real country, on its own sites or its owner’s (2026-11-03)', () => {
    expect(messages(withRaters([[['owner', 'country'], undefined]]))).toEqual([
      `${planet} owner: Say where the company is from: owner.country, an ISO 3166-1 code, quoted from its own pages or its owner’s`,
    ]);
    // "XX" has no names, so its words fail first; "UK" and "EU" have names, so the code itself is refused.
    expect(messages(withRaters([[['owner', 'country', 'code'], 'XX']]))).toEqual([
      `${planet} owner.country.code: The owner's quotes don't name XX: give the country a page and quotes of its own`,
    ]);
    const named = (code: string, quote: string) => ({
      code,
      page: { name: 'Contact us', url: 'https://www.dailyplanet.example.com/contact' },
      quotes: [quote],
      lastVerified: '2026-10-20',
    });
    expect(
      messages(withRaters([[['owner', 'country'], named('UK', 'London, United Kingdom')]])),
    ).toEqual([
      `${planet} owner.country.code: "UK" isn't an ISO 3166-1 region code: use GB for the United Kingdom`,
    ]);
    expect(
      messages(withRaters([[['owner', 'country'], named('EU', 'within the European Union')]])),
    ).toEqual([`${planet} owner.country.code: "EU" isn't an ISO 3166-1 country code (US, CA, CH)`]);
    const elsewhere = {
      code: 'US',
      page: { name: 'Profile', url: 'https://en.wikipedia.org/wiki/Daily_Planet' },
      quotes: ['Metropolis, New York'],
      lastVerified: '2026-10-20',
    };
    expect(messages(withRaters([[['owner', 'country'], elsewhere]]))).toEqual([
      `${planet} owner.country.page.url: Must be a page of Daily Planet's own sites, its policies' or its owner's (dailyplanet.example.com): give the owner's site in website when the page is there`,
    ]);
  });

  it('takes a public company’s shares from the same sites, read no later than today (2026-11-10)', () => {
    const investors = (url: string, lastVerified = '2026-10-20') => ({
      company: 'Galaxy Holdings Inc.',
      listings: [{ exchange: 'TSX', symbol: 'GLX' }],
      page: { name: 'Investors', url },
      quotes: ['Galaxy Holdings Inc. (TSX: GLX)'],
      lastVerified,
    });
    expect(
      messages(
        withRaters([
          [['owner', 'stock'], investors('https://investors.galaxy.example.com/')],
          [['owner', 'website'], 'https://www.galaxy.example.com'],
        ]),
      ),
    ).toEqual([]);
    expect(
      messages(withRaters([[['owner', 'stock'], investors('https://www.tmx.example.com/glx')]])),
    ).toEqual([
      `${planet} owner.stock.page.url: Must be a page of Daily Planet's own sites, its policies' or its owner's (dailyplanet.example.com): give the owner's site in website when the page is there`,
    ]);
    const tomorrow = investors('https://www.dailyplanet.example.com/investors', '2026-10-24');
    expect(messages(withRaters([[['owner', 'stock'], tomorrow]]))).toEqual([
      `${planet} owner.stock.lastVerified: 2026-10-24 is after today (2026-10-23)`,
    ]);
  });

  it('refuses a read date after today, and warns once it’s a year old', () => {
    expect(messages(withRaters([[['owner', 'lastVerified'], '2026-10-24']]))).toEqual([
      `${planet} owner.lastVerified: 2026-10-24 is after today (2026-10-23)`,
    ]);
    // The renewal days and free use read the same day warn too (M11.5, 2026-11-09): the owners' are what this test is
    // about.
    const owners = messages(withRaters([[['ratings'], undefined]]), '2027-10-21').filter(
      (message) =>
        !message.includes('renewalAnchor.lastVerified') &&
        !message.includes('freeUse.lastVerified'),
    );
    expect(owners).toEqual(
      [
        `warning: ${planet} owner.lastVerified: Read on 2026-10-20, over a year ago: read the page again`,
        'warning: data/raters.yaml 0.id: No provider shows this rater: add its ratings to the providers it rates, or remove it',
        'warning: data/raters.yaml 1.id: No provider shows this rater: add its ratings to the providers it rates, or remove it',
        // The test catalog's own owners, read the same day.
        'warning: data/providers/crave.yaml owner.lastVerified: Read on 2026-10-20, over a year ago: read the page again',
        // Its country, from a page of its own (the owner's choice, 2026-11-03), in the file's order.
        'warning: data/providers/mullvad.yaml owner.country.lastVerified: Read on 2026-10-20, over a year ago: read the page again',
        'warning: data/providers/mullvad.yaml owner.lastVerified: Read on 2026-10-20, over a year ago: read the page again',
        'warning: data/providers/netflix.yaml owner.lastVerified: Read on 2026-10-20, over a year ago: read the page again',
        'warning: data/providers/proton.yaml owner.lastVerified: Read on 2026-10-20, over a year ago: read the page again',
      ].sort(byFile),
    );
  });
});

/** Issues in data:validate's order: by file, as validateCatalog checks them. */
function byFile(a: string, b: string): number {
  return order(a) - order(b);
}

function order(message: string): number {
  return ['crave', 'mullvad', 'netflix', 'proton', 'daily-planet', 'raters'].findIndex((name) =>
    message.includes(name),
  );
}

describe('outsideRatings', () => {
  it('groups the labels by subject, in core’s order, with each rater’s name', () => {
    expect(outsideRatings(dailyPlanet, raters)).toEqual([
      {
        subject: 'news-bias',
        name: 'Bias',
        ratings: [
          {
            rater: 'Bias Check',
            label: 'Centre',
            date: '2026-09-14',
            url: 'https://biascheck.example.org/daily-planet',
          },
          {
            rater: 'Second Look',
            label: 'Lean left',
            date: '2026-06',
            url: 'https://ratings.example.net/daily-planet',
          },
        ],
      },
      {
        subject: 'news-reliability',
        name: 'Reliability',
        ratings: [
          {
            rater: 'Second Look',
            label: 'Reliable',
            date: '2026-06',
            url: 'https://ratings.example.net/daily-planet',
          },
          {
            rater: 'Bias Check',
            label: 'High',
            date: '2026-09-14',
            url: 'https://biascheck.example.org/daily-planet',
          },
        ],
      },
    ]);
  });

  it('leaves out a rater the catalog doesn’t list, and has nothing without ratings', () => {
    expect(
      outsideRatings(dailyPlanet, raters.slice(0, 1)).map(({ ratings }) => ratings.length),
    ).toEqual([1, 1]);
    expect(outsideRatings({}, raters)).toEqual([]);
  });
});

describe('ownerCitation', () => {
  it('checks that the country’s words name it: its own quotes, else the owner’s', () => {
    const owner = dailyPlanet.owner;
    const page = { name: 'Contact us', url: 'https://www.dailyplanet.example.com/contact' };
    const own = (quotes: string[]) => ({ code: 'US', page, quotes, lastVerified: '2026-10-20' });
    expect(issues(ownerSchema, owner)).toEqual([]);
    expect(issues(ownerSchema, { ...owner, country: { code: 'CA' } })).toEqual([
      "country.code: The owner's quotes don't name CA: give the country a page and quotes of its own",
    ]);
    expect(
      issues(ownerSchema, { ...owner, country: own(['355 Main Street, Metropolis']) }),
    ).toEqual([
      'country.quotes: No quote names US: quote the words that name the country, its people or, in an address, a state or province',
    ]);
    expect(issues(ownerSchema, { ...owner, country: { code: 'US', page } })).toEqual([
      'country.quotes: Give its page, quotes and lastVerified together, or none when the owner’s quotes say it',
    ]);
    expect(issues(ownerSchema, { ...owner, country: { code: 'us' } })[0]).toMatch(
      /^country\.code:/,
    );
  });

  it.each([
    ['Los Gatos, CA 95032, USA', 'US', true],
    ['One Microsoft Way, Redmond, WA 98052, U.S.A.', 'US', true],
    ['a company based and headquartered in the United States', 'US', true],
    ['ESPN Headquarters in Bristol, Connecticut', 'US', true],
    ['500 South Buena Vista Street, Burbank, California 91521', 'US', true],
    ['siège social aux États-Unis', 'US', true],
    ['Visa, Mastercard, American Express', 'US', false],
    ['San Francisco, CA 94104', 'US', false],
    ['Bell Media is Canada’s leading media and entertainment company', 'CA', true],
    ['299 Queen Street West, Toronto, Ontario M5V 2Z5', 'CA', true],
    ['Montréal (Québec)', 'CA', true],
    ['une société canadienne', 'CA', true],
    ['Proton AG, a Swiss corporation', 'CH', true],
    ['Plan-les-Ouates, Genève, Suisse', 'CH', true],
    ['a VPN provider based in Sweden', 'SE', true],
    ['Bucharest, Romania', 'RO', true],
    ['Minato-ku, Tokyo, Japan', 'JP', true],
    ['Bucharest, Romania', 'SE', false],
    // Videoland's, on Viaplay's Dutch help centre (M11.15): the Netherlands' own name.
    ['Videoland, een van de toonaangevende streaming- en tv-aanbieders van Nederland', 'NL', true],
    ['a Dutch broadcaster', 'NL', true],
    ['Nederlandse', 'BE', false],
    // Mixcloud's terms (M11.15): one of the UK's nations names the UK, as a US state names the US.
    ['a company incorporated in England', 'GB', true],
    ['registered in Scotland', 'GB', true],
    ['offices across New England', 'GB', false],
  ] as const)('reads "%s" as naming %s: %s', (text, code, named) => {
    expect(namesCountry(text, code)).toBe(named);
  });

  it('links the owner’s page to its quotes, with where it’s from', () => {
    expect(ownerCitation(dailyPlanet.owner)).toEqual({
      name: 'Galaxy Communications',
      page: 'About us',
      href: quoteLink('https://www.dailyplanet.example.com/about', dailyPlanet.owner.quotes),
      quotes: ['The Daily Planet is owned by Galaxy Communications, of Metropolis, New York.'],
      // The owner's quotes say it, so the country has no page of its own.
      country: { code: 'US' },
    });
  });

  it('checks that the stock’s words name each exchange, symbol and majority holder (2026-11-10)', () => {
    const owner = {
      ...dailyPlanet.owner,
      quotes: [
        'The Daily Planet is owned by Galaxy Communications, of Metropolis, New York.',
        'Galaxy Communications (NYSE: GXC) is 61.2% owned by the Kent Family Trust.',
      ],
    };
    const nyse = { exchange: 'NYSE', symbol: 'GXC' };
    const trust = { name: 'the Kent Family Trust', percent: 61.2, of: 'shares' };
    // The owner's quotes say it all, so the stock has no page of its own.
    expect(
      issues(ownerSchema, { ...owner, stock: { listings: [nyse], majorityHolder: trust } }),
    ).toEqual([]);
    expect(
      issues(ownerSchema, {
        ...owner,
        stock: {
          listings: [{ exchange: 'TSX', symbol: 'GX' }],
          majorityHolder: { ...trust, name: 'Lex Holdings', percent: 61 },
        },
      }),
    ).toEqual([
      "stock.listings.0.exchange: The owner's quotes don't name TSX: give the stock a page and quotes of its own",
      // GX is part of GXC, which doesn't count.
      "stock.listings.0.symbol: The owner's quotes don't name GX: give the stock a page and quotes of its own",
      "stock.majorityHolder.name: The owner's quotes don't name Lex Holdings: give the stock a page and quotes of its own",
      "stock.majorityHolder.percent: The owner's quotes don't name 61%: give the stock a page and quotes of its own",
    ]);
    // Its own page's words, once it has them.
    const investors = { name: 'Investors', url: 'https://www.dailyplanet.example.com/investors' };
    expect(
      issues(ownerSchema, {
        ...owner,
        stock: {
          listings: [{ exchange: 'TSX', symbol: 'GX' }],
          page: investors,
          quotes: ['Our shares trade on the TSX as GX.'],
          lastVerified: '2026-10-20',
        },
      }),
    ).toEqual([]);
    // Its own words and the owner's both count: the owner's give NYSE and the holder, its own TSX.
    const both = [nyse, { exchange: 'TSX', symbol: 'GX' }, { exchange: 'Nasdaq', symbol: 'GLXY' }];
    expect(
      issues(ownerSchema, {
        ...owner,
        stock: {
          listings: both,
          majorityHolder: trust,
          page: investors,
          quotes: ['Galaxy is listed on the TSX.'],
        },
      }),
    ).toEqual([
      'stock.lastVerified: Give its page, quotes and lastVerified together, or none when the owner’s quotes say it',
      'stock.listings.1.symbol: No quote names GX',
      'stock.listings.2.exchange: No quote names Nasdaq',
      'stock.listings.2.symbol: No quote names GLXY',
    ]);
  });

  it('needs listings or a majority holder, a symbol in capitals, and a majority above half', () => {
    const owner = dailyPlanet.owner;
    expect(issues(ownerSchema, { ...owner, stock: {} })).toEqual([
      'stock: Give its listings, its majority holder, or both',
    ]);
    expect(
      issues(ownerSchema, {
        ...owner,
        stock: { listings: [{ exchange: 'NYSE', symbol: 'gxc' }] },
      })[0],
    ).toBe(
      'stock.listings.0.symbol: Use the ticker symbol in capitals, as the exchange lists it (BCE, RCI.B)',
    );
    expect(
      issues(ownerSchema, {
        ...owner,
        stock: { majorityHolder: { name: 'Galaxy Communications', percent: 50, of: 'votes' } },
      }),
    ).toEqual(['stock.majorityHolder.percent: A majority is more than 50%']);
  });

  it('gives the stock’s listings and majority holder, with its own page when it has one', () => {
    const investors = { name: 'Investors', url: 'https://www.dailyplanet.example.com/investors' };
    const quotes = ['Galaxy Holdings Inc. (TSX: GLX) is controlled by the Kent Family Trust.'];
    expect(
      ownerCitation({
        ...dailyPlanet.owner,
        stock: {
          company: 'Galaxy Holdings Inc.',
          listings: [{ exchange: 'TSX', symbol: 'GLX' }],
          majorityHolder: { name: 'the Kent Family Trust', of: 'votes' },
          page: investors,
          quotes,
          lastVerified: '2026-10-20',
        },
      }).stock,
    ).toEqual({
      company: 'Galaxy Holdings Inc.',
      listings: [{ exchange: 'TSX', symbol: 'GLX' }],
      majorityHolder: { name: 'the Kent Family Trust', of: 'votes' },
      cited: { page: 'Investors', href: quoteLink(investors.url, quotes), quotes },
    });
    expect(
      ownerCitation({
        ...dailyPlanet.owner,
        stock: { majorityHolder: { name: 'Galaxy Communications', of: 'shares' } },
      }).stock,
    ).toEqual({ listings: [], majorityHolder: { name: 'Galaxy Communications', of: 'shares' } });
    expect(ownerCitation(dailyPlanet.owner).stock).toBeUndefined();
  });

  it('links a country quoted from a page of its own (the owner’s choice, 2026-11-03)', () => {
    const contact = { name: 'Contact us', url: 'https://www.dailyplanet.example.com/contact' };
    const quotes = ['355 Main Street, Metropolis, New York, USA'];
    expect(
      ownerCitation({
        ...dailyPlanet.owner,
        country: { code: 'US', page: contact, quotes, lastVerified: '2026-10-20' },
      }).country,
    ).toEqual({
      code: 'US',
      cited: { page: 'Contact us', href: quoteLink(contact.url, quotes), quotes },
    });
  });
});

describe('the catalog files, with raters', () => {
  it('publishes the raters with the catalog, and leaves them out when there are none', () => {
    const data = buildCatalogData(
      readCatalogSource(withRaters()),
      'https://sub.simplely.ca/icons/',
    );
    expect(data.raters?.map((rater) => rater.id)).toEqual(['bias-check', 'second-look']);
    expect(buildCatalogData(readCatalogSource(catalog()), '').raters).toBeUndefined();
  });

  it('cites the owner’s page as a policy page, with its quotes', () => {
    const source = readCatalogSource(withRaters());
    const about = 'https://www.dailyplanet.example.com/about';
    expect(citedPages(source.providers, source.bundles)).toContainEqual({
      url: about,
      type: 'policies',
      owners: ['daily-planet'],
    });
    expect(citedFacts(source.providers, source.bundles, about).quotes).toEqual(
      dailyPlanet.owner.quotes,
    );
  });

  it('cites the stock’s own page as a policy page, with its quotes (2026-11-10)', () => {
    const investors = 'https://www.dailyplanet.example.com/investors';
    const quotes = ['Galaxy Holdings Inc. (TSX: GLX)'];
    const source = readCatalogSource(
      withRaters([
        [
          ['owner', 'stock'],
          {
            listings: [{ exchange: 'TSX', symbol: 'GLX' }],
            page: { name: 'Investors', url: investors },
            quotes,
            lastVerified: '2026-10-20',
          },
        ],
      ]),
    );
    expect(citedPages(source.providers, source.bundles)).toContainEqual({
      url: investors,
      type: 'policies',
      owners: ['daily-planet'],
    });
    expect(citedFacts(source.providers, source.bundles, investors).quotes).toEqual(quotes);
  });
});
