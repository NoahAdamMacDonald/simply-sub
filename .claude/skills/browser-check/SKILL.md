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

## Gotchas

- Light/dark: create the browser context with `colorScheme`; ThemeService follows the OS when nothing is saved.
- `data-theme` updates on the next tick after a toggle; wait for it rather than checking right away.
- MatSidenav moves focus into the drawer only after its slide-in ends, and listens for Escape on the drawer
  itself. Wait for focus inside the drawer before pressing Escape.
- Inject axe with `page.addScriptTag({ path: '<deps>/node_modules/axe-core/axe.min.js' })`, then
  `axe.run(document)`. A page-level `region` violation means content outside every landmark.
- Trigger the error snackbar with `page.evaluate(() => setTimeout(() => { throw new Error('x'); }))`.
