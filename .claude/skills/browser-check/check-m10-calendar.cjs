// M10's Calendar batch in the system Edge, on `ng serve` with `wrangler dev` behind its proxy (the live calendar's
// /api/v1/cal on the local user database, migrated with `npm -w apps/api run db:user:migrate:local`), for a Canadian in
// Alberta with Work Related (Netflix Standard on the 12th, tagged Family; Crave Premium billed on the 31st) and Family
// (Mullvad VPN, yearly on Jan 20, renewed by hand).
// In both themes at 1280 and 360 px, keyboard only:
// - M10.3, the live calendar: Sync calendar's menu (Live calendar… first, then each app's file); the dialog, focus on
//   its title, saying what's uploaded and who can see it; Family chosen with Space, Make links with Enter; then each
//   calendar's link, which the Worker serves with only its own payments (amounts as charged, Crave's rule on each
//   month's last day), Copy link putting it on the clipboard and saying so, Google's add page and Apple's webcal://
//   link, each app's steps opening with Enter; Escape back to Sync calendar. Settings' Live calendar card says it's on
//   and opens the dialog. Light and wide also: a change saved while the app was closed reaches the feed on the next
//   start, Change calendars, and Revoke all (asking first), after which every link answers 404.
// - M10.4, the year view: Year by Enter (pressed, in the URL); the year's bar; twelve month cards, each a link named
//   with all it shows, reached in order by Tab after the year's controls (no month to choose, the arrows by year);
//   Enter on March opens its month with focus on its grid; Month goes back.
// With axe on each view of the dialog, on the confirmation and on the year, and no horizontal scroll.
// Usage: node check-m10-calendar.cjs <deps dir with playwright-core + axe-core> <output dir> <base url ending in />
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
/** The menu that's open, not one still fading out. */
const OPEN_MENU = '.mat-mdc-menu-panel:not(.mat-menu-panel-exit-animation)';
const DIALOG = 'ss-live-calendar-dialog';
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
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  // GET /fx, answered with fixed rates; the live calendar's requests go on to the Worker.
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
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return { context, page };
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

