// M6.10 in the system Edge: the app lock (P13's Security, P15's lock screen) on `ng serve`, for a Canadian in Alberta,
// with Work Related (Netflix Standard nicknamed Mom's, noted "Paid by Dad" and tagged Family), a custom subscription
// (Goodlife Gym, $43.21) and a rank written to IndexedDB. In both themes at 1280 and 360 px, keyboard only:
// - Settings' Lock with a passphrase by Space: the dialog (focus in its field), a short and a mismatched passphrase
//   refused, Lock after by typeahead, then Turn on the lock, at 600,000 iterations;
// - IndexedDB read raw: every user table sealed, no names, notes or amounts in it, the caches plain, and no key;
// - a reload: the lock screen in place of the app, focus in its field, nothing of the user's in the page;
// - a wrong passphrase says so, keeps focus in the field and unlocks nothing; "Forgot it?" opens its ways out;
// - the right passphrase opens the page the reload was on;
// - Turn off the lock: a wrong passphrase refused, then every table back exactly as it was.
// Then at 1280 px: the idle lock (Playwright's clock) closing an open dialog, Export while the lock is on, and the lock
// screen's Import a backup and Delete all data. With axe on each screen and dialog, and no horizontal scroll.
// Usage: node check-app-lock.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function newPage(browser, label, { colorScheme = 'light', viewport = WIDE, clock } = {}) {
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({
      json: {
        data: {
          base: 'CAD',
          date: '2026-10-26',
          source: 'European Central Bank via Frankfurter',
          rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
        },
        meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
      },
    }),
  );
  // Time flows as usual until the script moves it on.
  if (clock) await context.clock.install();
  const page = await context.newPage();
  page.on('filechooser', () => undefined);
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

/** Completes the first-run dialog for Alberta. */
async function firstRun(page) {
  const dialog = page.locator('ss-first-run-dialog');
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

function readTable(page, table) {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const rows = db.transaction(store).objectStore(store).getAll();
          rows.onsuccess = () => {
            db.close();
            resolve(rows.result);
          };
          rows.onerror = () => reject(rows.error);
        };
      }),
    table,
  );
}

function putRecords(page, records) {
  return page.evaluate(
    (rows) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(
            [...new Set(rows.map(([table]) => table))],
            'readwrite',
          );
          for (const [table, value] of rows) transaction.objectStore(table).put(value);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    records,
  );
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
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

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

/** The focused element's accessible name, from its accessibility snapshot. */
async function focusedName(page) {
  const focused = await page.evaluate(
    () => document.activeElement !== null && document.activeElement !== document.body,
  );
  if (!focused) return undefined;
  const line = (await page.locator(':focus').ariaSnapshot()).split('\n')[0];
  return /"([^"]*)"/.exec(line)?.[1];
}

/** Presses `key` until the element named `name` has focus. */
async function keyToName(page, name, key = 'Tab', limit = 60) {
  for (let presses = 0; presses < limit; presses++) {
    if ((await focusedName(page)) === name) return;
    await page.keyboard.press(key);
  }
  throw new Error(`Couldn't reach ${name} (focus on ${await focusedName(page)})`);
}

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const GYM = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c';
const GYM_PLAN = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d';
const TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const PASSPHRASE = 'correct horse battery';
const LOCKED = ['settings', 'lists', 'items', 'customSubs', 'rankings', 'tags', 'drafts'];
/** What mustn't show in a locked table, or on the lock screen. */
const SECRETS = [
  'Work Related',
  "Mom's",
  'Paid by Dad',
  'Goodlife Gym',
  'Family',
  'netflix.standard',
  '43.21',
  'CA-AB',
];

async function plant(page) {
  await putRecords(page, [
    ['tags', { id: TAG, name: 'Family', color: '#1e88e5', ...stamps }],
    ['lists', { id: LIST, name: 'Work Related', ...stamps }],
    [
      'items',
      {
        id: NETFLIX,
        listId: LIST,
        source: { kind: 'catalog', planId: 'netflix.standard' },
        billing: {
          mode: 'recurring',
          interval: 'month',
          intervalCount: 1,
          anchorDate: '2026-11-12',
          autoRenew: true,
        },
        tagIds: [TAG],
        rankOverrides: { 'streaming.ad-free': 'essential' },
        pinned: true,
        nickname: "Mom's",
        note: 'Paid by Dad',
        ...stamps,
      },
    ],
    [
      'customSubs',
      {
        id: GYM,
        name: 'Goodlife Gym',
        plans: [
          {
            id: GYM_PLAN,
            name: 'Monthly',
            features: {},
            price: { amount: 43.21, currency: 'CAD', interval: 'month', intervalCount: 1 },
            autoRenewAvailable: true,
          },
        ],
        ...stamps,
      },
    ],
    ['rankings', { rankKey: 'video.quality=4k', rank: 'wanted', ...stamps }],
  ]);
}

