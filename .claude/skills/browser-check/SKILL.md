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
lost cache), and the "IndexedDB blocked" notice with in-memory mode. Since M6.16 both dialogs open on their heading
with no list open, and Country, the province or state, and Currency are menus you can type in: it Tabs to one, types
("Ont", "Que") and presses Enter, and for the mouse clicks the field, then the choice. Run it the same way. For the production build
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
suggestions by arrow keys, the price's top thumb by arrow keys, Category typed to narrow, and again after a click
(M5.14), an Activity chip, Clear all), the URL and
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
back on the button), "Auto-renews until it ends" and Ends on's "It stops then" once there's an end date (M6.19), and
that checkbox by Space, then Save, a reload and the item read from IndexedDB (its id, tags and ranks
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
- the cards by price, with their statuses ("Auto-renews Nov 12", "Manual · renew by Nov 12" since M7.11), tags and the
  feature summary;
- the Tab order (← Lists, Edit list, the search box, at 360 px the compact View optimizations (M6.13), Sort, then each
  card's 📌 and details);
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
- Delete all data (folded since M4.7: at 1280 px the jump link of its name puts focus on its summary, at 360 px, whose
  jump list has only the groups, Tab reaches the summary, found by its id since an accessibility snapshot gives a
  summary no name; Enter opens it, then its button): starting in its DELETE field, refusing "delete", then everything cleared, Home and the first-run
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

`check-tags.cjs` (M6.11) checks custom tags on `ng serve` for a Canadian in Alberta. It writes to IndexedDB Family and
Work, and Work Related with Netflix Standard (tagged both) and Mullvad VPN (tagged Family).

In both themes at both widths, keyboard only, it checks:
- Settings' Custom tags: each row's colour named ("Colour of Family: Blue"), ✎ opening the name in place, another
  tag's name refused in any case with focus kept in the field, Escape changing nothing, and Enter saving with focus
  back on ✎;
- the colour button opening the palette on the colour it has, an arrow key to the next preset, and a hex colour, each
  saved;
- ⊕ adding a tag with a colour no tag has, then ✕ deleting it at once, focus moving to the previous row's ✕;
- ✕ on a tag in use: "Used by 1 subscription" with focus on Cancel, then the tag gone from IndexedDB and the items;
- the list editor's ✎ on Netflix, the dialog's Delete a tag menu by keyboard, "Used by 2 subscriptions" (the draft's
  items and the list's counted once each), the chip gone, every item and the draft without the tag, and focus in the
  field once no tag is left;
- List view with no tag chips, and its Sort menu's Tags saying there are none.

It runs axe on the card, the editor and its error, the question, the menu and List view, and checks for horizontal
scroll. Wait for the item dialog to put focus on its heading before tabbing: it moves focus there once it's open,
which undoes Tab presses made sooner.

`check-home.cjs` (M7.3, M7.10) checks Home, the hub, on `ng serve` for a Canadian in Alberta, with no lists, then with
Work Related (Netflix Standard, monthly on the 12th) and Family (Mullvad VPN, yearly, renewed by hand, due a week from
today) written to IndexedDB.

In both themes at both widths, keyboard only, it checks:
- no lists: the empty state's Create a list, Browse services and Import backup, and Enter on the first;
- the mini calendar's dots this month (it reads the machine's date), the 12th reached with the arrow keys from today's
  tab stop, its tooltip "Netflix $19.94" and Enter opening `/calendar?month=`;
- every list's totals without budgets, "Set a monthly budget →" to Settings, and with budgets a bar for each, the
  monthly one over;
- the quick actions first in the Tab order: Add a subscription's menu (To Work Related, To Family, A custom
  subscription) and Escape back on it, New list, and Open a list's menu, an arrow and Enter opening Family;
- Coming up (the next 14 days, Mullvad's with Mark renewed), Enter on Mark renewed moving its renewal on a year (read
  from IndexedDB) and taking it off the list, and the snackbar's Undo putting both back;
- Your lists' cards (each one's words read with spaces: the link's name), Ways to save with each list's View
  optimizations, Price changes from `settings.priceChanges`, Subscription Lists by keyboard;
- budgets and Coming up beside the calendar at 1280 px, one column at 360.

Light at 1280 px, it also checks Home's totals against the sum of the Lists overview's cards, to a cent a list (each
amount is rounded for display). It runs axe on each state, the open tooltip included, and checks for horizontal
scroll.

`check-calendar.cjs` (M7.4) checks the Calendar on `ng serve` for a Canadian in Alberta with a $60 monthly budget. It
writes to IndexedDB Work Related (Netflix Standard on the 12th, Crave Premium billed on the 31st) and Family (Mullvad
VPN, yearly on Jan 20, renewed by hand; Netflix Standard with ads on Specific dates, Sep 2 to Nov 1 every year).

In both themes at both widths, keyboard only, it checks:
- the days with charges: October's 2nd, 12th and 31st, November's 12th and 30th (the window ended), February's 12th
  and 28th;
- the bar: a past month paid in full, a future one at $0.00, this one up to today with the budget's tick;
- at 1280 px the grid: today's tab stop, arrows to the 12th, Enter opening its panel (focus on its heading, Netflix,
  its list link, Renews automatically), Escape putting focus back, Page Down to the next month in the URL;
