import { describe, expect, it } from 'vitest';
import {
  findPages,
  linksIn,
  missingPath,
  onProviderSite,
  pageFits,
  parseWebAddress,
  readSitemap,
  registeredDomain,
  sitemapsIn,
  urlScore,
  type FetchedPage,
  type FindIo,
  type SearchResult,
} from '../../src';

const long = (text: string) => `${text} ${'Lorem ipsum dolor sit amet. '.repeat(40)}`;

describe('urlScore', () => {
  it('scores pricing paths and link words, in English and French', () => {
    expect(urlScore('pricing', 'https://mullvad.net/en/pricing')).toBeGreaterThan(4);
    expect(urlScore('pricing', 'https://www.rds.ca/abonnement/')).toBeGreaterThan(4);
    expect(
      urlScore('pricing', 'https://help.netflix.com/en/node/24926', 'Plans and Pricing'),
    ).toBeGreaterThan(4);
    expect(
      urlScore('pricing', 'https://help.hulu.com/article/hulu-how-much-does-hulu-cost'),
    ).toBeGreaterThan(4);
    expect(urlScore('pricing', 'https://example.com/about')).toBe(0);
  });

  it("prefers Canada's pages and passes over another country's", () => {
    const ca = urlScore('pricing', 'https://help.disneyplus.com/article/disneyplus-en-ca-price');
    const au = urlScore(
      'pricing',
      'https://help.disneyplus.com/en-GB/article/disneyplus-en-au-price',
    );
    const frCa = urlScore('pricing', 'https://help.disneyplus.com/fr-CA/article/disneyplus-price');
    expect(ca).toBeGreaterThan(frCa);
    expect(frCa).toBeGreaterThan(au);
    expect(urlScore('pricing', 'https://www.spotify.com/ca-en/premium/')).toBeGreaterThan(
      urlScore('pricing', 'https://www.spotify.com/de/premium/'),
    );
  });

  it('leaves out business plans, sign-ins and a catalogue’s shows', () => {
    expect(
      urlScore('pricing', 'https://www.bitdefender.com/en-ca/business/compare', 'Compare plans'),
    ).toBe(0);
    expect(
      urlScore('pricing', 'https://www.crave.ca/en/play/power/best-laid-plans-s1e8-1321256'),
    ).toBe(0);
    expect(urlScore('cancel', 'https://example.com/login?next=/cancel')).toBe(0);
  });

  it('puts an article before the list it is in', () => {
    expect(urlScore('pricing', 'https://help.hulu.com/category/plans-and-add-ons')).toBeLessThan(
      urlScore('pricing', 'https://help.hulu.com/article/hulu-plans'),
    );
  });

  it('scores the policies, cancel, payment, bundle and reseller pages', () => {
    expect(urlScore('terms', 'https://www.netflix.com/termsofuse')).toBeGreaterThan(4);
    expect(urlScore('privacy', 'https://ici.tou.tv/confidentialite')).toBeGreaterThan(4);
    expect(urlScore('cancel', 'https://www.netflix.com/cancelplan')).toBeGreaterThan(4);
    expect(
      urlScore('payment', 'https://help.netflix.com/en/node/116380', 'Payment methods'),
    ).toBeGreaterThan(4);
    expect(urlScore('bundles', 'https://www.crave.ca/en/bundles')).toBeGreaterThan(4);
    expect(
      urlScore('resellers', 'https://mullvad.net/en/help/partnerships-and-resellers'),
    ).toBeGreaterThan(4);
  });
});

describe('pageFits', () => {
  it('knows a pricing page by its prices for a period', () => {
    expect(
      pageFits(
        'pricing',
        long('Standard: $18.99 / month. Premium: $23.99 / month. Choose a plan.'),
      ),
    ).toBe('yes');
    expect(pageFits('pricing', long('Abonnement Premium : 9,99 $ par mois.'))).toBe('yes');
    // Prices without a period are a shop, not a plan.
    expect(pageFits('pricing', long('Mug $12.99, T-shirt $24.99. Our plans for the year.'))).toBe(
      'no',
    );
    // No amount at all: its scripts may fill them in.
    expect(pageFits('pricing', long('Choose your plan'))).toBe('unreadable');
    expect(pageFits('pricing', 'Loading…')).toBe('unreadable');
  });

  it('knows policies, cancel, payment, bundle and reseller pages by their words', () => {
    const terms = `These Terms of Use govern your use of our service. ${'You agree to these terms. '.repeat(100)}`;
    expect(pageFits('terms', terms)).toBe('yes');
    expect(pageFits('privacy', terms)).toBe('no');
    const privacy = `Privacy Statement. We collect personal information when you sign up. ${'Your data is yours. '.repeat(80)}`;
    expect(pageFits('privacy', privacy)).toBe('yes');
    expect(
      pageFits(
        'privacy',
        `Politique de confidentialité. Vos renseignements personnels. ${'Texte. '.repeat(250)}`,
      ),
    ).toBe('yes');
    expect(
      pageFits(
        'cancel',
        long('To cancel your membership, go to Account and select Cancel Membership.'),
      ),
    ).toBe('yes');
    expect(
      pageFits(
        'payment',
        long('We accept the following cards: Visa, MasterCard, American Express.'),
      ),
    ).toBe('yes');
    expect(
      pageFits(
        'bundles',
        long('The Disney+ and Crave bundle costs $29.25 a month. Bundle and save.'),
      ),
    ).toBe('yes');
    expect(
      pageFits('resellers', long('Our official resellers sell vouchers in their stores.')),
    ).toBe('yes');
  });
});

