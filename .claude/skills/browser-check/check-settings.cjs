// M4.2 in the system Edge: the first-run dialog, Settings (budgets, Appearance, 📍), the theme in Dexie, and the
// "IndexedDB blocked" notice with in-memory mode, in both themes at 1280 and 360 px, by keyboard, with axe. Country,
// province or state, and Currency are menus you can type in (M6.16): the dialogs open on their heading, Tab reaches each
// menu, typing narrows its list and Enter picks the first; a click on the field opens its list for the mouse.
// See SKILL.md. Usage: node check-settings.cjs <deps dir with playwright-core + axe-core> <output dir> <base url>
const fs = require('fs');
const path = require('path');

const [depsDir, outDir, baseUrl] = process.argv.slice(2);
const { chromium } = require(path.join(depsDir, 'node_modules', 'playwright-core'));
const axePath = path.join(depsDir, 'node_modules', 'axe-core', 'axe.min.js');

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 360, height: 740 };
const checks = [];
const consoleProblems = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

async function waitForServer() {
  for (let i = 0; i < 180; i++) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No server at ${baseUrl}`);
}

/** IndexedDB refuses to open, as with site data blocked. */
function blockIndexedDb() {
  IDBFactory.prototype.open = function () {
    throw new DOMException('The user denied permission to access the database.', 'SecurityError');
  };
}

/** Rates per Canadian dollar, from the API contract's example. */
const cadRates = { CHF: 0.581, EUR: 0.6372, GBP: 0.5571, SEK: 7.097, USD: 0.7243 };

/** GET /fx's body for `base`, from the rates per Canadian dollar. */
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

async function newContext(
  browser,
  { viewport = WIDE, colorScheme = 'light', locale = 'en-CA', blocked = false },
) {
  const context = await browser.newContext({ viewport, colorScheme, locale });
  if (blocked) await context.addInitScript(blockIndexedDb);
  // GET /fx, answered with fixed rates in the currency asked for, as check-search.cjs does: there's no Worker behind
  // the dev proxy, and its 502 was a console error.
  await context.route('**/api/v1/fx?**', (route) =>
    route.fulfill({ json: fxBody(new URL(route.request().url()).searchParams.get('base')) }),
  );
  return context;
}

async function newPage(context, label) {
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleProblems.push(`[${label}] ${msg.type()}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`[${label}] pageerror: ${error.message}`));
  return page;
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const dialog = (page) => page.locator('mat-dialog-container');
const dialogText = async (page) => (await dialog(page).textContent())?.replace(/\s+/g, ' ') ?? '';
const mainText = async (page) => (await page.locator('main').textContent()).replace(/\s+/g, ' ');

async function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    const label =
      el.getAttribute('aria-label') ??
      (el.labels?.length ? el.labels[0].textContent : null) ??
      (el.getAttribute('aria-labelledby') &&
        el
          .getAttribute('aria-labelledby')
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean)
          .join(' ')) ??
      el.textContent ??
      '';
    return `${el.tagName.toLowerCase()} "${label.trim().replace(/\s+/g, ' ')}"`;
  });
}

async function axe(page, label) {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document);
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')),
    }));
  });
  check(
    `axe: ${label}`,
    violations.length === 0,
    violations.map((v) => `${v.id} (${v.impact}) on ${v.nodes.join(', ')}`).join('; '),
  );
}

async function noHorizontalScroll(page, label) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  check(
    `no horizontal scroll: ${label}`,
    scrollWidth <= innerWidth,
    `${scrollWidth} <= ${innerWidth}`,
  );
}

/** The menu you can type in (M6.16) labelled `label`: its text box. */
const choice = (page, label) => page.locator(`ss-choice-field[data-label="${label}"] input`);

/** What the menu labelled `label` shows: its choice's name. */
async function choiceValue(page, label) {
  return choice(page, label).inputValue();
}

/**
 * Picks `option` in the menu labelled `label` with the mouse: a click on the field opens its list. Where a user
 * clicks: the field, as an empty one's label lies over its text box.
 */