/** A value as JSON with its objects' keys sorted, and none that's undefined (JSON drops them too). */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Every locked table as stored, each sorted, as one string to compare. */
async function snapshot(page) {
  const tables = {};
  for (const table of LOCKED) tables[table] = (await readTable(page, table)).map(canonical).sort();
  return JSON.stringify(tables);
}

const dialog = (page) => page.locator('mat-dialog-container').last();
const dialogText = async (page) => (await dialog(page).textContent()).replace(/\s+/g, ' ').trim();
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container').last();
const lockScreen = (page) => page.locator('ss-lock-screen');
const pageText = (page) => page.evaluate(() => document.body.innerText);

async function openSettings(page) {
  await page.goto(`${baseUrl}settings`);
  await page.locator('ss-settings-page h1').waitFor({ timeout: 20000 });
  await page.locator('ss-settings-page h1').click();
}

/** Lock with a passphrase from Settings, by keyboard, with Lock after picked by typing `idleKey`. */
async function turnOn(page, label, shot, viewport, { idleKey = '5', idleText = '5 minutes' } = {}) {
  await openSettings(page);
  await keyToName(page, 'Lock with a passphrase');
  await page.keyboard.press('Space');
  await dialog(page).locator('h2', { hasText: 'Lock with a passphrase' }).waitFor();
  await until(
    'focus in the passphrase field',
    async () => (await focusedName(page)) === 'Passphrase',
  );
  check(`${label}: the turn-on dialog starts in its Passphrase field`, true);
  check(
    `${label}: it says nobody can recover a forgotten passphrase, and offers a backup first`,
    (await dialogText(page)).includes('Nobody can recover a forgotten passphrase') &&
      (await dialog(page).getByRole('button', { name: 'Export a backup first' }).count()) === 1,
  );
  // Too short, and typed differently: refused, with focus on the first.
  await page.keyboard.type('short');
  await page.keyboard.press('Tab');
  await page.keyboard.type('shorts');
  await page.keyboard.press('Enter');
  await until('the errors', async () => (await dialog(page).locator('mat-error').count()) === 2);
  check(
    `${label}: a short, mismatched passphrase is refused at its fields`,
    (await dialogText(page)).includes('Use at least 8 characters') &&
      (await dialogText(page)).includes('Type the same passphrase again') &&
      (await focusedName(page)) === 'Passphrase',
  );
  await page.screenshot({ path: shot('lock-on-errors') });
  await axeCheck(page, `${label}, turn-on dialog with errors`);
  await noSideScroll(page, viewport, `${label}, turn-on dialog`);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(PASSPHRASE);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(PASSPHRASE);
  await page.keyboard.press('Tab');
  check(`${label}: Lock after is the next stop`, (await focusedName(page)) === 'Lock after');
  // A closed mat-select picks the option its typeahead matches, after a 200 ms pause.
  await page.keyboard.type(idleKey);
  await until('Lock after picked', async () =>
    (await dialog(page).locator('.mat-mdc-select-value-text').textContent())
      .trim()
      .startsWith(idleText),
  );
  await page.screenshot({ path: shot('lock-on-dialog') });
  await keyToName(page, 'Turn on the lock');
  await page.keyboard.press('Enter');
  await dialog(page).waitFor({ state: 'detached', timeout: 30000 });
  await until('the snackbar', async () =>
    (await snackBar(page).textContent())?.includes('The lock is on'),
  );
  check(`${label}: Turn on the lock says "The lock is on"`, true);
}