describe('linksIn', () => {
  it('reads each link with its words and the part of the page it is in', () => {
    const html = `
      <header><nav><a href="/plans">Plans &amp; Pricing</a></nav></header>
      <main><a href='/blog/post'>Read our blog</a><a href="mailto:x@example.com">Mail</a><a href="#top">Top</a></main>
      <footer><a href="https://www.bell.ca/privacy" aria-label="Privacy"><svg></svg></a><a href=/terms>Terms</a></footer>`;
    expect(linksIn(html)).toEqual([
      { href: '/plans', words: 'Plans & Pricing', area: 'nav' },
      { href: '/blog/post', words: 'Read our blog', area: 'body' },
      { href: 'https://www.bell.ca/privacy', words: 'Privacy', area: 'footer' },
      { href: '/terms', words: 'Terms', area: 'footer' },
    ]);
  });
});

describe('sitemaps', () => {
  it('reads robots.txt’s sitemaps and a sitemap’s pages or sitemaps', () => {
    expect(
      sitemapsIn(
        'User-agent: *\nSitemap: https://example.com/a.xml\nsitemap:https://example.com/b.xml.gz',
      ),
    ).toEqual(['https://example.com/a.xml', 'https://example.com/b.xml.gz']);
    expect(
      readSitemap(
        '<urlset><url><loc> https://example.com/pricing?a=1&amp;b=2 </loc></url></urlset>',
      ),
    ).toEqual({
      pages: ['https://example.com/pricing?a=1&b=2'],
      sitemaps: [],
    });
    expect(
      readSitemap(
        '<sitemapindex><sitemap><loc>https://example.com/pages.xml</loc></sitemap></sitemapindex>',
      ),
    ).toEqual({
      pages: [],
      sitemaps: ['https://example.com/pages.xml'],
    });
  });
});

describe('the provider’s sites', () => {
  it('reads the registered domain, with two-label endings', () => {
    expect(registeredDomain('help.netflix.com')).toBe('netflix.com');
    expect(registeredDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registeredDomain('www.tsn.ca')).toBe('tsn.ca');
  });

  it('takes the website’s domain, its subdomains and its other domains', () => {
    const proton = { name: 'Proton', website: 'https://proton.me', domains: ['protonvpn.com'] };
    expect(onProviderSite('https://account.proton.me/pricing', proton)).toBe(true);
    expect(onProviderSite('https://protonvpn.com/blog/resellers', proton)).toBe(true);
    expect(onProviderSite('https://proton.me.example.com/', proton)).toBe(false);
    expect(onProviderSite('https://www.reddit.com/r/ProtonMail', proton)).toBe(false);
  });
});

/** A small web: URL → HTML (404 otherwise), with what the search finds, counting every page read. */
function fakeWeb(
  pages: Record<string, string>,
  options: {
    files?: Record<string, string>;
    answersAnyPath?: boolean;
    results?: SearchResult[];
  } = {},
): FindIo & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async page(url) {
      reads.push(url);
      const html = pages[url] ?? (options.answersAnyPath ? '<div id="app"></div>' : undefined);
      if (html === undefined) return { error: 'The page answered 404' };
      return { url, html, text: html.replace(/<[^>]+>/g, ' ') } satisfies FetchedPage;
    },
    async file(url) {
      return options.files?.[url];
    },
    // Core has no URL parser: absolute links, and paths from the page's host, are all these pages have.
    resolve: (href, base) => {
      if (/^https?:\/\//.test(href)) return href;
      const host = parseWebAddress(base)?.host;
      return host && href.startsWith('/') ? `https://${host}${href}` : undefined;
    },
    ...(options.results && { search: async () => options.results }),
  };
}

const pricing = long('<h1>Plans</h1> Basic $9.99 / month. Premium $19.99 / month.');

