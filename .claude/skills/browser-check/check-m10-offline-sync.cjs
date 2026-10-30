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
//   serves a build by putting its new and changed files over apps/api/public/'s and waiting until wrangler dev serves
//   them, then puts the first build (apps/web/dist's) back after each run.
// - M10.9, sync between two browsers, A and B (light at 1280 px and dark at 360, then the other way round), by
//   keyboard: A turns sync on (the new code's 24 words, axe), B joins with four letters of each word and
//   Tab, sees what the copy holds (axe) and merges; then A's lists and B's are in both, an edit in A reaches B within
//   15 s with B doing nothing, a deletion in B reaches A, changes made offline on both to different lists all survive,
//   the theme stays each browser's, and A's Start over and then its Delete the synced copy each leave B saying the copy
//   was deleted, B joining the new chain in between and turning sync off at the end.
// With axe offline, with the prompt shown and with each sync dialog open, and no horizontal scroll.
// Usage: node check-m10-offline-sync.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
//   <second build's browser dir> <third build's browser dir> [parts: offline,updates,install,sync, all by default]
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl, secondBuild, thirdBuild, partsArgument] = process.argv.slice(2);
const parts = new Set((partsArgument ?? 'offline,updates,install,sync').split(','));
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

/**
 * Puts a build in apps/api/public over the last one, whose files stay: deleting them first would leave a moment when a
 * request finds no file and gets the SPA's index.html, and the build names its files after their content, so a file
 * left over from another build changes nothing. Only new and changed files are written, each copied beside the folder
 * and then moved in whole: on Windows, wrangler dev's watcher fails on a file still being written (EBUSY, the 940 kB
 * exceljs chunk rewritten as it was) and stops for good, after which every new file gets index.html.
 */