- at 360 px the compact grid (a dot per day, no chips, M7.8) and the agenda, and Enter on a payment opening its day
  in a bottom sheet with focus on it, which Escape closes;
- Showing by keyboard (Space unticks Work Related): the URL's `lists`, `settings.calendarHiddenLists`, and the same
  after a reload; Next month and Today;
- Home's dots on the Calendar's days this month, and List view's mini calendar, folded under 960 px until its button
  opens it.

It runs axe on the page, the panel, the open select, the sheet and List view, setting aside contrast hits on text
under an open panel as `check-list-view.cjs` does, and checks for horizontal scroll. Wait about 600 ms before judging a
bottom sheet: it slides up.

`check-exports.cjs` (M7.5) checks the exports on `ng serve` for a Canadian in Alberta. It writes to IndexedDB Work
Related (Netflix Standard on the 12th, tagged Family and with a tag deleted since; Crave Premium billed on the 31st)
and Family (Mullvad VPN, yearly on Jan 20, renewed by hand), then reads every file it downloads:
- List view's Export by keyboard: the CSV (its byte order mark, header and rows, live tags only), the workbook
  (parsed by the repository's exceljs: Summary, the list's sheet, Payments), the JSON, the text, and the .ics (since
  M7.12 a repeating all-day event per subscription, its RRULE read: Crave's on each month's last day,
  `BYMONTHDAY=-1` since M10.2, the form Proton Calendar takes), with "Saved <name>" after each;
- the Calendar's Export to file (the main button's .ics for both lists, the menu's payment schedule in date order
  and its workbook) and Sync calendar for each app's file (since M10.3 below Live calendar…, so one item further
  down): the .ics, then its steps with focus on the heading, and Escape back on Sync calendar;
- offline at 360 px, a library not loaded yet: the snack bar's "The file couldn't be made".

Every format runs light at 1280 px; the other runs open each menu and download one file of each page. It runs axe on
the open menus and each app's steps, and checks for horizontal scroll. Wait for focus on a menu's first item before
pressing the arrows: keys sent while it opens land elsewhere. A closing menu stays in the DOM a moment: look for
`.mat-mdc-menu-panel:not(.mat-menu-panel-exit-animation)`. Material nests two `.mat-mdc-snack-bar-label`s, and the live
announcer holds the same words: take the first.

