// M5.2 and M5.3 in the system Edge: the Search page on the real catalog (data:build's files), for a Canadian in
// Alberta and a US user, in both themes at 1280 and 360 px: the cards, plan chips by keyboard, the expanded details,
// the "Cheaper at" resellers, typing with its pause, the empty state, a listed provider's status, every card's cancel
// page (M1.9), a plan sold in the US only, a provider not sold in the user's country (Crave, sold in Canada only), a
// UK user's fallback price, with Sold in and its Settings default (M5.6), and the filter panel (M5.3): its Tab order,
// each filter by keyboard, the URL after each one (typing replaces its entry, a run of price changes makes one,
// anything else adds one), a reload, Back and Forward, a URL with values the catalog doesn't have, no scroll on a
// filter change, and under 960 px the drawer (focus, its trap, Escape, Show results, Back), a price's Add to list
// menu by keyboard (M5.4), and M5.7's pinned bar and panel, chips that stay put, the plans' order, a lone plan's
// chip and the details' slide and foot, and M1.13's Terms and policies with M1.14's grade dots, their tooltips (hover,
// keyboard and a phone's tap) and citations, with axe. GET /fx is answered with fixed rates (1 EUR ≈ CA$1.5694), so
// Amazon.ca's Mullvad cards are cheaper in Alberta.
// Usage: node check-search.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axeSource = fs.readFileSync(
  path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);
fs.mkdirSync(outDir, { recursive: true });

const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 360, height: 740 };
const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rates per Canadian dollar, rebased for other currencies. */
const cadRates = { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 };
function fxBody(base) {
  const perCad = (currency) => (currency === 'CAD' ? 1 : cadRates[currency]);
  const rates = Object.fromEntries(
    ['CAD', ...Object.keys(cadRates)]
      .filter((currency) => currency !== base)
      .map((currency) => [currency, Number((perCad(currency) / perCad(base)).toPrecision(6))]),
  );
  return {
    data: { base, date: '2026-10-26', source: 'European Central Bank via Frankfurter', rates },
    meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
  };
}

async function waitForServer() {
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`No server at ${baseUrl}`);
}

async function until(what, condition, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function newContext(
  browser,
  { locale, colorScheme = 'light', viewport = WIDE, reducedMotion = 'no-preference' },
) {
  const context = await browser.newContext({ locale, colorScheme, viewport, reducedMotion });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  return context;
}

async function newPage(context, label) {
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return page;
}

/** Completes the first-run dialog: a Canadian picks a province; en-US needs nothing. */
async function firstRun(page, province) {
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  if (province) {
    await page
      .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
      .locator('.mat-mdc-text-field-wrapper')
      .click();
    await page.getByRole('option', { name: province, exact: true }).click();
    await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  }
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

async function openSearch(page, province) {
  await page.goto(`${baseUrl}search`);
  await firstRun(page, province);
  await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
}

/** A details section's ratings: each dot's grade, then its topic, why and citations, as they show. */
async function policyRows(scope) {
  return scope.locator('.policies li').evaluateAll((items) =>
    items.map((item) => {
      const copy = item.querySelector('.rated').cloneNode(true);
      copy.querySelectorAll('.visually-hidden').forEach((node) => node.remove());
      const grade = item.querySelector('.grade').getAttribute('aria-label');
      return `${grade} | ${copy.textContent.replace(/\s+/g, ' ').trim()}`;
    }),
  );
}

const card = (page, name) =>
  page.locator('ss-sub-card', { has: page.getByRole('heading', { name, exact: true }) });
const names = (page) => page.locator('ss-sub-card h2').allTextContents();
const count = async (page) => (await page.locator('.count').textContent()).trim();

/** What's on screen in `locator`: no icon ligatures or screen-reader-only words, texts spaced as laid out. */
async function shown(locator) {
  return locator.evaluate((element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('mat-icon, .visually-hidden').forEach((node) => node.remove());
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode.textContent.trim());
    return texts.filter(Boolean).join(' ');
  });
}

async function chips(page, name) {
  return card(page, name)
    .locator('label.chip')
    .allTextContents()
    .then((texts) => texts.map((text) => text.replace('check', '').trim()));
}

async function focused(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    return {
      tag: element?.tagName.toLowerCase(),
      type: element?.getAttribute('type'),
      value: element?.value,
      name:
        element?.getAttribute('aria-label') ?? element?.textContent?.replace(/\s+/g, ' ').trim(),
      className: element?.className,
    };
  });
}

/** The focused element's role and accessible name, as an accessibility snapshot's first line gives them. */
async function stop(page) {
  const snapshot = await page.locator(':focus').ariaSnapshot();
  return snapshot.split('\n')[0].replace(/^- /, '');
}

/** The URL's query, decoded. */
const search = (page) => decodeURIComponent(new URL(page.url()).search);
const entries = (page) => page.evaluate(() => history.length);

/** Goes back or forward, and waits for the URL to change. */
async function go(page, step) {
  const before = page.url();
  await page.evaluate((where) => (where === 'back' ? history.back() : history.forward()), step);
  await until(`${step} to change the URL`, () => page.url() !== before);
  await sleep(300);
}

