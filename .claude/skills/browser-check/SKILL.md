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

`check-drafts.cjs` (M6.3) checks list drafts on `ng serve` for a Canadian in Alberta: `/lists/new` making a new
list's draft (read from IndexedDB, with nothing in the lists table) and replacing its URL with `/lists/<id>/edit`, so
Back skips it; the editor's [+ Add from catalog] by keyboard opening pick mode with the banner "Adding to Subscription
List"; a price by keyboard back to the editor; a reload keeping the same draft and `/search?addTo=<new id>` keeping
its banner; Search's New list… landing on the new list's editor with one history entry; and with a saved
"Subscription List", the next new list named "Subscription List 2". Both themes at both widths, with axe and no
horizontal scroll. Its base URL ends in `/`.

`check-list-edit.cjs` (M6.4) checks the list editor on `ng serve` for a Canadian in Alberta, with a saved list
(Work Related: Netflix Standard tagged Family, and Mullvad VPN) written to IndexedDB. In both themes at both widths,
keyboard only: the name, the rows and the footer's average; a new name kept in the draft as it's typed; 🗑 moving
focus to the next row, with Undo in a snackbar putting it back; [+ Add from catalog] to pick mode with no question,
its banner naming the draft's name; a price back to the editor, which opens the item dialog (M6.5; Escape closes it),
"Resumed unsaved changes" and a reload; Lists in the
sidebar asking "Discard changes?" (focus on Cancel, Escape stays); and Save landing on the list view. Then at 1280 px:
Cancel after a reload discarding everything, a refused Back keeping the history (the editor opened from Search's Add
to list menu, since a `page.goto` starts a new document, whose Back leaves the app), an empty name, ⋮ Delete list, a
list there isn't, and a new list's Cancel. With axe on the snackbar, the dialogs and the error. Scope selectors to
`ss-list-edit-page`: the shell has a `.footer` too, and `ss-page-header` a `.row`. Since M6.5, `check-search.cjs` and
`check-drafts.cjs` check the item dialog a price opens, and that the editor dropped the request from the URL.

`check-item-dialog.cjs` (M6.5) checks the item dialog on `ng serve` for a Canadian in Alberta, with Work Related
(Netflix Standard tagged Family, and Mullvad VPN) written to IndexedDB. In both themes at both widths, keyboard only:
Search → a price → New list… → the dialog, preselected (the card's provider, plan and period, or a free plan's note),
focus on its heading, with the URL's request dropped in place (one history entry after Search) → Add → the row, the
snackbar and focus on its ✎ → Save → the list view; the dialog 720 px wide, or the whole screen at 360 px; Specific
dates with no end and an own price of 0 refused at their fields, with focus on the first; and ✎ on Netflix changing
its plan to Premium, an extra member with a quantity of 2, Feb 28 typed with its billing day chosen by arrow keys, the
renewal hint ending above Auto-renews, Ends on picked from the calendar by keyboard (its button, an arrow, Enter, focus
back on the button), and Auto-renews, then Save, a reload and the item read from IndexedDB (its id, tags and ranks
kept). With axe on the dialog, its errors, the billing day choice and the open calendar, and no horizontal scroll. The first card on Search is Proton, whose
first price is Proton Free.