async function chooseOption(page, label, option) {
  await page.locator(`ss-choice-field[data-label="${label}"] .mat-mdc-text-field-wrapper`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
}

/** Waits for focus on the open dialog's heading, where the first-run and 📍 dialogs start (M6.16). */
async function headingFocused(page) {
  await page.waitForFunction(
    () => document.activeElement?.matches('mat-dialog-container h2') === true,
  );
}

/** Presses Tab until focus is in the menu labelled `label`. */
async function tabToChoice(page, label, limit = 12) {
  const inIt = () =>
    page.evaluate(
      (name) => document.activeElement?.closest(`ss-choice-field[data-label="${name}"]`) !== null,
      label,
    );
  for (let presses = 0; presses < limit && !(await inIt()); presses++) {
    await page.keyboard.press('Tab');
  }
  if (!(await inIt())) throw new Error(`Couldn't reach ${label} (focus on ${await focused(page)})`);
}

/** Types `text` in the focused menu and presses Enter once its list shows `option`, which is then the first. */
async function typeAndPick(page, text, option) {
  await page.keyboard.type(text);
  await page.locator('.cdk-overlay-pane mat-option', { hasText: option }).waitFor();
  // The first is made active a moment after the list changes.
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.locator('.cdk-overlay-pane mat-option').first().waitFor({ state: 'detached' });
}

async function getStarted(page) {
  await page.getByRole('button', { name: 'Get started' }).click();
  await dialog(page).waitFor({ state: 'detached' });
}

async function firstRunLooks(browser) {
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const context = await newContext(browser, { viewport, colorScheme });
      const page = await newPage(context, label);
      await page.goto(baseUrl + '/');
      await dialog(page).waitFor();
      await page.waitForTimeout(300);
      await shot(page, `first-run-${colorScheme}-${viewport.width}`);
      await axe(page, `first run ${label}`);
      await noHorizontalScroll(page, `first run ${label}`);
      if (viewport === WIDE) {
        await page.getByRole('button', { name: 'Get started' }).click();
        await page.getByText('Choose your province or territory').waitFor();
        await page.waitForTimeout(300);
        await shot(page, `first-run-error-${colorScheme}`);
        await axe(page, `first run, a missing province ${label}`);
        await chooseOption(page, 'Province or territory', 'Ontario');
        await page.getByText('Use my own rate').click();
        await page.waitForTimeout(200);
        await shot(page, `first-run-own-rate-${colorScheme}`);
        await axe(page, `first run, own rate ${label}`);
      }
      await context.close();
    }
  }
}

async function firstRunKeyboard(browser) {
  const context = await newContext(browser, { locale: 'en-CA' });
  const page = await newPage(context, 'keyboard en-CA');
  await page.goto(baseUrl + '/');
  await dialog(page).waitFor();
  await headingFocused(page);
  check(
    'en-CA: Canada and CAD by default, no province yet',
    (await choiceValue(page, 'Country')) === 'Canada' &&
      (await choiceValue(page, 'Currency')) === 'CAD — Canadian Dollar' &&
      (await choiceValue(page, 'Province or territory')) === '',
  );
  check(
    'first run: focus starts on the dialog’s heading, with no list open over it (M6.16)',
    (await focused(page)) === 'h2 "Welcome to Simply Sub"' &&
      (await page.locator('.cdk-overlay-pane mat-option').count()) === 0,
    await focused(page),
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('first run: Escape does not close it', (await dialog(page).count()) === 1);

  // From the heading: each menu (whose list opens with focus and closes as it moves on), the budgets, then the buttons.
  const order = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    order.push(await focused(page));
  }
  check(
    'first run: Tab order, kept inside the dialog',
    order.join(' > ') ===
      [
        'input "Country"',
        'input "Province or territory"',
        'input "Currency"',
        'input "Monthly budget"',
        'input "Annual budget"',
        // M6.9.
        'button "Import a backup instead"',
        'button "Get started"',
        'input "Country"',
      ].join(' > '),
    order.join(' > '),
  );
  check(
    'first run: only the focused menu’s list is open',
    (await page.locator('.cdk-overlay-pane .mat-mdc-autocomplete-panel').count()) <= 1,
  );

  // Get started without a province: the error shows, and focus goes to its menu. Focus is on Country now.
  for (let i = 0; i < 10 && (await focused(page)) !== 'button "Get started"'; i++) {
    await page.keyboard.press('Tab');
  }
  check('first run: reached Get started', (await focused(page)) === 'button "Get started"');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  // Its list stays closed, so the message under the field shows (M6.16); typing opens it.
  check(
    'first run: a missing province says so, and gets focus with its list closed',
    (await dialogText(page)).includes('Choose your province or territory') &&
      (await focused(page)) === 'input "Province or territory"' &&
      (await page.locator('.cdk-overlay-pane mat-option').count()) === 0,
    await focused(page),
  );
  await shot(page, 'first-run-province-error');

  // Choose Ontario with the keyboard: type to narrow the list, and Enter picks the first (M6.16).
  await typeAndPick(page, 'Ont', 'Ontario');
  check(
    'first run: typing "Ont" and Enter picks Ontario, and the tax follows',
    (await choiceValue(page, 'Province or territory')) === 'Ontario' &&
      (await dialogText(page)).includes('Sales tax 13% (Ontario)'),
    await dialogText(page),
  );

  // Monthly budget, then Enter submits.
  await page.getByLabel('Monthly budget').focus();
  await page.keyboard.type('200');
  await page.keyboard.press('Enter');
  await dialog(page).waitFor({ state: 'detached' });
  check('first run: Enter in a field saves and closes', true);

  await page.reload();
  await page.locator('main h1').waitFor();
  await page.waitForTimeout(1500);
  check('first run: appears once (not after a reload)', (await dialog(page).count()) === 0);

  await page.goto(baseUrl + '/settings');
  await page.getByText('Ontario, Canada (CAD)').waitFor();
  const text = await mainText(page);
  check(
    'settings: the first run saved country, province, currency and budget',
    text.includes('Sales tax 13% (Ontario)') && text.includes('Monthly budget: $200'),
    text,
  );
  await context.close();
}

