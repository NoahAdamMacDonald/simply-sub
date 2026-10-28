// The feedback after M6.8 in the system Edge: no page scrolls sideways at phone widths. Every page at 320, 360 and
// 390 px, with the browser's scrollbars shown (headless Chromium hides them, which hid any width that counts on
// them), for a Canadian in Alberta with Work Related (Netflix Standard tagged Family, and Mullvad VPN, pinned) written
// to IndexedDB: Home, Search (its filters drawer and Mullvad's details open), Lists, List view (its Sort menu and a
// card's details open), the list editor, a new list, the item dialog, Features, Custom subscriptions (its editor
// open), Settings, Calendar and Payment. Each has to fit the page's width; a failure names what sticks out.
// Usage: node check-overflow.cjs <deps dir with playwright-core> <output dir> <base url ending in />
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
fs.mkdirSync(outDir, { recursive: true });

const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0b';
const TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

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

/** Writes records straight to IndexedDB, in one transaction. */
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

/**
 * The page's width and scroll width, the outermost elements past its right edge, and any element that scrolls sideways
 * itself (a dialog's content, a panel).
 */
function overflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const past = [];
    for (const element of document.querySelectorAll('body *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.right <= width + 0.5) continue;
      if (getComputedStyle(element).position === 'fixed') continue;
      if (past.some((outer) => outer.contains(element))) continue;
      past.push(element);
    }
    const scrollers = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const { overflowX } = getComputedStyle(element);
        return (
          (overflowX === 'auto' || overflowX === 'scroll') &&
          element.scrollWidth > element.clientWidth + 1
        );
      })
      .map(
        (element) => `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}`,
      );
    return {
      width,
      scrollers,
      scrollWidth: document.documentElement.scrollWidth,
      past: past.slice(0, 4).map((element) => {
        const classes = String(element.className).split(' ').filter(Boolean).slice(0, 2).join('.');
        return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''} to ${Math.round(element.getBoundingClientRect().right)}px`;
      }),
    };
  });
}

/** Each page, and what to open on it before measuring. */
const pages = [
  ['Home', ''],
  [
    'Search, filters open',
    'search',
    (page) => page.getByRole('button', { name: /^Filters/ }).click(),
  ],
  [
    'Search, Mullvad open',
    'search?q=mullvad',
    (page) => page.getByRole('button', { name: 'Details: Mullvad VPN' }).click(),
  ],
  ['Lists', 'lists'],
  [
    'List view, Sort open',
    `lists/${LIST}`,
    async (page) => {
      await page.locator('.filters-toggle').click();
      await page.locator('ss-item-card .expand').first().click();
    },
  ],
  ['the list editor', `lists/${LIST}/edit`],
  ['a new list', 'lists/new'],
  ['the item dialog', `lists/${LIST}/edit?item=${NETFLIX}`],
  ['Features', 'features'],
  [
    'Custom subscriptions, editor open',
    'custom',
    (page) => page.getByRole('button', { name: /New custom subscription/ }).click(),
  ],
  ['Settings', 'settings'],
  ['Calendar', 'calendar'],
  ['Payment', 'payment'],
];

(async () => {
  await waitForServer();
  // Scrollbars shown: they take width from the page, as a desktop browser's do.
  const browser = await chromium.launch({
    channel: 'msedge',
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  for (const width of [320, 360, 390]) {
    const colorScheme = width === 360 ? 'dark' : 'light';
    const context = await browser.newContext({
      locale: 'en-CA',
      colorScheme,
      viewport: { width, height: 740 },
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
    page.on('pageerror', (error) => consoleProblems.push(`[${width}] pageerror: ${error.message}`));
    await firstRun(page);
    const billing = {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    };
    const item = (id, planId, extra) => ({
      id,
      listId: LIST,
      source: { kind: 'catalog', planId },
      billing,
      tagIds: [],
      rankOverrides: {},
      pinned: false,
      ...stamps,
      ...extra,
    });
    await putRecords(page, [
      ['tags', { id: TAG, name: 'Family', color: '#1e88e5', ...stamps }],
      ['lists', { id: LIST, name: 'Work Related', ...stamps }],
      ['items', item(NETFLIX, 'netflix.standard', { tagIds: [TAG] })],
      [
        'items',
        item('0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0c', 'mullvad.vpn', {
          billing: { ...billing, autoRenew: false },
          pinned: true,
        }),
      ],
    ]);
    for (const [label, url, open] of pages) {
      await page.goto(baseUrl + url);
      await page.locator('main h1, mat-dialog-container').first().waitFor({ timeout: 20000 });
      await sleep(1200);
      if (open) {
        await open(page);
        await sleep(900);
      }
      const result = await overflow(page);
      const fits = result.scrollWidth <= result.width && result.scrollers.length === 0;
      check(
        `${width} px, ${label}: nothing past the page's width, and nothing in it scrolls sideways`,
        fits,
        `${result.scrollWidth} of ${result.width}px${result.past.length ? `; ${result.past.join(', ')}` : ''}${
          result.scrollers.length ? `; scrolls sideways: ${result.scrollers.join(', ')}` : ''
        }`,
      );
      if (!fits) {
        await page.screenshot({
          path: path.join(outDir, `overflow-${width}-${label.replace(/\W+/g, '-')}.png`),
        });
      }
    }
    await context.close();
  }
  await browser.close();
  check('no page errors', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
