// M10's offline and sync batch in the system Edge, under `wrangler dev` with the production build (`npm -w apps/web run
// build`, then `node apps/api/scripts/copy-web-build.mjs`), so the CSP, Trusted Types and the service worker are as on
// the live site; its user database migrated (`npm -w apps/api run db:user:migrate:local`). For a Canadian in Alberta
// with Work Related (Netflix Standard on the 12th; Crave Premium billed on the 31st) and Family (Mullvad VPN, yearly on
// Jan 20). In both themes at 1280 and 360 px:
// - M10.5, offline start: the service worker registers (through its Trusted Types policy: no violation), controls the
//   page and caches the app's files; with the network off, Home, a deep link and every sidebar page load, the catalog,
//   the rates and the lists from IndexedDB, no CSP or Trusted Types error; none of the worker's caches holds an /api/ or /data/
//   answer (Angular's worker passes every request through itself, so Playwright's fromServiceWorker says nothing).
// - M10.6, the update prompt and install: both theme-color metas take the theme on screen; Settings gives the build's
//   version, and its Check for updates by Enter finds nothing new. Two more builds, each new to the worker (their
//   browser folders, the 4th and 5th arguments: `WORKERS_CI_COMMIT_SHA=b0b0b0b node scripts/build.mjs
//   --output-path=<dir>` in apps/web, then c0c0c0c): with the second served, the open tab's Check for updates finds it
//   and "A new version of Simply Sub is ready." [Reload] shows, reached by Tab from Check for updates, and Enter
//   runs it; with the third served, a page load runs it at once (freshness) and the worker, learning of it after,
//   prompts nothing. Then, in a profile of its own (Edge offers no install to a private window): no manifest or
//   installability error, Edge's offer as Settings' Install, and Enter on it, which an offer allows once. The script
//   serves a build by copying it into apps/api/public/, as copy-web-build.mjs does, and puts the first build
//   (apps/web/dist's) back after each run.
// With axe offline and with the prompt shown, and no horizontal scroll.
// Usage: node check-m10-offline-sync.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
//   <second build's browser dir> <third build's browser dir>
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl, secondBuild, thirdBuild] = process.argv.slice(2);
for (const build of [secondBuild, thirdBuild]) {
  if (!build || !fs.existsSync(path.join(build, 'ngsw.json'))) {
    throw new Error(
      'The 4th and 5th arguments are the browser folders of two more production builds, each with its ngsw.json.',
    );
  }
}
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axeSource = fs.readFileSync(
  path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);
fs.mkdirSync(outDir, { recursive: true });

const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 360, height: 740 };

const repo = path.resolve(__dirname, '..', '..', '..');
const publicDir = path.join(repo, 'apps', 'api', 'public');
const firstBuild = path.join(repo, 'apps', 'web', 'dist', 'web', 'browser');

/** Serves a build under wrangler dev, as copy-web-build.mjs does: public/'s own files (_headers) stay. */
function serve(build) {
  for (const entry of fs.readdirSync(publicDir)) {
    if (entry !== '_headers' && entry !== '_redirects') {
      fs.rmSync(path.join(publicDir, entry), { recursive: true, force: true });
    }
  }
  fs.cpSync(build, publicDir, { recursive: true });
}
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

