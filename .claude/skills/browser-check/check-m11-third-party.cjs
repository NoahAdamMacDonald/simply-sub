// M11.16 in the system Edge: third-party values, on the real catalog (data:build's files) with CA.json answered so
// Netflix Standard with ads' download devices come from a publication, in both themes at 1280 and 360 px, for a
// Canadian in Alberta. Search's Netflix details mark the value "third-party", linking the publication in a new tab,
// named for it and its words; Tab reaches it and its tooltip quotes them. Optimizations for Streaming (Netflix
// Standard, written to IndexedDB) shows the downgrade to Standard with ads resting on the claim, its publisher linked
// and reached by Tab. Settings' "Use third-party claims", on by default, is turned off by Space (skipThirdParty in
// IndexedDB), and then neither the mark, the value nor the note is there. List view's card for Standard with ads (a
// list of its own, so Streaming's suggestions stay as they are) marks the value the same way, and drops it with the
// setting off. Light and wide only: the "Nothing will be
// saved" notice, a chunk of its own since M11.16, shows when IndexedDB is blocked. With axe, screenshots and no
// horizontal scroll. GET /fx is answered with fixed rates.
// Usage: node check-m11-third-party.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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

const LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4f';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a2b';
const ADS_LIST = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c50';
const ADS = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a2c';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };

/** The claim CA.json is answered with: no catalog plan has one yet. */
const claim = {
  publisher: 'The Verge',
  url: 'https://www.theverge.com/netflix-ads-plan-downloads',
  quote: 'The ads plan now lets you download on two devices.',
  lastVerified: '2026-11-01',
};

const cadRates = { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 };
function fxBody(base) {
  const perCad = (currency) => (currency === 'CAD' ? 1 : cadRates[currency]);
  const rates = Object.fromEntries(
    ['CAD', ...Object.keys(cadRates)]
      .filter((currency) => currency !== base)
      .map((currency) => [currency, Number((perCad(currency) / perCad(base)).toPrecision(6))]),
  );
  return {
    data: { base, date: '2026-10-26', source: 'European Central Bank via Frankfurter', rates },
    meta: { fetchedAt: '2026-10-26T06:00:02Z', stale: false },
  };
}

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

