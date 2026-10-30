// Sync's one-time join link and joining on the first visit (M10.14, M10.15: the feedback after M10, part 2) in the
// system Edge, with wrangler dev answering the API: behind `ng serve`'s proxy, or the production build itself (base URL
// http://localhost:8787/), where the CSP and Trusted Types apply. Its user database migrated (`npm -w apps/api run
// db:user:migrate:local`, for join_links). For a Canadian in Alberta with Work Related (Netflix Standard, Crave Premium)
// and Family (Mullvad VPN), in both themes at 1280 and 360 px, by keyboard:
// - A turns sync on: the new code's 24 words, with no QR code (a link that works for 10 minutes is no code to keep);
// - A's Show the code: a QR code that decodes (as drawn) to a join link on this site, /join#<id>.<key>, "It works once,
//   for 10 minutes"; the POST that made it sent 61 bytes, and no request ever carries the key; axe, a screenshot;
// - B, a new device, opens the link: the address loses it at once (Settings, no #), the first run's dialog with Join
//   over it, the link taken by one DELETE, "Join this synced copy" with focus on it and no Merge or Replace, then Join
//   by Enter: B's settings are A's place (Alberta, CAD) with B's own theme, its lists A's, and the first run is over;
// - C, another new device, opens the same link: "This link was used or has expired.";
// - A's Make a new QR code withdraws the first link, Done the second, and the user database keeps none;
// - D, a new device whose camera shows A's next QR code (a Y4M file Edge plays as its camera): the first run's Join
//   with a sync code reached by Tab, Scan the QR code by Enter (focus on Stop scanning), the code read from the camera,
//   then Join: D has A's lists;
// - light and wide only: a link opened where the app lock is on leaves the address bar at once, waits for the unlock,
//   then Join takes it in Settings, with Merge and Replace; a link past its 10 minutes (moved on in the local
//   database) says it has expired; Show the code offline says why there's no QR code.
// With axe on each dialog and the scanner, screenshots, and no horizontal scroll.
// Usage: node check-m10-join-link.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
//   [one run only: light-wide, light-narrow, dark-wide or dark-narrow]
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const [depsDir, outDir, baseUrl, only] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axeSource = fs.readFileSync(
  path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js'),
  'utf8',
);
fs.mkdirSync(outDir, { recursive: true });