describe('findPages', () => {
  it('takes a common path whose words fit, and reads each URL once', async () => {
    const web = fakeWeb({
      'https://example.com': '<a href="/pricing">Pricing</a>',
      'https://example.com/pricing': pricing,
    });
    const [report] = await findPages(
      { name: 'Example', website: 'https://example.com' },
      ['pricing'],
      web,
    );
    expect(report.found).toEqual({
      kind: 'pricing',
      url: 'https://example.com/pricing',
      via: 'path',
      fit: 'yes',
      score: 6,
    });
    expect(new Set(web.reads).size).toBe(web.reads.length);
  });

  it('starts from a product’s own page', async () => {
    const web = fakeWeb({ 'https://example.com/premium': '<div id="root"></div>' });
    const [report] = await findPages(
      { name: 'Example Premium', website: 'https://example.com/premium' },
      ['pricing'],
      web,
    );
    expect(report.found).toMatchObject({
      url: 'https://example.com/premium',
      via: 'website',
      fit: 'unreadable',
    });
  });

  it('trusts no guessed path on a site that answers every path, but a sitemap’s page', async () => {
    const web = fakeWeb(
      { 'https://example.com/en/subscribe': '<div id="app"></div>' },
      {
        answersAnyPath: true,
        files: {
          'https://example.com/robots.txt': 'Sitemap: https://example.com/sitemap.xml',
          'https://example.com/sitemap.xml':
            '<urlset><url><loc>https://example.com/en/subscribe</loc></url></urlset>',
        },
      },
    );
    const [report] = await findPages(
      { name: 'Example', website: 'https://example.com' },
      ['pricing'],
      web,
    );
    expect(web.reads).toContain(`https://example.com${missingPath}`);
    expect(report.found).toMatchObject({
      url: 'https://example.com/en/subscribe',
      via: 'sitemap',
      fit: 'unreadable',
    });
  });

  it('follows the footer’s policy links, even to the parent company’s site', async () => {
    const privacy = `Privacy policy: how we use your personal information. ${'Text. '.repeat(400)}`;
    const web = fakeWeb({
      'https://crave.example':
        '<footer><a href="https://bell.example/privacy">Privacy</a></footer>',
      'https://bell.example/privacy': privacy,
    });
    const [report] = await findPages(
      { name: 'Crave', website: 'https://crave.example' },
      ['privacy'],
      web,
    );
    expect(report.found).toMatchObject({
      url: 'https://bell.example/privacy',
      via: 'link',
      fit: 'yes',
    });
  });

  it('takes the footer’s terms before a sitemap’s, and never another audience’s', async () => {
    const terms = `These Terms of Service apply to you. ${'You agree to these terms. '.repeat(100)}`;
    const web = fakeWeb(
      {
        'https://ai.example': '<footer><a href="/legal/consumer-terms">Consumer Terms</a></footer>',
        'https://ai.example/legal/k12-terms': terms,
        'https://ai.example/legal/consumer-terms': terms,
      },
      {
        files: {
          'https://ai.example/robots.txt': 'Sitemap: https://ai.example/sitemap.xml',
          'https://ai.example/sitemap.xml':
            '<urlset><url><loc>https://ai.example/legal/k12-terms</loc></url></urlset>',
        },
      },
    );
    const [report] = await findPages({ name: 'AI', website: 'https://ai.example' }, ['terms'], web);
    expect(report.found).toMatchObject({
      url: 'https://ai.example/legal/consumer-terms',
      via: 'link',
    });
    expect(urlScore('terms', 'https://ai.example/legal/k12-terms')).toBe(0);
  });

  it('searches last, and only takes results on the provider’s sites', async () => {
    const web = fakeWeb(
      {
        'https://help.example.com/node/24926': pricing,
        'https://news.example.org/example-prices': pricing,
      },
      {
        results: [
          { url: 'https://news.example.org/example-prices', title: 'Example prices', snippet: '' },
          { url: 'https://help.example.com/node/24926', title: 'Plans and Pricing', snippet: '' },
        ],
      },
    );
    const [report] = await findPages(
      { name: 'Example', website: 'https://www.example.com' },
      ['pricing'],
      web,
    );
    expect(report.searched).toBe('yes');
    expect(report.found).toMatchObject({
      url: 'https://help.example.com/node/24926',
      via: 'search',
      fit: 'yes',
    });
    expect(web.reads).not.toContain('https://news.example.org/example-prices');
  });

  it('says when no search was left this month', async () => {
    const web = { ...fakeWeb({}), search: async () => undefined };
    const [report] = await findPages(
      { name: 'Example', website: 'https://example.com' },
      ['bundles'],
      web,
    );
    expect(report).toMatchObject({ kind: 'bundles', searched: 'none-left' });
    expect(report.found).toBeUndefined();
  });
});