`check-custom-subs.cjs` (M6.6) checks custom subscriptions on `ng serve` for a Canadian in Alberta, with Work Related
written to IndexedDB and `GET /icon` answered with a catalog logo (there's no Worker behind the dev proxy). In both
themes at both widths, keyboard only: the page with none; New opening the editor (focus on its heading, 720 px wide or
the whole screen); Save with nothing filled in, each field's error and focus on the name; a name, a website, two plans
(the second billed every 3 months), Ad free added at once and Video quality after its value; Save storing it (read
from IndexedDB) with its row, the icon asked for its domain, the snackbar and focus on its ✎; the list editor's
[+ Add custom subscription] menu adding it through the item dialog (flow F3); ✎ with a cost changed, asking how many
list items it reaches; and 🗑 asking "Also remove it from 1 list." and deleting it with its item. With axe on the
page, the editor, its errors, a feature's value, the menu and both questions, and no horizontal scroll.

`check-lists.cjs` (M6.7) checks the Lists overview on `ng serve` for a Canadian in Alberta. In both themes at both
widths, keyboard only: with no lists, the hint and New Subscription List (Enter opens a new list's editor); then Work
Related (Netflix Standard with Ad free ranked Essential, and Mullvad VPN) and Family (empty), with 1080p ranked Wanted,
written to IndexedDB: each card's cost, count and rank counts, the feature summary (VPN is a headline in the real
registry), the Tab order, View, and 🗑 asking first (focus on Cancel), deleting the list with its subscriptions,
moving focus on, and Undo putting them back. With axe on the page, the question and the snackbar, and no horizontal
scroll. A link's line in an accessibility snapshot ends in a colon, before its URL.

`check-list-view.cjs` (M6.8) checks List view on `ng serve` for a Canadian in Alberta. It writes to IndexedDB Work
Related (Netflix Standard tagged Family, Mullvad VPN, and Crave Premium from Dec 1) and an empty list.

In both themes at both widths, keyboard only, it checks:
- the header's average and count;
- the cards by price, with their statuses, tags and the feature summary;
- the Tab order (← Lists, Edit list, the search box, Sort, then each card's 📌 and details);
- 📌 by Space: saved to the item with no draft, the card moving to Pinned with focus on its 📌, and still there after a
  reload;
- the search box finding a tag, and Clear search;
- the Sort menu: Name, A to Z, the price slider's top thumb by arrow keys, the Inactive chip by Space and 4K from the
  Features suggestions, the count on its button, and Clear all keeping the sort;
- a card's details, with Edit opening the item dialog in the list editor;
- Edit list at the top, and the one at the foot.

Then at 1280 px:
- the note about the editor's changes not saved;
- an empty list's Add custom subscription menu and Add from catalog;
- a list there isn't.

It runs axe on the page, the open Sort menu (and the open Features suggestions at 1280 px), the details and the empty
states, and checks for horizontal scroll. Its `focusedName` reads the accessibility snapshot, so an icon's ligature ("tune") and
an input's `<label>` come out right.

`check-backup.cjs` (M6.9) checks backups on `ng serve` for a Canadian in Alberta. It writes to IndexedDB Work Related
(Netflix Standard nicknamed Mom's and tagged Family), a custom subscription and a rank.

In both themes at both widths, keyboard only, it checks:
- Export with a passphrase, read back from the download: encrypted, at 600,000 iterations, with no names in it;
- Export without one: every record, the deleted list too;
- Delete all data: starting in its DELETE field, refusing "delete", then everything cleared, Home and the first-run
  dialog;
- the first-run dialog's Import a backup instead with the encrypted file:
  - a wrong passphrase says so, keeps focus in its field and writes nothing;
  - the right one shows the counts, with focus on the preview;
  - Import brings back exactly what was stored, compared with sorted keys and with `undefined` fields left out.

Then at 1280 px:
- Merge, keeping a list renamed here since;
- Replace's question, with focus on Cancel;
- a file that isn't a backup.

It runs axe on each dialog and step, and checks for horizontal scroll.

`check-overflow.cjs` (the feedback after M6.8) checks that no page scrolls sideways at 320, 360 and 390 px, with the
browser's scrollbars shown (`ignoreDefaultArgs: ['--hide-scrollbars']`). It covers Home, Search (filters and
Mullvad's details open), Lists, List view (Sort and a card's details open), the editor, a new list, the item dialog,
Features, Custom subscriptions (editor open), Settings, Calendar and Payment. A failure names what sticks out, and
anything inside a page that scrolls sideways fails too.

`check-app-lock.cjs` (M6.10) checks the app lock on `ng serve` for a Canadian in Alberta. It writes to IndexedDB Work
Related (Netflix Standard nicknamed Mom's, noted "Paid by Dad" and tagged Family), Goodlife Gym at $43.21 and a rank.

In both themes at both widths, keyboard only, it checks:
- Settings' Lock with a passphrase by Space: the dialog with focus in its field, its warning and Export a backup
  first, a short and a mismatched passphrase refused, and Lock after picked by typeahead;
- Turn on the lock, and IndexedDB read raw: every user table sealed, none of those words or amounts in it, the
  settings keeping only `key`, `theme` and `appLock` plain at 600,000 iterations, and the exchange rates plain;
- a reload of Lists: the lock screen in place of the app, focus in its field, nothing of the user's in the page;
- a wrong passphrase said so, focus kept in the field, nothing unlocked; then Unlock, "Forgot it?" (Enter opens it,
  `aria-expanded`), Import a backup and Delete all data in the Tab order;
- the right passphrase opening Lists, as the reload left it;
- Turn off the lock: a wrong passphrase refused, then every table back exactly as it was.

Then at 1280 px, with Playwright's clock installed:
- Export while the lock is on: the records opened, with no `appLock`;
- the idle lock: 4 minutes leave it unlocked, a fifth locks it and closes the open Export dialog;
- the lock screen's Import a backup: no Merge, Replace asking first with focus on Cancel, then the lock off and the
  backup written plain;
- the lock screen's Delete all data: everything gone, `ss-lock` removed, and the first-run dialog.

It runs axe on each screen and dialog, and checks for horizontal scroll.

Since the feedback after M6.8, the other scripts check more:
- `check-search.cjs`: at 360 px each shop's price is on its line under one "Cheaper at".
- `check-item-dialog.cjs`: the three date boxes have the same height.
- `check-list-view.cjs`: the Types column, and View in Search by keyboard.
- `check-lists.cjs`: the overview's Types, and its summary folded after 8 rows with "Show all".

Since the feedback after M6.9:
- `check-search.cjs`, in light at 1280 px and dark at 360 px: a listed provider's "1 list" by Tab, its tooltip naming
  the list, Enter opening the menu with focus on the list, Escape back on the button, and the list opening its page;
  then Best for my ranks with 4K Needed: the providers with a 4K plan first, each showing it with "1 Needed", and the
  user's own plan still shown, with no counts. With axe on the menu and the sorted cards.
- `check-lists.cjs`: New list at the top, after Custom subscriptions in the Tab order, and Enter on it.
- `check-list-view.cjs`: the header and the Sort menu, as above.
- `check-list-edit.cjs`: the back button is the first stop, named for the list as saved (not the draft's new name),
  and asks "Discard changes?" too.
- `check-custom-subs.cjs`: the back button is the first stop, to Lists.
- `check-settings.cjs`: from Lists, ← Back is Settings' first stop, and Enter goes back to Lists.
- A click on a page's title focuses `<main>`, the skip link's target (`tabindex="-1"`), so Tab goes on from the top of
  the page, not from the title: the back button is the first stop on a page that has one.

Since M6.10, `check-backup.cjs` finds Settings' Your data by its region name: Security's hint says "your data" too, and
Playwright's `hasText` matches without case.

## Gotchas

- With the app lock on, every `page.goto` or `reload` is a visit, so the lock screen comes first. `check-app-lock.cjs`
  goes to the page it wants, then unlocks. PBKDF2 at 600,000 iterations takes about half a second, and turning the lock
  on or off a little more: give those waits 20 to 30 seconds.
- The idle lock counts in minutes. Install Playwright's clock before the page loads (`context.clock.install()`, time
  then flows as usual) and move it on with `page.clock.fastForward('05:00')`, which fires the timers that are due.
- A closed `mat-select` picks the option its typeahead matches (after the 200 ms pause): Tab to it and type "5" or "N".
  Read what it shows from `.mat-mdc-select-value-text`.

- Playwright starts catching file pickers only when something first waits for one (`waitForEvent('filechooser')`),
  without waiting for the browser to agree. A key press straight after that first wait sometimes opened a picker it
  missed, and the next Enter worked. Listen from the page's start (`page.on('filechooser', () => undefined)`), as
  `check-backup.cjs` does.

- Headless Chromium hides scrollbars, so a width that counts on them (`100vw`, a scrollbar's 15 px) never shows up.
  Launch with `ignoreDefaultArgs: ['--hide-scrollbars']` to measure with them, as `check-overflow.cjs` does. When a
  reported sideways scroll doesn't reproduce, compare both side gutters in the screenshot: seeing only one at a time
  means the page was zoomed, not too wide.

- Dates are Material datepickers since the feedback after M6.7: select what's there (Control+A) and type
  2027-02-28. The calendar opens from the field's button (named "Ends on: choose a date"), arrow keys move a day and
  Enter picks it. (The browser's own date field, before, took a year of up to 6 digits and needed ArrowRight.)
- Type decimals into fields as a user does, key by key: `check-custom-subs.cjs` found a number field in a list of
  plans turning a quickly typed "49.99" into 9949 (M6.6). `fill()` sets the value at once and wouldn't have.
- A Material autocomplete Tabbed past quickly could stay open, empty and unseen, and take a dialog's next Escape (fixed
  in M6.6 by closing on focus leaving). `check-item-dialog.cjs` names the overlays open when an Escape closes nothing.
- `check-shell.cjs` answers `GET /fx` itself since M6.7, as the other scripts do, and knows the pages whose heading
  isn't their link's name (Subscription Lists, Your feature ranks).
- An error in dev mode (ExpressionChangedAfterItHasBeenChecked included) opens the error snackbar, an overlay above a
  dialog, which then gets Escape: a dialog Escape won't close often means a console error. The scripts print the
  console problems on a crash.

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
- A select's open panel is in the browser's top layer, next to its field in the page (inside `.cdk-overlay-pane`, not
  `.cdk-overlay-container`). axe's `color-contrast` measures a field label hidden under it against the panel's colour
  and fails it. `check-list-view.cjs` sets aside contrast hits on text whose middle is under a `.cdk-overlay-pane`.
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