async function until(what, condition, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await condition();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Rates for GET /fx, so no request leaves the machine. */
const rates = {
  data: {
    base: 'CAD',
    date: '2026-10-26',
    source: 'European Central Bank via Frankfurter',
    rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
  },
  meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
};

/** Whether the context is offline now: a request that fails then is expected, and its console line too. */
const network = { offline: false };

async function newPage(browser, label, { colorScheme = 'light', viewport = WIDE } = {}) {
  // Service workers allowed: they're what's checked.
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  return { context, page: await prepare(context, label) };
}

/** A context's first page, with /fx answered and the console watched. */
async function prepare(context, label) {
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('console', (msg) => {
    const failedOffline = network.offline && /^Failed to load resource/.test(msg.text());
    if ((msg.type() === 'error' || msg.type() === 'warning') && !failedOffline) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return page;
}

/** Opens Home and completes the first-run dialog for Alberta. */
async function firstRun(page) {
  await page.goto(baseUrl);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 20000 });
  await page
    .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
    .locator('.mat-mdc-text-field-wrapper')
    .click();
  await page.getByRole('option', { name: 'Alberta', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

/** Writes a record straight to an IndexedDB table. Dexie's live queries don't see it: reload after. */
function putRecord(page, table, record) {
  return page.evaluate(
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
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  const inOverlay = await page.evaluate(
    (targets) =>
      targets.map(
        (target) => document.querySelector(target)?.closest('.cdk-overlay-container') != null,
      ),
    (result.violations.find((violation) => violation.id === 'region')?.nodes ?? []).map((node) =>
      node.target.join(' '),
    ),
  );
  const violations = result.violations.filter(
    (violation) =>
      violation.id !== 'region' || !violation.nodes.every((_, index) => inOverlay[index]),
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

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

const WORK = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const monthly = (anchorDate) => ({
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate,
  autoRenew: true,
});

async function plant(page) {
  await putRecord(page, 'lists', { id: WORK, name: 'Work Related', ...stamps });
  await putRecord(page, 'lists', { id: FAMILY, name: 'Family', ...stamps });
  const items = [
    [WORK, 'netflix.standard', monthly('2026-11-12')],
    [WORK, 'crave.premium', monthly('2026-01-31')],
    [
      FAMILY,
      'mullvad.vpn',
      {
        mode: 'recurring',
        interval: 'year',
        intervalCount: 1,
        anchorDate: '2027-01-20',
        autoRenew: false,
      },
    ],
  ];
  for (const [index, [listId, planId, billing]] of items.entries()) {
    await putRecord(page, 'items', {
      id: `0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0${index}`,
      listId,
      source: { kind: 'catalog', planId },
      billing,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
    });
  }
}

/** The files the catalog cache (IndexedDB's catalogCache) holds: one a region, once downloaded (index.json isn't kept). */
function catalogFiles(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction('catalogCache').objectStore('catalogCache').getAllKeys();
          all.onsuccess = () => {
            db.close();
            resolve(all.result.length);
          };
        };
      }),
  );
}

/** Every URL any of the worker's caches holds under /api/ or /data/: there should be none. */
function cachedApiOrData(page) {
  return page.evaluate(async () => {
    const found = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        const { pathname } = new URL(request.url);
        if (/^\/(api|data)\//.test(pathname)) found.push(pathname);
      }
    }
    return found;
  });
}

/** Waits for the worker to control the page and to hold every file of the app's group (ngsw.json's). */
async function cached(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await until('the worker controls the page', () =>
    page.evaluate(() => navigator.serviceWorker.controller !== null),
  );
  return until(
    'the app’s files cached',
    () =>
      page.evaluate(async () => {
        const manifest = await (await fetch('/ngsw.json', { cache: 'no-store' })).json();
        const expected = manifest.assetGroups.find((group) => group.name === 'app').urls.length;
        const key = (await caches.keys()).find((name) => name.endsWith(':assets:app:cache'));
        if (!key) return false;
        const count = (await (await caches.open(key)).keys()).length;
        return count >= expected ? count : false;
      }),
    60000,
  );
}

/** The pages offline: Home, a deep link and every sidebar page, each by its title and what it shows. */
const pages = [
  ['', 'Home · Simply Sub'],
  [`lists/${WORK}`, 'List · Simply Sub'],
  ['lists', 'Lists · Simply Sub'],
  ['search', 'Search · Simply Sub'],
  ['features', 'Features · Simply Sub'],
  ['calendar', 'Calendar · Simply Sub'],
  ['payment', 'Payment · Simply Sub'],
  ['custom', 'Custom subscriptions · Simply Sub'],
  ['settings', 'Settings · Simply Sub'],
];

async function offlineStart(page, context, viewport, label) {
  const files = await cached(page).catch(() => 0);
  check(
    `${label}: the worker controls the page and holds the app's files`,
    files > 100,
    `${files} files`,
  );
  // The catalog is downloaded once the first run has saved the country: wait for it before going offline.
  await until('the catalog in IndexedDB', async () => (await catalogFiles(page)) >= 1, 30000);

  await context.setOffline(true);
  network.offline = true;
  const loaded = [];
  for (const [route, title] of pages) {
    await page.goto(`${baseUrl}${route}`);
    const ok = await until(
      `${route || 'Home'} offline`,
      async () =>
        (await page.title()) === title && (await page.locator('main h1, main h2').count()) > 0,
    ).catch(() => false);
    loaded.push(`${route || '/'}: ${ok ? 'ok' : await page.title()}`);
  }
  check(
    `${label}: offline, Home, a deep link and every sidebar page start`,
    loaded.every((line) => line.endsWith(': ok')),
    loaded.filter((line) => !line.endsWith(': ok')).join(', '),
  );
  await page.goto(`${baseUrl}lists/${WORK}`);
  const cards = await page
    .locator('ss-item-card')
    .nth(1)
    .waitFor({ timeout: 10000 })
    .then(
      () => true,
      () => false,
    );
  const banner = await page
    .locator('ss-catalog-status')
    .innerText()
    .catch(() => '');
  check(
    `${label}: offline, Work Related lists its two items, priced from the cached catalog, and says it's offline`,
    cards && /Offline/.test(banner),
    banner.trim(),
  );
  await axeCheck(page, `${label}: offline, List view`);
  await page.screenshot({ path: path.join(outDir, `m10-offline-${label}.png`) });
  await noSideScroll(page, viewport, `${label}: offline, List view`);
  // The rates from IndexedDB: with none, the price tag would show Mullvad's euros, without the ≈.
  await page.goto(`${baseUrl}lists/${FAMILY}`);
  const mullvad = page.locator('ss-item-card').first();
  const price = (
    await mullvad
      .locator('.price ss-price')
      .first()
      .innerText({ timeout: 10000 })
      .catch(() => '')
  ).replace(/\s+/g, ' ');
  check(
    `${label}: offline, Family's Mullvad VPN is converted from euros with the saved rates`,
    /^≈/.test(price.trim()) && /\$\d+\.\d\d/.test(price) && !price.includes('€'),
    price.trim(),
  );
  // What the page asked for offline fails while still counted as offline: Mullvad's icon, never shown online, is one
  // (the worker answers it with a 504).
  await sleep(1000);
  await context.setOffline(false);
  network.offline = false;

  const kept = await cachedApiOrData(page);
  check(
    `${label}: none of the worker's caches holds an /api/ or /data/ answer`,
    kept.length === 0,
    kept.join(', '),
  );
}

/** The worker's caches of a version's app files, one per version it holds. */
function appCaches(page) {
  return page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.endsWith(':assets:app:cache')),
  );
}