function put(build) {
  const staging = fs.mkdtempSync(path.join(publicDir, '..', '.serve-'));
  try {
    for (const entry of fs.readdirSync(build, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const from = path.join(entry.parentPath, entry.name);
      const to = path.join(publicDir, path.relative(build, from));
      if (fs.existsSync(to) && fs.readFileSync(to).equals(fs.readFileSync(from))) continue;
      const staged = path.join(staging, entry.name);
      fs.copyFileSync(from, staged);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(staged, to);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Serves a build under wrangler dev: put, then wait until its ngsw.json and every file it lists come back as built. */
async function serve(build) {
  put(build);
  // wrangler dev serves a new file about half a second after it appears, and index.html until then.
  const manifest = fs.readFileSync(path.join(build, 'ngsw.json'), 'utf8');
  const served = async (file) =>
    Buffer.from(await (await fetch(new URL(file, baseUrl), { cache: 'no-store' })).arrayBuffer());
  await until(
    `wrangler dev to serve ${build} (if its log says its assets watcher was disabled, restart it)`,
    async () => {
      try {
        if ((await served('ngsw.json')).toString('utf8') !== manifest) return false;
        for (const [file, hash] of Object.entries(JSON.parse(manifest).hashTable)) {
          const body = await served(file.slice(1));
          if (crypto.createHash('sha1').update(body).digest('hex') !== hash) return false;
        }
        return true;
      } catch {
        // wrangler dev reloading
        return false;
      }
    },
    60000,
  );
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
    // A deleted chain answers 404, and a write after another device's 412: sync says so in the page.
    const syncAnswer =
      /^Failed to load resource/.test(msg.text()) && msg.location().url.includes('/api/v1/sync/');
    if ((msg.type() === 'error' || msg.type() === 'warning') && !failedOffline && !syncAnswer) {
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
  await serve(secondBuild);
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
  await serve(thirdBuild);
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
  await serve(firstBuild);
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

// M10.9: sync between two browsers.

/** A list B has before it joins. */
const PHONE = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c50';

/** Reads a table's records straight from IndexedDB. */
function readRecords(page, table) {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const all = request.result.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => {
            request.result.close();
            resolve(all.result);
          };
        };
      }),
    table,
  );
}

/** Changes a list straight in IndexedDB, as an edit made then, and reloads so the app's live queries see it. */
async function changeList(page, id, change) {
  const list = (await readRecords(page, 'lists')).find((record) => record.id === id);
  const at = new Date().toISOString();
  await putRecord(page, 'lists', {
    ...list,
    ...change,
    updatedAt: at,
    ...(change.deletedAt && { deletedAt: at }),
  });
  await page.reload();
}

/** The lists the Lists page shows, by name, sorted. */
async function listNames(page) {
  await page.goto(`${baseUrl}lists`);
  await page.locator('main h1').waitFor();
  await sleep(500);
  return (await page.locator('h2.name a').allTextContents()).map((name) => name.trim()).sort();
}

const syncCard = (page) => page.locator('section[aria-labelledby="sync-heading"]');
const syncStatus = async (page) =>
  (
    (await syncCard(page)
      .locator('.status')
      .textContent({ timeout: 2000 })
      .catch(() => '')) ?? ''
  ).trim();

async function openSync(page) {
  if (!page.url().endsWith('/settings')) await page.goto(`${baseUrl}settings`);
  await syncCard(page).waitFor({ timeout: 20000 });
}

/** A button pressed by keyboard: focused, then Enter. */
async function press(page, scope, name) {
  const button = scope.getByRole('button', { name, exact: true });
  await button.waitFor({ timeout: 20000 });
  await button.focus();
  await page.keyboard.press('Enter');
}

/** The dialog on top: the confirmation's, or sync's own. */
const topDialog = (page) => page.locator('mat-dialog-container').last();

/** Sync now, by keyboard, until this sync is done: the record's syncedAt moves on (a status could be the last one's). */
async function syncNow(page, label) {
  await openSync(page);
  const syncedAt = async () => (await readRecords(page, 'sync'))[0]?.syncedAt;
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await syncedAt();
    await until(
      'Sync now to be there',
      () => syncCard(page).getByRole('button', { name: 'Sync now' }).isEnabled(),
      20000,
    );
    await press(page, syncCard(page), 'Sync now');
    const synced = await until(
      `${label} to sync`,
      async () => (await syncedAt()) !== before,
      15000,
    ).catch(() => false);
    if (synced) return;
    // Busy (the API's writes a minute): it tries again.
    await sleep(5000);
  }
  throw new Error(`${label} didn't sync: ${await syncStatus(page)}`);
}

/** Types the code's words into the join dialog: four letters of each, then Tab, which completes it. */
async function typeCode(page, dialog, words) {
  // The dialog puts focus on Scan the QR code itself, once it has opened (M10.14): the first box is a Tab on.
  await until('focus on Scan the QR code', () =>
    page.evaluate(() => document.activeElement?.matches('button.scan') === true),
  );
  await page.keyboard.press('Tab');
  await until('focus in the first box', () =>
    page.evaluate(() => document.activeElement?.matches('.words input') === true),
  );
  await sleep(300);
  for (const word of words) {
    await page.keyboard.type(word.slice(0, 4));
    await page.keyboard.press('Tab');
  }
  return dialog.locator('.words input').evaluateAll((inputs) => inputs.map((input) => input.value));
}

/** Joins with the code's words, by keyboard, merging: what the copy said it holds. */
async function joinWith(page, label, words, viewport, shots) {
  await openSync(page);
  await press(page, syncCard(page), 'Join with a code');
  const dialog = topDialog(page);
  await dialog.locator('.words input').first().waitFor({ timeout: 20000 });
  if (shots) {
    await axeCheck(page, `${label}: Join with a code`);
    await noSideScroll(page, viewport, `${label}: Join with a code`);
  }
  const typed = await typeCode(page, dialog, words);
  check(
    `${label}: four letters and Tab complete each of the 24 words`,
    typed.join(' ') === words.join(' '),
    typed.join(' '),
  );
  await press(page, dialog, 'Continue');
  await dialog.getByRole('heading', { name: 'Join this synced copy' }).waitFor({ timeout: 20000 });
  const holds = ((await dialog.locator('mat-dialog-content p').first().textContent()) ?? '').trim();
  if (shots) {
    await axeCheck(page, `${label}: the synced copy to join`);
    await page.screenshot({ path: path.join(outDir, `m10-sync-join-${label}.png`) });
    await noSideScroll(page, viewport, `${label}: the synced copy to join`);
  }
  await press(page, dialog, 'Join');
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  await until(
    `${label} to sync`,
    async () => (await syncStatus(page)) === 'Synced just now',
    20000,
  );
  return holds;
}

/** Turns sync on, or starts over, by keyboard: the new code's words, once kept. */
async function keepNewCode(page, label, viewport, shots) {
  const dialog = topDialog(page);
  // A new code is one to keep: its QR code comes with Show the code, once sync is on (M10.14).
  await dialog.locator('.words li').nth(23).waitFor({ timeout: 20000 });
  const words = (await dialog.locator('.words li').allTextContents()).map((word) => word.trim());
  if (shots) {
    await axeCheck(page, `${label}: the new code`);
    await page.screenshot({ path: path.join(outDir, `m10-sync-code-${label}.png`) });
    await noSideScroll(page, viewport, `${label}: the new code`);
  }
  await press(page, dialog, 'I’ve saved it');
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  await until(
    `${label} to sync`,
    async () => (await syncStatus(page)) === 'Synced just now',
    20000,
  );
  return words;
}

async function syncBetween(browser, a, b) {
  const labelA = `A ${a.colorScheme} ${a.viewport === WIDE ? 'wide' : 'narrow'}`;
  const labelB = `B ${b.colorScheme} ${b.viewport === WIDE ? 'wide' : 'narrow'}`;
  const A = await newPage(browser, labelA, a);
  const B = await newPage(browser, labelB, b);
  await firstRun(A.page);
  await plant(A.page);
  await A.page.reload();
  await firstRun(B.page);
  await putRecord(B.page, 'lists', { id: PHONE, name: 'Phone list', ...stamps });
  await B.page.reload();

  // A turns sync on.
  await openSync(A.page);
  await press(A.page, syncCard(A.page), 'Turn on sync');
  const words = await keepNewCode(A.page, labelA, a.viewport, true);
  check(
    `${labelA}: Turn on shows a new code of 24 words, then starts the chain: "Synced just now"`,
    words.length === 24,
    words.length,
  );

  // B joins, merging.
  const holds = await joinWith(B.page, labelB, words, b.viewport, true);
  check(
    `${labelB}: Join says what the synced copy holds`,
    holds === 'It holds 2 lists, 3 subscriptions.',
    holds,
  );
  const both = 'Family,Phone list,Work Related';
  check(
    `${labelB}: after Merge it has the copy's lists and its own`,
    (await listNames(B.page)).join() === both,
    (await listNames(B.page)).join(),
  );
  await syncNow(A.page, labelA);
  check(
    `${labelA}: Sync now brings B's list`,
    (await listNames(A.page)).join() === both,
    (await listNames(A.page)).join(),
  );
  // The devices are the chain's, known again once the page's first sync is done.
  await openSync(A.page);
  const devices = async () =>
    ((await syncCard(A.page).locator('.devices').textContent()) ?? '').replace(/\s+/g, ' ');
  await until('B among the devices', async () => /synced/.test(await devices()), 15000).catch(
    () => false,
  );
  check(
    `${labelA}: the devices: this one, and B`,
    /\(this device\)/.test(await devices()) && /synced/.test(await devices()),
    (await devices()).trim(),
  );
  await A.page.screenshot({ path: path.join(outDir, `m10-sync-on-${labelA}.png`) });
  await axeCheck(A.page, `${labelA}: Sync between devices, on`);

  // An edit in A reaches B within 15 s, B doing nothing on its Lists page, opened before.
  await B.page.goto(`${baseUrl}lists`);
  await B.page.locator('h2.name a').first().waitFor({ timeout: 20000 });
  await sleep(2000);
  await changeList(A.page, FAMILY, { name: 'Family 2' });
  await syncNow(A.page, labelA);
  const sent = Date.now();
  const arrived = await until(
    'the edit on B',
    async () =>
      (await B.page.locator('h2.name a').allTextContents()).some(
        (name) => name.trim() === 'Family 2',
      ),
    25000,
  ).then(
    () => Date.now() - sent,
    () => undefined,
  );
  check(
    `${labelB}: an edit made in A shows within 15 s, B doing nothing`,
    arrived !== undefined && arrived <= 15000,
    `${arrived} ms`,
  );

  // A deletion in B reaches A.
  await changeList(B.page, WORK, { deletedAt: true });
  await syncNow(B.page, labelB);
  await syncNow(A.page, labelA);
  check(
    `${labelA}: a list deleted in B is gone after Sync now`,
    (await listNames(A.page)).join() === 'Family 2,Phone list',
    (await listNames(A.page)).join(),
  );

  // Offline on both, changes to different lists: all survive.
  await A.context.setOffline(true);
  await B.context.setOffline(true);
  network.offline = true;
  await changeList(A.page, PHONE, { name: 'Phone list (A)' });
  await putRecord(B.page, 'lists', {
    id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c51',
    name: 'Offline (B)',
    ...stamps,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await B.page.reload();
  await sleep(1000);
  await A.context.setOffline(false);
  await B.context.setOffline(false);
  network.offline = false;
  await syncNow(A.page, labelA);
  await syncNow(B.page, labelB);
  await syncNow(A.page, labelA);
  const all = 'Family 2,Offline (B),Phone list (A)';
  const [listsA, listsB] = [(await listNames(A.page)).join(), (await listNames(B.page)).join()];
  check(
    `${labelA} and ${labelB}: changes made offline on both, to different lists, all survive`,
    listsA === all && listsB === all,
    `${listsA} / ${listsB}`,
  );

  // The theme stays each browser's.
  await A.page.goto(`${baseUrl}settings`);
  const dark = A.page.getByRole('radio', { name: a.colorScheme === 'dark' ? 'Light' : 'Dark' });
  await dark.focus();
  await A.page.keyboard.press('Space');
  await sleep(500);
  await syncNow(A.page, labelA);
  await syncNow(B.page, labelB);
  const themeB = (await readRecords(B.page, 'settings'))[0]?.theme;
  check(`${labelB}: the theme A chose stays A's`, themeB === 'system', themeB);

  // Start over in A: B learns its copy was deleted.
  await openSync(A.page);
  await press(A.page, syncCard(A.page), 'Start over with a new code…');
  await press(A.page, topDialog(A.page), 'Start over');
  const fresh = await keepNewCode(A.page, labelA, a.viewport, false);
  await openSync(B.page);
  const gone = await until(
    'B to see its chain gone',
    async () => (await syncStatus(B.page)).startsWith('The synced copy was deleted'),
    25000,
  ).catch(() => false);
  check(
    `${labelB}: after A's Start over, B says the synced copy was deleted`,
    gone !== false,
    await syncStatus(B.page),
  );
  await axeCheck(B.page, `${labelB}: sync stopped`);

  // B joins the new chain; then A deletes the synced copy, and B says so again.
  await joinWith(B.page, labelB, fresh, b.viewport, false);
  await openSync(A.page);
  await press(A.page, syncCard(A.page), 'Delete the synced copy…');
  await press(A.page, topDialog(A.page), 'Delete the synced copy');
  await syncCard(A.page).getByRole('button', { name: 'Turn on sync' }).waitFor({ timeout: 20000 });
  const goneAgain = await until(
    'B to see the copy deleted',
    async () => (await syncStatus(B.page)).startsWith('The synced copy was deleted'),
    25000,
  ).catch(() => false);
  check(
    `${labelB}: after A deletes the synced copy, B says so`,
    goneAgain !== false,
    await syncStatus(B.page),
  );
  await press(B.page, syncCard(B.page), 'Turn off sync here…');
  await press(B.page, topDialog(B.page), 'Turn off');
  await syncCard(B.page).getByRole('button', { name: 'Turn on sync' }).waitFor({ timeout: 20000 });
  check(
    `${labelB}: Turn off ends sync here, its data staying`,
    (await listNames(B.page)).join() === all,
    (await listNames(B.page)).join(),
  );
  await A.context.close();
  await B.context.close();
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const colorScheme of ['light', 'dark']) {
    for (const [viewport, width] of [
      [WIDE, 'wide'],
      [NARROW, 'narrow'],
    ]) {
      if (!parts.has('offline') && !parts.has('updates')) continue;
      const label = `${colorScheme} ${width}`;
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plant(page);
      await page.reload();
      if (parts.has('offline')) await offlineStart(page, context, viewport, label);
      if (parts.has('updates')) await updates(page, viewport, label, colorScheme);
      await context.close();
    }
  }
  if (parts.has('sync')) {
    await syncBetween(
      browser,
      { colorScheme: 'light', viewport: WIDE },
      { colorScheme: 'dark', viewport: NARROW },
    );
    await syncBetween(
      browser,
      { colorScheme: 'dark', viewport: NARROW },
      { colorScheme: 'light', viewport: WIDE },
    );
  }
  await browser.close();
  if (parts.has('install')) await install('light wide, a profile of its own');

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
  // What the pages logged before it stopped, which may say why.
  for (const line of consoleProblems) console.error(`console: ${line}`);
  // Each run of updates() ends on the first build; one cut short may not have.
  put(firstBuild);
  process.exit(1);
});