async function otherCountries(browser) {
  {
    const context = await newContext(browser, { locale: 'en-GB' });
    const page = await newPage(context, 'en-GB');
    await page.goto(baseUrl + '/');
    await dialog(page).waitFor();
    const text = await dialogText(page);
    check(
      'en-GB: United Kingdom, GBP, no province, prices include tax',
      (await choiceValue(page, 'Country')) === 'United Kingdom' &&
        (await choiceValue(page, 'Currency')) === 'GBP — British Pound' &&
        (await page.locator('mat-label', { hasText: /Province|State/ }).count()) === 0 &&
        text.includes('Prices for United Kingdom already include sales tax.'),
      text,
    );
    await getStarted(page);
    await page.goto(baseUrl + '/settings');
    await page.getByText('United Kingdom (GBP)').waitFor();
    check(
      'en-GB: Settings says prices include sales tax',
      (await mainText(page)).includes('Prices include sales tax'),
    );
    await context.close();
  }
  {
    const context = await newContext(browser, { locale: 'en-US' });
    const page = await newPage(context, 'en-US');
    await page.goto(baseUrl + '/');
    await dialog(page).waitFor();
    await choice(page, 'State').click();
    await page.getByRole('option').first().waitFor();
    const options = await page.getByRole('option').allTextContents();
    await page.keyboard.press('Escape');
    const names = options.map((option) => option.trim());
    check(
      'en-US: the State menu lists the 50 states and DC only',
      names.length === 52 && names.includes('Not given') && !names.includes('Ontario'),
      `${names.length} options`,
    );
    check(
      'en-US: the rate field has its hint',
      (await dialogText(page)).includes('Your state and city sales tax on subscriptions, if any'),
    );
    await chooseOption(page, 'State', 'New York');
    await page.getByLabel('Sales tax rate').fill('8.875');
    await page.waitForTimeout(400);
    await shot(page, 'first-run-us');
    await getStarted(page);
    await page.goto(baseUrl + '/settings');
    await page.getByText('New York, United States (USD)').waitFor();
    check(
      'en-US: the own rate is saved',
      (await mainText(page)).includes('Sales tax 8.875% (your rate)'),
    );
    await context.close();
  }
  // Changing the country moves the currency, unless the user picked one.
  {
    const context = await newContext(browser, { locale: 'en-CA' });
    const page = await newPage(context, 'country change');
    await page.goto(baseUrl + '/');
    await dialog(page).waitFor();
    await chooseOption(page, 'Country', 'Germany');
    // The currency follows a moment after the pick.
    await page
      .waitForFunction(
        () =>
          document.querySelector('ss-choice-field[data-label="Currency"] input')?.value ===
          'EUR — Euro',
        null,
        { timeout: 3000 },
      )
      .catch(() => undefined);
    const followed = await choiceValue(page, 'Currency');
    await chooseOption(page, 'Currency', 'USD — US Dollar');
    await chooseOption(page, 'Country', 'France');
    await page.waitForTimeout(500);
    check(
      'the currency follows the country until the user picks one',
      followed === 'EUR — Euro' && (await choiceValue(page, 'Currency')) === 'USD — US Dollar',
      `${followed}, then ${await choiceValue(page, 'Currency')}`,
    );
    await context.close();
  }
}