const WIDE = { width: 1280, height: 900 };
const NARROW = { width: 360, height: 740 };
const repo = path.resolve(__dirname, '..', '..', '..');
const origin = new URL(baseUrl).origin;

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
      if ((await fetch(baseUrl)).ok && (await fetch(`${baseUrl}api/v1/health`)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`No app and API at ${baseUrl}`);
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

/** Every request the pages sent, with its body: none may carry a link's key. */
const sent = [];
const network = { offline: false };

async function newPage(
  browser,
  label,
  { colorScheme = 'light', viewport = WIDE, camera = false } = {},
) {
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
    ...(camera && { permissions: ['camera'] }),
  });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('request', (request) =>
    sent.push({
      label,
      at: Date.now(),
      method: request.method(),
      // A page load never sends its fragment.
      url: request.resourceType() === 'document' ? request.url().split('#')[0] : request.url(),
      type: request.headers()['content-type'],
      body: request.postDataBuffer() ?? Buffer.alloc(0),
    }),
  );
  page.on('console', (msg) => {
    const text = msg.text();
    const failedOffline = network.offline && /^Failed to load resource/.test(text);
    // A link used or past its time answers 404, and so does a chain just turned on, read before its first write:
    // the page says so in words, or goes on to write it.
    const linkGone =
      /^Failed to load resource/.test(text) && /\/api\/v1\/(join|sync)\b/.test(msg.location().url);
    const blockedWorker = /Service Worker registration blocked by Playwright/.test(text);
    if (
      (msg.type() === 'error' || msg.type() === 'warning') &&
      !failedOffline &&
      !linkGone &&
      !blockedWorker
    ) {
      consoleProblems.push(
        `[${label}] ${msg.type()}: ${text} (${msg.location().url || 'no location'})`,
      );
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

/** Completes the first-run dialog for Alberta, on the page open now. */
async function getStarted(page) {
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

async function axeCheck(page, label) {
  await sleep(600);
  try {
    await page.addScriptTag({ path: path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js') });
  } catch {
    // The production build's Trusted Types refuse a script tag.
    await page.evaluate(axeSource);
  }
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

/** A's lists: Work Related (Netflix Standard, Crave Premium) and Family (Mullvad VPN). */
async function plant(page) {
  await putRecord(page, 'lists', { id: WORK, name: 'Work Related', ...stamps });
  await putRecord(page, 'lists', { id: FAMILY, name: 'Family', ...stamps });
  const items = [
    [WORK, 'netflix.standard', monthly('2026-11-12')],
    [WORK, 'crave.premium', monthly('2026-01-31')],
    [FAMILY, 'mullvad.vpn', { ...monthly('2027-01-20'), interval: 'year' }],
  ];
  for (const [index, [listId, planId, billing]] of items.entries()) {
    await putRecord(page, 'items', {
      id: `0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3d0${index}`,
      listId,
      source: { kind: 'catalog', planId },
      billing,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
    });
  }
  await page.reload();
}

/** The lists the Lists page shows, by name, sorted. */
async function listNames(page) {
  await page.goto(`${baseUrl}lists`);
  await page.locator('main h1').waitFor();
  await sleep(800);
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
const topDialog = (page) => page.locator('mat-dialog-container').last();

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

/** The focused element's role and name, from the accessibility tree. */
async function focused(page) {
  return (
    (await page
      .locator(':focus')
      .ariaSnapshot()
      .catch(() => '')) ?? ''
  ).split('\n')[0];
}

/** Tab until `name` has focus, at most `limit` times: whether it got there. */
async function tabTo(page, name, limit = 30) {
  for (let step = 0; step < limit; step++) {
    if ((await focused(page)).includes(name)) return true;
    await page.keyboard.press('Tab');
    await sleep(80);
  }
  return (await focused(page)).includes(name);
}

/** The QR code a dialog draws, read back as the camera would: its modules from the SVG, then the decoder. */
async function drawnModules(dialog) {
  const svg = dialog.locator('ss-qr-code svg');
  await svg.locator('path').waitFor({ timeout: 20000 });
  const size = Number((await svg.getAttribute('viewBox')).split(' ')[2]);
  const d = await svg.locator('path').getAttribute('d');
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
    for (let at = 0; at < Number(run); at++) modules[Number(y)][Number(x) + at] = true;
  }
  return modules;
}

let decoder;
async function decode(modules) {
  decoder ??= await import(
    pathToFileURL(path.join(repo, 'node_modules', '@paulmillr', 'qr', 'esm', 'decode.js')).href
  );
  const scale = 6;
  const size = modules.length * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++)
          data.fill(
            0,
            ((y * scale + dy) * size + x * scale + dx) * 4,
            ((y * scale + dy) * size + x * scale + dx) * 4 + 3,
          );
      }
    }),
  );
  return decoder.decodeQR({ width: size, height: size, data });
}

/** A Y4M video of the QR code, which Edge plays as its camera: 640 by 480, the code in the middle, 8 px a module. */
function cameraFile(modules, file) {
  const width = 640;
  const height = 480;
  const scale = 8;
  const left = Math.floor((width - modules.length * scale) / 2);
  const top = Math.floor((height - modules.length * scale) / 2);
  const luma = Buffer.alloc(width * height, 235);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        luma.fill(
          16,
          (top + y * scale + dy) * width + left + x * scale,
          (top + y * scale + dy) * width + left + (x + 1) * scale,
        );
      }
    }),
  );
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma, chroma]);
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420jpeg\n`),
      ...Array(15).fill(frame),
    ]),
  );
}

/** Runs SQL on the local user database, which wrangler dev uses: wrangler's own entry, with no shell in between. */
function userDb(sql) {
  const out = execFileSync(
    process.execPath,
    [
      path.join(repo, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'd1',
      'execute',
      'simply-sub-user',
      '--local',
      '--json',
      '--command',
      sql,
    ],
    { cwd: path.join(repo, 'apps', 'api'), encoding: 'utf8' },
  );
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

/**
 * Waits for the next minute when `writes` more would take this one past the API's 10 writes a minute per IP, which
 * wrangler dev holds every browser here to, counting in the wall clock's minutes.
 */
async function room(writes) {
  const minute = Math.floor(Date.now() / 60000);
  const made = sent.filter(
    (request) =>
      Math.floor(request.at / 60000) === minute &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      request.url.includes('/api/'),
  ).length;
  if (made + writes > 7) await nextMinute();
}

/** Turns sync on in A by keyboard: the new code's words, kept. */
async function turnOn(A, label, viewport) {
  await room(2);
  await openSync(A);
  await press(A, syncCard(A), 'Turn on sync');
  const dialog = topDialog(A);
  await dialog.locator('.words li').nth(23).waitFor({ timeout: 20000 });
  const text = ((await dialog.textContent()) ?? '').replace(/\s+/g, ' ');
  check(
    `${label}: Turn on shows the new code's 24 words and no QR code, saying Show the code gives one`,
    (await dialog.locator('ss-qr-code').count()) === 0 &&
      text.includes(
        'Once sync is on, Show the code gives a QR code that adds a device in one scan.',
      ),
  );
  await axeCheck(A, `${label}: the new code`);
  await noSideScroll(A, viewport, `${label}: the new code`);
  await press(A, dialog, 'I’ve saved it');
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  await until(`${label} to sync`, async () => (await syncStatus(A)) === 'Synced just now', 20000);
}

