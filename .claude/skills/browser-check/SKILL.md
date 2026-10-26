---
name: browser-check
description: Run the Simply Sub web app in a real browser (system Edge via Playwright) to check a UI change in light and dark theme, at 360 px and 1280 px, keyboard-only, with an axe scan and screenshots. Use for the PROJECT-PLAN §1.4 definition-of-done checks.
---

# Browser check (Windows, system Edge)

The machine has no `chromium-cli` and no Playwright browsers. Drive the installed Edge with `playwright-core`.

## 1. Dependencies (scratchpad, never the repo)

Install pinned packages into their own empty scratchpad folder, with install scripts off:

```bash
DEPS="<scratchpad>/browser-deps"
mkdir -p "$DEPS" && cd "$DEPS"
printf '{ "name": "browser-deps", "private": true }\n' > package.json
npm install --ignore-scripts --no-audit --no-fund playwright-core@1.64.1 axe-core@4.14.0
```

## 2. Dev server on its own port

The user may run their own `ng serve` on port 4200. Never use or stop it. Start a separate server in the
background:

```bash
cd apps/web && npx ng serve --port 4300
```

The driver waits for the server itself (no polling loop needed). When done, stop only port 4300's listener:

```bash
pid=$(netstat -ano | grep -E "[:.]4300 " | grep LISTENING | awk '{print $NF}' | sort -u | head -1)
taskkill //PID "$pid" //T //F
```

## 3. Drive it

`check-shell.cjs` (next to this file) is the M0.5 shell check: every sidebar link with `aria-current` and the tab
title, Tab order and skip link, drawer focus (open, trap, navigate, Escape, backdrop, resize), window scrolling and
scroll restoration, the error snackbar, no horizontal scroll at 360 px, and axe in both themes at both widths.
Copy it to a scratchpad folder and add checks for the page you changed:

```bash
node check-shell.cjs "<scratchpad>/browser-deps" "<scratchpad>/shots" http://localhost:4300
```

It prints PASS/FAIL lines, exits non-zero on failure, and saves screenshots. **Look at the screenshots**; a passing
script doesn't prove the layout looks right.

`check-settings.cjs` (M4.2) checks the first-run dialog (defaults per browser locale, keyboard, validation, axe),
Settings (budgets edited in place, Appearance, the 📍 dialog), the theme saved in Dexie (reloads, a second tab, a
lost cache), and the "IndexedDB blocked" notice with in-memory mode. Run it the same way. For the production build
under `wrangler dev`, with the CSP, see the progress-preview skill's `csp-check.cjs`.

`check-catalog.cjs` (M4.3) checks the catalog downloads (which `/data/` files each step asks for, and what's cached in
IndexedDB), the offline banner (`context.setOffline`, and an aborted `index.json`), Settings' Catalog line by
keyboard, the "Catalog updated" toast in two tabs (a new version served with `context.route`), two tabs that reload
together downloading once, a country with no file of its own, and a first visit with no catalog, with axe in both
themes at both widths. Its base URL ends in `/`. It works on `ng serve` and under `wrangler dev`, where a CSP
violation fails its console check.

`check-prices.cjs` (M4.4) checks `ss-price` on the `/dev/components` gallery, so it needs `ng serve` (production
builds have no gallery): every fixed case's text for a Canadian, a US user with no rate and a UK user, the catalog's
own prices, the tooltip on hover and on keyboard focus, the accessible name, and picking a price by click and Enter,
with axe in both themes at both widths. It answers `GET /fx` itself with the API contract's example rates, so no
Worker is needed behind the dev proxy. Its selectors stay inside the gallery's ss-price section.

`check-components.cjs` (M4.5) checks the rest of the gallery on `ng serve`: the budget bars (labels, colours,
`aria-valuetext`, the label inside its bar, the Calendar tick), provider icons and their letter fallback, status
badges, rank chips and counts, the rank selects by keyboard (options per level, an override set and cleared), the
feature summary and list, the mini calendar by keyboard (one tab stop, arrows, Home, Page Up/Down, the payment
tooltip), creating a tag (name, colour by arrow keys, saved in IndexedDB) and removing its chip, the split button and
its menu, and ss-confirm (focus on Cancel, Escape, Enter), with axe in both themes at both widths and with the
popups open. The gallery's "File missing" icon is a deliberate 404, which both gallery scripts leave out of their
console check.

## Gotchas

- Every new browser context starts with no settings, so the first-run dialog (M4.2) covers the page until it's
  completed. The scripts complete it first. The context's `locale` sets its defaults (Playwright uses the system's
  unless given): `en-CA` needs a province, `en-US` and `en-GB` need nothing.
- An empty outlined field's label lies over its `mat-select`, so Playwright won't click the select: click the
  field's `.mat-mdc-text-field-wrapper`, as a user does.
- A `mat-select`'s typeahead moves to a match after a 200 ms pause: wait before pressing Enter.
- `getByLabel` matches substrings: "Monthly budget" also finds the "Edit Monthly budget" button. Pass `exact: true`.
- A focused element's name: inputs get theirs from `<label for>` (`el.labels`), not `aria-label`.
- Block IndexedDB with an init script that makes `IDBFactory.prototype.open` throw a `SecurityError`, as Edge does
  with site data blocked.
- Playwright presses keys faster than Angular renders. After a key that changes what's on screen (a new month in
  the mini calendar, a row that opens), wait for the focus or text it should produce before the next key.
- Material shows a tooltip on keyboard focus only. Once the last keypress is old, `locator.focus()` counts as
  programmatic and no tooltip opens: reach the element with a key instead (Tab, or an arrow in a grid).
- Material renders menus and select panels in an overlay container on `<body>`, outside the page's landmarks, so
  axe's best-practice `region` rule flags their text. `check-components.cjs` sets aside `region` hits inside
  `.cdk-overlay-container` and keeps every other rule.
- A screenshot taken just after a popup opens catches it mid-animation (half transparent): wait about 500 ms
  before judging how it looks.

- Light/dark: create the browser context with `colorScheme`; ThemeService follows the OS when nothing is saved.
- `data-theme` updates on the next tick after a toggle; wait for it rather than checking right away.
- MatSidenav moves focus into the drawer only after its slide-in ends, and listens for Escape on the drawer
  itself. Wait for focus inside the drawer before pressing Escape.
- Inject axe with `page.addScriptTag({ path: '<deps>/node_modules/axe-core/axe.min.js' })`, then
  `axe.run(document)`. Against the production build (`wrangler dev`, whose CSP has Trusted Types), `addScriptTag`
  throws; use `page.evaluate(fs.readFileSync(axePath, 'utf8'))` instead. A page-level `region` violation means content outside every landmark.
- Trigger the error snackbar with `page.evaluate(() => setTimeout(() => { throw new Error('x'); }))`.
- Run axe about 600 ms after clicking a Material button: its ripple and state layer fade out, and mid-fade the
  dark theme's accent label on them measures 4:1, a contrast failure that isn't there once they settle.
- Offline, a lazy page that hasn't been opened in the session can't load its chunk, and the error snackbar shows.
  That's expected until M10's service worker: navigate offline only to pages already opened.
- A Material tooltip opens on hover and on keyboard focus (Tab), not on a script's `locator.focus()`.
- Read a control's accessible name with `locator.ariaSnapshot()` (`- button "about $7.53 a month"`), not its
  `textContent`, which keeps `aria-hidden` text and icon ligatures.
- Run axe on the snackbar only once it has opened. While opening, it fades in (contrast fails) and keeps its
  content in an `aria-hidden` wrapper (`aria-hidden-focus` fails on the Dismiss button).