async function axeCheck(page, label) {
  await sleep(600);
  await page.evaluate(axeSource);
  const result = await page.evaluate(() => axe.run(document));
  // Material renders menus and dialogs outside the page's landmarks: set aside `region` hits inside its overlays, and
  // contrast hits on text under an open popup.
  const hidden = await page.evaluate(
    (targets) =>
      targets.map((target) => {
        const element = document.querySelector(target);
        if (!element) return false;
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return (
          (top?.closest('.cdk-overlay-pane, .cdk-overlay-backdrop') ?? null) !== null &&
          !element.closest('.cdk-overlay-pane')
        );
      }),
    (result.violations.find((violation) => violation.id === 'color-contrast')?.nodes ?? []).map(
      (node) => node.target.join(' '),
    ),
  );
  const inOverlay = await page.evaluate(
    (targets) =>
      targets.map(
        (target) => document.querySelector(target)?.closest('.cdk-overlay-container') != null,
      ),
    (result.violations.find((violation) => violation.id === 'region')?.nodes ?? []).map((node) =>
      node.target.join(' '),
    ),
  );
  const violations = result.violations
    .map((violation) =>
      violation.id === 'color-contrast'
        ? { ...violation, nodes: violation.nodes.filter((_, index) => !hidden[index]) }
        : violation,
    )
    .filter(
      (violation) =>
        violation.nodes.length > 0 &&
        (violation.id !== 'region' || !violation.nodes.every((_, index) => inOverlay[index])),
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

/** Presses `key` (Tab by default) until `isThere` holds for the focused element. */
async function keyTo(page, isThere, key = 'Tab', limit = 120) {
  let presses = 0;
  while (presses < limit && !(await page.evaluate(isThere))) {
    await page.keyboard.press(key);
    presses++;
  }
  if (!(await page.evaluate(isThere))) throw new Error(`Never reached: ${isThere}`);
}

/** Tabs to the element `selector` names. */
function tabTo(page, selector) {
  return keyTo(page, `document.activeElement?.matches(${JSON.stringify(selector)}) ?? false`);
}

/** Tabs to the focusable whose accessible text, or aria-label, is `name`. */
function tabToNamed(page, name) {
  return keyTo(
    page,
    `(() => { const active = document.activeElement; if (!active) return false;
      const label = active.getAttribute('aria-label') ?? active.closest('label, mat-checkbox, mat-radio-button')?.textContent ?? active.textContent;
      return label.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(name)}; })()`,
  );
}

const focusedOn = (page, selector) =>
  page.evaluate((target) => document.activeElement?.matches(target) ?? false, selector);

const WORK = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
const FAMILY = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e';
const FAMILY_TAG = '0192f1c7-3e4f-7051-ac6d-7e8f9a0b1c2d';
const NETFLIX = '0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a00';
const stamps = { createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:00:00.000Z' };
const monthly = (anchorDate) => ({
  mode: 'recurring',
  interval: 'month',
  intervalCount: 1,
  anchorDate,
  autoRenew: true,
});
const items = [
  [WORK, 'netflix.standard', monthly('2026-11-12'), [FAMILY_TAG]],
  [WORK, 'crave.premium', monthly('2026-01-31'), []],
  [
    FAMILY,
    'mullvad.vpn',
    {
      mode: 'recurring',
      interval: 'year',
      intervalCount: 1,
      anchorDate: '2027-01-20',
      autoRenew: false,
    },
    [],
  ],
];

function item(index, extra = {}) {
  const [listId, planId, billing, tagIds] = items[index];
  return {
    id: `0192f1c5-1c2d-7e3f-8a4b-5c6d7e8f9a0${index}`,
    listId,
    source: { kind: 'catalog', planId },
    billing,
    tagIds,
    rankOverrides: {},
    pinned: false,
    ...stamps,
    ...extra,
  };
}

async function plant(page) {
  await putRecord(page, 'lists', { id: WORK, name: 'Work Related', ...stamps });
  await putRecord(page, 'lists', { id: FAMILY, name: 'Family', ...stamps });
  await putRecord(page, 'tags', { id: FAMILY_TAG, name: 'Family', color: '#1e88e5', ...stamps });
  for (const index of items.keys()) await putRecord(page, 'items', item(index));
}

/** A feed's events as the Worker serves them: each SUMMARY and RRULE, unfolded; or its status when it isn't 200. */
async function feed(url) {
  const answer = await fetch(url);
  if (answer.status !== 200) return answer.status;
  const text = (await answer.text()).replace(/\r\n[ \t]/g, '');
  return [...text.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map(([, body]) =>
    [/SUMMARY:(.*)/.exec(body)?.[1], /RRULE:(.*)/.exec(body)?.[1]].filter(Boolean).join(' / '),
  );
}

/** Sync calendar's menu by keyboard, then Live calendar…: the dialog, focus on its title. */
async function openFromCalendar(page, label) {
  await page.goto(`${baseUrl}calendar`);
  await page.locator('button.sync').waitFor();
  await tabTo(page, 'button.sync');
  await page.keyboard.press('Enter');
  await page.locator(OPEN_MENU).waitFor();
  const choices = await page.locator(`${OPEN_MENU} .mat-mdc-menu-item-text`).allInnerTexts();
  check(
    `${label}: Sync calendar offers the live calendar, then each app's file`,
    choices.map((choice) => choice.trim()).join(' | ') ===
      'Live calendar… | Google Calendar file | Apple Calendar file | Proton Calendar file',
    choices.join(' | '),
  );
  await until('focus on the menu’s first item', () =>
    page.evaluate(() => document.activeElement?.matches('[mat-menu-item]') ?? false),
  );
  await page.keyboard.press('Enter');
  await page.locator(DIALOG).waitFor();
  return until('focus on the dialog’s title', () => focusedOn(page, `${DIALOG} h2`)).then(
    () => true,
    () => false,
  );
}

async function liveCalendar(page, viewport, label, everything) {
  const titled = await openFromCalendar(page, label);
  const intro = await page.locator(DIALOG).innerText();
  check(
    `${label}: the dialog opens on its title, saying what's uploaded and who can see it`,
    titled &&
      intro.includes('each payment’s name, amount, date and how it repeats') &&
      intro.includes('Anyone with a link can see that calendar.'),
  );
  await axeCheck(page, `${label}: Live calendar, choosing`);
  await page.screenshot({ path: path.join(outDir, `m10-live-choose-${label}.png`) });
  await noSideScroll(page, viewport, `${label}: Live calendar, choosing`);

  await tabToNamed(page, 'Family');
  await page.keyboard.press('Space');
  const chosen = await page.evaluate(
    (dialog) =>
      [...document.querySelectorAll(`${dialog} fieldset:first-of-type mat-checkbox`)].map(
        (box) => `${box.textContent.trim()}: ${box.querySelector('input').checked}`,
      ),
    DIALOG,
  );
  check(
    `${label}: Space chooses Family beside Everything`,
    chosen.join(', ') === 'Everything: true, Family: true, Payments without a tag: false',
    chosen.join(', '),
  );
  await tabToNamed(page, 'Make links');
  await page.keyboard.press('Enter');
  await page.locator(`${DIALOG} .calendars > li`).nth(1).waitFor({ timeout: 20000 });
  const linksTitled = await until('focus on the title', () => focusedOn(page, `${DIALOG} h2`)).then(
    () => true,
    () => false,
  );
  const urls = await page.locator(`${DIALOG} .link`).allInnerTexts();
  const served = await Promise.all(urls.map((url) => feed(url.trim())));
  check(
    `${label}: Make links lists both calendars, focus on the title, and each serves only its own payments`,
    linksTitled &&
      JSON.stringify(served) ===
        JSON.stringify([
          [
            'Crave: $23.10 / FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1',
            'Netflix: $19.94 / FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12',
            'Renew Mullvad VPN: €60.00 / FREQ=YEARLY;INTERVAL=1;BYMONTH=1;BYMONTHDAY=20',
          ],
          ['Netflix: $19.94 / FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12'],
        ]),
    JSON.stringify(served),
  );
  const [google, apple] = await Promise.all(
    ['Add to Google Calendar: Family, opens in a new tab', 'Add to Apple Calendar: Family'].map(
      (name) => page.locator(`${DIALOG} a[aria-label="${name}"]`).getAttribute('href'),
    ),
  );
  const webcal = urls[1].trim().replace(/^https?:/, 'webcal:');
  check(
    `${label}: Family's Google and Apple links`,
    google === `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` &&
      apple === webcal,
    `${google} / ${apple}`,
  );
  await axeCheck(page, `${label}: Live calendar, links`);
  await page.screenshot({ path: path.join(outDir, `m10-live-links-${label}.png`) });
  await noSideScroll(page, viewport, `${label}: Live calendar, links`);

  await tabToNamed(page, 'Copy link: Everything');
  await page.keyboard.press('Enter');
  const said = await until('the copied message', async () => {
    const text = await page.locator(`${DIALOG} p.visually-hidden[role="status"]`).innerText();
    return text.startsWith('Copied') ? text : undefined;
  }).catch(() => '');
  const clipboard = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(
    `${label}: Copy link puts Everything's link on the clipboard and says so`,
    clipboard === urls[0].trim() && said === 'Copied the link for Everything.',
    `${clipboard} / ${said}`,
  );

  await tabTo(page, `${DIALOG} details:first-of-type summary`);
  await page.keyboard.press('Enter');
  const opened = await page.locator(`${DIALOG} details:first-of-type`).getAttribute('open');
  const protonSteps = await page.locator(`${DIALOG} details:first-of-type li`).count();
  check(`${label}: Enter opens Proton Calendar's steps`, opened !== null && protonSteps === 3);
  if (everything) await axeCheck(page, `${label}: Live calendar, Proton's steps open`);

  await page.keyboard.press('Escape');
  await page.locator(DIALOG).waitFor({ state: 'detached' });
  const back = await until('focus back on Sync calendar', () =>
    focusedOn(page, 'button.sync'),
  ).then(
    () => true,
    () => false,
  );
  check(`${label}: Escape closes it, focus back on Sync calendar`, back);
  return urls.map((url) => url.trim());
}

async function settingsCard(page, label) {
  await page.goto(`${baseUrl}settings`);
  const card = page.locator('section.card', { has: page.locator('#live-calendar-heading') });
  await card.waitFor();
  const line = (await card.locator('.hint').innerText()).trim();
  const jump = await page.locator('nav.jump a', { hasText: 'Live calendar' }).count();
  check(
    `${label}: Settings has Live calendar, on with 2 calendars, in On this page`,
    /^On: 2 calendars, last sent [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/.test(line) && jump === 1,
    line,
  );
  await tabToNamed(page, 'Manage…');
  await page.keyboard.press('Enter');
  await page.locator(DIALOG).waitFor();
  const links = await page.locator(`${DIALOG} .calendars > li`).count();
  check(`${label}: Manage… opens the dialog with the links`, links === 2);
  await page.keyboard.press('Escape');
  await page.locator(DIALOG).waitFor({ state: 'detached' });
}

/** Light and wide: a change saved while the app was closed reaches the feed when it starts again. */
async function updates(page, urls) {
  await putRecord(
    page,
    'items',
    item(0, { nickname: 'Movies', updatedAt: '2026-10-29T12:00:00.000Z' }),
  );
  await page.reload();
  // Every 2 s: a feed takes 30 fetches a minute.
  let served;
  for (let tries = 0; tries < 15 && served === undefined; tries++) {
    await sleep(2000);
    const events = await feed(urls[1]);
    if (Array.isArray(events) && events[0]?.startsWith('Movies: $19.94')) served = events;
  }
  check(
    'light wide: a change reaches the feed on the next start, at the same link',
    served !== undefined,
  );
}

/** Light and wide: Change calendars, then Revoke all, asking first; every link answers 404 after. */
async function changeAndRevoke(page, urls) {
  await openFromCalendar(page, 'light wide, again');
  await tabToNamed(page, 'Change calendars');
  await page.keyboard.press('Enter');
  await until(
    'the choosing view',
    async () =>
      (await page.locator(`${DIALOG} h2`).innerText()).trim() === 'Change your live calendar',
  );
  await tabToNamed(page, 'Payments without a tag');
  await page.keyboard.press('Space');
  await tabToNamed(page, 'Save changes');
  await page.keyboard.press('Enter');
  await page.locator(`${DIALOG} .calendars > li`).nth(2).waitFor({ timeout: 20000 });
  const now = await page.locator(`${DIALOG} .link`).allInnerTexts();
  check(
    'light wide: Change calendars adds one, and the others keep their links',
    now[0].trim() === urls[0] && now[1].trim() === urls[1] && now.length === 3,
    now.join(' | '),
  );

  await tabToNamed(page, 'Revoke all…');
  await page.keyboard.press('Enter');
  const confirm = page.locator('ss-confirm-dialog');
  await confirm.waitFor();
  const onCancel = await until('focus on Cancel', () =>
    page.evaluate(() => document.activeElement?.textContent?.trim() === 'Cancel'),
  ).catch(() => false);
  check('light wide: Revoke all asks first, focus on Cancel', onCancel);
  await axeCheck(page, 'light wide: Revoke all, asking');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  // The links' title is Live calendar too: the choosing view's Make links says the revoke is done.
  await page.locator(`${DIALOG} button[type="submit"]`, { hasText: 'Make links' }).waitFor();
  const statuses = await Promise.all(now.map((url) => feed(url.trim())));
  check(
    'light wide: after Revoke all, every link answers 404',
    statuses.every((status) => status === 404),
    JSON.stringify(statuses),
  );
  await page.keyboard.press('Escape');
}

async function yearView(page, viewport, label) {
  await page.goto(`${baseUrl}calendar`);
  await page.locator('.views button').first().waitFor();
  await tabToNamed(page, 'Year');
  await page.keyboard.press('Enter');
  await page.waitForURL(/view=year/);
  await page.locator('ss-calendar-year .month').nth(11).waitFor();
  const pressed = await page.evaluate(() =>
    [...document.querySelectorAll('.views button')].map(
      (button) => `${button.textContent.trim()}: ${button.getAttribute('aria-pressed')}`,
    ),
  );
  const year = new Date().getFullYear();
  const barName = await page.locator('.month-bar ss-budget-bar').getAttribute('aria-label');
  check(
    `${label}: Year by Enter: pressed, in the URL, with the year's bar and twelve months`,
    pressed.join(', ') === 'Month: false, Year: true' && barName === `Paid so far in ${year}`,
    `${pressed.join(', ')} / ${barName}`,
  );
  const names = await page
    .locator('ss-calendar-year .month a')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')));
  check(
    `${label}: each month is a link named with what it shows`,
    names.length === 12 &&
      names[0].startsWith(`January ${year}, `) &&
      names.every((name) =>
        /^[A-Z][a-z]+ \d{4}, (No payments|\d+ payments?, (about )?\$[\d,.]+)/.test(name),
      ),
    names.slice(0, 2).join(' / '),
  );
  const controls = await page.evaluate(() => ({
    month: document.querySelector('mat-form-field.month') !== null,
    next: document.querySelector('button[aria-label="Next year"]') !== null,
  }));
  check(
    `${label}: no month to choose, and the arrows go by year`,
    !controls.month && controls.next,
  );
  // Tab from Next year reaches January, then February (since M10.20 Today comes before the arrows).
  await tabToNamed(page, 'Next year');
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  await page.keyboard.press('Tab');
  const second = await page.evaluate(
    () => document.activeElement?.getAttribute('aria-label') ?? '',
  );
  check(
    `${label}: Tab goes from Next year to January, then February`,
    first.startsWith('January') && second.startsWith('February'),
    `${first} / ${second}`,
  );
  await axeCheck(page, `${label}: the year view`);
  await page.screenshot({ path: path.join(outDir, `m10-year-${label}.png`), fullPage: true });
  await noSideScroll(page, viewport, `${label}: the year view`);

  await keyTo(
    page,
    `document.activeElement?.getAttribute('aria-label')?.startsWith('March') ?? false`,
  );
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`month=${year}-03(?!.*view)`));
  const focused = await until('focus on March’s grid', () =>
    page.evaluate(() =>
      document.activeElement?.closest('.grid')?.querySelector('.day')
        ? document.activeElement.getAttribute('data-date')
        : '',
    ),
  ).catch(() => '');
  check(
    `${label}: Enter on March opens it, focus on its grid`,
    focused.startsWith(`${year}-03-`),
    focused,
  );
  await tabToNamed(page, 'Year');
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`month=${year}-03.*view=year`));
  await tabToNamed(page, 'Month');
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`month=${year}-03$`));
  check(`${label}: Month goes back to the month the year view was opened on`, true);
}

(async () => {
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const colorScheme of ['light', 'dark']) {
    for (const [viewport, width] of [
      [WIDE, 'wide'],
      [NARROW, 'narrow'],
    ]) {
      const label = `${colorScheme} ${width}`;
      const everything = colorScheme === 'light' && width === 'wide';
      const { context, page } = await newPage(browser, label, { colorScheme, viewport });
      await firstRun(page);
      await plant(page);
      await page.reload();
      const urls = await liveCalendar(page, viewport, label, everything);
      await settingsCard(page, label);
      await yearView(page, viewport, label);
      if (everything) {
        await updates(page, urls);
        await changeAndRevoke(page, urls);
      }
      await context.close();
    }
  }
  await browser.close();

  check('no console errors or warnings', consoleProblems.length === 0, consoleProblems.join(' | '));
  const failed = checks.filter((ok) => !ok).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
