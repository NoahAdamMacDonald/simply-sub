// The feedback after M10, part 2 (M10.24) in the system Edge on ng serve, for a Canadian in Alberta: two tags of one
// name, as a backup's Merge or sync leaves two devices' "Family" tags (Family and family), and Work, with Netflix
// Standard tagged family. In both themes at 1280 and 360 px, keyboard only: Settings' Custom tags says of the later one
// "Another tag is called Family.", with Merge into it after it; Enter asks first (focus on Merge, as a question that
// loses nothing has it), Escape keeps both; Enter on Merge moves the subscription to Family and deletes family, the note goes, and focus is on Family's ✎. With axe on
// the note and the question, screenshots, and no horizontal scroll.
// Usage: node check-m10-merge-tags.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const rates = {
  data: {
    base: 'CAD',
    date: '2026-10-26',
    source: 'European Central Bank via Frankfurter',
    rates: { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 },
  },
  meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
};

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

const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const ITEM = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a00';
const FAMILY = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c21';
const WORK = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c22';
const PHONE = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c23';

async function plant(page) {
  await putRecord(page, 'tags', { id: FAMILY, name: 'Family', color: '#1e88e5', ...stamps });
  await putRecord(page, 'tags', { id: WORK, name: 'Work', color: '#e53935', ...stamps });
  await putRecord(page, 'tags', { id: PHONE, name: 'family', color: '#8e24aa', ...stamps });
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  await putRecord(page, 'items', {
    id: ITEM,
    listId: LIST,
    source: { kind: 'catalog', planId: 'netflix.standard' },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    tagIds: [WORK, PHONE],
    rankOverrides: {},
    pinned: false,
    ...stamps,
  });
}

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  const problems = result.violations
    .filter(
      (violation) =>
        violation.id !== 'region' ||
        !violation.nodes.every((node) => node.target.join(' ').includes('cdk-overlay')),
    )
    .map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .map((node) => node.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe: ${label}`, problems.length === 0, problems.join('; '));
}

async function noSideScroll(page, viewport, label) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`no horizontal scroll: ${label}`, width <= viewport.width, `${width}px`);
}

/** The focused control's aria-label, or its text. */
const focusedLabel = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    return element?.getAttribute('aria-label') ?? element?.textContent?.replace(/\s+/g, ' ').trim();
  });

async function tabTo(page, name, limit = 80) {
  for (let presses = 0; presses < limit; presses++) {
    if ((await focusedLabel(page)) === name) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Never reached ${name}`);
}

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  const shot = (name) => path.join(outDir, `${name}-${label.replace(' ', '-')}.png`);
  try {
    await firstRun(page);
    await plant(page);
    await page.goto(`${baseUrl}settings`);
    const note = page.locator('ss-tags-setting .namesake');
    await note.waitFor({ timeout: 20000 });
    check(
      `${label}: only the later tag says another has its name, with Merge into it`,
      (await note.count()) === 1 &&
        (await note.evaluate((element) => element.closest('li').getAttribute('data-tag'))) ===
          PHONE &&
        (await note.innerText()).replace(/\s+/g, ' ').trim() ===
          'Another tag is called Family. Merge into it',
      await note.innerText(),
    );
    await note.scrollIntoViewIfNeeded();
    await page.locator('ss-tags-setting').screenshot({ path: shot('namesake') });
    await axeCheck(page, `${label}: the note`);
    await noSideScroll(page, viewport, label);

    await page.locator('main').focus();
    await tabTo(page, 'Merge into it');
    await page.keyboard.press('Enter');
    const question = page.locator('ss-confirm-dialog');
    await question.waitFor();
    await sleep(500);
    check(
      `${label}: Merge asks first, with focus on Merge`,
      (await question.locator('h2').innerText()).trim() === 'Merge the two “Family” tags?' &&
        (await focusedLabel(page)) === 'Merge',
      `${await question.locator('h2').innerText()} / ${await focusedLabel(page)}`,
    );
    await axeCheck(page, `${label}: the question`);
    await page.keyboard.press('Escape');
    await question.waitFor({ state: 'detached' });
    check(
      `${label}: Escape keeps both tags`,
      (await readTable(page, 'tags')).every((tag) => !tag.deletedAt),
    );

    await tabTo(page, 'Merge into it');
    await page.keyboard.press('Enter');
    await question.waitFor();
    await sleep(400);
    await page.keyboard.press('Enter');
    await question.waitFor({ state: 'detached' });
    await until('the merge', async () =>
      (await readTable(page, 'tags')).some((tag) => tag.id === PHONE && tag.deletedAt),
    );
    const [item] = await readTable(page, 'items');
    await until('focus on Family’s ✎', async () => (await focusedLabel(page)) === 'Rename Family');
    check(
      `${label}: Merge moves the subscription to Family, the note goes, and focus is on Family's ✎`,
      item.tagIds.join() === `${WORK},${FAMILY}` && (await note.count()) === 0,
      item.tagIds.join(),
    );
    await page.locator('ss-tags-setting').screenshot({ path: shot('merged') });
  } catch (error) {
    check(`${label}: ran to the end`, false, error.message.split('\n')[0]);
    await page.screenshot({ path: shot('failure') });
  } finally {
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) await run(browser, colorScheme, viewport);
    }
  } finally {
    await browser.close();
  }
  check(
    'no console errors or warnings',
    consoleProblems.length === 0,
    consoleProblems.slice(0, 5).join(' | '),
  );
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} of ${checks.length} passed`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
