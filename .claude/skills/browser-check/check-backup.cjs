// M6.9 in the system Edge: backups (P13's Your data) on `ng serve`, for a Canadian in Alberta, with Work Related
// (Netflix Standard nicknamed Mom's and tagged Family), a custom subscription and a rank written to IndexedDB. In both
// themes at 1280 and 360 px, keyboard only:
// - Export backup with "Protect with a passphrase", read back from the download: encrypted, no names in it;
// - Export backup without one, read back: every record, deleted ones too;
// - Delete all data: typing DELETE, then Home with the first-run dialog;
// - the first-run dialog's Import a backup instead, with the encrypted file: a wrong passphrase says so and writes
//   nothing, the right one shows what it holds, and Import brings back exactly what was stored.
// Then at 1280 px: Merge from Settings, Replace asking first (focus on Cancel), and a file that isn't a backup. With axe
// on each dialog and step, and no horizontal scroll.
// Usage: node check-backup.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

async function newPage(browser, label, { colorScheme = 'light', viewport = WIDE } = {}) {
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
  const page = await context.newPage();
  // Playwright starts catching file pickers when something first waits for one, without waiting for the browser to
  // agree, so a key press straight after the first wait could open a picker it missed. Listening from the start, it
  // catches every one.
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
const OLD_LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const GYM = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1c';
const GYM_PLAN = '0192f1c6-2d3e-7f40-9b5c-6d7e8f9a0b1d';
const TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const PASSPHRASE = 'correct horse battery';
const backedUp = ['settings', 'lists', 'items', 'customSubs', 'rankings', 'tags'];

async function plant(page) {
  await putRecords(page, [
    ['tags', { id: TAG, name: 'Family', color: '#1e88e5', ...stamps }],
    ['lists', { id: LIST, name: 'Work Related', ...stamps }],
    ['lists', { id: OLD_LIST, name: 'Old', ...stamps, deletedAt: '2026-10-21T08:00:00.000Z' }],
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
        name: 'Gym',
        plans: [
          {
            id: GYM_PLAN,
            name: 'Monthly',
            features: {},
            price: { amount: 40, currency: 'CAD', interval: 'month', intervalCount: 1 },
            autoRenewAvailable: true,
          },
        ],
        ...stamps,
      },
    ],
    ['rankings', { rankKey: 'video.quality=4k', rank: 'wanted', ...stamps }],
  ]);
}

/**
 * A value as JSON with its objects' keys sorted, and none that's undefined: the app stores fields in its schemas'
 * order, not the order planted, and a field the first-run dialog left undefined is as good as none (JSON drops it).
 */
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

/** Every backed-up table as stored, each sorted, as one string to compare. */
async function snapshot(page) {
  const tables = {};
  for (const table of backedUp) {
    tables[table] = (await readTable(page, table)).map(canonical).sort();
  }
  return JSON.stringify(tables);
}

const dialog = (page) => page.locator('mat-dialog-container').last();
const dialogText = async (page) => (await dialog(page).textContent()).replace(/\s+/g, ' ').trim();
const snackBar = (page) => page.locator('.mat-mdc-snack-bar-container');

async function openSettings(page) {
  await page.goto(`${baseUrl}settings`);
  await page.locator('ss-settings-page h1').waitFor({ timeout: 20000 });
  await page.locator('ss-settings-page h1').click();
}

