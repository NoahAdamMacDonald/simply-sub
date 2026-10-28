// M4.3 in the system Edge: CatalogStore's downloads, the offline banner, the "Catalog updated" toast and Settings'
// Catalog line, in both themes at 1280 and 360 px, by keyboard, with axe. Works on ng serve and on the production
// build under wrangler dev (axe goes in through evaluate, which the CSP allows).
// Usage: node check-catalog.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axeSource = fs.readFileSync(
  path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);
fs.mkdirSync(outDir, { recursive: true });

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 360, height: 740 };
const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  let last;
  while (Date.now() - start < timeout) {
    last = await condition();
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Every /data/ request in a context, as a path without the leading slash. */
function trackRequests(context) {
  const requests = [];
  context.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/data/')) requests.push(pathname.slice(1));
  });
  return requests;
}

/** Rates per Canadian dollar, from the API contract's example. */
const cadRates = { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 };

/** GET /fx's body for `base`, from the rates per Canadian dollar. */
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

/**
 * Answers GET /fx with fixed rates, as check-search.cjs does: there's no Worker behind the dev proxy, and its 502 was
 * a console warning. Again after each `unrouteAll`.
 */
async function routeFx(context) {
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
}

async function newContext(browser, options) {
  const context = await browser.newContext(options);
  await routeFx(context);
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

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const banner = async (page) =>
  ((await page.locator('ss-catalog-status [role="status"]').textContent()) ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const catalogSection = (page) =>
  page.locator('section', { has: page.getByRole('heading', { name: 'Catalog' }) });
const catalogText = async (page) =>
  ((await catalogSection(page).textContent()) ?? '').replace(/\s+/g, ' ').trim();
const checkMessage = async (page) =>
  ((await page.locator('.check-message').textContent()) ?? '').trim();
const snackbarText = async (page) => {
  const bar = page.locator('.mat-mdc-snack-bar-container');
  return (await bar.count()) > 0 ? ((await bar.first().textContent()) ?? '').trim() : '';
};

/** The cached catalog files, read straight from IndexedDB: "US 37f6573". */
async function cacheRows(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction('catalogCache').objectStore('catalogCache').getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve(
              all.result.map((row) => `${row.key} ${row.snapshot.meta.catalogVersion}`).sort(),
            );
          };
        };
      }),
  );
}

async function axe(page, label) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document);
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  });
  check(
    `axe: ${label}`,
    violations.length === 0,
    violations.map((v) => `${v.id} (${v.impact}) on ${v.nodes.join(', ')}`).join('; '),
  );
}

async function noHorizontalScroll(page, label) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  check(
    `no horizontal scroll: ${label}`,
    scrollWidth <= innerWidth,
    `${scrollWidth} <= ${innerWidth}`,
  );
}

async function focusedName(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el
      ? `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ')}"`
      : 'none';
  });
}

