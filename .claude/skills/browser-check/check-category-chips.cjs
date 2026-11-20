// A card's categories (M10.36) in the system Edge, on the real catalog (data:build's files), for a Canadian in Ontario
// with Proton Pass Plus, Mullvad and Netflix in a list: Proton's Search card shows a chip for each of its plans'
// categories, Pass Plus's filled; Unlimited fills them all without moving a chip; Tab reaches the row and its tooltip
// names them; List view's cards show theirs. In both themes at 1280 and 360 px, with axe, screenshots and no horizontal
// scroll. GET /fx is answered with fixed rates.
// Usage: node check-category-chips.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
  ['proton.pass-plus', 'year'],
  ['mullvad.vpn', 'month'],
  ['netflix.standard', 'month'],
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

    await page.goto(`${baseUrl}search?q=proton`);
    const card = page.locator('ss-sub-card', { has: page.locator('h2', { hasText: /^Proton$/ }) });
    await card.waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const row = card.locator('ss-category-chips .chips');
    const filled = () => card.locator('ss-category-chips .chip.in-plan').count();
    const total = await card.locator('ss-category-chips .chip').count();
    const before = await filled();
    check(
      `${label}: Proton shows its categories, some filled`,
      total >= 4 && before >= 1,
      `${before} of ${total}`,
    );
    console.log(`  ${label}: ${await row.getAttribute('aria-label')}`);
    // Another plan: the chips stay, the marks move.
    const unlimited = card.locator('label.chip', { hasText: 'Unlimited' });
    if (await unlimited.count()) {
      await unlimited.click();
      await page.waitForTimeout(400);
      check(
        `${label}: Unlimited fills more, the chips stay`,
        (await filled()) > before &&
          (await card.locator('ss-category-chips .chip').count()) === total,
        `${await filled()} of ${total}`,
      );
    }
    await card.screenshot({ path: path.join(outDir, `${label}-proton.png`) });
    // Focus shows the names.
    await row.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1000);
    check(
      `${label}: Tab reaches the chips`,
      await row.evaluate((element) => element === document.activeElement),
    );
    const tip = await page
      .locator('.mat-mdc-tooltip-show')
      .innerText()
      .catch(() => '');
    check(`${label}: focus shows the names`, tip.startsWith('This plan:'), tip);
    await page.screenshot({ path: path.join(outDir, `${label}-tooltip.png`) });
    await axe('Search');

    await page.goto(`${baseUrl}lists/${LIST}`);
    await page.locator('ss-item-card ss-category-chips').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    check(
      `${label}: List view's cards have their categories`,
      (await page.locator('ss-item-card ss-category-chips').count()) === 3,
    );
    await page.screenshot({ path: path.join(outDir, `${label}-list.png`) });
    await axe('List view');
    await context.close();
  }
  await browser.close();
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