async function type(page, text) {
  const box = page.getByRole('searchbox');
  await box.fill('');
  await box.pressSequentially(text);
  await sleep(400);
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  // Material renders autocomplete panels outside the page's landmarks (the skill's gotchas): set aside `region` hits
  // that are all inside its overlay container.
  const violations = result.violations.filter(
    (violation) =>
      violation.id !== 'region' ||
      !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay')),
  );
  const problems = violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join(' | ')}`,
  );
  check(`axe: ${label}`, problems.length === 0, problems.join('; '));
}

/** Writes a list item to IndexedDB, as the item dialog will (M6.5), and reloads so the repositories read it. */
/** The list addItem's items are in. */
const LIST_ID = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';

/** Writes `record` to an IndexedDB table, as the repositories would, and reloads so they read it. */
async function putRecord(page, table, record) {
  await page.evaluate(
    ([store, value]) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(store, 'readwrite');
          transaction.objectStore(store).put(value);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    [table, record],
  );
  await page.reload();
  await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
}

/** A list, Work Related, for the Add to list menu (M5.4). */
async function addList(page) {
  await putRecord(page, 'lists', {
    id: LIST_ID,
    name: 'Work Related',
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  });
}

/** Writes a list item to IndexedDB, as the item dialog will (M6.5), and reloads so the repositories read it. */
async function addItem(page, planId) {
  await putRecord(page, 'items', {
    id: '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
    listId: LIST_ID,
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-09-10',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    createdAt: '2026-10-20T12:00:00.000Z',
    updatedAt: '2026-10-20T12:00:00.000Z',
  });
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });

  // ── A Canadian in Alberta, light, 1280 px ─────────────────────────────────────────────────────
  {
    const context = await newContext(browser, { locale: 'en-CA' });
    const page = await newPage(context, 'CA');
    await openSearch(page, 'Alberta');

    const all = await names(page);
    // M1.11: Hulu is sold in the US only; ESPN has no price for Canada and no country list, so it's unknown.
    check(
      'one card per provider, and the count',
      all.length === 9 && (await count(page)) === '9 services' && !all.includes('Hulu'),
      `${all.join(', ')} / ${await count(page)}`,
    );
    const cancels = Object.fromEntries(
      await page
        .locator('ss-sub-card')
        .evaluateAll((cards) =>
          cards.map((element) => [
            element.querySelector('h2')?.textContent,
            [...element.querySelectorAll('.links a')].find((link) =>
              link.textContent.includes('Cancel'),
            )?.href,
          ]),
        ),
    );
    const cancelPages = {
      Proton: 'https://account.proton.me/dashboard',
      'Mullvad VPN': 'https://mullvad.net/en/help/refunds',
      Netflix: 'https://www.netflix.com/cancelplan',
      'Disney+': 'https://help.disneyplus.com/article/disneyplus-cancel',
      Crave:
        'https://plus.crave.ca/en/faq/plans-billing-bundles/canceling-or-pausing-my-crave-subscription/',
      TSN: 'https://www.tsn.ca/help/faq/#cancellations',
      RDS: 'https://www.rds.ca/aide/faq/#annuler-abonnement',
      'ICI TOU.TV': 'https://ici.tou.tv/abonnement/condition',
      ESPN: 'https://support.espn.com/hc/en-us/articles/40377550796308-Cancelling-Your-ESPN-Select-or-Unlimited-Subscription',
    };
    check(
      'every card links to its provider’s cancel page',
      Object.entries(cancelPages).every(([name, href]) => cancels[name] === href),
      JSON.stringify(cancels),
    );
    const disney = await chips(page, 'Disney+');
    check(
      'a Canadian never sees the US-only Disney+ With Ads',
      !disney.includes('With Ads') && disney.includes('Standard With Ads'),
      disney.join(', '),
    );
    const deals = await shown(card(page, 'Mullvad VPN').locator('.deals'));
    check(
      // €48.76 before VAT is CA$76.52, plus GST (M1.12).
      'Mullvad is cheaper at Laptop with Linux, ProxyStore and Amazon.ca in Alberta, cheapest first',
      /^Cheaper at Laptop with Linux ≈ \$76\.52 \/ 12 mo \+ tax Cheaper at ProxyStore .* Cheaper at Amazon \$87\.00 \/ 12 mo \+ tax$/.test(
        deals,
      ),
      deals,
    );
    const amazon = card(page, 'Mullvad VPN').locator('.deals a', { hasText: 'Amazon' });
    check(
      'a reseller link opens its page in a new tab',
      (await amazon.getAttribute('target')) === '_blank' &&
        (await amazon.getAttribute('rel')) === 'noopener' &&
        (await amazon.getAttribute('href')).startsWith('https://www.amazon.ca/'),
    );
    await page.screenshot({ path: path.join(outDir, 'ca-light-1280.png'), fullPage: true });

    // Keyboard: the box, the sort, then the filter panel (M5.3, below), then the first card's chips (one tab stop,
    // right below its names since M5.7), its links, its prices and its details button.
    await page.getByRole('searchbox').focus();
    await page.keyboard.press('Tab');
    check(
      'Tab goes from the search box to Sort',
      (await focused(page)).className.includes('mat-mdc-select'),
    );
    await page.getByRole('button', { name: 'Clear all' }).focus();
    const firstName = all[0];
    const first = card(page, firstName);
    const firstPlan = (await first.locator('.plan-name').textContent()).trim();
    await page.keyboard.press('Tab');
    const radio = await focused(page);
    check(
      `Tab reaches ${firstName}'s checked chip first`,
      radio.tag === 'input' && radio.type === 'radio',
      `${radio.tag}:${radio.value}`,
    );
    await page.keyboard.press('ArrowRight');
    await until(
      'the next plan',
      async () => (await first.locator('.plan-name').textContent()).trim() !== firstPlan,
    );
    check(
      'an arrow key picks the next plan',
      true,
      `${firstPlan} → ${(await first.locator('.plan-name').textContent()).trim()}`,
    );
    const stops = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const now = await focused(page);
      stops.push(now);
      if (now.name?.startsWith('Details: ')) break;
    }
    check(
      'Tab leaves the chips for the plan’s links, its prices, then the details button',
      stops[0].tag === 'a' &&
        stops.some((stop) => /add to a list/.test(stop.name)) &&
        stops.at(-1).name?.startsWith('Details: '),
      stops.map((stop) => `${stop.tag}:${stop.name ?? stop.value}`).join(' → '),
    );
    // The details' classes as they come and go: `moving` while they slide (M5.7).
    await first.evaluate((element) => {
      window.ssSeen = [];
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of [record.target, ...record.addedNodes]) {
            if (node instanceof Element && node.classList.contains('details-body')) {
              window.ssSeen.push(node.className);
            }
          }
        }
      }).observe(element, { subtree: true, childList: true, attributes: true });
    });
    await page.keyboard.press('Enter');
    await until('the details', () => first.locator('ss-plan-details').isVisible());
    await sleep(400);
    check(
      'Enter expands the card, sliding the details open',
      (await first.locator('button.expand').getAttribute('aria-expanded')) === 'true' &&
        (await page.evaluate(() => window.ssSeen.some((name) => name.includes('moving')))) &&
        !(await first
          .locator('.details-body')
          .evaluate((body) => body.className.includes('moving'))),
      await page.evaluate(() => window.ssSeen.join(' | ')),
    );
    await page.evaluate(() => (window.ssSeen = []));
    await page.keyboard.press('Enter');
    check(
      'the details button says closed at once, while they slide shut',
      (await first.locator('button.expand').getAttribute('aria-expanded')) === 'false' &&
        (await first.locator('ss-plan-details').count()) === 1,
    );
    await until(
      'the details to close',
      async () => (await first.locator('ss-plan-details').count()) === 0,
    );
    check(
      'Enter again collapses it, sliding them shut',
      await page.evaluate(() => window.ssSeen.some((name) => name.includes('moving'))),
      await page.evaluate(() => window.ssSeen.join(' | ')),
    );

    // Typing, with its pause.
    await type(page, 'netflix 4k');
    const netflix4k = await names(page);
    check(
      '"netflix 4k" finds Netflix, showing its 4k plan, by best match',
      netflix4k.join() === 'Netflix' &&
        (await card(page, 'Netflix').locator('.plan-name').textContent()).trim() === 'Premium' &&
        (await page.getByRole('combobox', { name: 'Sort' }).textContent()).includes('Best match'),
      `${netflix4k.join(', ')} / ${await count(page)}`,
    );

    // The empty state, cleared by keyboard.
    await type(page, 'zzzz');
    check('no match shows the empty state', (await count(page)) === 'No services match');
    await page.getByRole('button', { name: 'Clear search' }).focus();
    await page.keyboard.press('Enter');
    await until('the cards again', async () => (await names(page)).length === 9);
    check(
      'Clear search empties the box and focuses it',
      (await focused(page)).type === 'search' &&
        (await page.getByRole('searchbox').inputValue()) === '',
    );

    // A listed provider: its status, and its plan shown.
    await addItem(page, 'netflix.standard');
    const netflix = card(page, 'Netflix');
    check(
      'a listed provider shows its status and the user’s plan',
      (await shown(netflix.locator('ss-status-badge'))) === 'Active · 1 list' &&
        (await netflix.locator('.plan-name').textContent()).trim() === 'Standard',
      await shown(netflix.locator('ss-status-badge')),
    );
    await page.screenshot({ path: path.join(outDir, 'ca-listed-1280.png'), fullPage: true });
    await context.close();
  }

  // ── M5.3: the filter panel and the URL, by keyboard (Alberta, light, 1280 px) ──────────────────
  {
    const context = await newContext(browser, { locale: 'en-CA' });
    const page = await newPage(context, 'CA filters');
    await openSearch(page, 'Alberta');
    const panel = page.locator('section.panel');
    const chipNames = async () =>
      (await panel.locator('mat-chip-row .mat-mdc-chip-action-label').allTextContents()).map(
        (text) => text.trim(),
      );
    const shownPlans = async () => {
      const result = [];
      for (const name of await names(page)) {
        result.push(
          `${name}: ${(await card(page, name).locator('.plan-name').textContent()).trim()}`,
        );
      }
      return result;
    };
    const native = panel.getByRole('checkbox', { name: 'Native pricing only' });

    check(
      'the panel is beside the results, headed Filters',
      (await panel.isVisible()) &&
        (await panel.getByRole('heading', { level: 2 }).textContent()) === 'Filters' &&
        (await page.locator('.open-filters').count()) === 0,
    );
    const start = panel.locator('input[type=range]').first();
    const end = panel.locator('input[type=range]').last();
    check(
      // ESPN Unlimited's US$319.99 a year is about CA$36.80 a month, rounded up to $40.
      'the price runs from $0 to Unlimited at $40, the catalog’s priciest rounded up, by $1',
      (await panel.locator('.range').textContent()).trim() === '$0 – Unlimited' &&
        (await end.getAttribute('max')) === '40' &&
        (await end.getAttribute('step')) === '1' &&
        (await end.getAttribute('aria-valuetext')) === 'Unlimited' &&
        (await start.getAttribute('aria-valuetext')) === '$0',
      `${await end.getAttribute('max')} by ${await end.getAttribute('step')}`,
    );

    // The Tab order: the bar, then the panel's controls, then the results.
    await page.getByRole('searchbox').focus();
    const order = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      await sleep(200);
      order.push(await stop(page));
    }
    const expected = [
      /^combobox "Sort/,
      /^slider "Lowest price per month"/,
      /^slider "Highest price per month"/,
      /^combobox "Category/,
      /^combobox "Features/,
      /^checkbox "Active"/,
      /^checkbox "Inactive"/,
      /^checkbox "Not listed"/,
      /^checkbox "Native pricing only"/,
      /^checkbox "Sold in Canada"/,
      /^button "Clear all" \[disabled\]/,
      // The first card's chips, right below its names (M5.7).
      /^radio "Proton Free" \[checked\]/,
    ];
    check(
      'Tab goes Sort → the price’s two thumbs → Category → Features → Activity → Native → Sold in → Clear all → the results',
      expected.every((pattern, i) => pattern.test(order[i] ?? '')),
      order.join(' → '),
    );

    // A filter change doesn't scroll the page.
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.evaluate(() => window.scrollTo(0, 200));
    const scrollFrom = await entries(page);
    await page.evaluate(() =>
      document.querySelectorAll('section.panel .activity input')[2].click(),
    );
    await until('act=none', () => search(page) === '?act=none');
    await sleep(300);
    const scrolled = await page.evaluate(() => window.scrollY);
    check('a filter change keeps the scroll position', scrolled === 200, `scrollY ${scrolled}`);
    await page.evaluate(() =>
      document.querySelectorAll('section.panel .activity input')[2].click(),
    );
    await until('no act', () => search(page) === '');
    await page.setViewportSize(WIDE);
    await page.evaluate(() => window.scrollTo(0, 0));
    check(
      'each Activity change added a history entry',
      (await entries(page)) === scrollFrom + 2,
      `${scrollFrom} → ${await entries(page)}`,
    );

    // Native pricing only, by Space: Mullvad's euro price is converted.
    const base = await entries(page);
    await native.focus();
    await page.keyboard.press('Space');
    await until('native=1', () => search(page) === '?native=1');
    await until('Mullvad to go', async () => !(await names(page)).includes('Mullvad VPN'));
    check(
      '"Native pricing only" hides converted prices, in the URL as native=1',
      (await names(page)).join() === 'Proton,ICI TOU.TV,Netflix,Disney+,Crave,RDS,TSN' &&
        (await entries(page)) === base + 1,
      `${(await names(page)).join(', ')} / ${search(page)}`,
    );

    // Features: "video quality" offers its values, then the rest of Streaming; 4K by arrow keys and Enter.
    const options = page.locator('.mat-mdc-autocomplete-panel mat-option');
    await panel.getByRole('combobox', { name: 'Features' }).focus();
    await page.keyboard.type('video quality');
    await options.first().waitFor();
    const groups = (
      await page.locator('.mat-mdc-autocomplete-panel .mat-mdc-optgroup-label').allTextContents()
    ).map((text) => text.trim());
    const offered = (await options.allTextContents()).map((text) => text.trim());
    check(
      'typing "video quality" offers its values, then related keys such as HDR and Ad free',
      groups.join() === 'Matches,More in Streaming' &&
        offered.slice(0, 4).join() ===
          'Video quality: 480p (SD),Video quality: 720p (HD),Video quality: 1080p (Full HD),Video quality: 4K (Ultra HD)' &&
        offered.includes('HDR') &&
        offered.includes('Ad free'),
      `${groups.join(' / ')}: ${offered.join(', ')}`,
    );
    await sleep(500);
    await page.screenshot({ path: path.join(outDir, 'features-autocomplete-1280.png') });
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await until('the 4k filter', () => search(page) === '?f=video.quality=4k&native=1');
    await until('the 4k results', async () => (await names(page)).length === 3);
    const fourK = await shownPlans();
    check(
      'filtering for 4k shows each provider’s cheapest 4k plan, and a chip for it',
      fourK.join() === 'Disney+: Premium,Crave: Premium,Netflix: Premium' &&
        (await chipNames()).join() === 'Video quality: 4K (Ultra HD)' &&
        (await entries(page)) === base + 2,
      `${fourK.join(', ')} / ${(await chipNames()).join(', ')}`,
    );
    await page.keyboard.press('Escape');

    // A reload restores the filters, then Back and Forward step through them.
    await page.reload();
    await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
    await until('the chips after reload', async () => (await chipNames()).length === 1);
    check(
      'a reload restores the filters and the results',
      search(page) === '?f=video.quality=4k&native=1' &&
        (await shownPlans()).join() === fourK.join() &&
        (await native.isChecked()),
      search(page),
    );
    await go(page, 'back');
    await until('no chips', async () => (await chipNames()).length === 0);
    check(
      'Back undoes the last filter',
      search(page) === '?native=1' && (await names(page)).length === 7,
      `${search(page)} / ${(await names(page)).join(', ')}`,
    );
    await go(page, 'forward');
    await until('the chip again', async () => (await chipNames()).length === 1);
    check('Forward puts it back', search(page) === '?f=video.quality=4k&native=1', search(page));

    // Typing replaces the current entry.
    const typedFrom = await entries(page);
    await type(page, 'netflix');
    await until('q=netflix', () => search(page).startsWith('?q=netflix'));
    check(
      'typing replaces the URL’s entry',
      (await entries(page)) === typedFrom && (await names(page)).join() === 'Netflix',
      `${search(page)} / ${typedFrom} → ${await entries(page)}`,
    );

    // The price, by arrow keys: a run of changes is one entry. Netflix Premium is CA$23.99.
    const priceFrom = await entries(page);
    const presses = Number(await end.getAttribute('max')) - 24;
    await end.focus();
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press('ArrowLeft');
      await sleep(150);
    }
    await until('max=24', () => search(page).includes('max=24'));
    check(
      `${presses} arrow presses on the top thumb make one history entry, at $24`,
      (await entries(page)) === priceFrom + 1 &&
        (await names(page)).join() === 'Netflix' &&
        (await panel.locator('.range').textContent()).trim() === '$0 – $24',
      `${search(page)} / ${priceFrom} → ${await entries(page)}`,
    );
    await page.keyboard.press('ArrowLeft');
    await until('max=23', () => search(page).includes('max=23'));
    await until('no match', async () => (await count(page)) === 'No services match');
    check(
      'below Netflix Premium’s price nothing matches, and the empty state offers Clear filters',
      (await page.getByRole('button', { name: 'Clear filters' }).isVisible()) &&
        (await entries(page)) === priceFrom + 1,
    );
    await go(page, 'back');
    await until('Netflix again', async () => (await names(page)).join() === 'Netflix');
    check('one Back undoes the whole price run', !search(page).includes('max='), search(page));

    // Clear all by keyboard keeps the text.
    await panel.getByRole('button', { name: 'Clear all' }).focus();
    await page.keyboard.press('Enter');
    await until('the filters cleared', () => search(page) === '?q=netflix');
    await sleep(200);
    check(
      'Clear all turns every filter off, keeps the text and keeps focus',
      (await chipNames()).length === 0 &&
        !(await native.isChecked()) &&
        (await stop(page)).startsWith('button "Clear all" [disabled]'),
      await stop(page),
    );

    // Category by keyboard, then an Activity chip by Space.
    await page.getByRole('button', { name: 'Clear the search' }).click();
    await until('no text', () => search(page) === '');
    await panel.getByRole('combobox', { name: 'Category' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'VPN', exact: true }).waitFor();
    const categoryOptions = (await page.getByRole('option').allTextContents()).map((text) =>
      text.trim(),
    );
    await sleep(250);
    await page.keyboard.type('VPN');
    await sleep(300);
    await page.keyboard.press('Enter');
    await until('cat=vpn', () => search(page) === '?cat=vpn');
    await until(
      'Mullvad and Proton',
      async () => (await names(page)).join() === 'Proton,Mullvad VPN',
    );
    check(
      'Category offers All and the categories a plan sold here is in',
      categoryOptions.join() === 'All,Streaming video,VPN,Privacy & security suites,Cloud storage',
      categoryOptions.join(', '),
    );
    // M1.10: Proton is a privacy suite, and its VPN Plus, Free and suites are VPNs too.
    const protonVpn = await chips(page, 'Proton');
    check(
      'VPN keeps Mullvad and Proton, with only Proton’s VPN plans',
      protonVpn.join() === 'Proton Free,VPN Plus,Proton Unlimited,Proton Duo,Proton Family',
      protonVpn.join(', '),
    );
    await panel.getByRole('checkbox', { name: 'Not listed' }).focus();
    await page.keyboard.press('Space');
    await until('act=none', () => search(page) === '?cat=vpn&act=none');
    check('Space on Not listed adds act=none', (await names(page)).join() === 'Proton,Mullvad VPN');
    await page.screenshot({ path: path.join(outDir, 'filters-1280.png'), fullPage: true });

    // A URL with values the catalog doesn't have is rewritten in place.
    const previous = page.url();
    await page.goto(`${baseUrl}search?f=nope,video.quality%3D4k&cat=zzz&sort=relevance&utm=1`);
    await until('the rewrite', () => search(page) === '?f=video.quality=4k', 15000);
    await until('the 4k results', async () => (await names(page)).length === 3);
    check(
      'unknown values and parameters are dropped from the URL',
      (await names(page)).join() === 'Disney+,Crave,Netflix',
      search(page),
    );
    await go(page, 'back');
    check(
      'the rewrite replaced its entry: Back goes to the page before',
      page.url() === previous,
      page.url(),
    );
    await context.close();
  }

  // ── M5.3 under 960 px: the drawer, keyboard only (Alberta, light, 360 px) ──────────────────────
  {
    const context = await newContext(browser, { locale: 'en-CA', viewport: NARROW });
    const page = await newPage(context, 'CA drawer');
    await openSearch(page, 'Alberta');
    const opener = page.locator('.open-filters');
    const drawer = page.locator('mat-dialog-container');
    const inDrawer = () =>
      page.evaluate(() => !!document.activeElement?.closest('mat-dialog-container'));

    check(
      'under 960 px a Filters button replaces the panel',
      (await opener.isVisible()) && (await page.locator('section.panel').count()) === 0,
    );
    // One pinned row (M5.7): the box, then Filters; Sort is in the drawer.
    await page.getByRole('searchbox').focus();
    await page.keyboard.press('Tab');
    check(
      'Tab goes from the search box to Filters',
      /^button "Filters"/.test(await stop(page)) &&
        (await page.locator('.pinned .sort').count()) === 0,
      await stop(page),
    );
    await page.keyboard.press('Enter');
    await drawer.waitFor();
    await until('focus in the drawer', inDrawer);
    const firstStop = await stop(page);
    check(
      'Enter opens the drawer, a dialog named Filters, with focus on its close button',
      (await drawer.getAttribute('role')) === 'dialog' &&
        (await drawer.getAttribute('aria-labelledby')) === 'ss-filters-drawer-title' &&
        // The CDK hides the rest of the page from screen readers, rather than setting aria-modal.
        (await page.locator('ss-root').getAttribute('aria-hidden')) === 'true' &&
        firstStop === 'button "Close filters"',
      firstStop,
    );
    await page.keyboard.press('Tab');
    check(
      'Sort is the drawer’s first control under 960 px',
      /^combobox "Sort"/.test(await stop(page)),
      await stop(page),
    );
    let trapped = true;
    let onList = false;
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab');
      await sleep(100);
      trapped &&= await inDrawer();
      onList ||= await page.evaluate(
        () => !!document.activeElement?.closest('.mat-mdc-autocomplete-panel'),
      );
    }
    // The Features box opens its suggestions on focus: leave it, and they close.
    if (/^combobox "Features/.test(await stop(page))) {
      await page.keyboard.press('Tab');
      await sleep(200);
    }
    check(
      'Tab stays inside the drawer, never stops on the Features suggestions, and leaves them closed',
      trapped && !onList && (await page.locator('.mat-mdc-autocomplete-panel').count()) === 0,
    );

    await drawer.getByRole('checkbox', { name: 'Native pricing only' }).focus();
    await page.keyboard.press('Space');
    await until('native=1', () => search(page) === '?native=1');
    await until(
      'the drawer’s count',
      async () => (await drawer.locator('[role=status]').textContent()) === '7 services',
    );
    check('a filter in the drawer applies at once, and the drawer announces the count', true);
    await page.screenshot({ path: path.join(outDir, 'drawer-native-360.png') });
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    await until('focus on Filters', async () => /^button "Filters/.test(await stop(page)));
    check(
      'Escape closes the drawer and puts focus back on Filters, whose badge counts one filter',
      (await stop(page)).startsWith('button "Filters, 1 applied"') && (await shown(opener)) === '1',
      `${await stop(page)} / ${await shown(opener)}`,
    );

    await page.keyboard.press('Enter');
    await drawer.waitFor();
    await until('focus in the drawer', inDrawer);
    await drawer.getByRole('button', { name: 'Show results' }).focus();
    await page.keyboard.press('Enter');
    await drawer.waitFor({ state: 'detached' });
    await until('focus on Filters', async () => /^button "Filters/.test(await stop(page)));
    check('Show results closes it too, back on Filters', true);

    await page.keyboard.press('Enter');
    await drawer.waitFor();
    await go(page, 'back');
    await drawer.waitFor({ state: 'detached' });
    check('Back closes the drawer and undoes the filter', search(page) === '', search(page));
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    check(
      'no horizontal scroll at 360 px with the Filters button',
      width <= NARROW.width,
      `${width}px`,
    );
    await context.close();
  }

  // ── M5.4: a price opens Add to list, by keyboard (Alberta, light, 1280 px) ─────────────────────
  {
    const context = await newContext(browser, { locale: 'en-CA' });
    const page = await newPage(context, 'CA add');
    await openSearch(page, 'Alberta');
    await addList(page);
    const menu = page.locator('.mat-mdc-menu-panel');
    const price = card(page, 'Netflix').locator('.prices ss-price button').first();

    check(
      'a price is a button that opens a menu, and says it adds to a list',
      (await price.getAttribute('aria-haspopup')) === 'menu' &&
        /add to a list/.test(await price.evaluate((button) => button.textContent)),
      await price.evaluate((button) => button.textContent.replace(/\s+/g, ' ').trim()),
    );
    await price.focus();
    await page.keyboard.press('Enter');
    await menu.waitFor();
    await sleep(500);
    const items = (await menu.getByRole('menuitem').allTextContents()).map((text) =>
      text.replace(/\s+/g, ' ').trim(),
    );
    check(
      'Enter opens Add to list: each list with its count, then New list…, with focus in the menu',
      items.join() === 'Work Related (0), 0 subscriptions,addNew list…' &&
        (await menu.getAttribute('aria-label')) === 'Add to list' &&
        (await page.evaluate(() => !!document.activeElement?.closest('.mat-mdc-menu-panel'))),
      items.join(' | '),
    );
    await page.screenshot({ path: path.join(outDir, 'add-menu-1280.png') });
    await axeCheck(page, 'light 1280, the Add to list menu open');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    check(
      'Escape closes it and puts focus back on the price',
      await price.evaluate((button) => button === document.activeElement),
    );

    await page.keyboard.press('Enter');
    await menu.waitFor();
    await sleep(300);
    await page.keyboard.press('Enter');
    await until('the editor', () => page.url().includes('/lists/'));
    await page.locator('.adding').waitFor();
    check(
      "picking a list opens its editor with the plan and the period clicked, which says what it'll add",
      new URL(page.url()).pathname.endsWith(`/lists/${LIST_ID}/edit`) &&
        search(page) === '?add=netflix.standard-ads&interval=month' &&
        (await page.locator('.adding').textContent()).trim() ===
          'Netflix Standard with ads, billed monthly, will be added here once the list editor is ready.',
      `${page.url()} / ${await page.locator('.adding').textContent()}`,
    );

    // A bundle's price, in Crave's details, and New list….
    await go(page, 'back');
    await card(page, 'Crave').locator('button.expand').click();
    const bundlePrice = card(page, 'Crave').locator('ss-plan-details ss-price button').first();
    await bundlePrice.waitFor();
    await bundlePrice.click();
    await menu.waitFor();
    await menu.getByRole('menuitem', { name: /New list/ }).click();
    await until('the new list', () => page.url().includes('/lists/new'));
    check(
      "a bundle's price opens a new list's editor with the bundle",
      search(page) === '?addBundle=bundle.disney-crave-ads&interval=month',
      page.url(),
    );
    await context.close();
  }

  // ── M5.7: the pinned bar, chips that stay put, the plans' order, a lone plan's chip, the details' foot ─────
  for (const viewport of [WIDE, NARROW]) {
    const label = `${viewport.width}`;
    const context = await newContext(browser, { locale: 'en-CA', viewport });
    const page = await newPage(context, `CA M5.7 ${label}`);
    await openSearch(page, 'Alberta');

    const tsn = await chips(page, 'TSN');
    check(
      `${label}: TSN lists Standard before Premium, though Premium's yearly price is less a month`,
      tsn.join() === 'Standard,Premium' &&
        (await card(page, 'TSN').locator('.plan-name').textContent()).trim() === 'Standard',
      tsn.join(', '),
    );
    const lone = await card(page, 'RDS')
      .locator('.plans')
      .evaluate((element) => ({
        text: element.textContent.replace('check', '').trim(),
        hidden: element.getAttribute('aria-hidden'),
        inputs: element.querySelectorAll('input').length,
      }));
    check(
      `${label}: a lone plan shows its chip, which isn't a control`,
      lone.text === 'RDS' && lone.hidden === 'true' && lone.inputs === 0,
      JSON.stringify(lone),
    );

    // Every chip's place in its card, before and after picking other plans (Proton's 1 or 2 prices, TSN's 1 or 3).
    const places = (name) =>
      card(page, name)
        .locator('label.chip')
        .evaluateAll((labels) =>
          labels.map((chip) => {
            const box = chip.getBoundingClientRect();
            const home = chip.closest('ss-sub-card').getBoundingClientRect();
            return [box.left - home.left, box.top - home.top, box.width].map(Math.round).join();
          }),
        );
    const moved = [];
    for (const [name, plans] of [
      ['Proton', ['Proton Duo', 'Mail Plus', 'Proton Family', 'VPN Plus', 'Proton Free']],
      ['TSN', ['Premium', 'Standard']],
    ]) {
      const before = (await places(name)).join(' ');
      for (const plan of plans) {
        await card(page, name).locator('label.chip', { hasText: plan }).click();
        await until(
          plan,
          async () => (await card(page, name).locator('.plan-name').textContent()).trim() === plan,
        );
        if ((await places(name)).join(' ') !== before) moved.push(`${name} ${plan}`);
      }
    }
    check(`${label}: picking other plans moves no chip`, moved.length === 0, moved.join(', '));

    // Scrolled well down: the bar stays at the top (under the top bar under 960 px), the panel below it from 960 px,
    // and the results pass under both without painting over them.
    await page.evaluate(() => window.scrollTo(0, 900));
    await sleep(400);
    const pinned = await page.evaluate(() => {
      const bar = document.querySelector('.pinned').getBoundingClientRect();
      const top = document.querySelector('.top-bar')?.getBoundingClientRect();
      const panel = document.querySelector('section.panel')?.getBoundingClientRect();
      const across = (rect, inside) =>
        [0.1, 0.3, 0.5, 0.7, 0.9].every(
          (at) =>
            document
              .elementFromPoint(rect.left + rect.width * at, rect.top + rect.height / 2)
              ?.closest(inside) !== null,
        );
      return {
        scrollY: Math.round(window.scrollY),
        barTop: Math.round(bar.top),
        barBottom: Math.round(bar.bottom),
        topBottom: top ? Math.round(top.bottom) : 0,
        panelTop: panel ? Math.round(panel.top) : undefined,
        barOnTop: across(bar, '.pinned'),
        topBarOnTop: top ? across(top, '.top-bar') : true,
      };
    });
    check(
      `${label}: scrolled down, the search bar stays pinned, and nothing paints over it or the top bar`,
      pinned.scrollY >= 900 &&
        Math.abs(pinned.barTop - pinned.topBottom) <= 1 &&
        pinned.barOnTop &&
        pinned.topBarOnTop &&
        (viewport === NARROW || Math.abs(pinned.panelTop - pinned.barBottom) <= 1),
      JSON.stringify(pinned),
    );
    if (viewport === NARROW) {
      const bar = await page.locator('.pinned .bar').evaluate((element) => ({
        height: Math.round(element.getBoundingClientRect().height),
        sort: element.querySelector('.sort') !== null,
        filters: element.querySelector('.open-filters')?.getAttribute('aria-label'),
      }));
      check(
        `${label}: the pinned bar is one row, the box and Filters`,
        bar.height <= 72 && !bar.sort && bar.filters === 'Filters',
        JSON.stringify(bar),
      );
    }
    await page.screenshot({ path: path.join(outDir, `pinned-${label}.png`) });
    await axeCheck(page, `light ${label}, scrolled with the bar pinned`);

    // Opening Proton's details keeps the card in view; Hide details, from their foot with the card's top scrolled
    // past, closes them, puts focus on the details button, and brings the card back below the bar.
    const proton = card(page, 'Proton');
    await proton.locator('label.chip', { hasText: 'Proton Unlimited' }).click();
    await proton.locator('button.expand').click();
    await proton.locator('ss-plan-details').waitFor();
    await sleep(900);
    const where = () =>
      proton.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          barBottom: Math.round(document.querySelector('.pinned').getBoundingClientRect().bottom),
          window: window.innerHeight,
          focus: document.activeElement?.getAttribute('aria-label'),
        };
      });
    const opened = await where();
    check(
      `${label}: open details keep the card in view below the bar`,
      opened.top >= opened.barBottom &&
        (opened.bottom <= opened.window || opened.top <= opened.barBottom + 9),
      JSON.stringify(opened),
    );
    const hide = proton.locator('button.collapse');
    await hide.evaluate((button) =>
      window.scrollBy(
        0,
        button.getBoundingClientRect().top -
          document.querySelector('.pinned').getBoundingClientRect().bottom -
          40,
      ),
    );
    await sleep(300);
    const scrolledPast = await where();
    const past = scrolledPast.top < scrolledPast.barBottom;
    await hide.focus();
    await page.keyboard.press('Enter');
    await until(
      'the details to close',
      async () => (await proton.locator('ss-plan-details').count()) === 0,
    );
    await sleep(900);
    const closed = await where();
    check(
      `${label}: Hide details closes them, focus goes back to the details button, and the card comes back into view`,
      past &&
        closed.focus === 'Details: Proton Unlimited' &&
        closed.top >= closed.barBottom &&
        closed.bottom <= closed.window,
      JSON.stringify({ past, ...closed }),
    );
    await context.close();
  }

  // ── M5.8: a long Features chip wraps inside its field, with its remove button centred ──────────────
  for (const viewport of [WIDE, NARROW]) {
    const label = `${viewport.width}`;
    const context = await newContext(browser, { locale: 'en-CA', viewport });
    const page = await newPage(context, `CA chips ${label}`);
    await page.goto(`${baseUrl}search?f=streaming.download-devices%3D6%2B`);
    await firstRun(page, 'Alberta');
    await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
    if (viewport === NARROW) {
      await page.locator('.open-filters').click();
      await page.locator('mat-dialog-container').waitFor();
      await sleep(600);
    }
    const chip = await page.evaluate(() => {
      const row = document.querySelector('mat-chip-row');
      const box = (element) => element.getBoundingClientRect();
      const [chipBox, fieldBox, iconBox] = [
        box(row),
        box(row.closest('mat-form-field')),
        box(row.querySelector('mat-icon')),
      ];
      const scroller =
        document.querySelector('mat-dialog-content') ?? document.querySelector('section.panel');
      return {
        text: row.textContent.replace('cancel', '').trim(),
        inField: chipBox.left >= fieldBox.left && chipBox.right <= fieldBox.right,
        iconInChip: iconBox.right <= chipBox.right,
        centred:
          Math.abs((iconBox.top + iconBox.bottom) / 2 - (chipBox.top + chipBox.bottom) / 2) <= 1,
        sideways: scroller.scrollWidth - scroller.clientWidth,
      };
    });
    check(
      `${label}: a long Features chip wraps inside its field, its remove button centred, with no sideways scroll`,
      chip.text === 'Download devices: Downloads on 6+ devices' &&
        chip.inField &&
        chip.iconInChip &&
        chip.centred &&
        chip.sideways === 0,
      JSON.stringify(chip),
    );
    await context.close();
  }

  // With reduced motion the details appear and go at once.
  {
    const context = await newContext(browser, { locale: 'en-CA', reducedMotion: 'reduce' });
    const page = await newPage(context, 'CA reduced motion');
    await openSearch(page, 'Alberta');
    const netflix = card(page, 'Netflix');
    await netflix.locator('button.expand').click();
    await netflix.locator('ss-plan-details').waitFor();
    const running = await netflix
      .locator('.details-body')
      .evaluate((body) => body.getAnimations().length);
    await netflix.locator('button.expand').click();
    await sleep(50);
    check(
      'with reduced motion the details open and close at once',
      running === 0 && (await netflix.locator('ss-plan-details').count()) === 0,
      `${running} animations`,
    );
    await context.close();
  }

  // ── Both themes at both widths: cards expanded (a bundle, a suite, resellers), and the empty state ─────
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const context = await newContext(browser, { locale: 'en-CA', colorScheme, viewport });
      const page = await newPage(context, label);
      await openSearch(page, 'Alberta');
      for (const name of ['Disney+', 'Proton', 'Mullvad VPN']) {
        await card(page, name).locator('button.expand').click();
      }
      // Proton's suite, and Disney+'s Premium, which a bundle includes.
      await card(page, 'Proton').locator('label.chip', { hasText: 'Proton Unlimited' }).click();
      await card(page, 'Disney+')
        .locator('label.chip', { hasText: /^check\s*Premium$|^Premium$/ })
        .click();
      await until('the suite', () =>
        card(page, 'Proton').getByRole('heading', { name: 'Includes' }).isVisible(),
      );
      await until('the bundle', () =>
        card(page, 'Disney+').getByRole('heading', { name: 'Bundles' }).isVisible(),
      );
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
      await page.screenshot({
        path: path.join(outDir, `expanded-${colorScheme}-${viewport.width}.png`),
        fullPage: true,
      });
      await axeCheck(page, `${label}, cards expanded`);
      if (viewport === WIDE) {
        await page.getByRole('combobox', { name: 'Features' }).focus();
        await page.keyboard.type('video');
        await page.locator('.mat-mdc-autocomplete-panel mat-option').first().waitFor();
        await sleep(500);
        await page.screenshot({ path: path.join(outDir, `panel-${colorScheme}-1280.png`) });
        await axeCheck(page, `${label}, the Features suggestions open`);
        await page.keyboard.press('Escape');
      } else {
        await page.locator('.open-filters').click();
        await page.locator('mat-dialog-container').waitFor();
        await sleep(500);
        await page.screenshot({ path: path.join(outDir, `drawer-${colorScheme}-360.png`) });
        await axeCheck(page, `${label}, the filter drawer open`);
        await page.keyboard.press('Escape');
        await page.locator('mat-dialog-container').waitFor({ state: 'detached' });
      }
      await card(page, 'Netflix').locator('.prices ss-price button').first().click();
      await page.locator('.mat-mdc-menu-panel').waitFor();
      await sleep(500);
      await axeCheck(page, `${label}, the Add to list menu open`);
      if (viewport === NARROW) {
        await page.screenshot({ path: path.join(outDir, `add-menu-${colorScheme}-360.png`) });
      }
      await page.keyboard.press('Escape');
      await page.locator('.mat-mdc-menu-panel').waitFor({ state: 'detached' });
      await type(page, 'zzzz');
      await axeCheck(page, `${label}, no match`);
      if (viewport === NARROW) {
        await page.screenshot({ path: path.join(outDir, `empty-${colorScheme}-360.png`) });
      }
      await context.close();
    }
  }

  // ── M1.13, M1.14: Terms and policies in a card's details (Alberta, light, 1280 px) ──────────────
  {
    const context = await newContext(browser, { locale: 'en-CA' });
    const page = await newPage(context, 'CA policies');
    await openSearch(page, 'Alberta');
    const mullvad = card(page, 'Mullvad VPN');
    await mullvad.locator('button.expand').click();
    const section = mullvad.locator('.group', {
      has: page.getByRole('heading', { name: 'Terms and policies' }),
    });
    await section.waitFor();
    // The details finish sliding open: a dot that moves under the pointer fires mouseleave.
    await sleep(1000);
    const rows = await policyRows(section);
    const groups = await section.locator('h4').allTextContents();
    const links = await section
      .locator('.policy-links a')
      .evaluateAll((anchors) =>
        anchors.map((anchor) => [
          anchor.textContent.replace(/\s+/g, ' ').trim(),
          anchor.target,
          anchor.rel,
        ]),
      );
    check(
      'Mullvad’s details grade its terms by group, each a dot named by its grade, with why and citations, and number its pages',
      groups.join() === 'Privacy,Billing,Legal,Service' &&
        rows[0] ===
          "Great | Data collection: To sign up you don't give your name, an email address or even a password, so it knows very little about you. [3]" &&
        rows.some((row) => row.startsWith('Good | Cancelling and refunds:')) &&
        links.length === 4 &&
        links[0][0].startsWith('[1] Terms of service') &&
        links.every(
          ([text, target, rel]) =>
            /opens in a new tab/.test(text) && target === '_blank' && rel === 'noopener',
        ),
      `${groups.join(', ')} | ${rows[0]} | ${links.map(([text]) => text).join(', ')}`,
    );
    const citations = await section
      .locator('.cite')
      .evaluateAll((anchors) =>
        anchors.map((anchor) => [
          anchor.textContent.replace(/\s+/g, ' ').trim(),
          anchor.href,
          anchor.target,
        ]),
      );
    check(
      'each citation links its page, scrolled to the words it quotes, in a new tab',
      citations.length >= 9 &&
        citations.every(
          ([text, href, target]) =>
            /^\[[1-4]\] .+, opens in a new tab$/.test(text) &&
            href.includes('#:~:text=') &&
            target === '_blank',
        ),
      `${citations.length}: ${citations[0]?.join(' ')}`,
    );
    // Mullvad's refunds quote its terms three times: one citation, highlighting all three.
    const refunds = section.locator('.policies li', { hasText: 'Cancelling and refunds' });
    const refundCites = await refunds
      .locator('.cite')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
    const repeats = await section.locator('.policies li').evaluateAll(
      (items) =>
        items.filter((item) => {
          const numbers = [...item.querySelectorAll('.cite')].map(
            (cite) => cite.href.split('#')[0],
          );
          return new Set(numbers).size !== numbers.length;
        }).length,
    );
    check(
      'a rating cites each page once, its link highlighting every quote from it',
      refundCites.length === 1 && refundCites[0].split('text=').length === 4 && repeats === 0,
      `${refundCites.join(' ')} / ${repeats} with a page twice`,
    );
    const looks = await section.evaluate((group) => {
      const style = (selector) => getComputedStyle(group.querySelector(selector));
      const resolved = (property, name) => {
        const probe = document.createElement('span');
        probe.style[property] = `var(${name})`;
        group.append(probe);
        const value = getComputedStyle(probe)[property];
        probe.remove();
        return value;
      };
      const grade = group.querySelector('.grade').getBoundingClientRect();
      const dot = group.querySelector('.grade .dot').getBoundingClientRect();
      return {
        muted: style('.rated').color === resolved('color', '--ss-text-muted'),
        bold:
          style('.topic').color === resolved('color', '--ss-text') &&
          style('.topic').fontWeight === '600',
        target: `${grade.width}x${grade.height}`,
        dot: `${dot.width}x${dot.height}`,
        fill:
          style('.grade .dot').backgroundColor === resolved('backgroundColor', '--policy-great'),
      };
    });
    check(
      'the reason is muted, its topic bold in the text colour, and the dot 12 px in a 24 px target, in its colour',
      looks.muted && looks.bold && looks.target === '24x24' && looks.dot === '12x12' && looks.fill,
      JSON.stringify(looks),
    );
    // Hover shows the grade, a click keeps it, and leaving hides it.
    const firstDot = section.locator('.grade').first();
    // The one showing: another may still be fading out.
    const tooltip = page.locator('.mat-mdc-tooltip-show');
    await firstDot.hover();
    await tooltip.waitFor();
    const hovered = (await tooltip.textContent()).trim();
    await firstDot.click();
    await sleep(400);
    const afterClick = await tooltip.isVisible();
    // The viewport: an element's screenshot scrolls, and a scroll closes a tooltip.
    await page.screenshot({ path: path.join(outDir, 'policies-tooltip-1280.png') });
    await page.mouse.move(5, 5);
    await tooltip.waitFor({ state: 'detached' });
    await section.screenshot({ path: path.join(outDir, 'policies-mullvad-1280.png') });
    check(
      'hovering a dot shows its grade, a click keeps it, and moving away hides it',
      hovered === 'Great' && afterClick,
      `${hovered} / ${afterClick}`,
    );
    // A citation's tooltip is the words it quotes.
    await section.locator('.cite').first().hover();
    await tooltip.waitFor();
    const quoteTip = (await tooltip.textContent()).trim();
    check(
      "a citation's tooltip quotes its page",
      quoteTip.startsWith('“When you sign up for Mullvad,') &&
        quoteTip.endsWith('(No-logging policy)'),
      quoteTip,
    );
    await axeCheck(page, 'light 1280, Terms and policies open, a citation’s tooltip shown');
    await page.mouse.move(5, 5);
    await tooltip.waitFor({ state: 'detached' });
    // By keyboard: Tab to a dot shows its grade, and Escape hides it.
    await firstDot.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await tooltip.waitFor();
    const keyed = (await tooltip.textContent()).trim();
    await page.keyboard.press('Escape');
    await tooltip.waitFor({ state: 'detached' });
    check('Tab to a dot shows its grade, and Escape hides it', keyed === 'Great', keyed);
    // Netflix's ratings from its Canadian terms show here, and its ad plan's own ratings on that plan.
    const netflix = card(page, 'Netflix');
    await netflix.locator('button.expand').click();
    await netflix.locator('.policies li').first().waitFor();
    const netflixRows = await policyRows(netflix);
    check(
      "Netflix's ad plan shows its own sharing and download limits, and its Canadian terms",
      netflixRows.some((row) => row.startsWith('Poor | Account sharing:')) &&
        netflixRows.some((row) =>
          row.startsWith('Poor | Device and download limits: You can only download 15'),
        ) &&
        netflixRows.some((row) => row.startsWith('Good | Price changes:')),
      netflixRows.join(' | '),
    );
    await axeCheck(page, 'light 1280, Terms and policies open');
    await context.close();
  }

  // ── M1.14: on a phone, a tap on a dot shows its grade and a tap elsewhere hides it (dark, 360 px) ──
  {
    const context = await browser.newContext({
      locale: 'en-CA',
      colorScheme: 'dark',
      viewport: NARROW,
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    });
    await context.route('**/api/v1/fx?**', (route) =>
      route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
    );
    const page = await newPage(context, 'CA policies, a phone');
    await openSearch(page, 'Alberta');
    const mullvad = card(page, 'Mullvad VPN');
    await mullvad.locator('button.expand').tap();
    const section = mullvad.locator('.group', {
      has: page.getByRole('heading', { name: 'Terms and policies' }),
    });
    await section.waitFor();
    // The one showing: another may still be fading out.
    const tooltip = page.locator('.mat-mdc-tooltip-show');
    // Mullvad's fifth rating, Cancelling and refunds, is Good.
    const dot = section.locator('.grade').nth(4);
    await dot.scrollIntoViewIfNeeded();
    await dot.tap();
    await tooltip.waitFor();
    const tapped = (await tooltip.textContent()).trim();
    await sleep(400);
    await page.screenshot({ path: path.join(outDir, 'policies-tooltip-dark-360.png') });
    await axeCheck(page, 'dark 360 phone, a grade shown');
    await section.locator('h3').tap();
    await tooltip.waitFor({ state: 'detached' });
    await section.screenshot({ path: path.join(outDir, 'policies-mullvad-dark-360.png') });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    check(
      'a tap on a dot shows its grade, a tap elsewhere hides it, and nothing scrolls sideways',
      tapped === 'Good' && width <= NARROW.width,
      `${tapped} / ${width}px`,
    );
    await context.close();
  }

  // ── A US user: the US-only plan and a provider not sold there; a UK user's fallback price ─────────
  {
    const context = await newContext(browser, { locale: 'en-US' });
    const page = await newPage(context, 'US');
    await openSearch(page);
    const disney = await chips(page, 'Disney+');
    check('a US user sees Disney+ With Ads', disney.includes('With Ads'), disney.join(', '));
    // M1.13: a rating for the buyer's country over the one for everywhere.
    await card(page, 'Proton').locator('button.expand').click();
    await card(page, 'Netflix').locator('button.expand').click();
    await card(page, 'Netflix').locator('.policies li').first().waitFor();
    const disputes = (await policyRows(card(page, 'Proton'))).find((row) =>
      row.includes('| Disputes:'),
    );
    check(
      "a US user sees Proton's US disputes rating, and none from Netflix's Canadian terms",
      disputes.startsWith('Poor | Disputes: In the US, a private arbitrator') &&
        (await card(page, 'Netflix')
          .locator('.policies li', { hasText: 'Price changes' })
          .count()) === 0,
      disputes,
    );
    check(
      'a provider not sold in the US has no card until the text names it',
      !(await names(page)).includes('Crave'),
    );
    await type(page, 'crave');
    check(
      'naming it shows "Not offered in United States"',
      (await shown(card(page, 'Crave').locator('.prices'))) === 'Not offered in United States',
      await shown(card(page, 'Crave').locator('.prices')),
    );
    await page.screenshot({ path: path.join(outDir, 'us-not-offered.png') });
    await axeCheck(page, 'US, not offered');
    await context.close();

    // Netflix has no UK price and no availableIn, so it's unknown there.
    const british = await newContext(browser, { locale: 'en-GB' });
    const second = await newPage(british, 'GB');
    await openSearch(second);
    const prices = await shown(card(second, 'Netflix').locator('.prices'));
    check(
      'with no UK price and no availableIn, the fallback price shows "No price for United Kingdom yet"',
      /^≈ £\d+\.\d\d \/ mo .*No price for United Kingdom yet$/.test(prices),
      prices,
    );
    // M5.6: Sold in United Kingdom hides what has no UK price, and Settings can make it the default.
    const sold = second.getByRole('checkbox', { name: 'Sold in United Kingdom' });
    await sold.focus();
    await second.keyboard.press('Space');
    await until('sold=1', () => search(second) === '?sold=1');
    await until('Netflix to go', async () => !(await names(second)).includes('Netflix'));
    check(
      '"Sold in United Kingdom" hides the providers with no UK price, in the URL as sold=1',
      (await names(second)).join() === 'Proton,Mullvad VPN',
      (await names(second)).join(', '),
    );
    await second.goto(`${baseUrl}settings`);
    const option = second.getByRole('checkbox', {
      name: "Show only what's sold in United Kingdom",
    });
    await option.waitFor();
    await option.focus();
    await second.keyboard.press('Space');
    await until('the option saved', () => option.isChecked());
    // Material's check mark animates in: a screenshot at once catches it still empty.
    await sleep(600);
    await second.screenshot({ path: path.join(outDir, 'settings-search-gb.png'), fullPage: true });
    await axeCheck(second, 'GB, Settings with the Search option');
    await second.goto(`${baseUrl}search`);
    await second.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
    await until('the default', async () => !(await names(second)).includes('Netflix'));
    check(
      "Settings' option starts Search with Sold in on, and no sold in the URL",
      search(second) === '' && (await sold.isChecked()),
      search(second),
    );
    await sold.focus();
    await second.keyboard.press('Space');
    await until('sold=0', () => search(second) === '?sold=0');
    await until('Netflix back', async () => (await names(second)).includes('Netflix'));
    check('turning it off against the default writes sold=0', true);
    await axeCheck(second, 'GB, Sold in off against the default');
    await british.close();
  }

  await browser.close();
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