async function themeInDexie(browser) {
  const context = await newContext(browser, { locale: 'en-US' });
  const page = await newPage(context, 'theme');
  await page.goto(baseUrl + '/');
  await dialog(page).waitFor();
  await getStarted(page);
  const other = await newPage(context, 'theme, second tab');
  await other.goto(baseUrl + '/lists');
  await other.locator('main h1').waitFor();

  await page.getByRole('button', { name: 'Dark theme' }).click();
  await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'dark');
  const followed = await other
    .waitForFunction(() => document.documentElement.dataset['theme'] === 'dark', null, {
      timeout: 3000,
    })
    .then(() => true)
    .catch(() => false);
  check('theme: another tab follows a toggle', followed);

  await page.reload();
  await page.locator('main h1').waitFor();
  check(
    'theme: persists across a reload',
    (await page.evaluate(() => document.documentElement.dataset['theme'])) === 'dark',
  );

  // The cache lost (or stale): the saved settings win once they load.
  await page.evaluate(() => localStorage.removeItem('ss-theme'));
  await page.reload();
  await page.locator('main h1').waitFor();
  const restored = await page
    .waitForFunction(() => document.documentElement.dataset['theme'] === 'dark', null, {
      timeout: 3000,
    })
    .then(() => true)
    .catch(() => false);
  check(
    'theme: settings.theme wins over the cache, and refills it',
    restored && (await page.evaluate(() => localStorage.getItem('ss-theme'))) === 'dark',
  );

  // System, from Settings.
  await page.goto(baseUrl + '/settings');
  await page.getByRole('radio', { name: 'System' }).check();
  await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'light');
  check('theme: System in Settings follows the OS (light here)', true);
  await context.close();
}

async function settingsPage(browser) {
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const context = await newContext(browser, { viewport, colorScheme });
      const page = await newPage(context, `settings ${label}`);
      await page.goto(baseUrl + '/settings');
      await dialog(page).waitFor();
      await chooseOption(page, 'Province or territory', 'Ontario');
      await page.getByLabel('Monthly budget').fill('200');
      await getStarted(page);
      await page.getByText('Ontario, Canada (CAD)').waitFor();
      await shot(page, `settings-${colorScheme}-${viewport.width}`);
      await axe(page, `settings ${label}`);
      await noHorizontalScroll(page, `settings ${label}`);

      await page.getByRole('button', { name: 'Edit Annual budget' }).click();
      await page.getByLabel('Annual budget').waitFor();
      await shot(page, `settings-editing-${colorScheme}-${viewport.width}`);
      await axe(page, `settings, editing a budget ${label}`);
      await noHorizontalScroll(page, `settings, editing a budget ${label}`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /Ontario, Canada/ }).click();
      await dialog(page).waitFor();
      await page.waitForTimeout(300);
      await shot(page, `location-dialog-${colorScheme}-${viewport.width}`);
      await axe(page, `📍 dialog ${label}`);
      await noHorizontalScroll(page, `📍 dialog ${label}`);
      await context.close();
    }
  }
}