async function newContext(browser, { colorScheme, viewport }) {
  const context = await browser.newContext({
    locale: 'en-CA',
    colorScheme,
    viewport,
    serviceWorkers: 'block',
  });
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  await context.route('**/data/catalog/CA.json', async (route) => {
    const response = await route.fetch();
    const file = await response.json();
    const netflix = file.data.providers.find((provider) => provider.id === 'netflix');
    const ads = netflix.plans.find((plan) => plan.id === 'netflix.standard-ads');
    ads.thirdParty = { 'streaming.download-devices': claim };
    await route.fulfill({ json: file });
  });
  const page = await context.newPage();
  const label = `${colorScheme} ${viewport.width}`;
  page.on('console', (msg) => {
    const blockedWorker = msg.text() === 'Service Worker registration blocked by Playwright';
    if ((msg.type() === 'error' || msg.type() === 'warning') && !blockedWorker) {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
}

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

function idb(page, store, mode, value) {
  return page.evaluate(
    ([table, how, record]) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('simply-sub');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(table, how);
          const objects = transaction.objectStore(table);
          const result = how === 'readwrite' ? objects.put(record) : objects.getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve(how === 'readwrite' ? undefined : result.result);
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
    [store, mode, value],
  );
}
const readTable = (page, table) => idb(page, table, 'readonly');
const putRecord = (page, table, record) => idb(page, table, 'readwrite', record);

/** Netflix `planId`, billed monthly, in `listId`. */
function netflixItem(id, listId, planId) {
  return {
    id,
    listId,
    source: { kind: 'catalog', planId },
    billing: {
      mode: 'recurring',
      interval: 'month',
      intervalCount: 1,
      anchorDate: '2026-11-12',
      autoRenew: true,
    },
    tagIds: [],
    rankOverrides: {},
    pinned: false,
    ...stamps,
  };
}

/** Streaming: Netflix Standard. Ads: Netflix Standard with ads, for List view's card. */
async function plantList(page) {
  await putRecord(page, 'lists', { id: LIST, name: 'Streaming', ...stamps });
  await putRecord(page, 'items', netflixItem(NETFLIX, LIST, 'netflix.standard'));
  await putRecord(page, 'lists', { id: ADS_LIST, name: 'Ads', ...stamps });
  await putRecord(page, 'items', netflixItem(ADS, ADS_LIST, 'netflix.standard-ads'));
}

/** List view's card for Netflix Standard with ads, its details open: its download devices' line. */
async function adsCardLine(page) {
  await page.goto(`${baseUrl}lists/${ADS_LIST}`);
  const button = page.getByRole('button', {
    name: 'Details: Netflix Standard with ads',
    exact: true,
  });
  await button.waitFor({ timeout: 20000 });
  await button.click();
  const details = page.locator(`[data-item="${ADS}"] .details-content`);
  await details.waitFor();
  await sleep(600);
  return {
    button,
    details,
    line: details.locator('ss-feature-lines li .feature', { hasText: 'Download devices' }),
  };
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
  check(
    `axe: ${label}`,
    violations.length === 0,
    violations
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join(' | ')}`,
      )
      .join('; '),
  );
}

async function noSideways(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check(`${label}: no horizontal scroll`, !overflow);
}

/** Presses Tab until `target` has focus, at most `limit` times. */
async function tabTo(page, target, limit = 60) {
  for (let presses = 0; presses < limit; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return true;
    await page.keyboard.press('Tab');
    await sleep(40);
  }
  return target.evaluate((element) => element === document.activeElement);
}

/** Netflix's card on Search with its details open on Features. */
async function netflixFeatures(page) {
  await page.goto(`${baseUrl}search?q=netflix`);
  const card = page.locator('ss-sub-card', {
    has: page.getByRole('heading', { name: 'Netflix', exact: true }),
  });
  await card.waitFor({ timeout: 20000 });
  await card.scrollIntoViewIfNeeded();
  // Once the list has Netflix Standard, the card shows that plan first.
  await card.locator('label.chip', { hasText: 'Standard with ads' }).click();
  await card.locator('button.expand').click();
  await card.locator('ss-plan-details').waitFor();
  await card.getByRole('tab', { name: /^Features/ }).click();
  await sleep(1000);
  return card;
}

async function optimizations(page) {
  await page.goto(`${baseUrl}lists/${LIST}/optimize`);
  const card = page.locator('ss-suggestion-card', { hasText: 'Standard with ads' }).first();
  await card.waitFor({ timeout: 20000 });
  return card;
}

async function run(browser, colorScheme, viewport) {
  const label = `${colorScheme} ${viewport.width}`;
  const { context, page } = await newContext(browser, { colorScheme, viewport });
  try {
    await firstRun(page);

    // Search: the mark beside Standard with ads' download devices.
    let netflix = await netflixFeatures(page);
    const plan = (
      await netflix
        .locator('.plan-name, h3, h4')
        .first()
        .innerText()
        .catch(() => '')
    ).trim();
    const line = netflix.locator('ss-feature-lines li .feature', { hasText: 'Download devices' });
    const text = (await line.first().innerText()).replace(/\s+/g, ' ').trim();
    check(
      `${label}: Standard with ads' download devices are marked third-party`,
      /^Download devices: .+ third-party$/.test(text),
      `${plan} | ${text}`,
    );
    const link = line.first().locator('a.third-party');
    check(
      `${label}: the mark links the publication, in a new tab`,
      (await link.getAttribute('href')) === claim.url &&
        (await link.getAttribute('target')) === '_blank',
    );
    const name = await link.getAttribute('aria-label');
    check(
      `${label}: its name says whose words they are`,
      name === `Third-party, from The Verge (opens in a new tab): “${claim.quote}”`,
      name ?? '',
    );
    await netflix.locator('button.expand').focus();
    const reached = await tabTo(page, link);
    check(`${label}: Tab reaches the mark`, reached);
    if (reached) {
      const tooltip = page.locator('.mat-mdc-tooltip-surface', { hasText: 'The Verge' });
      await tooltip.waitFor({ timeout: 5000 }).catch(() => undefined);
      const words = (await tooltip.count()) ? await tooltip.first().innerText() : '';
      check(
        `${label}: its tooltip quotes the publication`,
        words === `“${claim.quote}” (The Verge)`,
        words,
      );
      await sleep(500);
    }
    await noSideways(page, `${label} Search`);
    await line.first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(outDir, `third-party-search-${colorScheme}-${viewport.width}.png`),
    });
    await axeCheck(page, `${label}, Netflix's features with the mark`);

    // Optimizations: the downgrade rests on the claim.
    await plantList(page);
    await page.reload();
    let suggestion = await optimizations(page);
    const notes = await suggestion
      .locator('p.features')
      .evaluateAll((paragraphs) =>
        paragraphs.map((paragraph) => paragraph.textContent.replace(/\s+/g, ' ').trim()),
      );
    const note = notes.find((line) => line.startsWith('Rests on third-party claims:')) ?? '';
    check(
      `${label}: the downgrade to Standard with ads rests on the claim`,
      /^Rests on third-party claims: Download devices.*, per The Verge$/.test(note),
      notes.join(' / '),
    );
    const publisher = suggestion.getByRole('link', { name: 'The Verge' });
    check(
      `${label}: its publisher links the page, in a new tab`,
      (await publisher.getAttribute('href')) === claim.url &&
        (await publisher.getAttribute('target')) === '_blank',
    );
    await page.locator('h1').first().click();
    check(`${label}: Tab reaches the publisher's link`, await tabTo(page, publisher, 120));
    await noSideways(page, `${label} Optimizations`);
    await suggestion.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(outDir, `third-party-card-${colorScheme}-${viewport.width}.png`),
    });
    await axeCheck(page, `${label}, the card with its note`);

    // List view: the item card marks the value too.
    let ads = await adsCardLine(page);
    const adsText = (await ads.line.first().innerText()).replace(/\s+/g, ' ').trim();
    check(
      `${label}: List view's card marks Standard with ads' download devices third-party`,
      /^Download devices: .+ third-party$/.test(adsText),
      adsText,
    );
    const adsLink = ads.line.first().locator('a.third-party');
    check(
      `${label}: the card's mark links the publication, in a new tab`,
      (await adsLink.getAttribute('href')) === claim.url &&
        (await adsLink.getAttribute('target')) === '_blank',
    );
    await ads.button.focus();
    check(`${label}: Tab reaches the card's mark`, await tabTo(page, adsLink));
    await noSideways(page, `${label} List view`);
    await ads.line.first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(outDir, `third-party-list-${colorScheme}-${viewport.width}.png`),
    });
    await axeCheck(page, `${label}, List view's card with the mark`);

    // Settings: the switch, on by default, turned off by Space.
    await page.goto(`${baseUrl}settings`);
    const box = page.locator('mat-checkbox', { hasText: 'Use third-party claims' });
    await box.waitFor({ timeout: 20000 });
    const input = box.locator('input');
    check(`${label}: Use third-party claims is on`, await input.isChecked());
    await page.locator('h1').first().click();
    const onBox = await tabTo(page, input, 120);
    check(`${label}: Tab reaches the switch`, onBox);
    await page.keyboard.press('Space');
    await sleep(500);
    const [settings] = await readTable(page, 'settings');
    check(
      `${label}: Space turns it off, saved as skipThirdParty`,
      !(await input.isChecked()) && settings?.skipThirdParty === true,
      JSON.stringify(settings?.skipThirdParty),
    );
    await noSideways(page, `${label} Settings`);
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(outDir, `third-party-settings-${colorScheme}-${viewport.width}.png`),
    });
    await axeCheck(page, `${label}, Settings' Catalog card`);

    // Off: no mark, no value, no note.
    suggestion = await optimizations(page);
    const after = (await suggestion.innerText()).replace(/\s+/g, ' ');
    check(`${label}: off, the card rests on no claim`, !after.includes('third-party'), after);
    netflix = await netflixFeatures(page);
    const marks = await netflix.locator('a.third-party').count();
    const lines = await netflix.locator('ss-feature-lines li .feature').allInnerTexts();
    check(
      `${label}: off, the card shows neither the mark nor the value`,
      marks === 0 && !lines.some((shown) => shown.startsWith('Download devices')),
      lines.join(' / '),
    );
    ads = await adsCardLine(page);
    const adsLines = await ads.details.locator('ss-feature-lines li .feature').allInnerTexts();
    check(
      `${label}: off, List view's card shows neither the mark nor the value`,
      (await ads.details.locator('a.third-party').count()) === 0 &&
        adsLines.length > 0 &&
        !adsLines.some((shown) => shown.startsWith('Download devices')),
      adsLines.join(' / '),
    );
  } finally {
    await context.close();
  }
}