const versionPattern = /^Version [0-9a-f]{7}, built [A-Z][a-z]{2} \d{1,2}, \d{4}$/;

/** M10.6: the title bar's colour, the version and its check, then two more builds: one prompted, one a page load runs. */
async function updates(page, viewport, label, colorScheme) {
  const colour = colorScheme === 'dark' ? '#000000' : '#ffffff';
  const metas = await until('the theme-color metas', async () => {
    const contents = await page.evaluate(() =>
      [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => meta.content),
    );
    return contents.length === 2 && contents.every((content) => content === colour) && contents;
  }).catch(() => []);
  check(
    `${label}: both theme-color metas take the theme's top bar colour`,
    metas.length === 2,
    metas.join(', '),
  );

  await page.goto(`${baseUrl}settings`);
  const card = page.locator('section[aria-labelledby="version-heading"]');
  const button = card.getByRole('button', { name: 'Check for updates' });
  const line = card.locator('.check-row p');
  const status = card.locator('[role="status"]');
  /** What a Check for updates by Enter says, once it has an answer. */
  const checked = async () => {
    await button.focus();
    await page.keyboard.press('Enter');
    return until(
      'the check',
      async () => {
        const text = (await status.innerText()).trim();
        return text !== '' && text !== 'Checking for updates…' && text;
      },
      45000,
    ).catch(() => '');
  };
  await button.waitFor({ timeout: 20000 });
  const first = (await line.innerText()).trim();
  check(`${label}: Settings gives the build's version`, versionPattern.test(first), first);
  const latest = await checked();
  check(
    `${label}: Check for updates by Enter: "You have the latest version."`,
    latest === 'You have the latest version.',
    latest,
  );
  await page.locator('section[aria-labelledby="app-heading"]').screenshot({
    path: path.join(outDir, `m10-app-group-${label}.png`),
  });

  // A second build served: this open tab's Check for updates finds it, and offers to reload into it.
  serve(secondBuild);
  const ready = await checked();
  const snackBar = page.locator('.mat-mdc-snack-bar-container');
  const prompt = await snackBar
    .waitFor({ timeout: 20000 })
    .then(async () => (await snackBar.innerText()).replace(/\s+/g, ' ').trim())
    .catch(() => '');
  check(
    `${label}: an open tab's Check for updates finds the new version, and "A new version of Simply Sub is ready." [Reload] shows`,
    ready === 'A new version is ready: reload to use it.' &&
      prompt === 'A new version of Simply Sub is ready. Reload',
    `${ready} / ${prompt}`,
  );
  await axeCheck(page, `${label}: Settings with the update prompt`);
  await page.screenshot({ path: path.join(outDir, `m10-update-prompt-${label}.png`) });
  await noSideScroll(page, viewport, `${label}: the update prompt`);
  // By keyboard: the snackbar comes after the page's content, so Tab from Check for updates reaches Reload.
  const stops = [];
  for (let i = 0; i < 4 && stops.at(-1) !== 'Reload'; i++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => document.activeElement?.textContent?.trim()));
  }
  check(
    `${label}: Tab from Check for updates reaches Reload`,
    stops.at(-1) === 'Reload',
    stops.join(' → '),
  );
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await button.waitFor({ timeout: 20000 });
  const second = (await line.innerText()).trim();
  check(
    `${label}: Enter on Reload runs the new version`,
    versionPattern.test(second) && second !== first,
    `${first} → ${second}`,
  );

  // A third build served: a page load fetches its index.html (freshness), so it runs at once; the worker, learning of
  // it a few seconds later, moves the page onto it with no prompt.
  const before = await appCaches(page);
  serve(thirdBuild);
  await page.reload();
  await button.waitFor({ timeout: 20000 });
  const third = (await line.innerText()).trim();
  await until(
    'the worker to download the third build',
    async () => (await appCaches(page)).some((name) => !before.includes(name)),
    60000,
  ).catch(() => undefined);
  await sleep(3000);
  check(
    `${label}: a page load runs the third build at once, and no prompt follows`,
    versionPattern.test(third) &&
      third !== second &&
      (await page.locator('.mat-mdc-snack-bar-container').count()) === 0,
    `${second} → ${third}`,
  );
  serve(firstBuild);
}

