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

`check-search.cjs` (M5.2) checks the Search page on the real catalog (data:build's files, so it works on `ng serve`
and under `wrangler dev`): one card per provider and the count, no US-only plan for a Canadian, Mullvad's "Cheaper at"
resellers in Alberta and their links, the Tab order (box, Sort, a card's links, its chips as one tab stop, the details
button), a chip picked with an arrow key, Enter on the details button, "netflix 4k" after the typing pause, the empty
state and Clear search, a listed provider's status (an item written to IndexedDB, then a reload), every card's cancel
page (M1.9), for a US user a provider not sold there (Crave, sold in Canada only), and for a UK user a fallback price
("No price for United Kingdom yet") and Sold in with its Settings default (M5.6), with axe in both themes at both
widths with cards expanded and with no match. It answers `GET /fx` itself. M5.3 added the filter panel:
its Tab order (after Sort, before the results), each filter by keyboard (Native by Space, 4K from the Features
suggestions by arrow keys, the price's top thumb by arrow keys, Category, an Activity chip, Clear all), the URL and
`history.length` after each (typing replaces its entry, a run of price changes makes one, anything else adds one), a
reload, Back and Forward, a URL with values the catalog doesn't have (rewritten in place), no scroll on a filter
change, and at 360 px the drawer by keyboard (focus on its close button, the trap, the count it announces, Escape,
Show results, Back), with axe on the open suggestions at 1280 px and the open drawer at 360 px in both themes. M5.4
added a price's Add to list menu: the price as a menu button ("…, add to a list"), Enter opening it with a list
(written to IndexedDB) and its count, then New list…, Escape back on the price, a list opening its editor with the
plan and period in the URL and the placeholder's text, and a bundle's price with New list…, with axe on the open menu
in both themes at both widths. M5.5 added pick mode (`?addTo=`): an `addTo` that names no list dropped in place,
the list kept through typing, Native, Clear all, a reload, Back and Forward, a bundle's price adding the bundle at
once, and in both themes at both widths, keyboard only, Tab from the top to the banner's ✕ (the stop before the
search box), Enter on it back to the editor, the editor's [+ Add from catalog] by keyboard, then Enter on the first
price adding its plan with no menu, with no horizontal scroll and axe with the banner shown; a 60-character list name
wrapping at 360 px in dark. M5.7 added, at both widths: TSN's plans in order (Standard first), a lone plan's chip
(RDS), every chip's place in its card unchanged across plan switches (Proton, TSN), the pinned bar and panel after
scrolling 900 px (`elementFromPoint` across the bar and the top bar, so nothing paints over them), the one-row bar
under 960 px with Sort first in the drawer, the details' slide (their `moving` class) and the details button saying
closed at once, Hide details from the foot of a long card (focus back on the details button, the card back in
view), and with `reducedMotion: 'reduce'` no animation; with axe while scrolled. The first card's Tab order is now
its chips, then its links, prices and details button. M1.13 added Terms and policies: Mullvad's groups, each rating's
grade, topic and reason, and its four linked pages; M1.14 its dots and the muted reasons and citations (one per
page, each linked to its quotes, with the quotes as a tooltip), and M5.9 the grade in words beside the topic at
1280 px and at 360 px in dark; M5.9 also a click on a Features chip removing it, and the filter panel with no
scroll of its own at 560, 720 and 900 px high; Netflix's ad-plan ratings and its Canadian terms; for a
US user, Proton's US disputes rating and none of Netflix's Canadian ones; axe with the section open. M5.10 reads
the price's and the menu's names from the accessibility tree, and checks that no name on Search, cards expanded, has
a space before a comma or colon, in both themes at both widths.

`check-features.cjs` (M6.2) checks the Features page on the real catalog: a card per feature category in order, all
open before anything is listed; the Tab order (Find a feature, Ranked only, the first card's toggle with its count);
a rank chosen by keyboard (Enter, an arrow, Enter), saved to IndexedDB at once, marked in its colour and still there
after a reload; Set all in VPN by keyboard (every child Wanted, not VPN itself, and the count it announces); a long
set folded until Enter opens it; "kill" finding the kill switch under its VPN heading; Ranked only by Space; Reset
all through its confirmation by keyboard (focus on Cancel); with Mullvad listed, only VPN open, with "in 1
subscription"; and in both themes at both widths, axe with ranked rows and with no match, and no horizontal scroll
(an open set's rows at 360 px too), with axe on an open dropdown, the Set all menu and the confirmation at 1280 px.

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
  `textContent`, which keeps `aria-hidden` text and icon ligatures, and which joins a `.visually-hidden` span without
  the space a browser puts before it: `.visually-hidden` is out of the flow, so Chromium names a button "a month , add
  to a list" whose text reads "a month, add to a list". Hidden words that start with a comma or colon go in one
  `aria-label` when the name starts with the visible words, or end the hidden words before them (a price, whose "/ mo"
  is read "a month": axe's `label-content-name-mismatch` fails an `aria-label` that doesn't contain what's shown).
  `check-search.cjs`'s `spacedNames` looks for them.
- Read the focused element's role and name with `page.locator(':focus').ariaSnapshot()`'s first line
  (`slider "Lowest price per month": "0"`). A name with a colon comes back quoted (`'link "Plan: …"'`), and a button
  whose aria-label differs from its text adds the text after a colon.
- Chromium makes a scrolling element a tab stop when nothing in it is focusable. Material renders an autocomplete's
  list just after its input, so Tab can land on the list: check that focus never reaches `.mat-mdc-autocomplete-panel`.
- A MatDialog sets `aria-modal="false"` and hides the rest of the page instead (`aria-hidden="true"` on `ss-root`).
- `history.length` counts entries: a `replaceState` leaves it as it was. Go back with `history.back()` and wait for the
  URL to change; the router follows a popstate after a timeout.
- Run axe on the snackbar only once it has opened. While opening, it fades in (contrast fails) and keeps its
  content in an `aria-hidden` wrapper (`aria-hidden-focus` fails on the Dismiss button).
