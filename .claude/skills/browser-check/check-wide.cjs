// The owner's 21:9 feedback (2026-11-19): screenshots of every page at desktop widths up to 3440 px (2560 in the dark
// theme), for a Canadian in Alberta with three lists (eight subscriptions in the first), with an overflow check at each.
// Look at the screenshots: the pages of cards should fill the width with their cards in columns, and 1280 px look
// as it did.
// Usage: node check-wide.cjs <deps dir> <out dir> <base url ending in /> [widths, comma separated]
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl, widthArg] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const LISTS = [
  ['0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d', 'Work Related'],
  ['0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e', 'Family'],
  ['0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4f', 'Kids'],
];
const PLANS = [
  [0, 'netflix.standard'],
  [0, 'mullvad.vpn'],
  [0, 'spotify.premium'],
  [0, 'disney-plus.standard'],
  [0, 'crave.premium'],
  [0, 'apple-music.individual'],
  [0, 'chatgpt.plus'],
  [0, 'microsoft-365.family'],
  [1, 'spotify.duo'],
  [1, 'netflix.standard'],
  [2, 'disney-plus.standard'],
];

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
  await page.getByRole('option', { name: 'Alberta', exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog.waitFor({ state: 'detached' });
}

function overflow(page) {
  return page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    main: Math.round(document.querySelector('main')?.getBoundingClientRect().width ?? 0),
    page: (() => {
      const host = document.querySelector('main router-outlet + *');
      if (!host) return '';
      const box = host.getBoundingClientRect();
      return `${host.tagName.toLowerCase()} ${Math.round(box.left)}–${Math.round(box.right)}`;
    })(),
  }));
}

const pages = [
  ['home', ''],
  ['search', 'search'],
  [
    'search-open',
    'search?q=mullvad',
    (page) => page.getByRole('button', { name: 'Details: Mullvad VPN' }).click(),
  ],
  ['lists', 'lists'],
  ['list-view', `lists/${LISTS[0][0]}`],
  [
    'list-view-open',
    `lists/${LISTS[0][0]}`,
    (page) => page.locator('ss-item-card .expand').first().click(),
  ],
  ['list-edit', `lists/${LISTS[0][0]}/edit`],
  ['features', 'features'],
  ['custom', 'custom'],
  ['settings', 'settings'],
  ['calendar', 'calendar'],
  ['calendar-year', 'calendar?view=year'],
  ['payment', 'payment'],
];

const sizes = { 1280: 800, 1920: 1080, 2560: 1080, 3440: 1440 };

(async () => {
  await waitForServer();
  const widths = widthArg ? widthArg.split(',').map(Number) : [1280, 1920, 2560, 3440];
  const browser = await chromium.launch({
    channel: 'msedge',
    ignoreDefaultArgs: ['--hide-scrollbars'],
  });
  let failures = 0;
  for (const width of widths) {
    const context = await browser.newContext({
      locale: 'en-CA',
      colorScheme: width === 2560 ? 'dark' : 'light',
      viewport: { width, height: sizes[width] ?? 1080 },
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
    page.on('pageerror', (error) => console.log(`[${width}] pageerror: ${error.message}`));
    await firstRun(page);
    const billing = {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    };
    const records = LISTS.map(([id, name]) => ['lists', { id, name, ...stamps }]);
    PLANS.forEach(([list, planId], index) => {
      records.push([
        'items',
        {
          id: `0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a${String(index).padStart(2, '0')}`,
          listId: LISTS[list][0],
          source: { kind: 'catalog', planId },
          billing: { ...billing, anchorDate: `2026-11-${String(3 + index * 2).padStart(2, '0')}` },
          tagIds: [],
          rankOverrides: {},
          pinned: index === 1,
          ...stamps,
        },
      ]);
    });
    await putRecords(page, records);
    for (const [label, url, open] of pages) {
      await page.goto(baseUrl + url);
      await page.locator('main h1, mat-dialog-container').first().waitFor({ timeout: 20000 });
      await sleep(1500);
      if (open) {
        await open(page);
        await sleep(1000);
      }
      const result = await overflow(page);
      const ok = result.scrollWidth <= result.width;
      if (!ok) failures++;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${width} ${label}: page ${result.scrollWidth}/${result.width}, main ${result.main}, ${result.page}`,
      );
      await page.screenshot({ path: path.join(outDir, `${width}-${label}.png`) });
    }
    await context.close();
  }
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
