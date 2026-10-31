// M10.27 (ids that last) in the system Edge on ng serve, for a Canadian in Alberta: List view, Home, Search and
// Optimizations with Claude Ultra (formerly Max 20x) and Netflix Standard served as retired, ending Mar 1.
// Usage: node check-m10-ids.cjs <deps dir> <output dir> <base url ending in />
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

const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const CLAUDE = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a00';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a01';

const item = (id, planId) => ({
  id,
  listId: LIST,
  source: { kind: 'catalog', planId },
  billing: {
    mode: 'recurring',
    interval: 'month',
    intervalCount: 1,
    anchorDate: '2026-11-12',
    autoRenew: true,
  },
  tagIds: [],
  rankOverrides: planId === 'netflix.standard' ? { 'streaming.ad-free': 'needed' } : {},
  pinned: false,
  ...stamps,
});

async function plant(page) {
  await putRecord(page, 'lists', { id: LIST, name: 'Work Related', ...stamps });
  await putRecord(page, 'items', item(CLAUDE, 'claude.max-20x'));
  await putRecord(page, 'items', item(NETFLIX, 'netflix.standard'));
  const [settings] = await readTable(page, 'settings');
  await putRecord(page, 'settings', {
    ...settings,
    planNotices: [
      {
        kind: 'renamed',
        planId: 'claude.max-20x',
        title: 'Claude Max 20x',
        name: 'Ultra',
        date: '2026-10-30',
      },
      {
        kind: 'ends',
        planId: 'netflix.standard',
        title: 'Netflix Standard',
        on: '2027-03-01',
        date: '2026-10-30',
      },
    ],
  });
}

/** Netflix Standard retired, ending for its subscribers on Mar 1, in whatever catalog file is asked for. */
async function retireNetflixStandard(context) {
  await context.route(/\/data\/catalog(\/[A-Z]+)?\.json$/, async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    for (const provider of snapshot.data.providers) {
      for (const plan of provider.plans) {
        if (plan.id === 'netflix.standard')
          Object.assign(plan, { retired: '2026-10-01', endsOn: '2027-03-01' });
      }
    }
    await route.fulfill({ response, json: snapshot });
  });
}

const textOf = (locator) => locator.innerText().then((text) => text.replace(/\s+/g, ' ').trim());

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const context = await browser.newContext({ locale: 'en-CA', colorScheme, viewport });
  await context.route('**/api/v1/fx?**', (route) => route.fulfill({ json: rates }));
  await retireNetflixStandard(context);
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

    // List view's cards.
    await page.goto(`${baseUrl}lists/${LIST}`);
    const cards = page.locator('ss-item-card');
    await until(
      'both cards, one retired',
      async () =>
        (await cards.count()) === 2 && (await page.locator('ss-item-card .retired').count()) === 1,
      30000,
    );
    const claude = cards.filter({ hasText: 'Ultra' });
    const claudeLine = await textOf(claude.locator('.plan-name'));
    check(
      `${label}: List view says Ultra (formerly Max 20x)`,
      claudeLine === 'Ultra (formerly Max 20x)',
      claudeLine,
    );
    const retired = await textOf(page.locator('ss-item-card .retired span'));
    check(
      `${label}: Netflix Standard's card says it isn't sold and when it ends`,
      retired ===
        'Netflix no longer sells Standard to new subscribers. It ends for its subscribers on Mar 1, 2027.',
      retired,
    );
    await page.screenshot({ path: shot('list-view'), fullPage: true });
    await axeCheck(page, `${label}: List view`);
    await noSideScroll(page, viewport, `${label} List view`);

    // Home's notices.
    await page.goto(baseUrl);
    const changes = page.locator('.changes');
    await changes.waitFor({ timeout: 20000 });
    const lines = await changes
      .locator('li')
      .evaluateAll((items) => items.map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
    check(
      `${label}: Home's Plan changes`,
      (await textOf(changes.locator('h2'))) === 'Plan changes' &&
        lines.join('|') ===
          'Claude Max 20x is now called Ultra Oct 30|Netflix Standard ends for its subscribers on Mar 1, 2027 Oct 30',
      lines.join('|'),
    );
    await changes.scrollIntoViewIfNeeded();
    await changes.screenshot({ path: shot('home-changes') });
    await axeCheck(page, `${label}: Home`);
    await noSideScroll(page, viewport, `${label} Home`);

    // Search: Claude's card on Ultra, found by its old name; Netflix Standard never offered.
    await page.goto(`${baseUrl}search?q=max%2020x`);
    const claudeCard = page.locator('ss-sub-card', { hasText: 'Claude' }).first();
    await claudeCard.waitFor({ timeout: 20000 });
    const planLine = await textOf(claudeCard.locator('.plan-name'));
    check(
      `${label}: Search finds "max 20x" as Ultra (formerly Max 20x)`,
      planLine === 'Ultra (formerly Max 20x)',
      planLine,
    );
    await claudeCard.screenshot({ path: shot('search-claude') });
    await axeCheck(page, `${label}: Search`);
    await noSideScroll(page, viewport, `${label} Search`);
    await page.goto(`${baseUrl}search?q=netflix`);
    const netflixCard = page.locator('ss-sub-card', { hasText: 'Netflix' }).first();
    await netflixCard.waitFor({ timeout: 20000 });
    const chips = (await netflixCard.locator('.plans .chip').allInnerTexts()).map((chip) =>
      chip.replace('check', '').trim(),
    );
    check(
      `${label}: Search offers no Netflix Standard`,
      chips.length > 0 && !chips.includes('Standard'),
      chips.join(', '),
    );

    // Optimizations: Plans that end, by keyboard.
    await page.goto(`${baseUrl}lists/${LIST}/optimize`);
    const endings = page.locator('section.endings');
    await endings.waitFor({ timeout: 30000 });
    const intro = await textOf(endings.locator('li.ending > p'));
    const plans = (await endings.locator('.plans a').allInnerTexts()).map((plan) => plan.trim());
    check(
      `${label}: Optimizations lists plans that keep Netflix Standard's Needed keys`,
      intro ===
        'Netflix Standard ends for its subscribers on Mar 1, 2027. These keep everything you rank Needed, cheapest first:' &&
        plans.length > 0 &&
        !plans.includes('Netflix Standard'),
      `${intro} / ${plans.join(', ')}`,
    );
    await endings.screenshot({ path: shot('endings') });
    await axeCheck(page, `${label}: Optimizations`);
    await noSideScroll(page, viewport, `${label} Optimizations`);
    await page.locator('main').focus();
    await tabTo(page, plans[0]);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/search\?/);
    check(`${label}: Enter on a plan opens it in Search`, page.url().includes('plan='), page.url());
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