/** Export backup from Settings, by keyboard; the download's text. */
async function exportBackup(page, label, shot, passphrase) {
  await openSettings(page);
  await keyToName(page, 'Export backup');
  await page.keyboard.press('Enter');
  await dialog(page).locator('h2', { hasText: 'Export a backup' }).waitFor();
  if (passphrase) {
    await keyToName(page, 'Protect with a passphrase');
    await page.keyboard.press('Space');
    await dialog(page).locator('.passphrase').waitFor();
    await page.keyboard.press('Tab');
    await page.keyboard.type(passphrase);
    await page.keyboard.press('Tab');
    await page.keyboard.type(passphrase);
    await page.screenshot({ path: shot('export-passphrase') });
    await axeCheck(page, `${label}, Export with a passphrase`);
  } else {
    await axeCheck(page, `${label}, Export`);
  }
  const downloading = page.waitForEvent('download');
  await keyToName(page, 'Export');
  await page.keyboard.press('Enter');
  const download = await downloading;
  const text = fs.readFileSync(await download.path(), 'utf8');
  await snackBar(page).waitFor();
  return { name: download.suggestedFilename(), text };
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
      const before = await snapshot(page);

      // ── Settings' Your data ─────────────────────────────────────────────────────────────────
      await openSettings(page);
      // By its name: Security's hint says "your data" too.
      const yourData = page.getByRole('region', { name: 'Your data', exact: true });
      await yourData.waitFor();
      await noSideScroll(page, viewport, `${label}, Settings`);
      await yourData.screenshot({ path: shot('your-data') });

      // ── Export, encrypted ───────────────────────────────────────────────────────────────────
      const encrypted = await exportBackup(page, label, shot, PASSPHRASE);
      const encryptedJson = JSON.parse(encrypted.text);
      check(
        `${label}: Export with a passphrase downloads an encrypted backup, with no names in it`,
        /^simply-sub-backup-\d{4}-\d\d-\d\d\.json$/.test(encrypted.name) &&
          encryptedJson.encrypted?.kdf === 'PBKDF2-SHA256' &&
          encryptedJson.encrypted?.iterations === 600000 &&
          !encrypted.text.includes('Work Related') &&
          !encrypted.text.includes("Mom's"),
        encrypted.name,
      );
      const encryptedPath = path.join(
        outDir,
        `backup-encrypted-${colorScheme}-${viewport.width}.json`,
      );
      fs.writeFileSync(encryptedPath, encrypted.text);

      // ── Export, plain ───────────────────────────────────────────────────────────────────────
      await snackBar(page)
        .waitFor({ state: 'detached', timeout: 10000 })
        .catch(() => {});
      const plain = await exportBackup(page, label, shot);
      const plainJson = JSON.parse(plain.text);
      check(
        `${label}: Export downloads every record, the deleted list too, and says it saved the file`,
        plainJson.data.lists.length === 2 &&
          plainJson.data.items[0].nickname === "Mom's" &&
          plainJson.data.customSubs.length === 1 &&
          plainJson.data.rankings.length === 1 &&
          !('drafts' in plainJson.data),
        `${plainJson.data.lists.length} lists`,
      );
      const plainPath = path.join(outDir, `backup-plain-${colorScheme}-${viewport.width}.json`);
      fs.writeFileSync(plainPath, plain.text);

      // ── Delete all data ─────────────────────────────────────────────────────────────────────
      await openSettings(page);
      // Folded under its summary since M4.7. At 1280 px the jump link of the same name (first in the Tab order) puts
      // focus on the summary; at 360 the jump list has only the groups, and Tab reaches the summary itself, which an
      // accessibility snapshot reads as plain text, with no name: it's found by its id. Its Enter opens it; then its
      // button asks.
      for (let presses = 0; ; presses++) {
        const there = await page.evaluate(
          () =>
            document.activeElement?.id === 'delete-heading' ||
            (document.activeElement?.tagName === 'A' &&
              document.activeElement.textContent.trim() === 'Delete all data'),
        );
        if (there) break;
        if (presses === 200) throw new Error("Couldn't reach Delete all data");
        await page.keyboard.press('Tab');
      }
      await page.keyboard.press('Enter');
      const folded = () =>
        page.evaluate(() => document.querySelector('details.danger')?.open === false);
      if (await folded()) {
        await until('focus on its summary', () =>
          page.evaluate(() => document.activeElement?.id === 'delete-heading'),
        );
        await page.keyboard.press('Enter');
      }
      await keyToName(page, 'Delete all data…');
      await page.keyboard.press('Enter');
      await dialog(page).locator('h2', { hasText: 'Delete all data?' }).waitFor();
      await sleep(400);
      check(
        `${label}: Delete all data starts in its DELETE field`,
        (await focusedName(page)) === 'Type DELETE to confirm',
        await focusedName(page),
      );
      await page.keyboard.type('delete');
      await page.keyboard.press('Enter');
      await dialog(page).locator('mat-error').waitFor();
      check(
        `${label}: anything but DELETE deletes nothing`,
        (await dialog(page).locator('mat-error').textContent()).trim() ===
          'Type DELETE in capitals to delete everything' &&
          (await readTable(page, 'lists')).length === 2,
      );
      await page.screenshot({ path: shot('delete-all') });
      await axeCheck(page, `${label}, Delete all data with its error`);
      await page.keyboard.press('Control+A');
      await page.keyboard.type('DELETE');
      await page.keyboard.press('Enter');
      const firstRunDialog = page.locator('ss-first-run-dialog');
      await firstRunDialog.waitFor({ timeout: 20000 });
      // The first-run dialog can open a moment before the navigation Home ends.
      await until('Home', () => new URL(page.url()).pathname === '/').catch(() => {});
      await sleep(500);
      const emptied = [];
      for (const table of [...backedUp, 'drafts'])
        emptied.push((await readTable(page, table)).length);
      check(
        `${label}: DELETE clears everything, goes Home and shows the first-run dialog`,
        new URL(page.url()).pathname === '/' && emptied.every((count) => count === 0),
        `${new URL(page.url()).pathname} ${emptied.join(',')}`,
      );

      // ── The first-run dialog's Import a backup instead, encrypted ───────────────────────────
      await keyToName(page, 'Import a backup instead');
      await page.keyboard.press('Enter');
      const importDialog = page.locator('ss-import-backup-dialog');
      await importDialog.waitFor();
      await sleep(400);
      check(
        `${label}: the import starts on Choose a backup file`,
        (await focusedName(page)) === 'Choose a backup file',
        await focusedName(page),
      );
      await axeCheck(page, `${label}, Import's first step`);
      const choosing = page.waitForEvent('filechooser');
      await page.keyboard.press('Enter');
      await (await choosing).setFiles(encryptedPath);
      await importDialog.locator('input[type=password]').waitFor();
      await until(
        'focus on the passphrase',
        async () => (await focusedName(page)) === 'Passphrase',
      );
      await page.keyboard.type('wrong horse battery');
      await page.keyboard.press('Enter');
      await importDialog.locator('[role=alert]').waitFor({ timeout: 20000 });
      check(
        `${label}: a wrong passphrase says so, with focus back in its field, and writes nothing`,
        (await importDialog.locator('[role=alert]').textContent()).trim() ===
          'That passphrase doesn’t open this backup, or the file was changed.' &&
          (await focusedName(page)) === 'Passphrase' &&
          (await readTable(page, 'lists')).length === 0,
      );
      await page.screenshot({ path: shot('import-wrong') });
      await axeCheck(page, `${label}, a wrong passphrase`);
      await page.keyboard.press('Control+A');
      await page.keyboard.type(PASSPHRASE);
      await page.keyboard.press('Enter');
      await importDialog.locator('.counts').waitFor({ timeout: 20000 });
      await until('focus on the preview', () =>
        page.evaluate(() => document.activeElement?.tagName === 'H3'),
      );
      const preview = await dialogText(page);
      check(
        `${label}: the right passphrase shows what the backup has, and one Import on first run`,
        preview.includes('1 list') &&
          preview.includes('1 subscription') &&
          preview.includes('1 custom subscription') &&
          preview.includes('your settings') &&
          (await importDialog.getByRole('button', { name: 'Import', exact: true }).count()) === 1 &&
          (await importDialog.getByRole('button', { name: 'Merge' }).count()) === 0,
        preview,
      );
      await page.screenshot({ path: shot('import-preview') });
      await axeCheck(page, `${label}, the backup's preview`);
      await keyToName(page, 'Import');
      await page.keyboard.press('Enter');
      await firstRunDialog.waitFor({ state: 'detached', timeout: 20000 });
      await sleep(300);
      const after = await snapshot(page);
      check(
        `${label}: Import brings back exactly what was stored, and ends the first run`,
        after === before,
        after === before
          ? ''
          : Object.keys(JSON.parse(before))
              .filter(
                (table) =>
                  JSON.stringify(JSON.parse(before)[table]) !==
                  JSON.stringify(JSON.parse(after)[table]),
              )
              .map(
                (table) => `${table}: ${JSON.parse(before)[table]} → ${JSON.parse(after)[table]}`,
              )
              .join(' | '),
      );
      await noSideScroll(page, viewport, `${label}, after the import`);

      if (viewport === WIDE) {
        // ── From Settings: Merge, Replace asking first, and a file that isn't a backup ─────────
        await putRecords(page, [
          ['lists', { id: LIST, name: 'Work', ...stamps, updatedAt: '2026-10-26T12:00:00.000Z' }],
        ]);
        await openSettings(page);
        await keyToName(page, 'Import backup');
        await page.keyboard.press('Enter');
        await importDialog.waitFor();
        let choosingAgain = page.waitForEvent('filechooser');
        await keyToName(page, 'Choose a backup file');
        await page.keyboard.press('Enter');
        await (await choosingAgain).setFiles(plainPath);
        await importDialog.locator('.counts').waitFor();
        await axeCheck(page, `${label}, the preview's Merge and Replace`);
        await keyToName(page, 'Merge');
        await page.keyboard.press('Enter');
        await snackBar(page).waitFor();
        const lists = (await readTable(page, 'lists')).map((list) => list.name).sort();
        check(
          `${label}: Merge keeps what's newer here and says what it did`,
          lists.join(',') === 'Old,Work' &&
            (await snackBar(page).textContent()).includes('Nothing in the backup was newer'),
          lists.join(','),
        );

        await openSettings(page);
        await keyToName(page, 'Import backup');
        await page.keyboard.press('Enter');
        await importDialog.waitFor();
        choosingAgain = page.waitForEvent('filechooser');
        await keyToName(page, 'Choose a backup file');
        await page.keyboard.press('Enter');
        await (await choosingAgain).setFiles(plainPath);
        await importDialog.locator('.counts').waitFor();
        await keyToName(page, 'Replace');
        await page.keyboard.press('Enter');
        const question = page.locator('ss-confirm-dialog');
        await question.waitFor();
        await sleep(500);
        check(
          `${label}: Replace asks first, with focus on Cancel`,
          (await question.locator('h2').textContent()).trim() === 'Replace everything here?' &&
            (await focusedName(page)) === 'Cancel',
        );
        await axeCheck(page, `${label}, Replace's question`);
        await page.keyboard.press('Escape');
        await question.waitFor({ state: 'detached' });
        await page.keyboard.press('Escape');
        await importDialog.waitFor({ state: 'detached' });

        await keyToName(page, 'Import backup');
        await page.keyboard.press('Enter');
        await importDialog.waitFor();
        const notes = path.join(outDir, 'notes.txt');
        fs.writeFileSync(notes, 'not a backup');
        choosingAgain = page.waitForEvent('filechooser');
        await keyToName(page, 'Choose a backup file');
        await page.keyboard.press('Enter');
        await (await choosingAgain).setFiles(notes);
        await importDialog.locator('[role=alert]').waitFor();
        check(
          `${label}: a file that isn't a backup says so`,
          (await importDialog.locator('[role=alert]').textContent()).trim() ===
            'notes.txt: This file isn’t a Simply Sub backup.',
        );
        await axeCheck(page, `${label}, a refused file`);
      }
      await context.close();
    }
  }

  await browser.close();
  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  if (consoleProblems.length > 0) console.error(consoleProblems.join(' | '));
  process.exit(1);
});