/** M10.6's install, in a profile of its own: Edge offers no install to a private window, which a new context is. */
async function install(label) {
  const profile = fs.mkdtempSync(path.join(outDir, 'edge-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    locale: 'en-CA',
    viewport: WIDE,
  });
  try {
    const page = await prepare(context, label);
    await firstRun(page);
    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    check(
      `${label}: the manifest loads with no error`,
      manifest.url === `${baseUrl}manifest.webmanifest` && manifest.errors.length === 0,
      JSON.stringify(manifest.errors),
    );
    await page.goto(`${baseUrl}settings`);
    const offer = page.getByRole('button', { name: 'Install Simply Sub' });
    const offered = await offer.waitFor({ timeout: 20000 }).then(
      () => true,
      () => false,
    );
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    check(
      `${label}: Edge offers to install the app, as Settings' Install`,
      offered && installabilityErrors.length === 0,
      JSON.stringify(installabilityErrors),
    );
    await axeCheck(page, `${label}: Settings' App group with Install`);
    await page.locator('section[aria-labelledby="app-heading"]').screenshot({
      path: path.join(outDir, `m10-install-${label}.png`),
    });
    // Enter shows Edge's own dialog, which the script can't answer; the offer is used, so the steps take its place.
    await offer.focus();
    await page.keyboard.press('Enter');
    const steps = await page
      .locator('.install-steps')
      .waitFor({ timeout: 10000 })
      .then(
        () => true,
        () => false,
      );
    check(`${label}: Enter on Install uses the offer, once: the steps take its place`, steps);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const colorScheme of ['light', 'dark']) {
    for (const [viewport, width] of [
      [WIDE, 'wide'],
      [NARROW, 'narrow'],
    ]) {
      const label = `${colorScheme} ${width}`;
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plant(page);
      await page.reload();
      await offlineStart(page, context, viewport, label);
      await updates(page, viewport, label, colorScheme);
      await context.close();
    }
  }
  await browser.close();
  await install('light wide, a profile of its own');

  // Offline, the catalog's check and the rates' fetch fail and say so: expected, not a problem.
  const problems = consoleProblems.filter(
    (line) => !/catalog couldn't be checked|exchange rates couldn't be fetched/.test(line),
  );
  check(
    'no console errors or warnings (CSP and Trusted Types among them)',
    problems.length === 0,
    problems.join(' | '),
  );
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  // Each run of updates() ends on the first build; one cut short may not have.
  serve(firstBuild);
  process.exit(1);
});
