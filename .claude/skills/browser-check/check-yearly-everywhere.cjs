// One yearly total everywhere (M10.35, the owner's feedback of 2026-11-19) in the system Edge, on the real catalog
// (data:build's files), for a Canadian in Ontario with a list of eight subscriptions: Home starts on This year; by
// keyboard, an arrow and Space on Home's Yearly total choose Next 12 months, which its annual line names; the Lists
// overview and List view then show the same choice, and the Lists overview's line follows. In both themes at 1280 and
// 360 px, with axe, screenshots and no horizontal scroll. GET /fx is answered with fixed rates.
// Usage: node check-yearly-everywhere.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axePath = path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const LIST = '01a1c356-6ecc-716b-a8c1-a907594c99fc';
const PLANS = [
  ['claude.max-20x', 'month'],
  ['mullvad.vpn', 'month'],
  ['iqiyi.premium', 'year'],
  ['soundcloud.go-plus', 'month'],
  ['proton.pass-plus', 'year'],
  ['google-ai.plus-2tb', 'year'],
  ['xbox-game-pass.pc-game-pass', 'month'],
  ['amazon-prime-video.amazon-prime', 'year'],
];
const RANKS = {
  'video.quality=4k': 'wanted',
  'ai.assistant': 'needed',
  'vpn.included': 'needed',
  'ad-free': 'uses',
};
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

async function waitForServer() {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`No server at ${baseUrl}`);
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

async function firstRun(page) {
  await page.goto(baseUrl);
  const dialog = page.locator('mat-dialog-container');
  await dialog.waitFor({ timeout: 60000 });
  await page
    .locator('mat-form-field', { has: page.locator('mat-label', { hasText: 'Province' }) })
    .locator('.mat-mdc-text-field-wrapper')
    .click();
  await page.getByRole('option', { name: 'Ontario', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const [width, colorScheme] of [
    [1280, 'light'],
    [1280, 'dark'],
    [360, 'light'],
    [360, 'dark'],
  ]) {
    const label = `${width}-${colorScheme}`;
    const context = await browser.newContext({
      locale: 'en-CA',
      colorScheme,
      viewport: { width, height: width === 360 ? 800 : 1000 },
    });
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
    page.on('pageerror', (error) => check(`${label}: no page error`, false, error.message));
    await firstRun(page);
    const records = [['lists', { id: LIST, name: 'Subscription List', ...stamps }]];
    PLANS.forEach(([planId, interval], index) => {
      records.push([
        'items',
        {
          id: `0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a${String(index).padStart(2, '0')}`,
          listId: LIST,
          source: { kind: 'catalog', planId },
          billing: {
            mode: 'recurring',
            interval,
            intervalCount: 1,
            anchorDate: '2026-12-09',
            autoRenew: true,
          },
          tagIds: [],
          rankOverrides: {},
          pinned: false,
          ...stamps,
        },
      ]);
    });
    await putRecords(page, records);
    const axe = async (where) => {
      await page.evaluate(fs.readFileSync(axePath, 'utf8'));
      const found = await page.evaluate(async () =>
        (await window.axe.run(document)).violations.map((v) => `${v.id} (${v.nodes.length})`),
      );
      check(`${label}, ${where}: axe finds nothing`, found.length === 0, found.join(', '));
      check(
        `${label}, ${where}: nothing scrolls sideways`,
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      );
    };
    const chosen = () =>
      page.locator('ss-yearly-total-switch button[aria-checked="true"]').first().innerText();
    const yearlyLine = (scope) =>
      page.locator(`${scope} ss-budget-totals .total [aria-hidden]`).nth(1).innerText();

    await page.goto(baseUrl);
    const homeSwitch = page.locator('.budgets ss-yearly-total-switch');
    await homeSwitch.waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    check(`${label}: Home starts on This year`, (await chosen()) === 'This year');
    // By keyboard: Tab into the group, then the arrow moves the choice.
    await homeSwitch.getByRole('radio', { name: 'This year' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    check(
      `${label}: Home's arrow key and Space choose Next 12 months`,
      (await chosen()) === 'Next 12 months',
    );
    check(
      `${label}: Home's total follows`,
      /in the next 12 months$/.test(await yearlyLine('.budgets')),
      await yearlyLine('.budgets'),
    );
    await homeSwitch.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, `${label}-home.png`) });
    await axe('Home');

    await page.goto(`${baseUrl}lists`);
    await page.locator('.money ss-yearly-total-switch').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    check(`${label}: Lists remembers Next 12 months`, (await chosen()) === 'Next 12 months');
    check(
      `${label}: Lists' total follows`,
      /in the next 12 months$/.test(await yearlyLine('.money')),
      await yearlyLine('.money'),
    );
    await page.screenshot({ path: path.join(outDir, `${label}-lists.png`) });
    await axe('Lists');

    await page.goto(`${baseUrl}lists/${LIST}`);
    await page.locator('.money ss-yearly-total-switch').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    check(`${label}: List view remembers Next 12 months`, (await chosen()) === 'Next 12 months');
    await context.close();
  }
  await browser.close();
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