/** en-US needs no province, so [Get started] saves the locale's defaults: the United States, in USD. */
async function firstRun(page) {
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

/** Serves `version` in place of the deployed catalog: index.json and US.json with that version. */
async function deployVersion(context, real, version) {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await routeFx(context);
  const index = { ...real.index, catalogVersion: version };
  const us = { ...real.us, meta: { ...real.us.meta, catalogVersion: version } };
  await context.route('**/data/catalog/index.json', (route) => route.fulfill({ json: index }));
  await context.route('**/data/catalog/US.json', (route) => route.fulfill({ json: us }));
}

async function checkButton(page) {
  await page.getByRole('button', { name: 'Check for updates' }).click();
}

/** Downloads, reloads, the keyboard, two tabs and a region with no file of its own (light, 1280 px). */
async function requestsAndTabs(browser, real) {
  const day = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(real.index.generatedAt));
  const context = await newContext(browser, {
    viewport: WIDE,
    colorScheme: 'light',
    locale: 'en-US',
  });
  const requests = trackRequests(context);
  const page = await newPage(context, 'tab 1');
  await page.goto(baseUrl);
  await firstRun(page);
  const v = real.index.catalogVersion;
  await until('US.json cached', async () => (await cacheRows(page)).join() === `US ${v}`);
  check('first run: US.json downloaded and cached', true);
  check(
    'first run: index.json before the dialog, then index.json and US.json once',
    JSON.stringify(requests) ===
      JSON.stringify([
        'data/catalog/index.json',
        'data/catalog/index.json',
        'data/catalog/US.json',
      ]),
    requests.join(', '),
  );

  requests.length = 0;
  await page.reload();
  await page.getByRole('heading', { name: 'Home' }).waitFor();
  await sleep(1500);
  check(
    'reload: only index.json is asked for',
    requests.join() === 'data/catalog/index.json',
    requests.join(', '),
  );
  check('reload: no banner online', (await banner(page)) === '', await banner(page));

  // Settings' Catalog line, reached by the sidebar and the keyboard.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Catalog' }).waitFor();
  const line = await catalogText(page);
  check('Settings: the Catalog line', line.includes(`Updated ${day} · version ${v}`), line);
  // Search's option and Your data's buttons (M5.6, M6.9) come between 📍 and the Catalog line.
  await page.getByRole('button', { name: /United States/ }).focus();
  let focused = '';
  for (let presses = 0; presses < 8 && !focused.includes('Check for updates'); presses++) {
    await page.keyboard.press('Tab');
    focused = await focusedName(page);
  }
  check(
    'keyboard: Tab from 📍 reaches [Check for updates]',
    focused.includes('Check for updates'),
    focused,
  );
  requests.length = 0;
  await page.keyboard.press('Enter');
  await until(
    'check message',
    async () => (await checkMessage(page)) === 'You have the latest catalog.',
  );
  check('keyboard: Enter checks, "You have the latest catalog."', true);
  check(
    'keyboard: focus stays on the button',
    (await focusedName(page)).includes('Check for updates'),
  );
  check(
    'a manual check asks only for index.json',
    requests.join() === 'data/catalog/index.json',
    requests.join(', '),
  );

  // The network drops while the app is open.
  await context.setOffline(true);
  await until('offline banner', async () => (await banner(page)).includes('Offline'));
  const shortDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
    new Date(real.index.generatedAt),
  );
  check(
    'offline: banner with the catalog date',
    (await banner(page)) === `wifi_off Offline — catalog from ${shortDay}`,
    await banner(page),
  );
  await checkButton(page);
  await until('offline message', async () =>
    (await checkMessage(page)).startsWith("You're offline"),
  );
  check('offline: [Check for updates] says so', true);
  // Home's chunk loaded with the app. A page never opened in this session can't load its chunk offline: that's
  // the service worker's job (M10).
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('heading', { name: 'Home' }).waitFor();
  check(
    'offline: navigating to a page already loaded works, banner stays',
    (await banner(page)).includes('Offline'),
  );
  await context.setOffline(false);
  await until('banner gone after online', async () => (await banner(page)) === '');
  check('back online: the banner goes', true);

  // index.json unreachable on a reload, with the browser online.
  await context.route('**/data/catalog/index.json', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await until('banner on unreachable index', async () =>
    (await banner(page)).includes('catalog from'),
  );
  check(
    'index.json unreachable on load: cached catalog, banner with its date',
    true,
    await banner(page),
  );
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await routeFx(context);

  // A new version, announced in both tabs, downloaded once.
  await page.goto(`${baseUrl}settings`);
  await page.getByRole('heading', { name: 'Catalog' }).waitFor();
  const page2 = await newPage(context, 'tab 2');
  await page2.goto(`${baseUrl}lists`);
  await page2.getByRole('heading', { name: 'Lists' }).waitFor();
  await sleep(1000);
  await deployVersion(context, real, 'abcdef1');
  requests.length = 0;
  await checkButton(page);
  await until(
    'downloaded message',
    async () => (await checkMessage(page)) === 'Downloaded the latest catalog.',
  );
  check('new version: "Downloaded the latest catalog."', true);
  await until('toast tab 1', async () => (await snackbarText(page)).includes('Catalog updated'));
  check('new version: "Catalog updated" in the tab that checked', true);
  await until('toast tab 2', async () => (await snackbarText(page2)).includes('Catalog updated'));
  check('new version: "Catalog updated" in the other open tab', true);
  check(
    'new version: US.json downloaded once',
    requests.filter((r) => r.endsWith('US.json')).length === 1,
    requests.join(', '),
  );
  check(
    'new version: Settings shows it',
    (await catalogText(page)).includes('version abcdef1'),
    await catalogText(page),
  );
  check(
    'new version: cached',
    (await cacheRows(page)).join() === 'US abcdef1',
    (await cacheRows(page)).join(),
  );

  // Two tabs reload together on another new version: one download (Web Lock).
  await deployVersion(context, real, 'abcdef2');
  requests.length = 0;
  await Promise.all([page.reload(), page2.reload()]);
  await until('both on abcdef2', async () => (await cacheRows(page)).join() === 'US abcdef2');
  await sleep(1500);
  check(
    'two tabs reloading together download the new version once',
    requests.filter((r) => r.endsWith('US.json')).length === 1,
    requests.join(', '),
  );
  await page2.close();

  // Sweden has no file of its own, and no EU file today: the full catalog.json, and US.json is dropped.
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await routeFx(context);
  await page.goto(`${baseUrl}settings`);
  await page.getByRole('button', { name: /United States/ }).click();
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor();
  await page
    .locator('mat-dialog-container mat-form-field', {
      has: page.locator('mat-label', { hasText: 'Country' }),
    })
    .locator('.mat-mdc-text-field-wrapper')
    .click();
  await page.getByRole('option', { name: 'Sweden', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  requests.length = 0;
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.waitFor({ state: 'detached' });
  await until('catalog.json cached', async () => (await cacheRows(page)).join() === `catalog ${v}`);
  check(
    'Sweden: served the full catalog.json, US.json dropped',
    requests.includes('data/catalog.json') && !requests.some((r) => r.endsWith('US.json')),
    requests.join(', '),
  );
  await context.close();
}

/** The banner, the Catalog line and the toast in each theme at each width. */
async function looks(browser, real) {
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const context = await newContext(browser, { viewport, colorScheme, locale: 'en-US' });
      const page = await newPage(context, label);
      await page.goto(`${baseUrl}settings`);
      await firstRun(page);
      await until('cached', async () => (await cacheRows(page)).length === 1);
      await context.setOffline(true);
      await until('offline banner', async () => (await banner(page)).includes('Offline'));
      await checkButton(page);
      await until('offline message', async () =>
        (await checkMessage(page)).startsWith("You're offline"),
      );
      // The click's ripple fades out over a few hundred ms; mid-fade, the dark theme's accent label on its state
      // layer measures 4:1, which axe would catch.
      await sleep(600);
      await shot(page, `settings-offline-${colorScheme}-${viewport.width}`);
      await axe(page, `Settings offline, banner and message, ${label}`);
      await noHorizontalScroll(page, `Settings offline, ${label}`);
      await context.setOffline(false);
      await until('banner gone', async () => (await banner(page)) === '');

      await deployVersion(context, real, 'abcdef9');
      await checkButton(page);
      await until('toast', async () => (await snackbarText(page)).includes('Catalog updated'));
      await sleep(600); // the snackbar's enter animation
      await shot(page, `toast-${colorScheme}-${viewport.width}`);
      await axe(page, `"Catalog updated" toast, ${label}`);
      await context.close();
    }
  }
}