`check-optimizations.cjs` (M8.2) checks Optimizations (P14) and List view's View optimizations on the real catalog, for
a Canadian in Alberta. It writes to IndexedDB Family (Netflix Standard twice, Mine and Sam's; Disney+ Premium monthly;
Mullvad VPN; Proton VPN Plus) with VPN ranked Needed, and prints the cards it finds. In both themes at both widths,
keyboard only:
- List view's link: its count, `data-strongest` and its name ("View optimizations (9), the strongest: Recommended"),
  reached by Tab after the side column, Enter opening the page; at 360 px the compact one in the pinned bar ("View
  optimizations: 9 suggestions, the strongest: Recommended", M6.13);
- the sections in P14's order, every card's saving, as many cards as List view counted, the extra member for the two
  Netflix accounts in Free savings (a removal of one only in Worth a look), Save up to, the back button by the list's
  name and first in the Tab order, the rules' tooltip on Tab, Dismiss right after Apply with the same changes;
- Dismiss by Enter: one card fewer, focus on a card's heading, the snackbar with Undo; Show dismissed by Space and
  back; a reload keeping it dismissed (one row in `dismissedSuggestions`); List view counting one fewer;
- Apply by Enter: it stays on the page (M8.4), focus moves on, and Review changes (M8.6) lists the change with its
  Undo and the back button to Optimizations; Open in the editor shows the list's draft in IndexedDB with the change,
  the items table as it was.

Then a 14-item list, which the Web Worker optimizes (`page.on('worker')`). It logs `securitypolicyviolation` events as
console errors, so under `wrangler dev` (base URL ending in `/`) it checks the production CSP too, the worker included.
With axe on List view, the page, the tooltip and the snackbar, and no horizontal scroll.
- A name with a colon comes back single-quoted from `ariaSnapshot()` (`'button "Apply: …"'`), its own quotes doubled:
  its `focused()` parses the role and name.
- The dev server serves the worker as `/worker-<hash>.js?worker_file&type=module`: match its path.
- The real catalog's Proton Free has a VPN, so a Proton VPN Plus moving to it keeps VPN: the cards depend on the data.

`check-optimizer-reapply.cjs` (M8.7, the feedback after M10) applies Optimizations' cards one after another, saves, and
applies again, on `ng serve` for a Canadian in Alberta (base URL ending in `/`). In both themes at both widths,
keyboard only: two Netflix Standards added today and a better card (the report's steps), every free saving applied,
Review changes, Open in the editor and Save; List view says one account becomes an extra member on the other, which
renews; Optimizations again offers no extra member (the host never joins the account that ends); Upcoming still has
the host's charge. Then the item dialog's Extra member unticked on the host: the snackbar says "the other Netflix
Standard no longer ends", and neither account ends in the draft or, after Save, in the list. Then, in light at 1280 px,
a 14-item list whose cards are clicked as soon as they can be (6, Save, then the rest at once, Save): no console
error, and every extra member's host goes on (`memberProblems`). Axe on Optimizations, List view and the editor with
its snackbar, and no horizontal scroll.
- The real catalog's Netflix lists Extra member (with ads) before Extra member: Tab to `/^Extra member$/`.
- Two of the same plan in a list: the item dialog's Save asks "Already in this list" first, a moment after.
- Each status badge's text starts with the words only screen readers get ("Active", "Inactive").

`check-budget-banners.cjs` (M7.6) checks the budget warnings on `ng serve` for a Canadian in Alberta with a $50 monthly
and a $500 annual budget, written into the stored settings. Work Related has Netflix Standard and Crave Premium ($43.04
a month), and Family Mullvad VPN (about $94.16 on Jan 20). In both themes at both widths, keyboard only:
- Home: January 2027 (≈ $137.20) and this year (≈ $610.64), above the calendar, in a status region and read with
  "Warning:"; Tab to the January link, and Enter opens the Calendar on that month;
- List view: Work Related only this year ($516.47) with no link; Family January 2027 (≈ $94.16), whose link opens the
  Calendar on it showing Family alone;
- with the budgets at $200 and $1,000, no warning, and the status region still there.

It runs axe on both pages with their warnings and checks for horizontal scroll.

`check-payment.cjs` (M9.1, M9.4) checks Payment (P11) on `ng serve` for a Canadian in Alberta. In both themes at both
widths, keyboard only:
- no cards: the heading, the line about card numbers and the empty state;
- Add card by Tab and Enter: the dialog with focus on its heading, 720 px wide or the whole screen, its "Never enter a
  card number"; Add with nothing filled in, each field's error and focus on the name; a card number refused in the
  name and in the limit (nothing stored);
- the card typed in field by field (Type and Network by typeahead), stored as typed (read from IndexedDB), the
  snackbar and focus on its ✎;
- Work Related written to IndexedDB (Netflix Standard on the 1st and Mullvad VPN on the 2nd of every month and year,
  paid with it; Crave Premium with none): the tile's badges, rates, this month's "≈ $116.46 of $500.00" (Mullvad's
  euros with the 2.5% FX fee), the subscriptions with what they cost a month with tax ("≈ $27.79 / mo with tax"), the
  bar's name, and "1 subscription has no card";
- ✎ clearing the limit ("No limit", the field gone from the record), and focus back on ✎;
- 🗑 asking with the count it pays for (focus on Cancel), then the card soft-deleted, its items with no card and focus
  on Add card.

It runs axe on the page, the dialog, its errors, the tile and the question, and checks for horizontal scroll. Wait
about 600 ms before a screenshot of the dialog's errors: they fade in, and the limit's label floats up meanwhile.
`check-shell.cjs` knows Payment's heading, "Payment cards".

M9.4 adds three cards (Everyday, a Mastercard at 1.5% with a $30 limit; Everyday Debit on Interac; Rewards Discover at
2%) and Family open in the editor (an unsaved draft with Crave Premium), then, keyboard only:
- P11: Everyday's "Over its limit in <this month>: ≈ $116.46 of $30.00" with its bar red, and "≈ $27.56 after cash
  back & FX fees"; Assign best cards, its preview (Work Related's Mullvad VPN from Everyday to Rewards Discover,
  saving ≈ $0.48; Family skipped, with its note), Apply (Mullvad's `cardId` in IndexedDB, Family's Crave Premium untouched,
  the warning gone) and Undo;
- P6: Netflix's "Paid with" menu with only No card and Everyday (no Interac or Discover in Canada); No card by
  typeahead, the Best card chip next in the Tab order ("Best card: Everyday, saves $0.30 / mo"), Enter on it, and the
  hint's net; Mullvad's two notes (acceptance not confirmed; its euros and the card's FX fee);
- P4: the header's "≈ $27.79 / mo with tax · ≈ $27.56 after cash back & FX fees" and Netflix's "Paid with Everyday: …";
- P10: at 1280 px the day that takes Everyday over its limit, flagged in the grid (its name ending ", over a card’s
  limit"), reached by the arrow keys, and its panel naming the card and the warning; at 360 px the agenda's payment
  and its bottom sheet.

With axe on each, and no horizontal scroll.
- With a select open, axe measures the field's hint against the panel's colour, which fails in dark theme. When the
  panel doesn't cover the hint's middle, `axeCheck`'s set-aside misses it, so it takes selectors to leave out of a scan.
- `buttonIn` drops a leading icon's ligature ("auto_fix_high Assign best cards").
- The card-number check reads the fields typed in, not ids or dates, whose digits run on once dashes are taken out.

`check-scrollbars.cjs` (M4.9, M9.5; UI polish) checks the scrollbars on `ng serve` with the browser's own shown
(`ignoreDefaultArgs: ['--hide-scrollbars']`), for a Canadian in Alberta, in both themes at 1280 and 360 px: the page's,
the card dialog's and its Card currency menu's (since M4.8 a menu you can type in: a click on its input lists every
currency, in `.mat-mdc-autocomplete-panel`) `scrollbar-color` (the muted text colour on a transparent track, read
against the tokens) and `scrollbar-width: thin`, a gutter of 12 px at most, the thumb's contrast against what's behind
it (WCAG's formula; Material's surfaces resolve to `color(srgb …)`, 0 to 1), dragging the thumb scrolling the page,
Add card reached by Tab with its Name hint naming no real card, axe and no horizontal scroll.

`check-after-m9.cjs` (the feedback after M9: M5.11, M5.12, M6.12–M6.16, M7.7–M7.9, M8.4) checks the batch on `ng serve`
for a Canadian in Alberta with a $50 monthly budget, Work Related planted with eight items (Netflix Standard with an
extra member, Netflix Standard with ads, Mullvad VPN renewed by hand, Crave, Disney+, Proton and TSN). In both themes
at both widths, keyboard only, each part on its own, so one failing doesn't stop the rest:
- first run typed in: the dialog opens on its heading with no list open, Tab to Province, "alb" and Enter;
- List view: the add-on with its price, "Auto-renews" and "Manual · renew by", the warning's ✕ then Show hidden (the key in the
  settings, focus moving between them), the bar's one colour (all red, half again over), scrolled to the end with the
  bar below the top bar and View optimizations on screen (compact in the bar at 360), then View in Search by keyboard
  with `plan=`;
- Search: Standard picked over the user's Standard with ads, "Auto-renews", and Netflix's Behavioral Advertising link;
- the item dialog: the shared-ranks note, French-language content set to Needed by keyboard, Save sharing it with
  Standard with ads in the draft, then New tag's hex field and colour picker following each other;
- Optimizations: Apply staying, Review changes, Undo dropping the draft, Apply again, Review changes and Open in the
  editor;
- the Calendar: "← Work Related" from a budget warning, the grid's width unchanged when a day opens at 1280 and none
  from the sidebar, the compact grid and its bottom sheet at 360, and the JSON and Text downloads;
- Settings: the 📍 dialog's province typed ("que" is Quebec alone) and the tag editor's picker;
- Home: the bars' colour on the scale and the warnings' ✕.

`check-m10-calendar-controls.cjs` (M10.20, the feedback after M10, part 2) checks the Calendar's controls and the year
view's cards on `ng serve` for a Canadian in Alberta (base URL ending in `/`), with Work Related and Family written to
IndexedDB, in both themes at both widths: the Tab order Month, Year, Today, ‹, the month, the year, › (in the year view
then January); at 1280 px Month, Year and Today not moving when the view changes, and the arrows at the row's end; at 360 px Month and Year on Today's row with Today at its end, and the arrows on a row of their own; every point
of March's card being its link (`elementFromPoint` on its days, total and strip) with the pointer cursor, a double click
on its total selecting nothing (`user-select: none`), and a click on its days opening March. With axe on both views,
screenshots and no horizontal scroll. An outlined Material button is 2 px wider than a filled one (its border), which
is why the views' outlined padding is a pixel less a side.

`check-m10-calendar.cjs` (M10's Calendar batch: M10.3, and M10.4's year view) needs `wrangler dev` behind `ng serve`'s
proxy, its user database migrated (`npm -w apps/api run db:user:migrate:local`), since the live calendar's requests
go to the Worker; it answers `/fx` itself. For a Canadian in Alberta with Work Related (Netflix tagged Family, Crave
billed on the 31st) and Family (Mullvad renewed by hand), in both themes at both widths, keyboard only:
- the live calendar (M10.3): Sync calendar's menu (Live calendar…, then each app's file); the dialog on its title,
  saying what's uploaded and who can see it; Family chosen with Space and Make links with Enter; each link fetched
  from the Worker with only its own payments (amounts as charged, Crave's `BYMONTHDAY=-1`); Google's and Apple's
  links; Copy link read back from the clipboard (the context grants clipboard access) and its spoken message;
  Proton's steps opened with Enter; Escape back on Sync calendar; Settings' card ("On: 2 calendars…") and Manage…;
- light and wide only: a nickname written to IndexedDB reaching the feed after a reload (the next start), Change
  calendars keeping each link, and Revoke all asking first (focus on Cancel), then every link answering 404;
- the year view (M10.4): Year by Enter (pressed, in the URL, the year's bar), twelve month links each named with all
  its card shows, no Month select and the arrows by year, Tab from Next year to January then February (Today comes before the arrows since M10.20), axe and a
  full-page screenshot, Enter on March opening its month with focus on its grid, then Year and Month by Enter.

A feed takes 30 fetches a minute, so poll one every 2 s, not every 100 ms, or the Worker's 429 looks like a missing
change. The links view and the choosing view without links share the title Live calendar: wait for Make links to
know a revoke has finished.

`check-m10-offline-sync.cjs` (M10's offline and sync batch: M10.5, M10.6 and M10.9) runs under `wrangler dev` on the
production build (`npm -w apps/web run build`, then `node apps/api/scripts/copy-web-build.mjs`), with the user database
migrated, so the CSP, Trusted Types and the service worker are as on the live site; it answers `/fx` itself. It takes
two more builds of the same code, each new to the worker: in `apps/web`, `WORKERS_CI_COMMIT_SHA=b0b0b0b0 node
scripts/build.mjs --output-path=<scratchpad>/build-b`, then `c0c0c0c0` into `build-c`; pass their `browser` folders
as the 4th and 5th arguments. It serves each by putting its new and changed files over `apps/api/public/`'s and
waiting until wrangler dev serves them, and puts `apps/web/dist`'s back, so don't build the app while it runs. For a Canadian in Alberta with Work Related (Netflix, Crave) and Family
(Mullvad, in euros), in both themes at both widths:
- M10.5: the worker registers through its own policy, controls the page after a reload and holds every file of
  `ngsw.json`'s app group; then, with `context.setOffline`, Home, a deep link and every sidebar page start, Work Related
  lists its items from the cached catalog under the Offline banner (axe, no horizontal scroll), and Family's Mullvad
  is converted with the saved rates (`≈`); back online, none of the worker's caches holds an `/api/` or `/data/`
  answer.
- M10.6: both `theme-color` metas take the theme on screen; Settings' Version line and its Check for updates by Enter
  ("You have the latest version."); with the second build served, Check for updates finds it and the prompt shows
  (axe, a screenshot, no horizontal scroll), Tab from Check for updates reaches Reload, and Enter runs the new
  version; with the third served, a page load runs it at once and no prompt follows. Then, light and wide in a
  `launchPersistentContext` profile (Edge offers no install to a private window: CDP's `in-incognito`), CDP's
  `Page.getAppManifest` and `Page.getInstallabilityErrors` report nothing, Settings' Install appears, and Enter on it
  uses the offer (Edge's dialog, which the script can't answer), the steps taking its place.

- M10.9, two browsers, A and B (light at 1280 px with dark at 360, then the other way round), by keyboard: A turns sync
  on (the new code, axe, a screenshot), B joins by typing four letters of each word and Tab (axe on the words and on
  the copy to join) and merges; both then have both lists; B left idle on its Lists page checks twice at most in 30 s
  (M10.26), then an edit in A shows there within 15 s with B in use (a Shift every 2 s), where idle it would wait 40;
  a deletion in B reaches A; changes made offline on both survive; B's theme stays its own; A's Start over, then its
  Delete the synced copy, each leave B saying the copy was deleted (B joining the new chain in between), and B turns
  sync off. A 6th argument runs some parts only: `offline,updates,install,sync` (all by default).

Angular's worker answers every request in its scope, passing on those it doesn't keep, so Playwright's
`fromServiceWorker()` can't tell what it cached. Sync's helpers wait for the `sync` record's `syncedAt` to move on, not
for "Synced just now", which the last sync may have left; the join dialog puts focus in the first box itself, so wait for
that before typing; and `page.goto` reloads the app, whose list of devices is in memory until its first sync. Offline,
it answers what it never kept (an icon never shown online) with a 504: wait a second before going back online, or that
console line arrives after. `wrangler dev` serves a file new to `apps/api/public/` about half a second after it
appears, and the SPA's index.html until then (for a new `main-*.js`, "Failed to load module script"); on Windows its
watcher also stops for good when it meets a file still being written (its log: "Assets directory watcher encountered an
error and has been disabled", `EBUSY`). So the script's `serve()` writes only new and changed files, each moved in whole
from beside the folder, and waits until every file in the build's `ngsw.json` comes back as built; if its wait times
out, look for that line and restart wrangler dev. For the same reason, copy a new first build in (`copy-web-build.mjs`,
which deletes and copies everything) only with wrangler dev stopped: `npm run dev:api` copies it before it starts. A
version the worker has held before isn't new to it, so serving the first build again brings no update: hence two more
builds.

`check-m10-reports.cjs` (M10.11, Report a wrong price) runs under `wrangler dev` on the production build too, with the
local catalog seeded (`npm -w apps/api run db:seed:local`: the report's plan is checked against D1's `plans`) and the
user database migrated (`npm -w apps/api run db:user:migrate:local`); run `npm run data:build` on the branch first. For
a Canadian in Alberta, in both themes at both widths, by keyboard: Search's Netflix card expanded, Tab to Report a wrong
price beside the price's date and Enter, which loads the dialog's chunk then; focus on the first choice, axe, no
horizontal scroll; a different price typed and sent (offline first in one run: it says so, sends nothing), or "It's not
sold any more" with an arrow key; the thanks with axe, and focus back on the button. Then Mullvad's card, whose five
billing periods its dialog asks for, filled in with the catalog's euro price, and Yearly chosen by keyboard. It reads the
local user database with `wrangler d1 execute --local` before and after: 3 reports of a different price and 1 that the
plan isn't sold any more, on Netflix's first plan (Standard with ads, the one its details show). A report is limited to 3
a minute per IP, and wrangler dev's limiter counts in the wall clock's minutes: a run's fourth report can be refused,
which the script checks is said in words, then sends again in the next minute (a run takes 2 to 3 minutes). A snackbar
fading out is paler than it shows, so axe waits until the thanks has gone.

`check-home-screen-app.cjs` (M10.16, the feedback after M10, part 2) checks the app installed on a phone's Home Screen,
on `ng serve` for a Canadian in Alberta (base URL ending in `/`): CDP's `Emulation.setSafeAreaInsetsOverride` gives the
screen an iPhone's safe areas (59 px top, 34 bottom) and `Emulation.setEmulatedMedia` the display mode standalone,
which `viewport-fit=cover` turns into `env(safe-area-inset-*)`. In both themes at both widths: the inset reaching the
app's tokens; Skip to main content off-screen until focused, then below the status bar; the top bar at the screen's top
with its ☰ below the status bar; the drawer's logo below it and its foot above the home indicator, with nothing to
scroll; Settings' end above the indicator; Search's bar pinned below the top bar; at 360 px the item dialog's title and
button; and a browser tab with no insets as before. Edge can't show iOS's own bug (its `vh` counting the status bar):
the owner checks that on a preview link.

`check-m10-merge-tags.cjs` (M10.24, the feedback after M10) checks Settings' Custom tags on `ng serve` for a Canadian
in Alberta (base URL ending in `/`), with Family, Work and family written to IndexedDB and Netflix Standard tagged
family, in both themes at both widths, keyboard only: the note under family alone, Merge into it asking first with
focus on Merge, Escape keeping both, then Merge moving the subscription to Family, deleting family and putting focus on
Family's ✎, with axe on the note and the question and no horizontal scroll.

`check-m10-menus-snackbars.cjs` (M10.19, the feedback after M10, part 2) checks, on `ng serve` for a Canadian in
Alberta (base URL ending in `/`), in both themes at 360 px (as the Home Screen app: CDP's safe areas, the display mode
standalone and touch, as `check-home-screen-app.cjs` sets them) and 1280 px: the first-run dialog's Province, opened by
typing, closed by a tap that leaves focus in it, by focus going nowhere (`blur()`, an iPhone keyboard's Done) and by a
tap or click on the dialog's heading, then Alberta picked by a tap or click; Search's Category (its panel at 1280 px,
its drawer at 360 px) picking VPN by a click or tap and closed the same three ways; then Lists' 🗑 → Delete list's
"Deleted Work Related" with Undo and ✕ (Dismiss), 8 px above the screen's bottom (42 with the home indicator); Escape
in a question opened over it closing only the question; Tab from the page to Undo, then ✕, and Enter on ✕ with focus
back where it came from; Escape closing the next; at 1280 px light, hovered past its 10 s it stays, and left it goes.
With axe on the open lists and the snackbar, and no horizontal scroll.
- An iPhone leaves focus in a field when a tap lands on something that can't take it, which Edge doesn't: the script
  sends that tap's pointer events itself, with no focus change (`iphoneTap`).
- An open list covers the dialog's text below its field, so a real tap or click elsewhere goes to the heading.
- Since M10.19 a snackbar's text is its message, its action and ✕'s icon name ("close"): read the message from
  `ss-snack .mat-mdc-snack-bar-label` (the container's own `.mat-mdc-snack-bar-label` wraps all of it), and find a
  button by its name, since there are two.
`check-m10-ids.cjs` (M10.27, ids that last) checks on `ng serve` for a Canadian in Alberta (base URL ending in `/`, after
`npm run data:build` on the branch), with Work Related (Claude's `claude.max-20x`, now Ultra, and Netflix Standard with
Ad free ranked Needed) and Home's plan notices written to IndexedDB, and every catalog file served with Netflix Standard
retired and ending on Mar 1, 2027 (`context.route`): List view's "Ultra (formerly Max 20x)" and the retired note, Home's
Plan changes, Search finding "max 20x" as Ultra and offering no Netflix Standard, and Optimizations' Plans that end
with Tab to its first plan and Enter opening it in Search. In both themes at both widths, with axe, screenshots and no
horizontal scroll.

`check-m10-billing.cjs` (M10.28) checks on `ng serve` for a Canadian in Alberta (base URL ending in `/`), with Work
Related (Claude Pro and Ultra, monthly, added Oct 20 and renewing Nov 12) and every catalog file served with Claude Pro's
Canadian monthly price retired: List view's card and Home saying it counts as yearly from Nov 12, with Check your billing
linking to claude.com/pricing; Ultra's "(formerly Max 20x)" until its renewal; then on Home by keyboard Keep (the item
grandfathered in IndexedDB, the check gone, the snackbar's Undo bringing it back) and Switch (billed yearly from Nov 12).
In both themes at both widths, with axe and no horizontal scroll.

`check-m10-category.cjs` (M10.22, the feedback after M10, part 2) checks Search's Category on `ng serve` for a Canadian
in Alberta (base URL ending in `/`), in both themes at 1280 px (the filter panel) and 360 px (the drawer): empty while
it's All with its label in the field, then focused by Tab with its label floated and "All" its placeholder, "vp" typed
at once narrowing the list to VPN and Enter picking it, and All picked with the pointer emptying it again, with axe on
the field focused and not, and no horizontal scroll.
`check-m10-lists-budgets.cjs` (M10.23, the feedback after M10, part 2) checks the Lists overview's budgets on `ng serve`
for a Canadian in Alberta (base URL ending in `/`), with a $20 monthly and $300 annual budget, Work Related (Netflix
Standard) and Family (Crave Premium), both due this month, in both themes at both widths: the overview's warnings the
same as Home's, its This month and This year bars the same amounts as Home's Budgets card, on the right above Types at
1280 px and above the cards at 360 px, and a warning's ✕ by keyboard hiding it there and on Home, with axe and no
horizontal scroll. Since M10.23 `check-lists.cjs` counts each card's bars (`li.card ss-budget-bar`), apart from every
list's together in `.money`.

`check-m10-join-link.cjs` (M10.14 and M10.15, the feedback after M10, part 2: sync's one-time join link and joining on
the first visit) needs wrangler dev answering the API, with its user database migrated (`npm -w apps/api run
db:user:migrate:local`, for `join_links`): behind `ng serve`'s proxy (`http://localhost:4300/`), or the production
build itself (`http://localhost:8787/`), where the CSP and Trusted Types apply. Its base URL ends in `/`. For a Canadian
in Alberta, in both themes at both widths, by keyboard: A turns sync on (the words, no QR code), then Show the code's QR
code is read back from its SVG with the decoder and must be a join link on this site; B, a new device, opens the link
(the address loses it at once, Join over the first run's dialog, no Merge or Replace, the settings the copy's with B's
theme); C opens it again ("used or has expired"); A's Make a new QR code and Done withdraw their links, and the local user
database (`wrangler d1 execute --local`) keeps none; D, a new device whose camera plays A's next QR code, joins from the
first run's Join with a sync code by scanning. Light and wide only: a link opened with the app lock on, unlocked; a link
moved past its 10 minutes in the local database; Show the code offline. It checks no request carries a link's key.
- Edge plays a Y4M file as its camera (`--use-fake-device-for-media-stream`, `--use-file-for-fake-video-capture`,
  `--use-fake-ui-for-media-stream` and the context's `camera` permission), so a browser with a camera is launched for
  each QR code: the script writes the code as drawn, 8 px a module, into a 640 by 480 grey frame.
- Every browser here shares one IP, and wrangler dev holds it to the API's 10 writes a minute, in the wall clock's
  minutes: `room(n)` waits for the next minute when a step's writes wouldn't fit.
- `wrangler d1 execute` gets its SQL from this script's own node and wrangler's JS entry, with no shell: Volta's shim
  passes arguments through cmd, which splits them.

`check-after-m3.cjs` (the feedback after M3: M5.13, M6.17–M6.19, M7.11, M8.5, M8.6, M9.6) checks the batch on
`ng serve` for a Canadian in Alberta, with Streaming (Crave Premium and Disney+ Premium) and Family (two Disney+
Premium, Netflix Standard auto-renewing until an end date, Mullvad renewed by hand, and four more so it scrolls). In
both themes at both widths, keyboard only, each part on its own:
- List view: Netflix's "Renews Nov 12, then ends Nov 28" (M6.19); Sort's filters opened, the page scrolled to its foot,
  the bar still at its sticky offset (read from its own `top`) and the filters under it on screen (M6.17); at 360 px
  Sort's icon, and View optimizations' icon and count, even on both sides of their buttons (M6.18); the item dialog's
  "Auto-renews until it ends" and Ends on's "It stops then: no renewal after", then Cancel;
- the bundle (M8.5, M8.6): its card applied by Enter, after which no card left changes either plan; Review changes'
  lines (− for each plan, ending when what's paid
  for runs out, + for the bundle from then) and totals (this year not up, the next 12 months down by the card's
  saving); Undo by Enter emptying it, Back to optimizations, applied again and Save changes; the saved bundle's start
  and both plans' ends, and List view's "Moves to Disney+ and Crave Premium Bundle on Nov 12" (M7.11);
- the extra member (M8.5): whichever Disney+ Premium the optimizer chose ends on its next charge and its extra member
  joins the other that day, in Review changes, in IndexedDB (the add-on's `since`) and on List view's cards;
- Settings' "Show every reseller" by Space (M5.13), then Mullvad's card on Search with its "Also at" resellers too;
- a buyer in the US (its own context: the settings rewritten to US-NY and USD, `/fx` answered for the base asked for),
  Proton Unlimited billed yearly on a USD card with no FX fee (M9.6): "Pay for Proton Unlimited in CAD", its "From
  <date>, paid with No FX Visa" and Estimated tag, Review changes' "Paid in CAD from <date>: CA$149.88 a year + tax",
  and the saved `priceOverride` with its `since`. Billed monthly, annual billing would come first and hold it back.

What it taught:
- A dialog moves focus to its heading (or its first field) once it has opened: wait for that before pressing Tab, or
  the dialog takes focus back mid-way and what's typed goes nowhere.
- A menu you can type in opens its list on focus. Tab pressed right after it opened came before Material set up its
  own closing: the list stayed open over the next field, and two presses with no gap sent focus out of the page (no
  `focusin` at all). The field closes its list on the Tab keydown now, and when focus moves to another control.
- CDK draws a menu's list inside the dialog that holds its field (a popover in the top layer, not in
  `.cdk-overlay-container`), so a press on a choice moves focus to the dialog, the nearest focusable element around
  it. A blur rule that closed the list for focus going outside the list's own pane closed it on mousedown, and the
  click landed on the dialog: no mouse pick worked. The rule now is the tag picker's: leave it alone when focus goes to
  an element that holds the field. Unit tests run in jsdom, where the list is at the page's end, so only a browser
  shows this; `check-settings.cjs` and the older scripts' first runs pick by mouse.
- List view's compact View optimizations sat between Sort and the menu Sort opens, so Tab after opening Sort went to the
  link, not the menu: it comes before Sort now.
- An icon's word is in a button's `textContent` with no space ("checkStandard", "eventCalendar (.ics)"): read the
  label's own span, or drop `mat-icon` first.
- Tab into a tag picker stops on its chips first: wait for the chip grid's input (`.mat-mdc-chip-input`).
- The list editor's Cancel asks "Discard changes?" a moment later: wait for the question or the editor to go.

Since M7.1, the scripts check the charges:
- `check-list-view.cjs`: Mullvad's "Renew by Nov 12", Netflix's next charge as charged in its details ("Next charge Nov
  12, 2026: $19.94, with $0.95 tax", Alberta's 5%), and Wrong date? by keyboard: the dialog filled in with focus in
  its field, a new date saved as the item's anchor with no draft, the card following it, focus back on Wrong date?,
  and the Enter that saves not opening it again. Wait for focus in the field before typing: the dialog moves it there
  once it's open.
- `check-list-edit.cjs`: a row's "Renews Nov 12 · auto".
- `check-search.cjs`: a provider renewed by hand (Mullvad, yearly, auto-renew off) shows "Renew by Jan 20".

Since M7.2, the totals:
- `check-lists.cjs`: each card's "≈ $27.79 this month · ≈ $333.44 this year · 2 subscriptions" with no bars, then
  with budgets written to the settings (and a reload), its bars named "Work Related, monthly budget", the monthly one
  over its $20 in red at 139%, with axe.
- `check-list-view.cjs`: the side column's "≈ $27.79 this month | ≈ $356.54 in 2026", each card's "…% of list over the
  next 12 months", the totals above the cards at 360 px and beside them at 1280, then with budgets a bar for each named
  by its heading ("Monthly budget: 13%, $27.79 of $200.00"), with axe.
- `check-list-edit.cjs`: the footer's "This month ≈ $27.79".

A record written straight to IndexedDB isn't seen by Dexie's live queries: reload the page after it, as the planting
steps do.

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
- Since M6.16 the first-run and 📍 dialogs' Country, province or state, and Currency are menus you can type in
  (`ss-choice-field[data-label="…"] input`). A click on the field, or its `.mat-mdc-text-field-wrapper`, opens the
  list; typing narrows it, and its first is made active a moment after the list changes, so wait about 400 ms before
  Enter. Tab into a filled one selects what it shows; Control+A first anyway. A list's options aren't focusable:
  read focus from the field, not the option.
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
- Offline on `ng serve`, a lazy page that hasn't been opened in the session can't load its chunk, and the error
  snackbar shows: navigate offline only to pages already opened. The production build's service worker (M10.5) holds
  every chunk once it controls the page, which `check-m10-offline-sync.cjs` checks under `wrangler dev`.
- Under `wrangler dev` the production build registers its service worker (M10.5), which then fetches the page's
  requests itself, past `context.route`. Scripts that answer requests themselves create their contexts with
  `serviceWorkers: 'block'` (`check-catalog.cjs`, `check-search.cjs`, `check-optimizations.cjs`, the progress preview's
  `csp-check.cjs`) and leave Playwright's console warning "Service Worker registration blocked by Playwright" out of
  their console check. `ng serve`'s development build registers no worker.
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
