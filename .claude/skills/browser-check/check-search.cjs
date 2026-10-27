// M5.2 and M5.3 in the system Edge: the Search page on the real catalog (data:build's files), for a Canadian in
// Alberta and a US user, in both themes at 1280 and 360 px: the cards, plan chips by keyboard, the expanded details,
// the "Cheaper at" resellers, typing with its pause, the empty state, a listed provider's status, a plan sold in the US
// only, a provider not sold in the user's country (the US file served with Crave limited to Canada), and the filter
// panel (M5.3): its Tab order, each filter by keyboard, the URL after each one (typing replaces its entry, a run of
// price changes makes one, anything else adds one), a reload, Back and Forward, a URL with values the catalog doesn't
// have, no scroll on a filter change, and under 960 px the drawer (focus, its trap, Escape, Show results, Back), with
// axe. GET /fx is answered with fixed rates (1 EUR ≈ CA$1.5694), so Amazon.ca's Mullvad cards are cheaper in Alberta.
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
  { locale, colorScheme = 'light', viewport = WIDE, craveInCanadaOnly },
) {
  const context = await browser.newContext({ locale, colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  if (craveInCanadaOnly) {
    await context.route('**/data/catalog/US.json', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.providers.find((provider) => provider.id === 'crave').availableIn = ['CA'];
      return route.fulfill({ response, json: body });
    });
  }
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
async function addItem(page, planId) {
  await page.evaluate(
    (item) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('items', 'readwrite');
          transaction.objectStore('items').put(item);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    {
      id: '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b',
      listId: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
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
    },
  );
  await page.reload();
  await page.locator('ss-sub-card').first().waitFor({ timeout: 20000 });
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
    check(
      'one card per provider, and the count',
      all.length === 5 && (await count(page)) === '5 services',
      `${all.join(', ')} / ${await count(page)}`,
    );
    const disney = await chips(page, 'Disney+');
    check(
      'a Canadian never sees the US-only Disney+ With Ads',
      !disney.includes('With Ads') && disney.includes('Standard With Ads'),
      disney.join(', '),
    );
    const deals = await shown(card(page, 'Mullvad VPN').locator('.deals'));
    check(
      'Mullvad is cheaper at Amazon.ca and ProxyStore in Alberta',
      /Cheaper at ProxyStore .* Cheaper at Amazon \$87\.00 \/ 12 mo \+ tax/.test(deals),
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

    // Keyboard: the box, the sort, then the filter panel (M5.3, below), then the first card's links, its chips (one
    // tab stop) and its details button.
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
    const stops = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const now = await focused(page);
      stops.push(now);
      if (now.tag === 'input' && now.type === 'radio') break;
    }
    const radio = stops.at(-1);
    check(
      `Tab reaches ${firstName}'s links, then its checked chip`,
      stops[0].tag === 'a' && radio.type === 'radio',
      stops.map((stop) => `${stop.tag}:${stop.name ?? stop.value}`).join(' → '),
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
    await page.keyboard.press('Tab');
    const expand = await focused(page);
    check(
      'Tab leaves the chips for the details button',
      expand.name?.startsWith('Details: '),
      expand.name,
    );
    await page.keyboard.press('Enter');
    await until('the details', () => first.locator('ss-plan-details').isVisible());
    check(
      'Enter expands the card',
      (await first.locator('button.expand').getAttribute('aria-expanded')) === 'true',
    );
    await page.keyboard.press('Enter');
    await until(
      'the details to close',
      async () => (await first.locator('ss-plan-details').count()) === 0,
    );
    check('Enter again collapses it', true);

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
    await until('the cards again', async () => (await names(page)).length === 5);
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
      'the price runs from $0 to Unlimited at $30, the catalog’s priciest rounded up, by $1',
      (await panel.locator('.range').textContent()).trim() === '$0 – Unlimited' &&
        (await end.getAttribute('max')) === '30' &&
        (await end.getAttribute('step')) === '1' &&
        (await end.getAttribute('aria-valuetext')) === 'Unlimited' &&
        (await start.getAttribute('aria-valuetext')) === '$0',
      `${await end.getAttribute('max')} by ${await end.getAttribute('step')}`,
    );

    // The Tab order: the bar, then the panel's controls, then the results.
    await page.getByRole('searchbox').focus();
    const order = [];
    for (let i = 0; i < 11; i++) {
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
      /^button "Clear all" \[disabled\]/,
      /^'?link /,
    ];
    check(
      'Tab goes Sort → the price’s two thumbs → Category → Features → Activity → Native → Clear all → the results',
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
      (await names(page)).join() === 'Proton,Netflix,Disney+,Crave' &&
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
      search(page) === '?native=1' && (await names(page)).length === 4,
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
    await end.focus();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowLeft');
      await sleep(150);
    }
    await until('max=24', () => search(page).includes('max=24'));
    check(
      'six arrow presses on the top thumb make one history entry, at $24',
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
    await until('Mullvad alone', async () => (await names(page)).join() === 'Mullvad VPN');
    check(
      'Category offers All and the categories sold here, and VPN keeps Mullvad',
      categoryOptions.join() === 'All,Streaming video,VPN,Privacy & security suites',
      categoryOptions.join(', '),
    );
    await panel.getByRole('checkbox', { name: 'Not listed' }).focus();
    await page.keyboard.press('Space');
    await until('act=none', () => search(page) === '?cat=vpn&act=none');
    check('Space on Not listed adds act=none', (await names(page)).join() === 'Mullvad VPN');
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
    await page.getByRole('searchbox').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    check(
      'Tab goes from Sort to Filters',
      /^button "Filters"/.test(await stop(page)),
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
    check(
      'Tab stays inside the drawer, never stops on the Features suggestions, and leaves them closed',
      trapped && !onList && (await page.locator('.mat-mdc-autocomplete-panel').count()) === 0,
    );

    await drawer.getByRole('checkbox', { name: 'Native pricing only' }).focus();
    await page.keyboard.press('Space');
    await until('native=1', () => search(page) === '?native=1');
    await until(
      'the drawer’s count',
      async () => (await drawer.locator('[role=status]').textContent()) === '4 services',
    );
    check('a filter in the drawer applies at once, and the drawer announces the count', true);
    await page.screenshot({ path: path.join(outDir, 'drawer-native-360.png') });
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    await until('focus on Filters', async () => /^button "Filters/.test(await stop(page)));
    check(
      'Escape closes the drawer and puts focus back on Filters, which counts one filter',
      (await stop(page)).startsWith('button "Filters, 1 applied"') &&
        (await shown(opener)) === 'Filters · 1',
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
      await type(page, 'zzzz');
      await axeCheck(page, `${label}, no match`);
      if (viewport === NARROW) {
        await page.screenshot({ path: path.join(outDir, `empty-${colorScheme}-360.png`) });
      }
      await context.close();
    }
  }

  // ── A US user: the US-only plan, a provider not sold there, and one with no US price ─────────────
  {
    const context = await newContext(browser, { locale: 'en-US', craveInCanadaOnly: true });
    const page = await newPage(context, 'US');
    await openSearch(page);
    const disney = await chips(page, 'Disney+');
    check('a US user sees Disney+ With Ads', disney.includes('With Ads'), disney.join(', '));
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

    const plain = await newContext(browser, { locale: 'en-US' });
    const second = await newPage(plain, 'US plain');
    await openSearch(second);
    await type(second, 'crave');
    const prices = await shown(card(second, 'Crave').locator('.prices'));
    check(
      'with no US price and no availableIn, the fallback price shows "No price for United States yet"',
      /^≈ \$\d+\.\d\d \/ mo .*No price for United States yet$/.test(prices),
      prices,
    );
    await plain.close();
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