/** A first visit whose catalog can't be reached. */
async function firstVisitOffline(browser) {
  for (const [colorScheme, viewport] of [
    ['dark', NARROW],
    ['light', WIDE],
  ]) {
    const label = `${colorScheme} ${viewport.width}`;
    const context = await newContext(browser, { viewport, colorScheme, locale: 'en-US' });
    await context.route('**/data/catalog/**', (route) => route.abort('internetdisconnected'));
    const page = await newPage(context, `first visit offline ${label}`);
    await page.goto(baseUrl);
    await firstRun(page);
    await until('banner', async () => (await banner(page)).includes('Offline'));
    check(
      `first visit, no catalog: "will load when you're back online" (${label})`,
      (await banner(page)) === "wifi_off Offline — the catalog will load when you're back online",
      await banner(page),
    );
    await shot(page, `first-visit-offline-${colorScheme}-${viewport.width}`);
    await axe(page, `Home with the first-visit banner, ${label}`);
    await noHorizontalScroll(page, `Home with the banner, ${label}`);
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const real = {
    index: await (await fetch(`${baseUrl}data/catalog/index.json`)).json(),
    us: await (await fetch(`${baseUrl}data/catalog/US.json`)).json(),
  };
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    await requestsAndTabs(browser, real);
    await looks(browser, real);
    await firstVisitOffline(browser);
  } catch (error) {
    check('script ran to the end', false, error.stack);
  } finally {
    await browser.close();
  }
  // Failed requests while offline are expected; anything else isn't.
  const unexpected = consoleProblems.filter(
    (line) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(line),
  );
  check('no unexpected console errors or warnings', unexpected.length === 0, unexpected.join('\n'));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