async function settingsKeyboard(browser) {
  const context = await newContext(browser, {});
  const page = await newPage(context, 'settings keyboard');
  await page.goto(baseUrl + '/settings');
  await dialog(page).waitFor();
  await chooseOption(page, 'Province or territory', 'Ontario');
  await getStarted(page);
  await page.getByText('Ontario, Canada (CAD)').waitFor();

  // Edit a budget: Enter opens it, Enter saves, and focus comes back to ✎.
  await page.getByRole('button', { name: 'Edit Monthly budget' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check(
    'budget: ✎ opens the field and focuses it',
    (await focused(page)) === 'input "Monthly budget"',
    await focused(page),
  );
  await page.keyboard.type('250');
  await page.keyboard.press('Enter');
  await page.getByText('Monthly budget: $250').waitFor();
  await page.waitForTimeout(200);
  check(
    'budget: Enter saves, and focus returns to ✎',
    (await focused(page)) === 'button "Edit Monthly budget"',
    await focused(page),
  );

  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(
    'budget: Escape cancels, and focus returns to ✎',
    (await mainText(page)).includes('Monthly budget: $250') &&
      (await focused(page)) === 'button "Edit Monthly budget"',
  );
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.getByText('Monthly budget: Not set').waitFor();
  check('budget: empty means no budget', true);

  // Appearance with the arrow keys.
  await page.getByRole('radio', { name: 'System' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'dark');
  check('appearance: arrow keys pick Dark', true);
  await shot(page, 'settings-keyboard-dark');

  // 📍 with the keyboard: change the province, save, and focus comes back.
  await page.getByRole('button', { name: /Ontario, Canada/ }).focus();
  await page.keyboard.press('Enter');
  await dialog(page).waitFor();
  await headingFocused(page);
  check(
    '📍: focus moves to the dialog’s heading, with no list open (M6.16)',
    (await focused(page)) === 'h2 "Location and currency"' &&
      (await page.locator('.cdk-overlay-pane mat-option').count()) === 0,
    await focused(page),
  );
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  check(
    '📍: Escape closes it, and focus returns to 📍',
    (await focused(page)).includes('Ontario, Canada (CAD)'),
    await focused(page),
  );

  // Tab to the province's menu, select what it shows, and type over it (M6.16).
  await page.keyboard.press('Enter');
  await dialog(page).waitFor();
  await headingFocused(page);
  await tabToChoice(page, 'Province or territory');
  await page.keyboard.press('Control+A');
  await typeAndPick(page, 'Que', 'Quebec');
  check(
    '📍: typing "Que" and Enter picks Quebec, and the tax follows',
    (await choiceValue(page, 'Province or territory')) === 'Quebec' &&
      (await dialogText(page)).includes('Sales tax 14.975% (Quebec)'),
    await dialogText(page),
  );
  await page.getByRole('button', { name: 'Save' }).focus();
  await page.keyboard.press('Enter');
  await dialog(page).waitFor({ state: 'detached' });
  await page.getByText('Quebec, Canada (CAD)').waitFor();
  check(
    '📍: saved, and Settings shows it',
    (await mainText(page)).includes('Sales tax 14.975% (Quebec)'),
  );

  // ← Back (the feedback after M6.9): the first stop (a click on the title focuses <main>), back where the user came
  // from, which the sidebar's Settings can be any page.
  await page.goto(baseUrl + '/lists');
  await page.locator('ss-lists-overview-page h1').waitFor({ timeout: 20000 });
  await page.locator('nav[aria-label=Main] a.settings').click();
  await page.locator('ss-settings-page h1').waitFor();
  await page.locator('ss-settings-page h1').click();
  await page.keyboard.press('Tab');
  const back = await page.evaluate(() =>
    document.activeElement?.querySelector('.mdc-button__label')?.textContent.trim(),
  );
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/lists$/);
  check(
    '← Back: the first stop on Settings, and Enter goes back to the page before',
    back === 'Back',
    back,
  );
  await context.close();
}

async function blockedStorage(browser) {
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [WIDE, NARROW]) {
      const label = `${colorScheme} ${viewport.width}`;
      const context = await newContext(browser, { viewport, colorScheme, blocked: true });
      const page = await newPage(context, `blocked ${label}`);
      await page.goto(baseUrl + '/');
      await page.getByRole('heading', { name: 'Nothing will be saved' }).waitFor();
      await shot(page, `blocked-${colorScheme}-${viewport.width}`);
      await axe(page, `blocked notice ${label}`);
      await noHorizontalScroll(page, `blocked notice ${label}`);
      await context.close();
    }
  }

  const context = await newContext(browser, { blocked: true });
  const page = await newPage(context, 'blocked keyboard');
  await page.goto(baseUrl + '/settings');
  await page.getByRole('heading', { name: 'Nothing will be saved' }).waitFor();
  await page.keyboard.press('Tab');
  check(
    'blocked: Tab reaches Continue anyway',
    (await focused(page)) === 'button "Continue anyway"',
    await focused(page),
  );
  await page.keyboard.press('Enter');
  await dialog(page).waitFor();
  check(
    'blocked: Continue anyway opens the app, and the first run asks',
    (await page.locator('main h1').textContent()) === 'Settings',
  );
  await chooseOption(page, 'Province or territory', 'Ontario');
  await getStarted(page);
  await page.getByText('Ontario, Canada (CAD)').waitFor();
  check(
    'blocked: everything works in memory, and the page says nothing is saved',
    (await mainText(page)).includes(
      'Nothing is being saved: your browser is blocking local storage.',
    ),
  );
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await page.waitForFunction(() => document.documentElement.dataset['theme'] === 'dark');
  await shot(page, 'blocked-memory-settings');
  await axe(page, 'in-memory settings page');
  await page.reload();
  await page.getByRole('heading', { name: 'Nothing will be saved' }).waitFor();
  check('blocked: after a reload the notice is back (nothing was saved)', true);
  await context.close();
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    await firstRunLooks(browser);
    await firstRunKeyboard(browser);
    await otherCountries(browser);
    await themeInDexie(browser);
    await settingsPage(browser);
    await settingsKeyboard(browser);
    await blockedStorage(browser);
  } finally {
    await browser.close();
  }
  const expected = consoleProblems.filter((line) =>
    line.includes('The saved data could not be opened'),
  );
  const other = consoleProblems.filter(
    (line) => !line.includes('The saved data could not be opened'),
  );
  console.log(`\nConsole: ${expected.length} expected line(s) from blocked IndexedDB.`);
  check('no unexpected console errors or warnings', other.length === 0, other.join('\n'));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