/** A's Show the code by keyboard, through its question: the dialog, once its QR code is drawn, and the link in it. */
async function showCode(A, label) {
  await room(2);
  await openSync(A);
  await press(A, syncCard(A), 'Show the code…');
  await press(A, topDialog(A), 'Show the code');
  const dialog = topDialog(A);
  await dialog.getByRole('heading', { name: 'Your sync code' }).waitFor({ timeout: 20000 });
  const modules = await qrOf(dialog);
  return { dialog, modules, link: await decode(modules) };
}

/** The next minute of the wall clock, when wrangler dev's limits count afresh. */
function nextMinute() {
  return sleep(60000 - (Date.now() % 60000) + 1000);
}

/**
 * The QR code a dialog draws once it's made. Refused for the minute's writes (429, which the dialog says "couldn't be
 * made just now"), it's made again in the next minute with Make a new QR code.
 */
async function qrOf(dialog) {
  const page = dialog.page();
  for (let attempt = 0; attempt < 3; attempt++) {
    const outcome = await until(
      'the QR code, or why there is none',
      async () =>
        (await dialog.locator('ss-qr-code path').count()) > 0
          ? 'made'
          : /couldn’t be made/.test((await dialog.locator('.qr-status').textContent()) ?? '')
            ? 'refused'
            : false,
      20000,
    );
    if (outcome === 'made') return drawnModules(dialog);
    await nextMinute();
    await press(page, dialog, 'Make a new QR code');
  }
  throw new Error('No QR code after three tries');
}

const keyOf = (link) => link.split('#')[1]?.split('.')[1] ?? '';
const idOf = (link) => link.split('#')[1]?.split('.')[0] ?? '';