/** On the lock screen: a wrong passphrase, "Forgot it?", then the right one. */
async function unlockScreen(page, label, shot, viewport, { full = true } = {}) {
  await lockScreen(page).locator('h1').waitFor({ timeout: 20000 });
  await until(
    'focus in the lock screen field',
    async () => (await focusedName(page)) === 'Passphrase',
  );
  if (full) {
    check(
      `${label}: the lock screen is in place of the app`,
      (await page.locator('ss-shell').count()) === 0,
    );
    const text = await pageText(page);
    const shown = SECRETS.filter((secret) => text.includes(secret));
    check(
      `${label}: the lock screen shows nothing of the user's`,
      shown.length === 0,
      shown.join(', '),
    );
    await page.screenshot({ path: shot('lock-screen') });
    await axeCheck(page, `${label}, lock screen`);
    await noSideScroll(page, viewport, `${label}, lock screen`);

    await page.keyboard.type('correct horse');
    await page.keyboard.press('Enter');
    const alert = lockScreen(page).locator('[role=alert]');
    await alert.waitFor({ timeout: 20000 });
    check(
      `${label}: a wrong passphrase says so, keeps focus in the field and unlocks nothing`,
      (await alert.textContent()).trim() === 'That passphrase is wrong, so nothing was unlocked.' &&
        (await focusedName(page)) === 'Passphrase' &&
        (await page.locator('ss-shell').count()) === 0,
    );
    await page.screenshot({ path: shot('lock-screen-wrong') });
    await axeCheck(page, `${label}, lock screen with a wrong passphrase`);

    await page.keyboard.press('Tab');
    check(`${label}: Unlock is the next stop`, (await focusedName(page)) === 'Unlock');
    await page.keyboard.press('Tab');
    check(`${label}: then "Forgot it?"`, (await focusedName(page)) === 'Forgot it?');
    await page.keyboard.press('Enter');
    await lockScreen(page).locator('#forgot').waitFor();
    check(
      `${label}: "Forgot it?" opens its ways out, and says it's open`,
      (await page.locator(':focus').getAttribute('aria-expanded')) === 'true',
    );
    await page.keyboard.press('Tab');
    check(`${label}: Import a backup is next`, (await focusedName(page)) === 'Import a backup');
    await page.keyboard.press('Tab');
    check(`${label}: then Delete all data`, (await focusedName(page)) === 'Delete all data');
    await page.screenshot({ path: shot('lock-screen-forgot'), fullPage: true });
    await axeCheck(page, `${label}, lock screen with "Forgot it?" open`);
    await noSideScroll(page, viewport, `${label}, "Forgot it?"`);
    await keyToName(page, 'Passphrase', 'Shift+Tab');
    await page.keyboard.press('Control+A');
  }
  await page.keyboard.type(PASSPHRASE);
  await page.keyboard.press('Enter');
  await page.locator('ss-shell').waitFor({ timeout: 20000 });
}

/** Turn off the lock from Settings, by keyboard: a wrong passphrase, then the right one. */
async function turnOff(page, label, shot, viewport) {
  // A visit: the lock screen first.
  await page.goto(`${baseUrl}settings`);
  await unlockScreen(page, label, shot, viewport, { full: false });
  await page.locator('ss-settings-page h1').waitFor({ timeout: 20000 });
  await page.locator('ss-settings-page h1').click();
  await keyToName(page, 'Lock with a passphrase');
  await page.keyboard.press('Space');
  await dialog(page).locator('h2', { hasText: 'Turn off the lock?' }).waitFor();
  await until(
    'focus in the passphrase field',
    async () => (await focusedName(page)) === 'Passphrase',
  );
  await page.keyboard.type('wrong passphrase');
  await page.keyboard.press('Enter');
  const alert = dialog(page).locator('[role=alert]');
  await alert.waitFor({ timeout: 20000 });
  check(
    `${label}: Turn off refuses a wrong passphrase, with focus kept in its field`,
    (await alert.textContent()).trim() === 'That passphrase is wrong, so the lock is still on.' &&
      (await focusedName(page)) === 'Passphrase',
  );
  await page.screenshot({ path: shot('lock-off-wrong') });
  await axeCheck(page, `${label}, turn-off dialog with a wrong passphrase`);
  await noSideScroll(page, viewport, `${label}, turn-off dialog`);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(PASSPHRASE);
  await page.keyboard.press('Enter');
  await dialog(page).waitFor({ state: 'detached', timeout: 30000 });
  await until('the snackbar', async () =>
    (await snackBar(page).textContent())?.includes('The lock is off'),
  );
  check(`${label}: Turn off the lock says "The lock is off"`, true);
}