/** The notice IndexedDB being blocked shows, loaded on demand since M11.16. */
async function blocked(browser) {
  const { context, page } = await newContext(browser, { colorScheme: 'light', viewport: WIDE });
  try {
    await context.addInitScript(() => {
      IDBFactory.prototype.open = () => {
        throw new DOMException('The user denied permission', 'SecurityError');
      };
    });
    await page.goto(baseUrl);
    const heading = page.getByRole('heading', { name: 'Nothing will be saved' });
    const shown = await heading
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check('blocked IndexedDB: "Nothing will be saved" shows', shown);
    await page.screenshot({ path: path.join(outDir, 'third-party-blocked-notice.png') });
    await axeCheck(page, 'the blocked notice');
    await page.getByRole('button', { name: 'Continue anyway' }).click();
    const inMemory = await page
      .getByText('Nothing is being saved: your browser is blocking local storage.')
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check('blocked IndexedDB: Continue anyway carries on in memory', inMemory);
  } finally {
    await context.close();
  }
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const colorScheme of ['light', 'dark']) {
      for (const viewport of [WIDE, NARROW]) {
        await run(browser, colorScheme, viewport);
      }
    }
    await blocked(browser);
  } finally {
    await browser.close();
  }
  // The blocked notice's console error (IndexedDB refused) is the app saying so, as check-settings.cjs allows.
  const problems = consoleProblems.filter((line) => !/blocked|SecurityError|denied/i.test(line));
  check('no console errors or warnings', problems.length === 0, problems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
