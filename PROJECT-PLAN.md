# Simply Sub — Project Plan

> **What this is:** the build guide. It turns BLUEPRINT.md into ordered tasks, and gives a full spec for every page,
> including the pages that aren't in Figma yet (list view, list edit, item dialog, add-to-list flows, custom
> subscriptions, optimizations).
>
> | File | Holds |
> |---|---|
> | [BLUEPRINT.md](BLUEPRINT.md) | Architecture, data model, hosting, decisions: the *why* and *what* |
> | **PROJECT-PLAN.md** (this file) | Build order, page specs, acceptance criteria: the *how* and *when* |
> | [docs/api-output-examples.json](docs/api-output-examples.json) | An example request and response for every API endpoint (the API contract) |
> | [docs/wireframes/](docs/wireframes/) | The Figma screenshots referenced below |
>
> If this file and BLUEPRINT.md disagree, treat it as a bug and fix whichever is wrong in the same PR.
> **For AI assistants:** implement one task ID at a time (section 2) and check it against its page's acceptance criteria.

Last updated: 2026-10-23

---

## Contents
1. [How to work on the project](#1-how-to-work-on-the-project)
2. [Build order: milestones and tasks](#2-build-order-milestones-and-tasks)
3. [Core rules every page uses](#3-core-rules-every-page-uses)
4. [App shell, theme additions and shared components](#4-app-shell-theme-additions-and-shared-components)
5. [Page specs](#5-page-specs)
6. [API work plan](#6-api-work-plan)
7. [Testing plan](#7-testing-plan)
8. [Wireframe → spec changes](#8-wireframe--spec-changes)

---

## 1. How to work on the project

### 1.1 Workspace
- **Keep the code out of OneDrive.** Put the repo somewhere like `C:\dev\simply-sub`. OneDrive tries to sync
  `node_modules` (tens of thousands of files) and can lock files mid-install, which breaks `npm install` and
  Angular builds. GitHub is the backup.
- In task M0.1, move the planning files into the repo:

  | Now (this folder) | In the repo |
  |---|---|
  | BLUEPRINT.md, PROJECT-PLAN.md, CLAUDE.md | repo root |
  | docs/api-output-examples.json, docs/wireframes/ | `docs/` |
  | plan.txt, pages.txt, subscriptions.txt, api-*-example.json | `docs/drafts/` (history only) |
- The repo is public, so `docs/wireframes/` and `docs/drafts/` stay local (gitignored). Everything else above is committed.
- When you change a Figma frame, re-export it into `docs/wireframes/` under the same file name.

### 1.2 Day-to-day workflow
1. Turn each task ID in section 2 into a GitHub issue (e.g. "M5.3 Search filter panel"), and track them on a
   GitHub Project board: Todo → Doing → Review → Done.
2. Use one branch per task: `feat/m5-3-search-filters`.
3. Open a PR early. CI (the required check `ci`) runs `npm audit --audit-level=high`, lint, the Prettier check, a check that `data/schema/` matches
   the Zod schemas, the catalog checks (`data:validate`), tests and the build (BLUEPRINT §7.6). Each branch also
   gets a Workers Builds preview link.
4. Squash-merge to `main` once `ci` is green; that's the only merge method, and the branch is deleted after.
   `main` is protected with no bypass, so nothing reaches it without a PR. Workers Builds then deploys to
   sub.simplely.ca automatically.
5. Commit messages: `feat(search): add price range filter`, `fix(calendar): month-end dates`.

### 1.3 Working with an AI assistant
Start each task in a fresh conversation with:
```text
Read CLAUDE.md, then BLUEPRINT.md §<n> and PROJECT-PLAN.md §<page> / task <ID>.
Task <ID>: <title>
Acceptance criteria: <copied from this plan>
Rules: follow the CLAUDE.md conventions; business logic goes in packages/core with Vitest tests;
keep the change limited to this task; ask before changing the data model or the API contract.
```
Review the diff, run it, and check the acceptance criteria yourself. If a decision changes during the task,
update BLUEPRINT.md / PROJECT-PLAN.md in the same PR, so future AI sessions get accurate context.

### 1.4 Definition of done (every task)
- [ ] Acceptance criteria met
- [ ] Tests: unit tests for logic in `packages/core`, component tests for interactive UI
- [ ] `npm run lint` and `npm test` pass; CI is green
- [ ] Checked in light **and** dark theme, at **360 px** and **≥ 1280 px** wide, and with the keyboard only
- [ ] Colours come from CSS tokens only (no hex values in components)
- [ ] Docs updated if behaviour or the API contract changed

---

## 2. Build order: milestones and tasks

```
M0 Setup ──► M1 Catalog data ──► M2 API
  │              └──► M3 Discovery pipeline (runs alongside everything below)
  └──► M4 App foundations ──► M5 Search & add ──► M6 Lists & ranking ──► M7 Money & calendar
                                                                            └──► M8 Optimizer ──► M9 Payment ──► M10 Extras
```
- M4 only needs the catalog **file** from M1.5 (as a fixture), not the deployed API.
- Mapping to BLUEPRINT phases: M0–M3 = Phases 0–1, M4–M6 = Phase 2, M7–M8 = Phase 3, M9 = Phase 4, M10 = Phase 5.

### M0 — Setup
These rows describe the setup as built, at `simplely.ca/simply/sub/`. The security review (2026-10-23) moved the
app and the API to `sub.simplely.ca` (BLUEPRINT §7.3).

| ID | Task | Done when |
|---|---|---|
| M0.1 | Create the GitHub repo `simply-sub`, clone it to `C:\dev\simply-sub`, move the planning files in (§1.1) | The repo has the docs, and the README links to them |
| M0.2 | Root workspace: `package.json` workspaces, `volta pin node@24.19.0 npm@12.0.2`, `tsconfig.base.json`, ESLint, Prettier, `.editorconfig`, `.gitignore` | `npm install` from the root works; `node -v` inside the repo prints 24.19.0 |
| M0.3 | Scaffold `apps/web` (Angular 22.2.3, SCSS, routing, no SSR); add Angular Material; production `baseHref: /simply/sub/` | `ng build` outputs `dist/web/browser` with `<base href="/simply/sub/">` |
| M0.4 | Theme: `styles/_tokens.scss` (BLUEPRINT §8.1 + §4.1 below), Material theme mapped to the tokens, Inter and Material Symbols self-hosted (`@fontsource/inter`; no Google Fonts requests), `ThemeService` (system/light/dark, saved) | The theme toggle works; no hex values exist outside `_tokens.scss` |
| M0.5 | App shell (P1): sidebar, a lazy placeholder route for every page, responsive drawer, not-found page (P15) | Every nav link works; the layout is fine at 360 px |
| M0.6 | `packages/core` with Vitest; path alias `@simply-sub/core` | A sample test passes in CI; the web app imports from core |
| M0.7 | `apps/api` Worker (Hono) with `/health`; `wrangler.jsonc` (BLUEPRINT §7.4); a script that copies the web build into `apps/api/public/simply/sub/`; dev proxy | `wrangler dev` serves the app and `/api/sub/v1/health` |
| M0.8 | D1 database + migration `0001_init.sql` (BLUEPRINT §5.3) | The migration applies locally and remotely |
| M0.9 | Connect Workers Builds and add the simplely.ca routes | https://simplely.ca/simply/sub/ and https://simplely.ca/api/sub/v1/health respond |
| M0.10 | GitHub Actions `ci.yml` + branch protection on `main` | A PR with a failing test can't be merged |

### M1 — Catalog data
| ID | Task | Done when |
|---|---|---|
| M1.1 | Zod schemas + types for the catalog (features with tiers and headline flags, providers, plans, prices, add-ons, bundles); generate JSON Schema for YAML autocomplete | VS Code autocompletes and validates `data/**/*.yaml` |
| M1.2 | `data/features.yaml` and `data/categories.yaml` (service, feature and spend categories) | Every feature used by the first providers exists |
| M1.3 | Hand-write `netflix`, `disney-plus`, `crave`, `mullvad`, `proton` and one bundle. Proton: Free, the Plus plans, and the Unlimited, Duo and Family suites; no business plans (BLUEPRINT §4.4) | All pass validation, and their shapes match `docs/api-output-examples.json` |
| M1.4 | `scripts/validate-data.ts` (BLUEPRINT §6.2) in CI | A broken file fails CI with a readable message |
| M1.5 | `scripts/build-catalog.ts` → static `catalog.json` + `seed.sql` | The output matches the `GET /catalog` example |
| M1.6 | `scripts/fetch-icons.ts` (`npm run data:icons`): any website's best icon → `data/logos/<id>.png` (committed, hand-made logos too), published as `/icons/<id>.webp`, a WebP of at most 96 px (a PNG copy until 2026-10-25); no logo → no `iconUrl`, and the app shows a letter | Every provider has an icon or the fallback |
| M1.7 | core: `pickPrice`, `convert` (§3.1; `monthlyEquivalent` arrived in M1.5 for the seed) | Tests cover a native price, the same currency from another region, a GLOBAL price and a fallback region |

### M2 — API
| ID | Task | Done when |
|---|---|---|
| M2.1 | `GET /catalog` (+ ETag / 304) and `?region=`, served from static snapshot files: `data:build` also writes `data/catalog/<region>.json` for each priced country and group, and `data/catalog/index.json`; a region without a file gets the full snapshot (BLUEPRINT §6.3). D1: migration 0002 (`WITHOUT ROWID`, a `catalog` row in place of `snapshots`, a provider `hash`), and a seed that writes only what changed, run by `npm run deploy` (BLUEPRINT §5.3, §7.6). `/health` reports the catalog version, build time and counts | Matches the examples; a code-only deploy writes no D1 rows, and a one-provider change writes only that provider's |
| M2.2 | `GET /features`, `GET /categories`, served from static files: `data:build` also writes `data/catalog/features.json` and `categories.json`, streamed like `/catalog` with the same ETag and 304 (BLUEPRINT §5.2, §6.3). No query parameters; `features.yaml` lists each group before its features | Match the examples (body, meta, status, Content-Type, Cache-Control, ETag); neither route reads D1 |
| M2.3 | `GET /providers`: search, filters, sort, cursor pagination, with queries that use the indexes (D1 counts every scanned row as read: BLUEPRINT §7.1). Built after M2.5, whose rates it converts with. The logic is core's `searchProviders`, `readProvidersQuery` and `providersBody`, with `rankKeyOptions`/`providesKey` (§3.2) and `regionCurrency`; D1 narrows by rank key through `plan_features`' index, with no migration | Every query parameter in the examples works |
| M2.4 | `GET /providers/:id`, `GET /plans/:id`, `GET /bundles`, plus the 404 shape. The logic is core's `providerBody`, `planBody` and `bundlesBody`, `readPricingQuery` and `readBundlesQuery` (GET /providers' region and currency rules), `bundleFeatures` and `bundleSavings` (BLUEPRINT §4.4) and `providedKeys`; D1 reads by primary key and the `bundle_plans (plan_id)` index, with no migration; 404 and 400 suggestions come from a static `data/catalog/ids.json` | Match the examples, including the 404 for an unknown provider with its suggestion |
| M2.5 | `GET /fx`: Frankfurter proxy, cached 12 h, serves the last good value if Frankfurter is down, kept in KV (binding `KV`: the namespace `simply-sub-kv`, made with `wrangler kv namespace create`, and its id is in `wrangler.jsonc`: BLUEPRINT §7.1, §7.2). Built before M2.3, which converts prices with the same rates: one copy in euros from Frankfurter's ECB-only route, rebased to any base in core (BLUEPRINT §5.2) | Matches the example, including the `stale` flag |
| M2.6 | `GET /icon?domain=`: icon proxy for custom subscriptions, cached 30 days in KV (a day for "no icon", keys hashed), restricted as in BLUEPRINT §5.4, using core's icon functions (M1.6) and `readIconQuery`; no `size`; request logs off (`invocation_logs: false`) | Returns an image, or 404 when there's no usable icon; a non-domain, an IP address or a URL gets `400`, nothing but the fixed icon services is ever fetched, and the domain never reaches the logs |
| M2.7 | Contract tests: every example in `docs/api-output-examples.json` is validated against the response schemas (core's `successBodySchemas` and `errorBodySchema`, which type the bodies), and `apps/api/test/contract.spec.ts` sends every built endpoint's example to the Worker and compares the answer (BLUEPRINT §13.3) | The examples and the code can't drift apart |
| M2.8 | Error middleware, CORS, caching, security headers and the per-IP rate limit (BLUEPRINT §5.4): `apps/api/src/middleware.ts`, with the edge Cache API for the routes that read D1 or KV (BLUEPRINT §5.1) and limits of 60 requests a minute per IP, 10 on `/icon`; the static files' `_headers` (a strict CSP with Trusted Types, the theme script's hash, immutable hashed files, icons for a day: BLUEPRINT §7.6). Request logs went off in M2.6 | Headers match the examples; going over the limit gets `429 rate_limited`; the CSP still lets Cloudflare Web Analytics load (BLUEPRINT §7.6); the app runs with no CSP or Trusted Types violations in the console |

### M3 — Discovery pipeline (BLUEPRINT §6.5)
| ID | Task | Done when |
|---|---|---|
| M3.1 | `discover-services.ts` (Wikidata) → `data/queue.yaml` | The queue has services with websites and categories |
| M3.2 | `find-urls.ts` (common paths → sitemap → nav links → search API) | At least 80% of a 20-service sample get a correct pricing URL |
| M3.3 | Playwright renderer, run locally so prices come back in CAD | Text and a screenshot are saved for each page |
| M3.4 | `extract-plans.ts` (LLM structured output, evidence quotes, proposed features; regular prices, the billing period as stated, `availableIn` from the provider's own country list: BLUEPRINT §6.5) | Draft YAML passes validation for most services |
| M3.5 | Batch PR script (`gh pr create`, about 10 providers per PR), with each new provider's logo fetched into `data/logos/` the way `npm run data:icons` does | One command turns a batch into a reviewable PR, logos included |
| M3.6 | Run it on your own services (BLUEPRINT §6.6) and tune the prompts | Your subscriptions are in the catalog with CAD prices |

### M4 — App foundations
**Before starting:** Home has a temporary progress preview (added after M2.8 to see the catalog and the API in the
running app). Delete `apps/web/src/app/features/home/progress-preview/` and its two lines in `home-page.ts` and
`home-page.html`. Keep `apps/web/src/zod-setup.ts`: it isn't part of the preview.

| ID | Task | Done when |
|---|---|---|
| M4.1 | Dexie database (BLUEPRINT §4.6, including `region`, add-on quantities, bundle items, `billingDay` and `priceOverride.until`) + repositories that expose signals. Repositories are the only way into Dexie, only non-sensitive fields are indexed, and records are Zod-validated on the way in and out (BLUEPRINT §11.1) | CRUD tests pass with `fake-indexeddb`, and a malformed stored record is rejected rather than shown |
| M4.2 | `SettingsStore` + first-run dialog (P1), with the province/state menu and the sales-tax rate (BLUEPRINT §4.8); `ThemeService` reads and writes `settings.theme`, keeping `localStorage` `ss-theme` as the startup cache (BLUEPRINT §8.1) | Country, province or state, and currency are saved, with defaults from the browser locale; the menu lists only the chosen country's subdivisions |
| M4.3 | `CatalogStore`: cached snapshot → revalidate `data/catalog/index.json`, and when its `catalogVersion` changed, fetch the region's file (`regionFileFor`: `data/catalog/<region>.json`, its group's or `catalog.json`; plus any region a list item uses) → save; the offline banner and "Catalog updated" toast (P1) | The app works offline after the first visit, and the banner shows the catalog's date |
| M4.4 | `FxStore` + `ss-price` with the converted marker and "+ tax" in tax-added regions | Converted prices show ≈, the icon and the tooltip; a Canadian sees "+ tax" |
| M4.5 | Shared components (§4.3) + a `/dev/components` gallery (dev builds only) | Every component renders in both themes in the gallery |
| M4.6 | `MetricsService` skeleton: resolved items (§3.4) from repos + catalog + FX | Unit tests pass with a fixture list |

### M5 — Search & add
| ID | Task | Done when |
|---|---|---|
| M5.1 | core: search index, matching and filters (`searchCatalog`), using `availability` (BLUEPRINT §4.7). Starts from M2.3's `searchProviders`, which already has P8's matching, filters and sorts | Name, plan, alias and feature matches are ranked as described in P8, and plans not offered in the user's region never appear |
| M5.2 | Search page layout, results and the search sub-card with expand (P8) | P8 layout criteria met |
| M5.3 | Filter panel + URL state (P8) | Filters survive a reload and back/forward |
| M5.4 | Add-to-list menu → edit page with `?add=` (flow F1) | F1 works end to end (needs M6.3–M6.5; stub it until then) |
| M5.5 | Pick mode `?addTo=` (flow F2) | F2 works end to end |

### M6 — Lists & ranking
| ID | Task | Done when |
|---|---|---|
| M6.1 | core: rank keys, `providedKeys`, `resolveRank`, `rankCounts`, `featureSummary` (§3.2). M2.3 added `rankKeyOptions` and `providesKey`, and M2.4 `providedKeys` (`ranking/rank-keys.ts`) | Tests cover enum and tier ladders and the resolution order |
| M6.2 | Features page (P9) | P9 criteria met |
| M6.3 | `ListDraftService`, with drafts saved in Dexie | A draft survives navigation and a reload |
| M6.4 | List edit page (P5) | P5 criteria met |
| M6.5 | Item dialog (P6) | P6 criteria met |
| M6.6 | Custom subscriptions page + editor (P12) | P12 criteria met |
| M6.7 | Lists overview (P3) | P3 criteria met (the bars can wait for M7.2) |
| M6.8 | List view (P4), without the money parts | Cards, pinning, search/filter and the edit button work |
| M6.9 | Backup export/import (the "Your data" section of P13), with an optional passphrase that encrypts the file, and the crypto module it uses (BLUEPRINT §11.5) | Export → delete all → import restores everything, encrypted or not; a wrong passphrase or a tampered file imports nothing |
| M6.10 | Optional app lock: a passphrase encrypts the user tables at rest, with a lock screen and an idle lock (P13, P15; BLUEPRINT §11.5) | Locked data on disk is unreadable without the passphrase; turning the lock on and off round-trips every table; a wrong passphrase unlocks nothing |

### M7 — Money, schedule & calendar
| ID | Task | Done when |
|---|---|---|
| M7.1 | core: schedule engine for charges, statuses, totals and budget checks (§3.1, §3.3), with `addMonths` in core's `dates/`; sales tax in `tax/` with the Canadian rate table checked against official sources (BLUEPRINT §4.8) | Charges include tax by province and "plus tax" amounts. Tests cover month-end with and without `billingDay`, leap years, 30-day and 2-week cycles, windows, yearly repeats, start/end dates, a re-anchored date and a price override ending |
| M7.2 | Totals and budget bars on Home, Lists and List view | The numbers match the §3.1 definitions |
| M7.3 | Home (P2) | P2 criteria met |
| M7.4 | Calendar (P10): grid, day panel, list filter, upcoming list, agenda layout on mobile | P10 criteria met |
| M7.5 | Exports: ICS (one all-day event per charge, no `RRULE`s: BLUEPRINT §11.2), CSV, XLSX, TXT (lazy-loaded) | The files open in Google Calendar and Excel, and a plan billed on the 31st shows in every month |
| M7.6 | Budget warning banners | A warning appears for a projected over-budget month |

### M8 — Optimizer & bot
| ID | Task | Done when |
|---|---|---|
| M8.1 | core: optimizer (BLUEPRINT §10) with fixtures | All fixture cases pass |
| M8.2 | Optimizations page (P14) + "Apply" to a draft | P14 criteria met |
| M8.3 | `apps/bot` nightly price check → GitHub PR (BLUEPRINT §6.4, §7.7); the same run proposes a new logo when a provider's icon changed (a rebrand) | A changed price produces a PR, and so does a changed logo |

### M9 — Payment (Phase 4)
| ID | Task | Done when |
|---|---|---|
| M9.1 | Cards repo, Payment page and card dialog (P11) | P11 criteria met |
| M9.2 | `acceptedNetworks` in the data and the extraction pipeline (the schema has validated the field since M1.1) | The pipeline fills it |
| M9.3 | core: eligibility, FX and cash-back maths, card assignment, limit checks (BLUEPRINT §9.3) | Tests pass |
| M9.4 | Card select in the item dialog, net-cost displays, over-limit warnings | All visible on P4, P6, P10 and P11 |

### M10 — Extras (Phase 5)
Live calendar feed (`POST /cal`), encrypted device sync, "report a wrong price", PWA install and offline mode,
calendar year view, broader regional price coverage.

---

## 3. Core rules every page uses

These live in `packages/core` as pure functions, so every page computes them the same way.

### 3.1 Money and time
| Term | Definition | Used by |
|---|---|---|
| **Picked price** | The price `pickPrice` chooses for the user's region and currency: one source region and currency per plan, add-on or bundle, with every interval priced there, converted if it isn't in the user's currency. Native means no conversion was needed (BLUEPRINT §4.7) | Everywhere a price appears |
| **Item price** | The price override if one is set and the charge is dated before its `until` (if any); otherwise the picked plan price plus each picked add-on price × its quantity. Bundle items use the bundle price | Charges |
| **Sales tax** | Added to the item price for a buyer in a tax-added region (Canada, US) at their rate: the built-in rate for their province, or their own `salesTaxPercent`. Typed amounts (a custom plan, a price override) already include it unless marked `plusTax` (BLUEPRINT §4.8) | Charges |
| **Monthly equivalent** | Price per month: year ÷ 12, week × 52 ÷ 12, day × 365 ÷ 12, each ÷ `intervalCount`. Before tax, like the price tags | Sorting, the price filter, "≈ $x/mo" hints |
| **Charge** | One scheduled payment: `{ date, amount, tax, currency, itemId, listId, converted, manual }`. `amount` includes `tax`, the sales tax part | Calendar and all totals |
| **This month** | Sum of the charges dated in the current calendar month | Monthly budget bars, list cards |
| **This year** | Sum of the charges dated in the current calendar year (Jan 1 – Dec 31) | Annual budget bars, list cards |
| **Next 12 months** | Sum of the charges from today up to, but not including, the same day next year (so a yearly plan renewing today counts once) | An item's "% of list", optimizer savings |

**Charge rules**
- **Ongoing billing:** charges fall on `anchorDate` plus or minus whole intervals. Each date is computed from the
  anchor (for months, `addMonths(anchor, n × intervalCount)`), never from the previous charge, so dates don't
  drift.
  - **Months and years:** the charge falls on the anchor's day, or on the month's last day when it's shorter: an
    anchor of Jan 31 gives Feb 28 (29 in a leap year), Mar 31, Apr 30. This is how Netflix and Stripe-billed
    services work. A yearly anchor of Feb 29 gives Feb 28 in other years.
  - **`billingDay`** (29–31) is the day when the anchor is a shorter month's last day: anchor Feb 28 with
    `billingDay: 31` gives Mar 31, Apr 30. The item dialog asks for it only when the date entered is the last day of
    a month shorter than 31 days.
  - **Days and weeks** are plain counts: `day` × 30 from Jan 31 gives Mar 2, Apr 1, May 1. A 30-day plan can
    charge twice in one month, and that month's total and budget check include both.
  - Only dates on or after `startDate` (if set) and before `endDate` (if set) count.
  - No `startDate` means it's assumed to have been active already, so earlier charges this year count toward
    "this year".
  - `autoRenew: false` doesn't stop charges. It marks them `manual`, and the calendar shows "Renew manually".
    Only `endDate` stops them.
- **Dates are expected dates.** Charges are calendar dates with no time. A provider's time zone can put the real
  charge a day either side, and some events move the date for good: a failed payment that goes through later
  (Netflix bills from that day on), a plan change, a pause, or app-store billing that keeps the earlier day after a
  short month. So **changing an item's next renewal date makes it the new `anchorDate`**, and every later date
  follows it. The list view and the calendar day panel offer this directly ("Wrong date?"), saved straight to the
  item like pinning.
- **Free plans:** a $0 price creates no charges, so a free item never appears on the calendar and adds nothing to
  totals. A price of 0 shows as "Free", never with ≈ (pickPrice marks it native).
- **Specific dates (limited windows):** a charge at each window's start, then one every interval while the date is
  before the window's end. The item is active from `start` through `end`, both included. `repeatYearly` copies the
  window into every year. Example: Sep 2 – Nov 1, monthly → charges on Sep 2 and Oct 2, active until Nov 1; a window
  of Sep 2 – Nov 2 gives the same charges, since none falls on the end date.
- **Currency:** everything is totalled in the user's currency. A total that includes a converted amount shows "≈".
- **Rounding:** keep full precision internally and round to 2 decimals only for display.

**Budget checks** (warning banners on Home and List view)
- Monthly: if *any* of the next 12 calendar months has more charges than the monthly budget, warn and name the first one.
- Annual: if this calendar year's charges (past + projected) exceed the annual budget, warn.

### 3.2 Rank keys
Users rank **rank keys**. Each one points to one rankable option of a feature:

| Feature type | Rank key example | A plan **provides** it when… |
|---|---|---|
| boolean | `streaming.ad-free` | the value is `true` |
| enum | `video.quality=1080p` | its value is **at least** 1080p in the enum order (a 4k plan provides 1080p) |
| number with tiers | `streaming.concurrent-streams=2-4` | its value is **at least the tier's min** (or `unlimited`) |
| set | `password-manager.item-types=passkey` | the set contains `passkey` |

- **Groups:** a boolean feature with children (e.g. `password-manager`) is a group. Its rank applies only to the
  group itself ("I want a password manager"). Children start as Not ranked, and ranks never cascade (BLUEPRINT §4.2
  explains why). The Features page offers "Set all in this group" for bulk ranking.
- **Resolution order** for an item: the item's override for the key → the profile rank for the key → `not-ranked`.
- **Subscription-only ranks:** Essential (keep this exact plan) and Critical (keep this provider, any plan that
  still provides the feature) exist only as item overrides, never as profile ranks. The optimizer rules are in
  BLUEPRINT §10.2.
- "Not ranked" is never stored. Removing a rank deletes its record.
- Features with `rankable: false` (e.g. `includes-subscription`) never appear in ranking UIs.

**Counts and summaries**
- **Rank counts** (list cards): for each item, and each key its plan provides, count the key's effective rank.
  Show all eight ranks from Essential to Unwanted, with zero counts in grey. Not ranked isn't shown.
- **Feature summary** ("VPN 2 / 3"): for each summary key, *active items that provide it* / *all items that provide it*.
  The summary keys are the keys marked `headline: true` in the registry, plus any key the user ranked Essential,
  Critical, Needed or Wanted. Only keys with a total of at least 1 are shown, sorted by rank and then by name.

### 3.3 Statuses
| Status | Rule | Shown as |
|---|---|---|
| Active | Today is inside a paid period (ongoing: on or after `startDate` and before `endDate`; limited: from a window's start through its end) | Green dot, "Active" |
| Inactive | In a list but not active today | Amber dot, "Inactive", plus "Active from Sep 10, 2026" when a future window or start date exists |
| Not listed | (Search only) The provider isn't in any list | Grey dot, "Not listed" |
| Ending | `endDate` is within the next 30 days | Small "Ends Nov 3" badge |
| Manual renewal | The next charge is `manual` | Small ↻ "Renew by Nov 3" badge |

In Search the status is per provider, across all lists ("Active · 2 lists").

### 3.4 View models
```ts
// packages/core/src/user/resolved.ts
export interface ResolvedItem {
  item: ListItem;
  listId: string;
  providerId?: string; planId?: string; bundleId?: string; customSubId?: string;
  name: string;            // "Netflix"
  planName: string;        // "Standard"
  iconUrl?: string;        // catalog: the relative icons/<id>.webp when the provider has an iconUrl (the absolute URL
                           // points at production, so a preview would miss a new logo); custom subs: /icon?domain=;
                           // none → ss-provider-icon shows a letter
  price: PickedPrice;      // amount, currency, interval, native/converted, FX info
  monthlyEquivalent: number;
  status: { kind: 'active' | 'inactive'; activeFrom?: string; endsOn?: string; manual: boolean };
  nextCharge?: Charge;
  providedKeys: RankKey[];
  effectiveRanks: Record<RankKey, Rank>;
  cardId?: string;         // Phase 4
}

export interface ListMetrics {
  thisMonth: number; thisYear: number; next12: number;
  approx: boolean;                                   // true if converted amounts are included
  rankCounts: Record<Exclude<Rank, 'not-ranked'>, number>;
  featureSummary: { key: RankKey; label: string; active: number; total: number }[];
  monthlyBudgetShare?: number; annualBudgetShare?: number;
}
```
`MetricsService` (Angular) builds these as `computed()` signals from the repositories, `CatalogStore`,
`FxStore` and `SettingsStore`. Components never recompute money or ranks themselves.

### 3.5 State and URL conventions
- **Saved data** (lists, items, rankings, tags, cards, settings, drafts) → Dexie.
- **Shareable UI state** (search query and filters, calendar month, selected lists) → URL query parameters.
- **Small per-device preferences** (the calendar's list filter, collapsed groups) → `settings`.
- Dialogs that need deep links use query params (`?add=`, `?item=`). All other dialogs are plain `MatDialog`s.

---

## 4. App shell, theme additions and shared components

### 4.1 Theme additions
Add these aliases to `_tokens.scss`. They build on the rank tokens in BLUEPRINT §8.1, so both themes get them:
```scss
:root {
  --status-active: var(--rank-wanted-text);
  --status-inactive: var(--rank-sometimes-text);
  --status-none: var(--rank-none-text);
  --suggest-hard: var(--rank-unwanted);      /* red    */
  --suggest-normal: var(--rank-unused);      /* orange */
  --suggest-soft: var(--rank-uses);          /* yellow */
  --ss-sidebar-width: 216px;
  --ss-radius-card: 12px;
  --ss-font: 'Inter', system-ui, sans-serif;
}
```

### 4.2 P1 — App shell & first run
**Wireframes:** every frame shares the shell; the dark version is `docs/wireframes/02-home-dark.png`.
```
┌──────────────┬───────────────────────────────────────────────────────┐
│ Simply (Sub) │                                                       │
│              │                                                       │
│    Home      │                                                       │
│    ────      │                  <router-outlet>                      │
│              │                                                       │
│    Lists     │                                                       │
│    Payment   │                                                       │
│    Features  │                                                       │
│    Calendar  │                                                       │
│              │                                                       │
│    Search    │                                                       │
│              │                                                       │
│ ⚙         ☀ │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```
- Sidebar order and spacing as in the wireframes: Home / Lists, Payment, Features, Calendar / Search, with ⚙ and ☀/☾ at the bottom.
- The logo is text: "Simply" plus an accent pill "Sub" (CSS, no image), so it follows the theme.
- The active link gets an accent underline and `aria-current="page"`; the others get a divider-coloured underline. ⚙ turns accent on `/settings`. Both use `--ss-accent-text`, which stays visible in dark mode.
- ☀/☾ toggles light and dark. "System" is chosen in Settings.
- Under 960 px the sidebar becomes a drawer (`MatSidenav`, mode `over`), opened from a top bar with ☰ and the logo. Navigating closes it and returns focus to ☰.
- The window scrolls, not a content pane: the sidebar is fixed in the viewport, and the router scrolls to the top on navigation and restores the position on Back. Pages shouldn't add their own full-height scroll containers.
- Global pieces: the skip-to-content link and the "Something went wrong" snackbar (P15) arrive in M0.5; the offline banner ("Offline — catalog from Oct 22") and the "Catalog updated" toast arrive with `CatalogStore` in M4.3.
- Page titles like "Lists · Simply Sub" come from each route's `title`.

**First-run dialog** (shown when Settings has no country):
```
┌ Welcome to Simply Sub ──────────────────────────────┐
│ Where are you?  [ Canada                 ▾ ]        │
│ Province        [ Ontario                ▾ ]        │
│ Currency        [ CAD — Canadian dollar  ▾ ]        │
│ Monthly budget  [ optional ]  Annual [ optional ]   │
│ Your data stays in this browser. No account needed. │
│ [Import a backup instead]             [Get started] │
└─────────────────────────────────────────────────────┘
```
The country defaults from `navigator.language` (`en-CA` → Canada), and the currency follows the country. The
Province (or State) menu lists only the chosen country's subdivisions, appears only for countries where sales tax
is added (Canada, the US), and sets the tax rate (BLUEPRINT §4.8). A US user's rate field starts empty, with the hint
"Your state and city sales tax on subscriptions, if any".

**Acceptance**
- [ ] Navigation works with the keyboard
- [ ] The drawer works at 360 px
- [ ] The theme persists across reloads
- [ ] The first-run dialog appears once and saves the settings

### 4.3 Shared components
| Component | Purpose | Key inputs → outputs |
|---|---|---|
| `ss-page-header` | Title, back link, action slot | `title`, `backLink?` |
| `ss-budget-bar` | Pill progress bar (wireframe style) with the label inside the fill | `value`, `max?`, `labelMode: 'percent' \| 'amount'`, `marker?` → colour ok/warn/over; `role="progressbar"` |
| `ss-price` | Price + interval; ≈ and the `currency_exchange` icon when converted; tooltip with the source price | `price: PickedPrice`, `clickable` → `select` |
| `ss-provider-icon` | Icon, with a letter fallback; at most 48 px, since catalog icons are 96 px files (BLUEPRINT §6.3) | `src?`, `name`, `size` (px) |
| `ss-status-badge` | Active / Inactive / Not listed, plus a date | `status` |
| `ss-rank-select` | The single rank dropdown | `value`, `subscriptionLevel` (adds Essential and Critical), `inherited?` (shows "Profile default (Wanted)") → `valueChange` |
| `ss-rank-dot`, `ss-rank-chip` | Colour dot (with or without a label) | `rank` |
| `ss-rank-counts` | Two-column rank counts, as on the Lists wireframe | `counts` |
| `ss-feature-summary` | "VPN 2 / 3" list | `rows` |
| `ss-feature-list` | A plan's features, grouped, with the user's rank dots | `plan`, `ranks` |
| `ss-mini-calendar` | Month grid with dots on charge days | `month`, `charges` → `dayClick`, `monthClick` |
| `ss-sub-card` | Subscription card (`variant: 'search' \| 'list'`) | view model → `priceClick`, `pinToggle`, `edit` |
| `ss-tag-chip`, `ss-tag-picker` | Coloured tags; the picker can create tags inline | `tags` → `tagsChange` |
| `ss-split-button` | Main action + dropdown (the Calendar buttons) | `label`, `items` → `action` |
| `ss-empty-state` | Icon, title, text and actions | — |
| `ss-confirm` (service) | `confirm({ title, message, confirmText, danger })` → `Promise<boolean>` | — |

---

## 5. Page specs

Each page lists its **wireframe**, **purpose**, **layout**, **data**, **behaviour**, **states** and **acceptance** criteria.
Routes are relative to `https://sub.simplely.ca/`. The example amounts in the sketches assume today is
Oct 22, 2026, and use the illustrative prices from `docs/api-output-examples.json`, before sales tax.

| ID | Page | Route | Wireframe | Milestone |
|---|---|---|---|---|
| P1 | App shell & first run | — | all frames | M0.5, M4.2 |
| P2 | Home | `/` | 01-home, 02-home-dark | M7.3 |
| P3 | Lists overview | `/lists` | 03-lists | M6.7 |
| P4 | List view | `/lists/:listId` | **new** | M6.8, M7.2 |
| P5 | List edit | `/lists/new`, `/lists/:listId/edit` | **new** | M6.4 |
| P6 | Subscription item dialog | (dialog) | **new** | M6.5 |
| P7 | Add-to-list flows | — | 07-search-price-click-comment | M5.4, M5.5 |
| P8 | Search | `/search` | 06-search | M5.2, M5.3 |
| P9 | Features (profile ranking) | `/features` | 04-features | M6.2 |
| P10 | Calendar | `/calendar` | 05-calendar | M7.4 |
| P11 | Payment | `/payment` | 09-payment-placeholder | M9.1 |
| P12 | Custom subscriptions | `/custom` | **new** | M6.6 |
| P13 | Settings | `/settings` | 08-settings | M4.2, M6.9 |
| P14 | Optimizations | `/lists/:listId/optimize` | **new** | M8.2 |
| P15 | Not found & errors | `**` | **new** | M0.5 |

### P2 — Home `/`
**Wireframe:** `01-home.png` (light), `02-home-dark.png` (dark shell).
**Purpose:** budget status at a glance, and the way into your lists.
```
┌──────────────────────────┐     Monthly budget
│ ‹  [Oct ▾] [2026 ▾]  ›   │     [██████████████           50% ]   $100 of $200 this month
│ Su Mo Tu We Th Fr Sa     │
│              1  2  3•    │     Annual budget
│  4  5  6  7  8  9 10     │     [███████                  25% ]   $250 of $1,000 in 2026
│ 11 12• 13 14 15• 16 17   │
│ …                        │
└──────────────────────────┘
               ┌──────────────────────────────────────────┐
               │           Subscription Lists              │
               └──────────────────────────────────────────┘
   Next payments (optional):  Oct 28 Crave $22.00 · Nov 3 Mullvad ≈ $7.53 · Nov 12 Netflix $18.99
```
**Data:** `MetricsService.global` (this month, this year, charges in the visible month) and the settings budgets.
**Behaviour**
- The bars cover **all lists combined** (BLUEPRINT §8.1.1). The % sits inside the fill (as in the wireframe), with "$100 of $200 this month" beside it.
- Over budget: the bar is full, uses the over colour, and the label shows the real % ("112%").
- No budget set: that bar is replaced by "Set a monthly budget →" (links to `/settings`) plus the plain total.
- Mini calendar: a dot on each day with a charge. Hover or tap shows the charges; clicking a day or the month title goes to `/calendar?month=YYYY-MM`.
- The "Subscription Lists" button goes to `/lists`.
- A budget warning banner appears at the top when the §3.1 budget checks fail.
- Optional extras for the empty space: a "Next payments" strip (next 3 charges) and an "Optimizations available" chip.

**States:**
- First run → the P1 dialog.
- No lists → empty state with [Create a list] [Browse services] [Import backup].
- Catalog still loading → skeleton dots.

**Acceptance**
- [ ] The bar totals equal the sum of every list's "this month" / "this year"
- [ ] Unset budgets show the prompt instead of a bar
- [ ] The calendar dots match the Calendar page
- [ ] Matches the wireframe layout at ≥ 1280 px and stacks vertically at 360 px

### P3 — Lists overview `/lists`
**Wireframe:** `03-lists.png`.
**Purpose:** all your lists side by side, with cost, budget share and rank mix.
```
Subscription Lists                          [Custom subscriptions]           Features
┌──────────────────────────────────────────────────────────────────┐        VPN: 2 / 3
│ Subscription List Name                                        🗑  │        1080p: 6 / 10
│ [██████████████░░░░] $50 this month    • 1 Essential  • 1 Sometimes│      4k: 2 / 5
│ [███████░░░░░░░░░░░] $250 this year    • 2 Needed     • 2 Unused   │      AI: 1 / 3
│                                        • 4 Wanted     • 1 Unwanted │
│                                        • 2 Uses                    │
│                          [ View ]                                 │
└──────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│                   New Subscription List  ⊕                        │
└──────────────────────────────────────────────────────────────────┘
```
**Data:** lists, `ListMetrics` for each list, the global feature summary.
**Behaviour**
- One card per list, in creation order. The name and [View] open `/lists/:listId`.
- Bars: this list's "this month" ÷ the monthly budget, and "this year" ÷ the annual budget. Without a budget the bar is hidden and only the amount shows.
- Rank counts follow §3.2 (zero counts in grey).
- 🗑 → confirm "Delete “Work Related”? Its 12 subscriptions will be removed." → soft delete → snackbar with Undo (10 s).
- "New Subscription List ⊕" → `/lists/new`.
- Right column: the feature summary across all lists (§3.2).
- Header link "Custom subscriptions" → `/custom`.

**States:** no lists → only the New tile and a one-line hint; the feature column is hidden.

**Acceptance**
- [ ] Rank counts match §3.2 for a fixture list
- [ ] Delete asks for confirmation and can be undone
- [ ] The bars are hidden when budgets are unset

### P4 — List view `/lists/:listId` (new)
**Purpose:** everything about one list: its subscriptions, cost, calendar, features and suggestions.
```
‹ Lists   Work Related                                                     [Export ▾]
≈ $62 / mo average · 12 subscriptions
┌─────────────────────────────────────────────────┐   Monthly budget
│ 🔍 Search this list                    [⚲ Sort] │   [████████░░░░░░] $50 of $200
├─────────────────────────────────────────────────┤   Annual budget
│ PINNED                                          │   [████░░░░░░░░░░] $250 of $1,000
│ ┌─────────────────────────────────────────────┐ │   ┌────────────────────────┐
│ │ [N] Netflix · Standard        📌 $18.99 / mo │ │   │  mini calendar          │
│ │     ● Active · renews Nov 12     31% of list │ │   └────────────────────────┘
│ │     #family                              ⌄  │ │   Features (active / total)
│ └─────────────────────────────────────────────┘ │   VPN 1 / 2
│ ALL                                             │   4k 1 / 3
│ ┌─────────────────────────────────────────────┐ │   Password manager 2 / 2
│ │ [D] Disney+ · Premium        $169.99 / year  │ │
│ │     ● Inactive · active from Sep 10, 2026    │ │   ┌────────────────────────┐
│ │     ≈ $14.17 / mo                        ⌄  │ │   │ View optimizations (3)  │ ← red/orange/yellow
│ └─────────────────────────────────────────────┘ │   └────────────────────────┘
│ [✎ Edit list]                                   │
└─────────────────────────────────────────────────┘
```
**Data:** the list, `ResolvedItem[]`, `ListMetrics`, charges in the visible month, the optimizer summary (M8).
**Behaviour**
- Header: name, back link, average monthly equivalent and item count. [Export ▾] offers CSV, Excel, JSON, Text and Calendar (.ics) for this list.
- The search box filters by name, plan, tag or feature.
- The [⚲ Sort] menu sorts by price, A–Z, active first or interval, and filters by Active only / Inactive only, price range, features or tags.
- Pinned cards come first. 📌 toggles pinning immediately (saved straight to the item, outside edit mode).
- **Card (list variant):**
  - Collapsed: icon, name · plan, pin, `ss-price` (≈ when converted), % of the list's next-12-months total, status (§3.3), tags.
  - Expanded (⌄): features with rank dots, billing details (next charge as charged, tax included; interval, auto/manual renewal, end date), Plan ↗ and Cancel ↗ links, and [Edit] → `/lists/:listId/edit?item=<itemId>`.
  - "Wrong date?" next to the next charge opens a date picker. The date becomes the item's new `anchorDate` (§3.1), saved straight to the item like pinning, without a draft.
- **Right column:**
  - Budget bars for **this list only** (hidden without budgets).
  - Mini calendar with this list's charges.
  - Feature summary for this list.
  - [View optimizations (n)] → `/lists/:listId/optimize`, coloured by the most severe suggestion. With no suggestions it shows a neutral outline: "No suggestions".
- [✎ Edit list] (bottom left, per `pages.txt`) → `/lists/:listId/edit`.
- Phase 4: the header adds "after cash back & FX fees: $60.80 / mo".
- Under 960 px the right column moves above the cards (bars, then summary), and the calendar collapses.

**States:**
- Unknown id → P15 "This list doesn't exist".
- Empty list → [Add from catalog] [Add custom subscription] (both open edit mode).

**Acceptance**
- [ ] Totals and % shares match §3.1
- [ ] Pinning survives a reload and doesn't create a draft
- [ ] Each export format downloads and contains only this list
- [ ] The optimizations button colour reflects the most severe suggestion

### P5 — List edit `/lists/new`, `/lists/:listId/edit` (new)
**Purpose:** add, change and remove subscriptions in a list, with Save and Cancel.
```
Editing  [ Work Related______________ ]                        [Cancel] [Save]  ⋮
┌────────────────────────────────────────────────────────────────────────────┐
│ [+ Add from catalog]   [+ Add custom subscription]                          │
├────────────────────────────────────────────────────────────────────────────┤
│ [N] Netflix · Standard          $18.99 / mo    Renews Nov 12 · auto         │
│     #family · 2 custom ranks                                       [✎] [🗑] │
├────────────────────────────────────────────────────────────────────────────┤
│ [M] Mullvad VPN                 ≈ $7.53 / mo   Renews Nov 3 · manual ↻      │
│                                                                    [✎] [🗑] │
└────────────────────────────────────────────────────────────────────────────┘
Unsaved changes · This month $26.52 · ≈ $26.52 / mo average
```
**Data:** `ListDraftService` (the draft lives in the Dexie `drafts` table), catalog, custom subscriptions.
**Behaviour**
- **Draft model:** opening edit mode copies the list and its items into a draft saved in Dexie, so a trip to
  Search (pick mode) or a reload keeps the changes. An existing draft is resumed ("Resumed unsaved changes").
- **Save:**
  - One Dexie transaction writes the list and its items (add / update / soft delete), deletes the draft, then goes to `/lists/:listId`.
  - Fields that are edited elsewhere (`pinned`, and the Phase 4 `cardId` assignment) keep their saved values unless they were changed in the draft.
- **Cancel:** confirm if anything changed → delete the draft → back to the list view (or `/lists` for a new list).
- **`/lists/new`:**
  - Creates a draft with a new id, named "Subscription List" (or "Subscription List 2" if that's taken).
  - Then replaces the URL with `/lists/<newId>/edit`.
  - Nothing is saved to the lists table until Save.
- The name is required, with a maximum of 60 characters.
- [+ Add from catalog] → `/search?addTo=<listId>` (flow F2).
- [+ Add custom subscription] → a menu of existing custom subscriptions plus "Create new…" (the P12 editor) → item dialog.
- ✎ opens the item dialog (P6) for that item. 🗑 removes it from the draft, with Undo in a snackbar.
- ⋮ → Delete list (confirm) → soft delete → `/lists`.
- On load, these query params open the item dialog and are then removed from the URL:
  `?add=<planId>&interval=<month|year>` · `?addBundle=<bundleId>` · `?addCustom=<customSubId>` · `?item=<itemId>`.
- Leaving with unsaved changes asks "Discard changes?", except when going to Search in pick mode for this list.
- The footer shows live totals for the draft.

**States:** an unknown id with no draft → P15.

**Acceptance**
- [ ] Changes survive a reload and a round trip to Search
- [ ] Save writes everything atomically and lands on the list view
- [ ] Cancel discards everything (checked after a reload)
- [ ] Each query param opens the right dialog, once

### P6 — Subscription item dialog (new)
Opened from P5 to add or edit an item. It goes full screen under 600 px.
```
┌ Add subscription ───────────────────────────────────────────────────── ✕ ┐
│ [N] Netflix                                                               │
│ Plan            [ Standard — $18.99 / mo                         ▾ ]      │
│ Extra members   [ ] Extra member  +$7.99 / mo   Qty [1 ▾]                 │
│                                                                           │
│ BILLING      (•) Ongoing    ( ) Specific dates                            │
│ Billed          [ Monthly — $18.99 ▾ ]                                    │
│ Next renewal    [ 2026-11-12 📅 ]    Subscribed since [ optional 📅 ]      │
│ [x] Auto-renews                     Ends on          [ optional 📅 ]      │
│ [ ] I pay a different price   [ 15.99 ] [ CAD ▾ ]                         │
│ ▸ Advanced: bought in region [ Canada ▾ ]                                 │
│                                                                           │
│ FEATURE RANKS  (only for this subscription)                               │
│ Ad free                      [ Essential                       ▾ ]        │
│ Video quality · 1080p        [ Profile default (Wanted)        ▾ ]        │
│ Simultaneous streams · 2–4   [ Profile default (Not ranked)    ▾ ]        │
│                                                                           │
│ TAGS     [#family ✕] [+ Add tag]                                          │
│ PAYMENT  [ Simplii Cashback ▾ ]  Best card: saves $0.27 / mo   (Phase 4)  │
│                                                                           │
│ ≈ $18.99 / mo · next charge Nov 12               [Cancel] [Add to list]   │
└───────────────────────────────────────────────────────────────────────────┘
```
In Specific dates mode, the renewal fields are replaced by:
```
│ Billed during each window [ Monthly — $23.99 ▾ ]                          │
│ Window 1  [ 2026-09-02 ] → [ 2026-11-01 ]  [x] Every year           [🗑]  │
│ [+ Add window]                                                            │
```
**Rules**
- **Plan:** plans of the same provider (or of the custom subscription), with their prices. Changing the plan keeps the interval if the new plan offers it; otherwise the first available interval is picked.
- **Extra members:** add-ons of the selected plan, with quantity up to `addOnLimit`.
- **Billed:** only intervals the plan has prices for (custom plans: any interval and count).
- **Next renewal** (= `anchorDate`): required for Ongoing. Defaults to one interval from today, with the hint "Check your account page for the exact date". For month and year intervals, when the date is the last day of a month shorter than 31 days, a choice appears: "Billed on the 28th" or "the 29th / 30th / 31st (the last day in shorter months)", which sets `billingDay` (§3.1). The default from today keeps today's day (added on Jan 31 → Feb 28 with `billingDay: 31`).
- **Auto-renews:** shown only when the price's `autoRenew` is true. Otherwise a note says "This plan renews manually — we'll remind you".
- **Free plans:** when the picked price is 0, Billed, Next renewal, Auto-renews and the price override are hidden. The item is saved as Ongoing, with today as the anchor date.
- **Specific dates:** at least one window; each end must be after its start; windows can't overlap.
- **Price override:** an amount above 0, with a currency, and an optional "until" date for an offer that ends (first-term discounts): charges from that date on use the catalog price. The amount is taken as charged, tax included, unless "plus tax" is ticked (BLUEPRINT §4.8).
- **Bought in region** (Advanced): any country; it sets `region`, which picks the item's price and availability. Defaults to Settings' country.
- **Feature ranks:** the plan's provided keys (§3.2), grouped. The dropdown starts with "Profile default (X)" and includes Essential ("keep this plan") and Critical ("keep this provider"), each with a one-line hint.
- **Tags:** autocomplete from the Settings tags, with "Create tag" inline (name + colour).
- **Bundles:** bundle items show the bundle's included plans read-only, and their combined features for ranking.
- **Duplicates:** adding a plan that's already in the list shows "Already in this list — add another?" (duplicates are allowed).
- **Save** writes to the **draft** (P5), closes the dialog and shows "Added Netflix Standard".

**Acceptance**
- [ ] Invalid combinations can't be saved, and show inline errors
- [ ] The interval choices match the plan's prices
- [ ] Rank overrides show the inherited profile rank
- [ ] Limited windows produce the expected charges (checked on the calendar)

### P7 — Add-to-list flows (new)
**Wireframe note** (`07-search-price-click-comment.png`): "Clicking on the prices opens the menu to add to subscription list".

**F1 — from Search (normal mode)**
```
Search card ── click "$18.99 / mo" ──► menu ┌ Add to list ───────────┐
                                            │ Work Related (12)      │
                                            │ Family – Sam (4)       │
                                            │ ────────────────────── │
                                            │ + New list…            │
                                            └────────────────────────┘
      pick a list ──► /lists/<id>/edit?add=netflix.standard&interval=month
                  ──► item dialog (prefilled) ── Add to list ──► draft row ── Save ──► /lists/<id>
```
**F2 — from List edit (pick mode)**
```
/lists/<id>/edit ── [+ Add from catalog] ──► /search?addTo=<id>   (banner "Adding to Work Related ✕")
      click a price ──► /lists/<id>/edit?add=<planId>&interval=<i> ──► item dialog ──► draft
```
**F3 — custom subscription:** List edit → [+ Add custom subscription] → pick or create (P12 editor) → item dialog.
**F4 — bundle:** click a bundle price on a search card → `?addBundle=<bundleId>` → the item dialog shows the bundle.

**Rules**
- "New list…" creates a draft list first, then continues as F1.
- The clicked interval is preselected.
- An existing draft for that list is resumed.
- The ✕ on the pick-mode banner returns to the edit page without adding anything.

**Acceptance**
- [ ] F1–F4 work end to end (Playwright scenarios 2–3 in §7)

### P8 — Search `/search`
**Wireframe:** `06-search.png`.
**Purpose:** find services by name, plan or feature, compare prices, and add them to a list.
```
┌ ☰  Search services, plans or features…                     🔍 ┐   ┌ Filters ──────────────────────┐
  Sort [ Price: low to high ▾ ]                                      │ Price per month  $0 – Unlimited│
┌───────────────────────────────────────────────────────────────┐   │ ●━━━━━━━━━━━━━━━━━━━━━━━━━━━●  │
│ [N] Netflix      🔗 Plan                       $18.99 / mo     │   │ Category [ All ▾ ]             │
│     Standard     🔗 Cancel                                     │   │ Features [ Video quality    ⊗ ]│
│     ● Active (Standard)   [Standard ads] [Standard] [Premium]  │   │   1080p · 4k · Ad free · HDR   │
│                               ⌄                               │   │ [download ✕] [stream ✕] [hdr ✕]│
└───────────────────────────────────────────────────────────────┘   │ Activity                       │
┌───────────────────────────────────────────────────────────────┐   │ [Active] [Inactive] [Not listed]│
│ [D] Disney+      🔗 Plan                       $16.99 / mo     │   │ [ ] Native pricing only        │
│     Premium      🔗 Cancel                    $169.99 / year   │   │ [Clear all]                    │
│     ● Inactive · active from Sep 10, 2026                      │   └────────────────────────────────┘
│  • Video quality 4k ●   • Streams on 4 devices   • Extra member │
│  • HDR                  • Downloads on 10 devices  $7.99 / mo   │
│  • Dolby Atmos          • Ad free                               │
│  Bundles: [D][C] $29.99 / mo — save $9.00                      │
│                               ⌃                               │
└───────────────────────────────────────────────────────────────┘
```
**Data:** the `CatalogStore` snapshot, `FxStore`, user lists (for status), profile ranks (for the dots). Everything runs locally (`searchCatalog` in core).
**Behaviour**
- **One card per provider.** It shows the plan you already have if that matches the filters, otherwise the cheapest plan that matches every filter. Plan chips switch between the provider's matching plans.
- **Matching:** text matches provider names and aliases, plan names, feature names and aliases, and category names, in this order: exact or prefix name → substring → alias → feature or category. 150 ms debounce.
- **Sort:** Best match (default when there's text), Price low→high (default otherwise), Price high→low, Name A–Z, Most features. Price sorts use the lowest monthly equivalent of the plan shown.
- **Prices:** every interval price is a button → flow F1 (or F2 in pick mode). Converted prices show ≈, the icon and a tooltip. A $0 price shows as "Free". In Canada and the US prices are shown before tax, with "+ tax" (BLUEPRINT §4.8).
- **Availability** (`availability` in core, BLUEPRINT §4.7): plans and bundles not offered in the user's region are left out. A provider with nothing offered there shows "Not offered in Canada" instead of prices, and only when the search text names it. An unknown item shows its fallback price with "No Canadian price yet".
- **Links:** Plan ↗ and Cancel ↗ open in a new tab (`rel="noopener"`).
- **Status:** follows §3.3, at provider level.
- **Expanded section:**
  - The plan's features grouped by registry parent, with the user's rank dot next to each.
  - Add-ons with prices, and bundles containing the plan with their savings (a bundle price click → F4).
  - For a suite plan (BLUEPRINT §4.4): the plans it includes, and its savings against buying them separately when there are any.
  - Perks, and accepted cards (Phase 4).
  - "Price checked Oct 14, 2026", with a "may be out of date" badge when it's older than 90 days.
- **Filter panel** (on the right; becomes a drawer opened by ☰ under 960 px):
  - Price per month: dual slider on the monthly equivalent in the user's currency; the right end means "Unlimited".
  - Category: a select.
  - Features: autocomplete over rank keys. Typing "Video quality" offers 1080p and 4k, plus related keys such as Ad free and HDR. Each pick adds a chip, and chips combine with AND.
  - Activity: Active / Inactive / Not listed (multi-select).
  - Native pricing only.
  - Clear all.
- **URL state:** `?q=&sort=&min=&max=&cat=&f=video.quality%3D4k,streaming.ad-free&act=active,none&native=1`.
- **Pick mode:** `?addTo=<listId>` shows a banner "Adding to Work Related ✕", and price clicks go straight to F2.

**States:**
- First load → skeleton cards.
- Offline → banner, cached catalog.
- No results → "No services match" with [Clear filters] [Add a custom subscription].

**Acceptance**
- [ ] Filtering for 4k shows each provider's cheapest 4k plan
- [ ] Converted prices are marked, and "Native pricing only" hides them
- [ ] A Canadian never sees a US-only plan (Disney+ With Ads), and a provider without Canadian prices or `availableIn` shows "No Canadian price yet"
- [ ] A reload and back/forward restore the query, filters and sort
- [ ] A price click opens the add menu (F1), or adds directly in pick mode (F2)

### P9 — Features (profile ranking) `/features`
**Wireframe:** `04-features.png` (the red × buttons are removed).
**Purpose:** say once how much you care about each feature. Every list uses these ranks unless a subscription overrides them.
```
Your feature ranks               [🔍 Find a feature]   [ ] Ranked only   [Reset all]
┌ VPN ─────────────────────────────────┐   ┌ Streaming ───────────────────────────────┐
│ VPN                  [ Needed     ▾ ] │   │ Ad free                  [ Needed     ▾ ] │
│ Unlimited traffic    [ Not ranked ▾ ] │   │ Simultaneous streams                      │
│ VPN devices                           │   │   Single device          [ Needed     ▾ ] │
│   1 to 5 devices     [ Not ranked ▾ ] │   │   2 to 4 devices         [ Wanted     ▾ ] │
│   6 to 10 devices    [ Not ranked ▾ ] │   │   More than 4 devices    [ Sometimes  ▾ ] │
└───────────────────────────────────────┘   └───────────────────────────────────────────┘
┌ Video quality ───────────────────────┐   ┌ Password manager   [ Wanted ▾ ] [Set all ▾] ┐
│ 1080p                [ Wanted     ▾ ] │   │ ▸ Storable item types (22)                │
│ 4k                   [ Uses       ▾ ] │   │     Logins               [ Not ranked ▾ ] │
└───────────────────────────────────────┘   └───────────────────────────────────────────┘
```
**Data:** the feature registry (from the catalog), the `rankings` repo, and items (to know which categories you use).
**Behaviour**
- Groups follow the registry's feature categories and parent features, and each group can be collapsed. Groups used by your lists start expanded.
- Each rank key has one dropdown: **Not ranked** (the default, muted), Needed, Wanted, Uses, Sometimes, Unused, Unwanted, each with its colour dot. Essential and Critical aren't offered here: they're set per subscription in the item dialog (P6).
- A ranked row gets a coloured left border.
- A group row's rank applies to the group only ("I want a password manager"). [Set all ▾] ranks every child in one step. Ranks never cascade on their own (§3.2).
- Changes save immediately; there's no Save button. Choosing Not ranked deletes the record.
- Search filters rows by name or alias. "Ranked only" hides unranked rows. [Reset all] (with confirmation) deletes every profile rank.
- Optional: a muted counter per row, e.g. "in 3 subscriptions".

**Acceptance**
- [ ] Ranks persist, and immediately change the rank counts on P3
- [ ] [Set all] ranks every child, and nothing cascades implicitly
- [ ] Tiers and enum values appear as separate rows (as in the wireframe)

### P10 — Calendar `/calendar`
**Wireframe:** `05-calendar.png` (the placeholder grid becomes a full-size calendar).
**Purpose:** when each payment happens, and how this month is going.
```
[████████ $44.45 ░░░░░░░░░|░░] $66.45                    [Sync calendar ▾] [Export to file ▾]
Showing [ All lists ▾ ]
┌───────────────────────────────────────────────────────────────────────────────┐
│ ‹  [Oct ▾] [2026 ▾]  ›   [Today]                                               │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬─────────────┤
│ Su       │ Mo       │ Tu       │ We       │ Th       │ Fr       │ Sa          │
│          │          │          │          │ 1        │ 2        │ 3           │
│          │          │          │          │          │          │ [M] ≈7.53 ↻ │
│ …                                                                             │
│ 11       │ 12       │ 13       │ 14       │ 15       │ 16       │ 17          │
│          │[N] 18.99 │          │          │[P] ≈17.93│          │             │
│ …                                                                             │
└───────────────────────────────────────────────────────────────────────────────┘
Upcoming   Oct 28 Crave $22.00 · Nov 3 Mullvad ≈ $7.53 ↻ · Nov 12 Netflix $18.99
```
**Data:** charges in the visible month (for the selected lists), settings (monthly budget, saved list filter).
**Behaviour**
- **Top bar** (the displayed month only):
  - The fill is the amount spent so far (charges up to today), shown inside it; the month's total is on the right.
  - A tick marks the monthly budget, if one is set.
  - Past months show full; future months show $0 of the total.
  - The colour reflects the month's total against the budget.
- **Showing:** a multi-select of lists. All are selected by default, and the choice is remembered on this device.
- **Grid:**
  - Fills the available space.
  - Each day shows its date, up to 3 charge chips (icon + amount, plus the name when there's room), "+2 more" and a muted day total.
  - Today is outlined, and days from other months are muted.
- Clicking a day or a chip opens a side panel (a bottom sheet on mobile) with the name, plan, list, amount (≈ if converted), auto/manual renewal, card (Phase 4), a link to the list, and "Wrong date?" (as on P4: the new date becomes the anchor).
- ↻ marks manual renewals. "Ends" marks the last charge before an `endDate`.
- Month and year selects, arrows and [Today]; URL `?month=2026-10&lists=<id>,<id>`.
- Under 600 px the grid becomes an agenda list grouped by date.
- **Export to file ▾:** Calendar (.ics) as the main action, plus a CSV payment schedule and Excel. Covers the shown lists for the next 12 months. The .ics has one all-day event per charge, not repeat rules (BLUEPRINT §11.2).
- **Sync calendar ▾:**
  - Phase 3: Google / Apple / Proton each download the .ics and show that app's import steps.
  - Phase 5: "Live calendar link" → opt-in dialog → `POST /cal` → shows the URL, subscribe steps for each app and a Revoke button.
- A year view (12 small months plus monthly totals) comes in M10.

**Acceptance**
- [ ] Charges appear on the right days, including month-end dates and limited windows
- [ ] The spent/total bar matches §3.1 for past, current and future months
- [ ] The .ics file imports into Google Calendar and Proton Calendar
- [ ] Agenda layout at 360 px

### P11 — Payment `/payment` (Phase 4)
**Wireframe:** `09-payment-placeholder.png` (text only). New layout:
```
Payment cards                                                          [+ Add card]
We never ask for card numbers, only what's needed to estimate cash back and fees.
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│ Simplii Cashback        [MC]  CREDIT │  │ Everyday Debit      [Interac]  DEBIT │
│ 1.5% cash back · FX fee 2.5%         │  │ 0% cash back · FX fee 2.5%           │
│ This month [███████░░░] $60 of $500  │  │ No limit                             │
│ Netflix $18.99 · Proton ≈ $17.93     │  │ No subscriptions                     │
│                            [✎] [🗑]  │  │                            [✎] [🗑]  │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
3 subscriptions have no card   [Assign best cards]
```
**Card dialog fields:**
- Name* · Nickname
- Type (credit/debit)* · Network*
- Card currency (defaults to yours)
- Cash back % (0–20)
- FX fee % (0–10, with the hint "most Canadian cards charge 2.5%")
- Monthly limit (empty = no limit)

**Behaviour**
- Limit bar: this month's charges assigned to the card ÷ its limit. Going over shows the warning colour and flags that day on the calendar.
- "Assign best cards" runs the assignment (BLUEPRINT §9.3) and shows a preview for each list. [Apply] writes `cardId` to the saved items, with Undo. Lists with an open draft are skipped, with a note.
- Deleting a card asks for confirmation; its items become unassigned.

**Acceptance**
- [ ] Ineligible cards never appear for a provider whose networks are known
- [ ] Net cost on P4 = gross + FX fee − cash back (the BLUEPRINT §9.3 formula)
- [ ] No field accepts a card number (validation blocks 12+ digit numbers in text fields)

### P12 — Custom subscriptions `/custom` (new)
**Purpose:** services that aren't in the catalog.
```
Custom subscriptions                                          [+ New custom subscription]
┌────────────────────────────────────────────────────────────────────────────────┐
│ [G] Local Gym              2 plans · used in 1 list                  [✎] [🗑]  │
│ [S] Substack – Example     1 plan  · not used                        [✎] [🗑]  │
└────────────────────────────────────────────────────────────────────────────────┘
```
Editor dialog:
```
┌ Custom subscription ──────────────────────────────────────────────────── ✕ ┐
│ Name*  [ Local Gym ]   Website [ https://… ]   Cancel link [ https://… ]    │
│ PLANS                                                                       │
│ ┌ Basic ────────────────────────────────────────────────────────────── 🗑 ┐ │
│ │ Name* [ Basic ]  Cost* [ 29.99 ] [ CAD ▾ ]  Every [ 1 ] [ month ▾ ]      │ │
│ │ [x] Auto-renew available                                                │ │
│ │ Features [Ad free ✕] [Simultaneous streams: 2 ✕] [+ Add feature]        │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ [+ New plan]                                               [Cancel] [Save]  │
└─────────────────────────────────────────────────────────────────────────────┘
```
**Behaviour**
- Features come from a registry search; enum and number features ask for a value.
- The cost is what you pay, tax included, unless "plus tax" is ticked (BLUEPRINT §4.8).
- Website and cancel links accept only `https://` URLs (BLUEPRINT §11.5).
- The icon comes from `/api/v1/icon?domain=<website>` (asked only when the subscription is saved, BLUEPRINT §5.4). When it answers 404, the card shows the subscription's first letter, as for a catalog provider without a logo.
- Editing a plan updates every item that uses it, after a warning that shows the count.
- Deleting a custom subscription that's in use asks to confirm: "Also remove it from 1 list".
- Reachable from the P3 header, from P5, and from the Search empty state.

**Acceptance**
- [ ] Custom plans behave like catalog plans in lists, the calendar, ranks and exports
- [ ] At least one plan with a name, cost and interval is required

### P13 — Settings `/settings`
**Wireframe:** `08-settings.png` (the lower sections are additions).
```
←
   Create local sync   (disabled, "Coming later")                       Custom tags
   Monthly budget: $200    ✎                                            [Work ✕]    (●)
   Annual budget: $1,000   ✎                                            [Family ✕]  (●)
                                                                        ⊕
   Appearance   (•) System  ( ) Light  ( ) Dark
   Your data    [Export backup] [Import backup] [Delete all data]
   Security     [ ] Lock with a passphrase   Lock after [15 minutes ▾]
   Catalog      Updated Oct 22, 2026 · version c4f9a21 · [Check for updates]
📍 Ontario, Canada (CAD)
```
**Behaviour**
- ← goes back (to Home if there's no history).
- **Budgets:** click to edit inline. Enter saves; an empty value means no budget.
- **Tags:**
  - Names are renamed inline.
  - The colour swatch opens a palette (12 presets plus a hex field).
  - ✕ deletes, asking for confirmation if the tag is in use: "Used by 5 subscriptions".
  - ⊕ adds a new tag in edit mode.
- 📍 opens a dialog for country, province or state, and currency (the currency follows the country unless you change it), with the sales tax that follows: "Sales tax 13% (Ontario)" and [Use my own rate] (BLUEPRINT §4.8).
- **Export backup** downloads `simply-sub-backup-YYYY-MM-DD.json`:
  ```json
  {
    "app": "simply-sub",
    "schemaVersion": 1,
    "exportedAt": "2026-10-22T18:30:00Z",
    "catalogVersion": "c4f9a21",
    "data": {
      "settings": { "country": "CA", "subdivision": "CA-ON", "currency": "CAD", "monthlyBudget": 200, "annualBudget": 1000, "theme": "system" },
      "lists": [{ "id": "0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d", "name": "Work Related", "createdAt": "2026-10-01T12:00:00Z", "updatedAt": "2026-10-20T09:15:00Z" }],
      "items": [], "customSubs": [], "rankings": [], "cards": [], "tags": []
    }
  }
  ```
- **Encrypt the backup** (M6.9): the export dialog offers "Protect with a passphrase" (entered twice). The file then holds `{ "app", "schemaVersion", "encrypted": { "kdf", "iterations", "salt", "iv", "ciphertext" } }` instead of `data` (BLUEPRINT §11.5). The dialog says a forgotten passphrase can't be recovered.
- **Import backup:** pick a file → (passphrase, if it's encrypted) → the whole file is validated with Zod before anything is written → preview the counts → **Merge** (by id; the newest `updatedAt` wins) or **Replace** (with confirmation). Backups with an older `schemaVersion` are migrated. A wrong passphrase, a tampered file or one that fails validation imports nothing and says why.
- **Delete all data:** type DELETE to confirm. Every table is cleared, then the first-run dialog appears.
- **Lock with a passphrase** (M6.10, off by default; BLUEPRINT §11.5):
  - Turning it on asks for a passphrase twice, explains that nobody can recover a forgotten one, offers an encrypted backup first, then encrypts every user table in one transaction.
  - "Lock after" sets the idle time (5, 15 or 60 minutes, or only when the tab closes).
  - Turning it off asks for the passphrase and decrypts everything.
- Create local sync stays disabled until Phase 5.

**Acceptance**
- [ ] Budgets and tags persist and update every page live
- [ ] Export → Delete all → Import (Replace) restores identical data, with and without a passphrase
- [ ] Changing the currency re-prices everything (the converted markers update)
- [ ] With the lock on, the IndexedDB records hold no readable names or amounts

### P14 — Optimizations `/lists/:listId/optimize` (new)
**Purpose:** show how to pay less without losing what matters (BLUEPRINT §10).
```
‹ Work Related   Optimizations                                    Save up to $214 / year
FREE SAVINGS — nothing you rank is lost
┌───────────────────────────────────────────────────────────────────────────────┐
│ Switch Disney+ Premium to annual billing                      save $33.89 / yr │
│ $16.99 / mo → $169.99 / year                                  [Apply] [Dismiss]│
└───────────────────────────────────────────────────────────────────────────────┘
● RECOMMENDED (red) — only removes features you marked Unwanted
┌───────────────────────────────────────────────────────────────────────────────┐
│ Downgrade Netflix Premium → Standard                          save $60.00 / yr │
│ You lose: ● 4k (Unwanted) · ● HDR (Unwanted)                  [Apply] [Dismiss]│
└───────────────────────────────────────────────────────────────────────────────┘
● SUGGESTED (orange) — also removes Unused features
● WORTH A LOOK (yellow) — affects Wanted, Uses or Sometimes features
[ ] Show dismissed
```
**Behaviour**
- Runs the optimizer for this list, in a Web Worker if it takes longer than about 50 ms.
- Sections, in this order: Free savings, Red, Orange, Yellow.
- Each card shows:
  - the changes (keep / downgrade / switch / remove / convert to extra member / bundle or suite / interval / card)
  - savings over the next 12 months
  - features lost or gained, with rank dots
  - an "estimated" tag when converted prices are involved
- [Apply] opens `/lists/:listId/edit` with that change applied to a draft, so you review it and press Save.
- [Dismiss] stores the suggestion's fingerprint in `dismissedSuggestions`. It comes back if the list changes, and "Show dismissed" reveals it.
- An info tooltip explains the Essential, Critical and Needed rules.

**Acceptance**
- [ ] The optimizer fixtures produce the expected cards and colours
- [ ] Apply never saves until the user presses Save in edit mode
- [ ] Dismissed suggestions stay hidden until the list changes

### P15 — Not found & errors
- Unknown route → "Page not found", with links to Home and Lists.
- Unknown list → "This list doesn't exist (it may have been deleted)" with [Back to lists].
- Unexpected error → snackbar "Something went wrong". Details go to the console; nothing is sent anywhere.
- IndexedDB blocked (some private browsing modes) → a full-page notice, "Your browser is blocking local storage,
  so nothing will be saved", with [Continue anyway] (in-memory mode).
- **Lock screen** (M6.10, when the app lock is on): a full-page passphrase prompt before anything else loads, and
  again after the idle time. A wrong passphrase says so and changes nothing. "Forgot it?" explains the two ways out:
  import a backup, or delete all data (with the DELETE confirmation).

---

## 6. API work plan
- **Contract first:** `docs/api-output-examples.json` holds an example request and response for every endpoint.
  Implement the endpoints in M2 order; task M2.7 makes the examples part of the test suite.
- **Envelope:** `{ "data": …, "meta": … }` on success, `{ "error": { "code", "message", "details?" } }` on failure.
- **Error codes:** `bad_request` (400), `forbidden` (403), `not_found` (404), `rate_limited` (429), `upstream_unavailable` (502), `internal` (500).
- **Limits and headers:** 60 requests a minute per IP, 10 on `/icon` (`429 rate_limited`, `Retry-After: 60`); every `/api/*` response carries the CORS header and the security headers (BLUEPRINT §5.4).
- **Validation:** core's query readers (`readProvidersQuery`, `readPricingQuery`, `readBundlesQuery`, `readIconQuery`) check every parameter. Unknown or invalid params → 400, listing each problem.
- **Pagination:** `limit` (1–50, default 20) plus an opaque `cursor`. `meta.nextCursor` is `null` on the last page.
- **What the app actually calls:**

  | Request | Served by | Caching | Uses Worker quota? |
  |---|---|---|---|
  | `/data/catalog/index.json`, then `/data/catalog/<region>.json` (or `catalog.json` for a region without a file) | static asset | ETag; the browser revalidates the index on each visit, and fetches the region's file when the catalog version changes | No |
  | `/icons/<id>.webp` | static asset | 1 day, then revalidated (the URL has no version, so a new logo must show up) | No |
  | `/api/v1/fx?base=CAD` | Worker → Frankfurter | 12 h at the edge + browser cache (about once a day per user) | Yes (tiny) |
  | `/api/v1/icon?domain=` | Worker → Google/DuckDuckGo | 30 days (KV) | Yes (custom subscriptions only) |
- The other endpoints (`/providers`, `/plans`, `/bundles`, `/features`, `/categories`, `/catalog`) serve deep links,
  future features and anyone else using the API. They're edge-cached for an hour, keyed by URL.
- **Versioning:** everything is under `/v1`, changes are additive only, and `/health` reports `apiVersion`.
- **Logging:** Workers observability is on. Never log calendar-feed contents or anything user-specific.

---

## 7. Testing plan
**Unit tests (packages/core):**
- `pickPrice` (all four fallback steps, region groups, free prices), `monthlyEquivalent`, region codes and
  `availability`
- Charges: month-end with and without `billingDay`, leap years, `intervalCount`, 30-day and 2-week cycles,
  windows (no charge on the end date), yearly repeats, start/end dates, manual renewals, re-anchoring, a price
  override's `until`, and "next 12 months" counting a yearly charge once
- Sales tax: each Canadian province's rate, a user's own rate, tax-included regions, `plusTax` amounts, and an
  item bought in another region
- Statuses, rank resolution and ladders, rank counts, feature summaries
- Budget checks, optimizer fixtures, reward maths
- The crypto module: a round trip, a wrong passphrase, a tampered ciphertext, and the KDF parameters stored with
  each file (BLUEPRINT §11.5)

**API:** route tests with `@cloudflare/vitest-plugin` (runs them in workerd), plus contract tests: every example is checked against core's response schemas, and every built endpoint's examples are sent to the Worker (M2.7, BLUEPRINT §13.3).

**Components:** `ss-rank-select`, `ss-budget-bar` (aria values, colours), `ss-price` (converted marker),
item dialog validation, filter panel ↔ URL sync.

**End-to-end (Playwright):**
| # | Scenario |
|---|---|
| 1 | First visit → choose Canada/CAD → empty Home with prompts |
| 2 | Search "netflix" → click $18.99 → New list… → item dialog → Add → Save → the list view shows Netflix and the Home bar updates |
| 3 | Edit list → Add from catalog (pick mode) → add Mullvad (≈ marker) → Save |
| 4 | Edit list → change a plan → Cancel → nothing has changed after a reload |
| 5 | Rank 4k as Unwanted on Features → the list card counts change → Optimizations offers a downgrade |
| 6 | The calendar shows Netflix on its renewal day, and the exported .ics validates and has a charge in every month for a plan billed on the 31st |
| 7 | Export backup → Delete all data → Import (Replace) → identical data, plain and with a passphrase |
| 10 | Turn on the app lock → reload → the lock screen → unlock → the lists are back; the stored records are unreadable |
| 8 | Offline after the first load → Search and lists still work from the cache |
| 9 | Dark mode screenshots of Home, Lists, Search and Calendar (visual check) |

---

## 8. Wireframe → spec changes
| Page | Wireframe shows | Spec | Why |
|---|---|---|---|
| All | `#D9D9D9` background, grey cards | `#E4E4E4` background, white cards | Contrast and depth (BLUEPRINT §8.1) |
| All | Neon rank and status text | Colour dot + label; darker text shades | Readability |
| All | Material's default lavender (search bar, filter panel, chips) | Material theme mapped to the `#6E062E` accent | One consistent theme |
| Lists | "$50 / mo", "$250 / year" | "$50 this month", "$250 this year" | Matches the budget maths (§3.1) |
| Lists | "View ✎" | "View" | Editing starts from the list view |
| Features | A red × beside each dropdown | Removed; "Not ranked" is in the dropdown | Decision of 2026-10-22 |
| Features | Fixed device rows | Tiers from the registry | Same rows, driven by data |
| Search | One card per plan | One card per provider (your plan or the cheapest match, plus plan chips) | Less clutter when filtering |
| Search | "In Active" and "Not Listed" in red | "Inactive" and "Not listed" in grey | Neither is an error |
| Search | Bundle row with placeholder logos | Bundles that contain the shown plan, with savings | Real data |
| Calendar | Placeholder grid and note | Full-size grid, day panel, upcoming list, mobile agenda | Spec |
| Calendar | "Sync Calendar ▾" | Phase 3: import help + .ics; Phase 5: live link | A live link needs data on the server (BLUEPRINT §11.3) |
| Settings | "Create Local Sync" | Disabled until Phase 5 | Sync is Phase 5 |
| Settings | — | Appearance, Your data and Catalog sections | Backups need a home |
| Payment | Placeholder text | Card tiles + card dialog | Decision of 2026-10-22 |
| Home | Empty space under the bars | Optional "Next payments" strip | Uses the space |