/** Checks what's stored once the lock is on: sealed, with no secrets, the caches plain, and no key. */
async function checkSealed(page, label) {
  const rows = {};
  for (const table of LOCKED) rows[table] = await readTable(page, table);
  const text = JSON.stringify(rows);
  const shown = SECRETS.filter((secret) => text.includes(secret));
  check(
    `${label}: IndexedDB holds no names, notes or amounts`,
    shown.length === 0,
    shown.join(', '),
  );
  const unsealed = LOCKED.flatMap((table) =>
    rows[table].filter((row) => !row.sealed).map(() => table),
  );
  check(`${label}: every user table's rows are sealed`, unsealed.length === 0, unsealed.join(', '));
  const [settings] = rows.settings;
  check(
    `${label}: the settings keep only the key, theme and lock plain, at 600,000 iterations`,
    canonical(Object.keys(settings).sort()) === canonical(['appLock', 'key', 'sealed', 'theme']) &&
      settings.appLock.iterations === 600000 &&
      Object.keys(settings.appLock).sort().join() === 'check,idleMinutes,iterations,salt',
    JSON.stringify(Object.keys(settings)),
  );
  const fx = await readTable(page, 'fxRates');
  check(`${label}: the exchange rates stay plain`, fx.length === 1 && fx[0].rates?.base === 'CAD');
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });

  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const shot = (name) => path.join(outDir, `${name}-${colorScheme}-${viewport.width}.png`);
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await page.goto(baseUrl);
      await firstRun(page);
      await plant(page);
      await until(
        'the exchange rates cached',
        async () => (await readTable(page, 'fxRates')).length === 1,
      );
      const before = await snapshot(page);

      // ── Settings' Security, before ─────────────────────────────────────────────────────────
      await openSettings(page);
      // Its card was Security until M4.7.
      const security = page.locator('ss-settings-page section.card', { hasText: 'App lock' });
      await security.waitFor();
      await security.screenshot({ path: shot('security-off') });

      // ── Turn on ─────────────────────────────────────────────────────────────────────────────
      await turnOn(page, label, shot, viewport);
      check(
        `${label}: the checkbox is checked, with Lock after at 5 minutes`,
        (await security.getByRole('checkbox', { name: 'Lock with a passphrase' }).isChecked()) &&
          (await security.locator('.mat-mdc-select-value-text').textContent()).trim() ===
            '5 minutes',
      );
      await security.screenshot({ path: shot('security-on') });
      await axeCheck(page, `${label}, Settings with the lock on`);
      await noSideScroll(page, viewport, `${label}, Settings with the lock on`);
      await checkSealed(page, label);

      // ── A visit: the lock screen ────────────────────────────────────────────────────────────
      await page.goto(`${baseUrl}lists`);
      await unlockScreen(page, label, shot, viewport);
      await page.locator('ss-lists-overview-page h1').waitFor({ timeout: 20000 });
      await until('Work Related on Lists', async () =>
        (await pageText(page)).includes('Work Related'),
      );
      check(
        `${label}: the right passphrase opens the page the visit was on`,
        page.url().endsWith('/lists'),
      );

      // ── Turn off: every table back exactly ──────────────────────────────────────────────────
      await turnOff(page, label, shot, viewport);
      check(
        `${label}: turning the lock off gives back every table exactly`,
        (await snapshot(page)) === before,
      );
      await context.close();
    }
  }

  // ── At 1280 px: the idle lock, Export while locked on, and the lock screen's ways out ──────────
  {
    const label = 'light 1280';
    const viewport = WIDE;
    const shot = (name) => path.join(outDir, `${name}-light-1280.png`);
    const { context, page } = await newPage(browser, `${label} (clock)`, { viewport, clock: true });
    await page.goto(baseUrl);
    await firstRun(page);
    await plant(page);
    await turnOn(page, label, shot, viewport);

    // Export while the lock is on: the file holds the records opened, without the lock.
    await keyToName(page, 'Export backup');
    await page.keyboard.press('Enter');
    await dialog(page).locator('h2', { hasText: 'Export a backup' }).waitFor();
    const downloading = page.waitForEvent('download');
    await keyToName(page, 'Export');
    await page.keyboard.press('Enter');
    const download = await downloading;
    const exported = fs.readFileSync(await download.path(), 'utf8');
    const backupPath = path.join(outDir, 'app-lock-backup.json');
    fs.writeFileSync(backupPath, exported);
    check(
      `${label}: Export while the lock is on writes the records opened, without the lock`,
      exported.includes('Work Related') &&
        exported.includes('Goodlife Gym') &&
        !exported.includes('appLock'),
    );

    // The idle lock: 4 minutes of nothing leaves it unlocked, a fifth locks it and closes an open dialog.
    await keyToName(page, 'Export backup');
    await page.keyboard.press('Enter');
    await dialog(page).locator('h2', { hasText: 'Export a backup' }).waitFor();
    await page.clock.fastForward('04:00');
    await sleep(500);
    check(`${label}: 4 idle minutes leave it unlocked`, (await lockScreen(page).count()) === 0);
    await page.clock.fastForward('01:05');
    await lockScreen(page).locator('h1').waitFor({ timeout: 20000 });
    await until(
      'the dialog closed',
      async () => (await page.locator('mat-dialog-container').count()) === 0,
    );
    const text = await pageText(page);
    check(
      `${label}: 5 idle minutes lock it, close the dialog and leave nothing of the user's on screen`,
      SECRETS.every((secret) => !text.includes(secret)),
    );
    await page.screenshot({ path: shot('idle-locked') });
    await unlockScreen(page, label, shot, viewport, { full: false });
    await page.locator('ss-settings-page h1').waitFor({ timeout: 20000 });
    check(`${label}: unlocked again, on Settings`, page.url().endsWith('/settings'));

    // The lock screen's Import a backup: everything here replaced, the lock off.
    await page.reload();
    await lockScreen(page).locator('h1').waitFor({ timeout: 20000 });
    await until('focus in the field', async () => (await focusedName(page)) === 'Passphrase');
    await keyToName(page, 'Forgot it?');
    await page.keyboard.press('Enter');
    await keyToName(page, 'Import a backup');
    await page.keyboard.press('Enter');
    await dialog(page).locator('h2', { hasText: 'Import a backup' }).waitFor();
    const choosing = page.waitForEvent('filechooser');
    await keyToName(page, 'Choose a backup file');
    await page.keyboard.press('Enter');
    await (await choosing).setFiles(backupPath);
    await until('the preview', async () => (await dialogText(page)).includes('turns the lock off'));
    check(
      `${label}: from the lock screen, the backup can only replace what's here`,
      (await dialog(page).getByRole('button', { name: 'Merge' }).count()) === 0,
    );
    await axeCheck(page, `${label}, lock screen's import preview`);
    await keyToName(page, 'Replace');
    await page.keyboard.press('Enter');
    const confirm = page.locator('ss-confirm-dialog');
    await confirm.waitFor();
    // The question moves focus once it has opened.
    const onCancel = await until(
      'focus on Cancel',
      async () => (await focusedName(page)) === 'Cancel',
      5000,
    )
      .then(() => true)
      .catch(() => false);
    const question = (await confirm.textContent()).replace(/\s+/g, ' ');
    check(
      `${label}: Replace asks first, saying the lock goes, with focus on Cancel`,
      question.includes('the lock is turned off') && onCancel,
      `${question} / focus on ${await focusedName(page)}`,
    );
    await axeCheck(page, `${label}, lock screen's Replace question`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.locator('ss-shell').waitFor({ timeout: 20000 });
    const [settings] = await readTable(page, 'settings');
    const lists = await readTable(page, 'lists');
    check(
      `${label}: the import turned the lock off and wrote the backup plain`,
      !settings.appLock && !settings.sealed && lists.some((list) => list.name === 'Work Related'),
    );

    // The lock screen's Delete all data: everything gone, the lock with it, then the first run.
    await turnOn(page, label, shot, viewport, { idleKey: 'N', idleText: 'Never' });
    await page.reload();
    await lockScreen(page).locator('h1').waitFor({ timeout: 20000 });
    await until('focus in the field', async () => (await focusedName(page)) === 'Passphrase');
    await keyToName(page, 'Forgot it?');
    await page.keyboard.press('Enter');
    await keyToName(page, 'Delete all data');
    await page.keyboard.press('Enter');
    await dialog(page).locator('h2', { hasText: 'Delete all data?' }).waitFor();
    check(
      `${label}: Delete all data from the lock screen says the lock goes too`,
      (await dialogText(page)).includes('the lock is turned off') &&
        !(await dialogText(page)).includes('export a backup first'),
    );
    await until(
      'focus in the DELETE field',
      async () => (await focusedName(page)) === 'Type DELETE to confirm',
    );
    await axeCheck(page, `${label}, lock screen's Delete all data`);
    await page.keyboard.type('DELETE');
    await page.keyboard.press('Enter');
    await page.locator('ss-first-run-dialog').waitFor({ timeout: 20000 });
    const left = [];
    for (const table of LOCKED) left.push(...(await readTable(page, table)));
    check(
      `${label}: everything's deleted, the lock off, and the first-run dialog shows`,
      left.length === 0 && (await page.evaluate(() => localStorage.getItem('ss-lock'))) === null,
    );
    await page.screenshot({ path: shot('deleted-first-run') });
    await context.close();
  }

  await browser.close();
  if (consoleProblems.length > 0) {
    console.log('Console problems:');
    for (const problem of consoleProblems) console.log(`  ${problem}`);
  }
  check('no console errors or warnings', consoleProblems.length === 0);
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  if (consoleProblems.length > 0) console.error(consoleProblems.join('\n'));
  process.exit(1);
});