async function run(browser, colorScheme, viewport) {
  const width = viewport === WIDE ? 'wide' : 'narrow';
  const other = {
    colorScheme: colorScheme === 'light' ? 'dark' : 'light',
    viewport: viewport === WIDE ? NARROW : WIDE,
  };
  const label = `${colorScheme} ${width}`;
  const links = [];

  // A: sync on, with two lists.
  const A = await newPage(browser, `A ${label}`, { colorScheme, viewport });
  await A.page.goto(baseUrl);
  await getStarted(A.page);
  await plant(A.page);
  await turnOn(A.page, `A ${label}`, viewport);

  // A shows the code: a QR code of a one-time link.
  const posts = () =>
    sent.filter((request) => request.method === 'POST' && request.url.endsWith('/api/v1/join'));
  const before = posts().length;
  const shown = await showCode(A.page, `A ${label}`);
  links.push(shown.link);
  check(
    `A ${label}: Show the code's QR code reads as a join link on this site, /join#<id>.<key>`,
    new RegExp(
      `^${origin.replace(/[.]/g, '\\.')}/join#[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}$`,
    ).test(shown.link),
    shown.link.replace(keyOf(shown.link), '<key>'),
  );
  const post = posts()[before];
  check(
    `A ${label}: the link was made with one POST of the sealed code, 61 bytes`,
    posts().length === before + 1 &&
      post?.type === 'application/octet-stream' &&
      post.body.length === 61,
    `${posts().length - before} POST, ${post?.body.length} bytes`,
  );
  const dialogText = ((await shown.dialog.textContent()) ?? '').replace(/\s+/g, ' ');
  check(
    `A ${label}: it says the QR code works once, for 10 minutes, and how to add a device`,
    dialogText.includes('It works once, for 10 minutes.') &&
      dialogText.includes('scan the QR code with its camera'),
  );
  await axeCheck(A.page, `A ${label}: Show the code with its QR code`);
  await A.page.screenshot({ path: path.join(outDir, `join-code-${label}.png`) });
  await noSideScroll(A.page, viewport, `A ${label}: Show the code`);
  // The code dialog's own stops, by Tab from its title: Make a new QR code, then Copy the words.
  await A.page.getByRole('heading', { name: 'Your sync code' }).focus();
  check(
    `A ${label}: Make a new QR code is reached by Tab`,
    await tabTo(A.page, 'Make a new QR code', 5),
  );

  // B, a new device, opens the link: it joins in its first run.
  const B = await newPage(browser, `B ${other.colorScheme}`, other);
  await room(3);
  // Only B's requests from here on: the label is the same in every run.
  const sentBeforeB = sent.length;
  await B.page.goto(shown.link);
  await until('B to leave /join', () => B.page.url() === `${baseUrl}settings`, 20000).catch(
    () => false,
  );
  check(
    `B ${other.colorScheme}: the link leaves the address bar at once: Settings, no #`,
    B.page.url() === `${baseUrl}settings` && (await B.page.evaluate(() => location.hash)) === '',
    B.page.url(),
  );
  const joinB = B.page.locator('ss-join-sync-dialog');
  await joinB.getByRole('heading', { name: 'Join this synced copy' }).waitFor({ timeout: 20000 });
  const takes = sent
    .slice(sentBeforeB)
    .filter(
      (request) =>
        request.method === 'DELETE' &&
        request.url.includes('/api/v1/join/') &&
        request.label.startsWith('B'),
    );
  const dialogsB = await B.page.locator('mat-dialog-container').count();
  check(
    `B ${other.colorScheme}: Join over the first run's dialog took the link with one DELETE, not naming its key`,
    dialogsB === 2 &&
      takes.length === 1 &&
      takes[0].url.endsWith(`/api/v1/join/${idOf(shown.link)}`) &&
      !takes[0].url.includes(keyOf(shown.link)),
    `${dialogsB} dialogs, DELETEs: ${takes.map((request) => request.url.replace(origin, '')).join(', ')}`,
  );
  await until(
    'focus on the copy’s title',
    async () => (await focused(B.page)).includes('Join this synced copy'),
    5000,
  ).catch(() => false);
  const holds = ((await joinB.locator('mat-dialog-content p').first().textContent()) ?? '').trim();
  check(
    `B ${other.colorScheme}: focus on "Join this synced copy", what it holds, and no Merge or Replace in a first run`,
    (await focused(B.page)).includes('Join this synced copy') &&
      holds === 'It holds 2 lists, 3 subscriptions.' &&
      (await joinB.getByRole('radio').count()) === 0,
    `${await focused(B.page)} / ${holds}`,
  );
  await axeCheck(B.page, `B ${other.colorScheme}: the copy to join, in the first run`);
  await B.page.screenshot({ path: path.join(outDir, `join-link-first-run-${label}.png`) });
  await noSideScroll(B.page, other.viewport, `B: the copy to join`);
  await press(B.page, joinB, 'Join');
  await B.page
    .locator('mat-dialog-container')
    .first()
    .waitFor({ state: 'detached', timeout: 20000 });
  const settingsB = (await readRecords(B.page, 'settings'))[0];
  check(
    `B ${other.colorScheme}: the first run is over, with A's place and B's own theme`,
    settingsB?.country === 'CA' &&
      settingsB?.subdivision === 'CA-AB' &&
      settingsB?.currency === 'CAD' &&
      settingsB?.theme === 'system',
    JSON.stringify(
      settingsB && {
        country: settingsB.country,
        subdivision: settingsB.subdivision,
        theme: settingsB.theme,
      },
    ),
  );
  await until(
    'B to have A’s lists',
    async () => (await listNames(B.page)).join() === 'Family,Work Related',
    20000,
  ).catch(() => false);
  check(
    `B ${other.colorScheme}: it has A's lists`,
    (await listNames(B.page)).join() === 'Family,Work Related',
    (await listNames(B.page)).join(),
  );

  // C opens the same link: it was used.
  const C = await newPage(browser, `C ${label}`, { colorScheme, viewport });
  await room(1);
  await C.page.goto(shown.link);
  const joinC = C.page.locator('ss-join-sync-dialog');
  await joinC.locator('.error').filter({ hasText: /\S/ }).waitFor({ timeout: 20000 });
  check(
    `C ${label}: the same link again says it was used or has expired`,
    ((await joinC.locator('.error').textContent()) ?? '').includes(
      'This link was used or has expired.',
    ),
    (await joinC.locator('.error').textContent())?.trim(),
  );
  await axeCheck(C.page, `C ${label}: a used link`);
  await C.page.screenshot({ path: path.join(outDir, `join-link-used-${label}.png`) });
  await noSideScroll(C.page, viewport, `C: a used link`);
  await C.context.close();

  // A makes a new QR code, withdrawing the first, and Done withdraws the second.
  const deletes = (id) =>
    sent.filter(
      (request) =>
        request.method === 'DELETE' &&
        request.url.endsWith(`/api/v1/join/${id}`) &&
        request.label.startsWith('A'),
    );
  await room(3);
  await press(A.page, shown.dialog, 'Make a new QR code');
  await until('a second link', async () => {
    const modules = await qrOf(shown.dialog);
    const link = await decode(modules);
    return link !== shown.link ? link : false;
  }).then((link) => links.push(link));
  check(
    `A ${label}: Make a new QR code shows another link and withdraws the first`,
    links.length === 2 && deletes(idOf(links[0])).length === 1,
  );
  await press(A.page, shown.dialog, 'Done');
  await shown.dialog.waitFor({ state: 'detached', timeout: 20000 });
  await until('the second withdrawn', () => deletes(idOf(links[1])).length === 1, 10000).catch(
    () => false,
  );
  check(`A ${label}: Done withdraws the link shown`, deletes(idOf(links[1])).length === 1);
  // This run's links, by the hash the database keeps of each id; the withdrawal may still be on its way.
  const hashes = links
    .map((link) => `'${crypto.createHash('sha256').update(idOf(link)).digest('hex')}'`)
    .join(', ');
  const kept = () =>
    userDb(`SELECT COUNT(*) AS links FROM join_links WHERE id_hash IN (${hashes})`)[0]?.links;
  await until('the links gone from the database', () => kept() === 0, 10000).catch(() => false);
  check(
    `A ${label}: the user database keeps neither link once it's taken or withdrawn`,
    kept() === 0,
    `${kept()}`,
  );

  // D, a new device whose camera shows A's next QR code, joins in its first run by scanning.
  const next = await showCode(A.page, `A ${label}`);
  links.push(next.link);
  const video = path.join(outDir, `camera-${label.replace(' ', '-')}.y4m`);
  cameraFile(next.modules, video);
  const cameraBrowser = await chromium.launch({
    channel: 'msedge',
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  const D = await newPage(cameraBrowser, `D ${label}`, { colorScheme, viewport, camera: true });
  await D.page.goto(baseUrl);
  const firstRun = D.page.locator('ss-first-run-dialog');
  await firstRun
    .getByRole('heading', { name: 'Welcome to Simply Sub' })
    .waitFor({ timeout: 20000 });
  await sleep(500);
  await axeCheck(D.page, `D ${label}: the first run's dialog with Join with a sync code`);
  await D.page.screenshot({ path: path.join(outDir, `join-first-run-${label}.png`) });
  await noSideScroll(D.page, viewport, `D: the first run's dialog`);
  check(
    `D ${label}: Join with a sync code is reached by Tab in the first run`,
    await tabTo(D.page, 'Join with a sync code', 25),
    await focused(D.page),
  );
  await D.page.keyboard.press('Enter');
  const joinD = D.page.locator('ss-join-sync-dialog');
  await joinD.getByRole('heading', { name: 'Join with a sync code' }).waitFor({ timeout: 20000 });
  await until(
    'focus on Scan the QR code',
    async () => (await focused(D.page)).includes('Scan the QR code'),
    5000,
  ).catch(() => false);
  check(
    `D ${label}: Join opens with focus on Scan the QR code`,
    (await focused(D.page)).includes('Scan the QR code'),
    await focused(D.page),
  );
  // The camera can read the code before the check looks: record where focus goes.
  await D.page.evaluate(() => {
    window.focusedTexts = [];
    document.addEventListener('focusin', (event) =>
      window.focusedTexts.push((event.target.textContent ?? '').trim()),
    );
  });
  await D.page.keyboard.press('Enter');
  const focusedTexts = () => D.page.evaluate(() => window.focusedTexts);
  await until(
    'focus on Stop scanning',
    async () => (await focusedTexts()).includes('Stop scanning'),
    5000,
  ).catch(() => false);
  check(
    `D ${label}: the camera takes its place, focus on Stop scanning`,
    (await focusedTexts()).includes('Stop scanning'),
    (await focusedTexts()).join(' > '),
  );
  await room(2);
  const scanned = await joinD
    .getByRole('heading', { name: 'Join this synced copy' })
    .waitFor({ timeout: 20000 })
    .then(
      () => true,
      () => false,
    );
  if (!scanned) {
    // What the scanner said, for the record.
    console.log(
      `  scanner: ${(
        await joinD
          .locator('ss-qr-scanner .status')
          .textContent()
          .catch(() => '')
      )?.trim()}`,
    );
  }
  check(`D ${label}: the camera read A's QR code, and Join took its link`, scanned);
  if (scanned) {
    await axeCheck(D.page, `D ${label}: the copy to join, after a scan`);
    await press(D.page, joinD, 'Join');
    await D.page
      .locator('mat-dialog-container')
      .first()
      .waitFor({ state: 'detached', timeout: 20000 });
    await until(
      'D to have A’s lists',
      async () => (await listNames(D.page)).join() === 'Family,Work Related',
      20000,
    ).catch(() => false);
    check(
      `D ${label}: it has A's lists`,
      (await listNames(D.page)).join() === 'Family,Work Related',
      (await listNames(D.page)).join(),
    );
  }
  await D.context.close();
  await cameraBrowser.close();
  await press(A.page, next.dialog, 'Done');

  // The scanner itself, as it shows: in light and wide, and dark and narrow.
  if ((colorScheme === 'light') === (viewport === WIDE)) {
    const show = await showCode(A.page, `A ${label}`);
    const still = path.join(outDir, `camera-still-${label.replace(' ', '-')}.y4m`);
    // A camera that sees no QR code: the scanner keeps looking, and says what to do.
    cameraFile(
      Array.from({ length: 49 }, () => Array(49).fill(false)),
      still,
    );
    const plainBrowser = await chromium.launch({
      channel: 'msedge',
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${still}`,
      ],
    });
    const E = await newPage(plainBrowser, `E ${label}`, { colorScheme, viewport, camera: true });
    await E.page.goto(baseUrl);
    await getStarted(E.page);
    await openSync(E.page);
    await press(E.page, syncCard(E.page), 'Join with a code');
    const joinE = E.page.locator('ss-join-sync-dialog');
    await press(E.page, joinE, 'Scan the QR code');
    await joinE.locator('ss-qr-scanner .viewfinder.showing').waitFor({ timeout: 20000 });
    check(
      `E ${label}: the scanner shows the camera and says what to do`,
      ((await joinE.locator('ss-qr-scanner .status').textContent()) ?? '').includes(
        'Point the camera at the QR code',
      ),
    );
    await axeCheck(E.page, `E ${label}: the scanner, showing the camera`);
    await E.page.screenshot({ path: path.join(outDir, `join-scanner-${label}.png`) });
    await noSideScroll(E.page, viewport, `E: the scanner`);
    await E.page.keyboard.press('Enter');
    await until(
      'focus back on Scan the QR code',
      async () => (await focused(E.page)).includes('Scan the QR code'),
      5000,
    ).catch(() => false);
    check(
      `E ${label}: Stop scanning puts focus back on Scan the QR code`,
      (await focused(E.page)).includes('Scan the QR code'),
      await focused(E.page),
    );
    await E.context.close();
    await plainBrowser.close();
    await press(A.page, show.dialog, 'Done');
  }

  // Light and wide only: a locked device, a link past its time, and Show the code offline.
  if (colorScheme === 'light' && viewport === WIDE) {
    const L = await newPage(browser, 'L light wide', { colorScheme, viewport });
    await L.page.goto(baseUrl);
    await getStarted(L.page);
    await L.page.goto(`${baseUrl}settings`);
    await L.page.getByRole('checkbox', { name: 'Lock with a passphrase' }).focus();
    await L.page.keyboard.press('Space');
    const lockDialog = topDialog(L.page);
    await lockDialog
      .getByRole('heading', { name: 'Lock with a passphrase' })
      .waitFor({ timeout: 20000 });
    await lockDialog.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
    await lockDialog.getByLabel('Type it again', { exact: true }).fill('correct horse battery');
    await press(L.page, lockDialog, 'Turn on the lock');
    await lockDialog.waitFor({ state: 'detached', timeout: 30000 });
    const locked = await showCode(A.page, 'A light wide');
    await L.page.goto(locked.link);
    await L.page.locator('ss-lock-screen').waitFor({ timeout: 20000 });
    await until('L to leave /join', () => L.page.url() === `${baseUrl}settings`, 10000).catch(
      () => false,
    );
    check(
      'L light wide: with the app locked, the link leaves the address bar at once, and nothing takes it yet',
      L.page.url() === `${baseUrl}settings` &&
        sent.filter(
          (request) =>
            request.label.startsWith('L') &&
            request.url.endsWith(`/api/v1/join/${idOf(locked.link)}`),
        ).length === 0,
      L.page.url(),
    );
    await room(3);
    await L.page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery');
    await L.page.keyboard.press('Enter');
    const joinL = L.page.locator('ss-join-sync-dialog');
    await joinL.getByRole('heading', { name: 'Join this synced copy' }).waitFor({ timeout: 30000 });
    check(
      'L light wide: once unlocked, Settings opens Join with the link, with Merge and Replace',
      (await joinL.getByRole('radio').count()) === 2,
    );
    await axeCheck(L.page, 'L light wide: the copy to join, after the unlock');
    await press(L.page, joinL, 'Join');
    await joinL.waitFor({ state: 'detached', timeout: 20000 });
    await L.context.close();
    await press(A.page, locked.dialog, 'Done');

    // A link past its 10 minutes.
    const old = await showCode(A.page, 'A light wide');
    userDb(`UPDATE join_links SET expires_at = '2026-01-01T00:00:00Z'`);
    const X = await newPage(browser, 'X light wide', { colorScheme, viewport });
    await room(1);
    await X.page.goto(old.link);
    const joinX = X.page.locator('ss-join-sync-dialog');
    await joinX.locator('.error').filter({ hasText: /\S/ }).waitFor({ timeout: 20000 });
    check(
      'X light wide: a link past its 10 minutes says it was used or has expired',
      ((await joinX.locator('.error').textContent()) ?? '').includes(
        'This link was used or has expired.',
      ),
    );
    await X.context.close();
    await press(A.page, old.dialog, 'Done');

    // Show the code offline.
    await A.context.setOffline(true);
    network.offline = true;
    await openSync(A.page);
    await press(A.page, syncCard(A.page), 'Show the code…');
    await press(A.page, topDialog(A.page), 'Show the code');
    const offline = topDialog(A.page);
    await offline.locator('.qr-status').filter({ hasText: 'offline' }).waitFor({ timeout: 20000 });
    check(
      'A light wide: offline, Show the code says why there is no QR code, with the words',
      (await offline.locator('ss-qr-code').count()) === 0 &&
        (await offline.locator('.words li').count()) === 24,
    );
    await axeCheck(A.page, 'A light wide: Show the code offline');
    await press(A.page, offline, 'Done');
    await A.context.setOffline(false);
    network.offline = false;
  }

  await A.context.close();
  await B.context.close();
  return links;
}

(async () => {
  await waitForServer();
  await nextMinute();
  const browser = await chromium.launch({ channel: 'msedge' });
  const links = [];
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      if (only && only !== `${colorScheme}-${viewport === WIDE ? 'wide' : 'narrow'}`) continue;
      links.push(...(await run(browser, colorScheme, viewport)));
    }
  }
  await browser.close();

  const keys = links.map(keyOf).filter(Boolean);
  const carried = sent.filter((request) =>
    keys.some((key) => request.url.includes(key) || request.body.includes(key)),
  );
  check(
    `no request carried any link's key (${keys.length} links, ${sent.length} requests)`,
    keys.length > 0 && carried.length === 0,
    carried.map((request) => `${request.method} ${request.url}`).join(' | '),
  );
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  for (const line of consoleProblems) console.error(`console: ${line}`);
  process.exit(1);
});
