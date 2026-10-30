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

Last updated: 2026-10-29

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
| M0.2 | Root workspace: `package.json` workspaces, `volta pin node@24.19.0 npm@12.0.2`, `tsconfig.base.json`, ESLint, Prettier, `.editorconfig`, `.gitignore` | `npm install` from the root works; `node -v` inside the repo prints 24.19.0 (24.22.1 since 2026-10-26, #32) |
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
| M1.8 | Resellers (BLUEPRINT §4.9, added 2026-10-26): `data/resellers.yaml` and a provider's `resellers` (core's schemas, the JSON Schemas, `validateCatalog`'s checks), reseller logos and icons (`data:icons`, `data:build`), region files that keep the reseller prices a buyer can use, core's `resellerDeals`, and Mullvad's official resellers researched one by one; Mullvad's 2-, 3- and 6-month prices | Validation rejects a reseller the provider's own site doesn't approve or a price page off the shop's domains; Amazon.ca shows as cheaper in Alberta and not in Ontario |
| M1.9 | Required links and country lists (added 2026-10-26): every plan and bundle has a sign-up `link` and every provider a `cancelUrl` (the schema requires them; Disney+'s, Crave's and Mullvad's read from their sites); `availableIn` for providers sold in certain countries only, from their own words (Crave: Canada) (BLUEPRINT §14) | Validation rejects a provider without a cancel page or a plan without a link; every Search card links to its plan and its cancel page; a US user doesn't see Crave until the text names it |
| M1.10 | Plan categories (added 2026-10-26): a plan's optional `categories` (core's `planCategories`, `providerCategories`, `validateCatalog`), Search's Category filter and category terms keeping the plans in a category, the panel's categories from the plans sold here, and GET /providers' category filter through D1's `provider_categories` (migration 0003, `seedFormat` 2) (BLUEPRINT §14) | Under VPN, Search and GET /providers show Proton with its VPN plans only, and Mail Plus stays out |
| M1.11 | Disney+'s and Crave's bundles and their providers (added 2026-10-26): TSN, RDS, ICI TOU.TV, Hulu and ESPN from their own pages, with `availableIn` for the ones sold in one country; 20 bundle files for Canada and the US; Disney+'s other countries surveyed; HBO Max, NFL+ and the bundles with them left out, as geo-blocked here (BLUEPRINT §14) | Crave's Standard With Ads card lists its bundles with Disney+, TSN, RDS and EXTRA; a US user sees the Disney+ and Hulu bundles; a Canadian never sees Hulu |
| M1.12 | Research covers bundles, official resellers and the terms (added 2026-10-27): the price-research skill and the pipeline (BLUEPRINT §6.5) check every provider's bundles, official resellers, terms of service and privacy policy each time, and the provider file says what each found; Mullvad's missing reseller, Laptop with Linux, added (its price before VAT), and Amazon's other 12 stores recorded as unreadable (price only in the basket) (BLUEPRINT §14) | An Albertan's Mullvad card lists Laptop with Linux first among its cheaper resellers; the skill and §6.5 list the three checks |
| M1.13 | Terms and policies (added 2026-10-27): `data/policy-topics.yaml` (13 topics in privacy, billing, legal and service, each with a five-tier rubric), a provider's `policies` (ratings with a one-line reason and quoted sources, for some plans or regions, and the pages they quote), `validateCatalog`'s checks, core's `planPolicies`, the card's Terms and policies section (tier pills green to red, `--policy-*`), the policy-research skill with its quote checker, and ratings for all ten providers (BLUEPRINT §4.10, §14) | Every card whose provider has ratings shows them by group with a tier in words and colour, a reason and its pages; every quote matches its page; a US user sees Proton's US disputes rating |
| M1.14 | Policy grades (added 2026-10-27, P8): the grades renamed Great, Good, Neutral, Poor and Bad; a dot per rating, like the rank dots, whose tooltip names its grade on hover, focus or a tap; reasons in plain words, muted, up to 240 characters (all 66 rewritten); an inline citation of each page a reason quotes, linked to the words (core's `quoteLink`), and the pages numbered (BLUEPRINT §4.10, §14) | Each rating's dot shows its grade on hover, keyboard focus and a phone's tap; each reason cites every page it quotes, once; all 111 quotes still match their pages |
| M1.15 | Proton's resellers (added 2026-10-27): a provider's `domains` (its other sites, where an approval page may be), Proton's ProxyStore vouchers approved by Proton VPN's blog, CoinGate recorded as unread (a firewall), and the price-research skill reading every site's blog and news for resellers (BLUEPRINT §4.9, §6.5, §14) | `data:validate` takes ProxyStore's approval from protonvpn.com; Search shows it only where it's cheaper (nowhere for real Canadian and US tax rates yet) |

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
| M3.1 | `discover-services.ts` (Wikidata) → `data/queue.yaml`. As built: `npm run data:queue` on core's `pipeline/queue.ts` (the queue's schema, checked by `data:validate`; `mergeCandidates`, `nextQueued`, `siteKey`) and `pipeline/wikidata.ts` (one query per class with an official website and 8 or more Wikipedia articles, `pickWebsite`); your own services first; 124 Wikidata services on 2026-10-28 (BLUEPRINT §6.5, §14) | The queue has services with websites and categories |
| M3.2 | `find-urls.ts` (common paths → sitemap → nav links → search API). As built: `npm run data:urls` on core's `pipeline/find-pages.ts` (`findPages`, `urlScore`, `pageFits`, `linksIn`, sitemaps, soft-404s, English and French) and `pipeline/search.ts` (Tavily, then Brave, then SearXNG, within this machine's budget; keys in `.env`), with `scripts/lib/web.ts` (robots.txt, one request per URL); the bot's text, amounts, tax-wording and robots modules moved to core (BLUEPRINT §6.5, §14) | At least 80% of a 20-service sample get a correct pricing URL |
| M3.3 | Playwright renderer, run locally so prices come back in CAD. As built: `npm run data:render` (`scripts/lib/browser.ts`, `playwright-core` 1.64.1 driving the system Edge): one navigation per page after robots.txt, the browser's User-Agent with the bot's token, `en-CA`, cookie banners declined, Monthly/Yearly toggles read, bot checks and error pages reported unread; `.pipeline/<id>/pages/<name>.json` (shown and served text, toggles, currencies) and a screenshot; `data:urls --browser` for script-filled pages: the sample at 16 of 20 (BLUEPRINT §6.5, §14) | Text and a screenshot are saved for each page |
| M3.4 | `extract-plans.ts` (LLM structured output, evidence quotes, proposed features; regular prices, the billing period as stated, `availableIn` from the provider's own country list, `taxIncluded` with the page's words when prices include tax everywhere, `acceptedNetworks` per region with its page's words (M9.2): BLUEPRINT §6.5). As built: `npm run data:extract` on core's `extractionAnswerSchema` (one schema for a session's Claude, Workers AI or a person), `extractionPrompt` and `extractionParts`, `draftFromAnswer` (quotes word for word or dropped, `findQuote` keeping the page's words; price plausibility; features by id, name or alias, else proposed; networks, `availableIn`, `taxIncluded` and policy ratings only with checked quotes) and `draftYaml` (BLUEPRINT §6.5, §14) | Draft YAML passes validation for most services |
| M3.5 | Batch PR script (`gh pr create`, about 10 providers per PR), with each new provider's logo fetched into `data/logos/` the way `npm run data:icons` does. As built: `npm run data:batch` (`--next 10` or queue ids; `--model workers-ai`, else a session answers the requests it writes; `--base`, `--leave-out-broken`, `--dry-run`): each step once, logos, `data:validate`, the queue marked, one branch, commit and PR whose body is core's `batchReview` (a table, each price linked to its quote, proposed features, dropped facts, the services left out, and a hidden line of queue ids so open and rejected batches aren't taken again) (BLUEPRINT §6.5, §14) | One command turns a batch into a reviewable PR, logos included |
| M3.6 | Run it on your own services (BLUEPRINT §6.6) and tune the prompts. As built: baselines for every cited page (`npm run data:baselines`, core's `citedPages`, `citedFacts`, `servedCovers`; 54 pages), the tuning (policies from footer links first, folded sections opened, a page's served text beside its shown one, local dates), and a batch in a session: Claude, Xbox Game Pass and Bitdefender drafted, Crunchyroll unreadable (BLUEPRINT §6.5, §14) | Your subscriptions are in the catalog with CAD prices |
| M3.7 | Resellers in the pipeline (BLUEPRINT §4.9, §6.5): find each provider's official reseller page, keep the shops it names as selling the provider's subscription (never partners that use the service in their own product), and read their regular prices from their own pages. As built: `searchQueries` adds the provider's own posts (`site:<domain> reseller OR partnered OR voucher`); the extraction's `resellers` (approval quotes on the provider's own site, each price on the shop's own site, known shops keep their ids, new ones go to `data/resellers.yaml` with their logos); the batch's review lists them with their approvals (BLUEPRINT §6.5, §14) | A provider with a reseller page gets its resellers in its PR, with the approval quotes |
| M3.8 | The automation's settings (added 2026-10-28): `data/automation.yaml`, validated by core's `automationSchema`: a cadence per kind of page and for discovery (daily, weekly, monthly, off), the weekly digest's day, the reviewer (`scheduled-claude`, `workers-ai`, `manual`), the batch sizes and each search engine's monthly budget for the bot and for this machine; `isDue`, `digestDue`, `searchBudgets`; the scripts' search reads its budgets there (BLUEPRINT §6.4, §14) | The bot decides what's due from the file on main, so a change takes a merge, not a redeploy; Tavily and Brave can't be left without a budget |
| M3.9 | The bot checks pages against their baselines, with a weekly digest (added 2026-10-28): each due page (core's `citedPages` and `isDue`, check dates in KV) compared with its baseline; unchanged, its facts hold with no model; changed or new, M8.3's checks and Workers AI with each price's quote checked word for word; findings pending in KV until the digest's day, when one pull request on `bot/catalog-digest` has the clear edits, each changed page's new baseline and `review/README.md` (prices, policies, features, pages not read) with the changed lines (BLUEPRINT §6.4, §14) | An unchanged page asks no model; a changed price, a lost quote and a changed policy page reach the digest, the first as an edit and the rest on the review list; a merged digest's pages drop out of KV |
| M3.11 | The discovery in the bot (added 2026-10-28): on `cadence.discovery`, the next `batch.discovery` queued services not in an open or rejected batch pull request; per service, a stage at a time over as many nights as the budgets take (KV keeps the work): core's `surveySite` and a step per kind with `findKind` (search last: Tavily, Brave, then SearXNG, within the bot's monthly budgets, keys as Worker secrets), Browser Rendering for pages only a browser shows, Workers AI per extraction part, then `draftFromAnswer`, the schema, the logo and baselines; one pull request on `catalog/batch-<date>-<id>` with the drafts, the new resellers and the queue's new statuses (`withQueueStatus`) (BLUEPRINT §6.5, §7.2, §14) | A due night drafts a queued service end to end with every quote on its page, and opens its batch pull request; a night short of Neurons or browser pages goes on the next night without reading its pages again; a service it can't read is left out with why; nothing merges |
| M3.10 | The digest's reviewers (added 2026-10-28), `reviewer` in `data/automation.yaml`: `scheduled-claude`, a weekly Claude Code scheduled task running the catalog-review skill on `bot/catalog-digest` from the committed text (prices, then policies, then features, a commit and a push after each item); `workers-ai`, the digest's review step with core's `reviewRequest` and `reviewOutcome`, within the night's Neurons and `batch.reviewItems`; `manual`, items wait for the owner. The bot never overwrites a branch with a review's commits (BLUEPRINT §6.4, §7.2, §14) | With `workers-ai`, a price the check couldn't confirm becomes an edit only with a quote on the page that shows it, a grade is only suggested, and anything unsure is labelled for the owner; the scheduled task's setup is documented, and a run cut short resumes at the first unticked item; no reviewer merges |

### M4 — App foundations
| ID | Task | Done when |
|---|---|---|
| M4.1 | Dexie database (BLUEPRINT §4.6, including `region`, add-on quantities, bundle items, `billingDay` and `priceOverride.until`) + repositories that expose signals. Repositories are the only way into Dexie, only non-sensitive fields are indexed, and records are Zod-validated on the way in and out (BLUEPRINT §11.1) | CRUD tests pass with `fake-indexeddb`, and a malformed stored record is rejected rather than shown |
| M4.2 | `SettingsStore` (on M4.1's `SettingsRepository`) + first-run dialog (P1), with the province/state menu and the sales-tax rate (BLUEPRINT §4.8): core's `settingsDefaults`, `subdivisionsOf` and `salesTaxRate`, with the Canadian rate table checked against official sources; Settings (P13) gets the budgets, Appearance and the 📍 dialog; `ThemeService` reads and writes `settings.theme`, keeping `localStorage` `ss-theme` as the startup cache (BLUEPRINT §8.1); the "IndexedDB blocked" notice (P15), from the repositories' `error` status, with [Continue anyway] running every repository in memory | Country, province or state, and currency are saved, with defaults from the browser locale; the menu lists only the chosen country's subdivisions; with IndexedDB blocked, the notice appears |
| M4.3 | `CatalogStore`: cached snapshot → revalidate `data/catalog/index.json`, and when its `catalogVersion` changed, fetch the region's file (`regionFileFor`: `data/catalog/<region>.json`, its group's or `catalog.json`; plus any region a list item uses) → save; the offline banner and "Catalog updated" toast (P1); P13's Catalog line. One `catalogCache` record per file, never merged; core's `planCatalogSync` chooses what to download (BLUEPRINT §6.3) | After the first visit the catalog shows at once from the cache; with the network down while the app is open it keeps working, and the banner shows the catalog's date; a new version is downloaded once and announced; a region with no file of its own gets its group's or the full catalog. Starting the app with no network comes with M10's service worker (narrowed on 2026-10-26: BLUEPRINT §14) |
| M4.4 | `FxStore` + `ss-price` with the converted marker and "+ tax" in tax-added regions ("incl. tax" for a price with `taxIncluded`, from core's `addedSalesTax`). The rates are kept in Dexie v2's `fxRates` table; core's `priceTaxNote` and `buyerTaxPlace` decide the note; the `/dev/components` gallery starts with `ss-price` (BLUEPRINT §4.7, §4.8, §14) | Converted prices show ≈, the icon and the tooltip; a Canadian sees "+ tax", and "incl. tax" on Mullvad |
| M4.5 | Shared components (§4.3) + a `/dev/components` gallery (dev builds only; started in M4.4 with `ss-price`), with hand-made inputs where the data comes later (charges M7.1, counts M6.1, view models M4.6); `ss-sub-card` moved to M5.2 and M6.8 (2026-10-26). Core: `budgetBar`, `rankChoices` and `countedRanks`, `planFeatureRows`, `monthWeeks` and `addMonths`, `tagColorPresets`, and the view-model parts the components take (`ItemStatus`, `RankCounts`, `FeatureSummaryRow`) (BLUEPRINT §14) | Every component renders in both themes in the gallery; each is keyboard-usable and passes axe; no hex colours outside `_tokens.scss` |
| M4.6 | `MetricsService` skeleton: resolved items (§3.4) from repos + catalog + FX. Core's `resolveItem` (and `typedPrice` for custom plans and price overrides); items it can't resolve come back with a reason. Status, the next charge and `ListMetrics` come with M7.1, effective ranks with M6.1 (BLUEPRINT §14) | Unit tests pass with a fixture list |
| M4.7 | Settings, grouped, the most used first (added 2026-10-28, UI polish, the owner's OK): Everyday (Budgets, Custom tags, Appearance), Where you are (Location and currency, Search), Your data (Backups, App lock, Catalog, and Delete all data folded until opened); "On this page" links each group and section, a side column from 960 px and chips that wrap under it; tags fold after six with Show all (P13) | Each jump link lands on its heading below the top bar with focus there; Delete all data opens only from its own summary; the page is one column at 360 px with nothing scrolling sideways |
| M4.8 | One control for each kind of choice (added 2026-10-28, UI polish; §4.3): every dropdown listed with a call; the four long lists (the item dialog's Bought in and own price's Currency, a custom plan's Currency, the card dialog's Card currency) become menus you can type in, like Settings'; the short ones stay; Lists' empty state is `ss-empty-state` like every other page's, and Features' loading line the same muted note (P3, P6, P9, P11, P12) | Typing "cad" or "cana" and Enter picks the currency or country in each of the four; no page's empty or loading state differs from the rest |
| M4.9 | Themed scrollbars (added 2026-10-28, UI polish; §4.1): thin, in both themes' colours from `_tokens.scss` only, with `scrollbar-color` and `scrollbar-width` and a `::-webkit-scrollbar` fallback for Safari | The page's, dialogs' and panels' scrollbars are thin, themed in light and dark, still draggable, and the thumb is at least 3:1 against what's behind it |

### M5 — Search & add
| ID | Task | Done when |
|---|---|---|
| M5.1 | core: matching and filters (`searchCatalog`), using `availability` (BLUEPRINT §4.7), on M2.3's `searchProviders`, the engine GET /providers shares: text matched term by term, with plurals and features' own names (P8); one result per provider with its matching plans priced, the plan shown (the user's own when it matches), each plan's reseller deals (`resellerDeals`) and "not offered" results for providers the text names; the Activity filter and status line from core's `itemActivity` (§3.3's active and inactive, moved from M7.1) and `providerActivity`. Add-ons, bundles and a suite's savings are M5.2's (BLUEPRINT §14) | Name, plan, alias and feature matches are ranked as described in P8, and plans not offered in the user's region never appear; filtering for 4k gives each provider's cheapest 4k plan; "Native pricing only" hides converted prices |
| M5.2 | Search page layout, results and the search sub-card with expand (P8): the search box (150 ms pause) and Sort, `ss-sub-card`'s search variant (§4.3, moved from M4.5) with plan chips, "Cheaper at" resellers from each plan's `deals` (`searchCatalog`, BLUEPRINT §4.9), and the expanded card (`ss-plan-details`): features with the user's ranks, add-ons, bundles with savings, a suite's plans and savings (core's `planExtras`), perks, notes and the price's date; loading, no-match and not-offered states; logos on a white tile in both themes (BLUEPRINT §14) | P8 layout criteria met |
| M5.3 | Filter panel + URL state (P8): `ss-search-filters` (the price per month up to the catalog's priciest plan, Category, Features over rank keys with chips, Activity, Native pricing only, Clear all) beside the results, and in a drawer opened by a Filters button under 960 px; core's `readSearchParams` and `writeSearchParams` (values the catalog doesn't have are dropped and the URL rewritten), `searchFilterOptions`, `featureSuggestions`, `filterCount` and `rankKeyLabel`; typing replaces its history entry, a run of price changes makes one, anything else adds one (BLUEPRINT §14) | Filters survive a reload and back/forward; filtering for 4k shows each provider's cheapest 4k plan; "Native pricing only" hides converted prices |
| M5.4 | Add-to-list menu → edit page with `?add=` (flows F1 and F4): `ss-add-to-list-menu`, one per Search card, opened by its prices and its bundles' prices (`ss-price`'s `menu` and `action`); core's `addRequestParams` and `readAddRequest` (`add` or `addBundle`, `interval`, and `count` above 1); until M6.3–M6.5 the editor says what it will add (BLUEPRINT §14) | F1 works end to end (needs M6.3–M6.5; stub it until then) |
| M5.5 | Pick mode `?addTo=` (flow F2, P7, P8): a banner "Adding to <list> ✕" in the pinned bar at both widths, its ✕ back to `/lists/<id>/edit`; in pick mode a price, or a bundle's price, goes straight to the editor with core's `addRequestParams`, with no menu (add-on and reseller prices as before); core's `readSearchParams` and `writeSearchParams` keep `addTo` (last, not a filter) while it names one of the user's lists, and drop it otherwise; the placeholder editor's [+ Add from catalog] (BLUEPRINT §14) | F2 works end to end, ending on the placeholder's message until M6.3–M6.5; `addTo` survives filter changes, typing, Clear all, a reload and Back/Forward; an unknown or deleted list is dropped from the URL in place, with no banner |
| M5.6 | "Sold in <country>" filter (added 2026-10-26): `CatalogQuery.soldOnly` in core's `searchCatalog`, `sold=1`/`sold=0` against the user's default (`SearchDefaults` in `readSearchParams`, `writeSearchParams` and `filterCount`), the panel's checkbox, and Settings' Search option `searchSoldOnly` (P8, P13; BLUEPRINT §14) | A UK user with Sold in on sees no fallback prices, a provider not sold there doesn't show even when named, and the Settings default holds across reloads with `sold=0` turning it off |
| M5.7 | Search fixes (added 2026-10-27, P8): nothing paints over the top bar; the search bar and the filter panel stay pinned while the results scroll (under 960 px one row, the box and a Filters icon button with a badge, Sort in the drawer); plan chips stay in place when switching plans, a lone plan shows its chip, and plans go cheapest first by their shortest billing period's price (core's `searchProviders`); the expanded section slides open and shut, closes from a "Hide details" bar at its foot, and keeps the card in view (BLUEPRINT §14) | Scrolled down, the bar and panel stay put at 360 and 1280 px; picking plans moves no chip; TSN lists Standard before Premium; Hide details closes the section and keeps the card on screen |
| M5.8 | Features chips that fit (added 2026-10-27, P8): a long chip ("Download devices: Downloads on 6+ devices") wraps inside its field instead of scrolling the panel or drawer sideways (a global `.ss-wrapping-chips`, since Material keeps a chip's label on one line), and its remove button is centred (BLUEPRINT §14) | No sideways scroll in the panel at 1280 px or the drawer at 360 px with the longest chip; its remove button is centred on it |
| M5.9 | Grades in words and a calmer panel (added 2026-10-27, P8): each rating's grade in muted text beside its topic ("Disputes (Good):"), the dot decorative again; a click on a Features chip removes it, as its X does; the filter panel has no scrollbar of its own, pinned by its foot when it's taller than the window (`--ss-panel-height`), with one-line hints (BLUEPRINT §14) | No rating needs a hover to show its grade; a click on a chip removes it once; at 560, 720 and 900 px high the panel never scrolls on its own and Clear all comes into view |
| M5.10 | Names without a stray space (added 2026-10-27): a browser puts a space before a `.visually-hidden` box ("$7.99 a month , add to a list"), so an Add to list menu item and the card's Plan, reseller, Hide details and policy-page links are named by one `aria-label`, and a price's action ends its hidden words (an `aria-label` would fail WCAG 2.5.3, since "/ mo" is read "a month") (BLUEPRINT §14) | A price reads "$7.99 a month, add to a list"; with cards expanded, no name on Search has a space before a comma or colon, in both themes at 360 and 1280 px |
| M5.11 | View in Search shows the item's plan (added 2026-10-28, the feedback after M9): Search's URL takes `plan=<plan id>` (core's `readSearchParams` and `writeSearchParams`, kept while the catalog has it; not a filter), and its provider's card shows that plan over the user's own (`CatalogQuery.plan`); List view's View in Search names the item's plan (BLUEPRINT §14) | From a Netflix Standard card, Search shows Netflix with Standard picked, though the user also has Standard with Ads |
| M5.12 | Where to change a policy (added 2026-10-28, the feedback after M9): a policy rating's optional `action` (core's `policyActionSchema`: what the link does and the provider's own page for it, which its policy or help pages link), checked by `validateCatalog` to be on the provider's own sites or its quoted policies' site; Search's Terms and policies links it under the reason; read for Netflix, Disney+, Hulu, ESPN, Crave, TSN and RDS; the policy-research skill's rule (BLUEPRINT §4.10, §14) | A rating whose reason says the user has to change something themselves links the provider's page for it, and validation refuses another company's |
| M5.13 | Show every reseller (added 2026-10-29, the feedback after M3): Settings' Search has "Show every reseller, even when it isn't cheaper", off by default (`searchAllResellers`); on, Search lists each official reseller of a plan, "Cheaper at" for the ones that sell it for less after the buyer's sales tax and "Also at" for the rest (core's `resellerDeals` with `all`, `ResellerDeal.cheaper`) (P8, P13, BLUEPRINT §4.9) | Off, Search is as before; on, Mullvad in Ontario lists Amazon "Also at"; the setting is saved and left out when off |
| M5.14 | Category you can type in (added 2026-10-29, the feedback after M10): Search's Category is a menu you can type in (`ss-choice-field`, M6.16), since the categories will grow; a click on any of those menus selects the chosen name, as Tab's focus does, so what's typed takes its place (P8, BLUEPRINT §14) | Typing "vp" in Category and Enter shows the VPNs; a click on Category, "str" and Enter pick Streaming video; Country does the same after a click |

### M6 — Lists & ranking
| ID | Task | Done when |
|---|---|---|
| M6.1 | core: rank keys, `providedKeys`, `resolveRank` (and `ResolvedItem.effectiveRanks`, §3.4), `rankCounts`, `featureSummary` (§3.2). M2.3 added `rankKeyOptions` and `providesKey`, and M2.4 `providedKeys` (`ranking/rank-keys.ts`); M6.1 added `ranking/resolve-rank.ts` and `ranking/rank-summaries.ts`, with `MetricsService` passing the profile's ranks to `resolveItem` (BLUEPRINT §14) | Tests cover enum and tier ladders and the resolution order |
| M6.2 | Features page (P9): a card per feature category with a parent's children under it (core's `rankingSections`), Find a feature (`nameMatcher`, shared with Search's Features box) and Ranked only (`filterRanking`), Set all and Reset all in one write (`RankingsRepository.setMany`), and "in 3 subscriptions" per row (`keyUsage`) (BLUEPRINT §14) | P9 criteria met |
| M6.3 | `ListDraftService`, with drafts saved in Dexie: core's draft record (`user/list-draft.ts`), `DraftsRepository`, Save in one transaction (`StorageEngine.transaction`), Search's pick mode adding to a new list's draft (`listsWithDrafts`), and `/lists/new` making the draft and replacing its URL (BLUEPRINT §14) | A draft survives navigation and a reload |
| M6.4 | List edit page (P5): the name, Cancel, Save and ⋮ Delete list (`DraftsRepository.deleteList`), a row per draft item (`MetricsService.resolve`) with 🗑 and Undo, the footer's average (core's `monthlyAverage`), and "Discard changes?" on leaving (`leaveGuard`). The item dialog opens from the query params in M6.5, [+ Add custom subscription] comes with M6.6, and the renewal dates and "This month" with M7.1–M7.2 (BLUEPRINT §14) | P5 criteria met, the item dialog's with M6.5 |
| M6.5 | Item dialog (P6): core's rules in `user/item-form.ts` (the periods a plan offers, the suggested renewal and its billing day, Specific dates' windows, the form's issues and the item it saves, duplicates), Signal Forms through one `validateTree`, full screen under 600 px, `?add=`, `?addBundle=`, `?addCustom=` and `?item=` opened once and dropped from the URL, ✎ opening it directly, and `CatalogStore.need` for an unsaved item's region. "Next charge" comes with M7.1 (BLUEPRINT §14) | P6 criteria met, the calendar's with M7.4 |
| M6.6 | Custom subscriptions page + editor (P12): core's rules in `user/custom-sub-form.ts` (the editor's issues, the record it saves, usage and what a change reaches, the features a plan can list), `CustomSubsRepository.save` and `removeWithItems` (each one transaction with the items), `ss-feature-picker`, and the list editor's [+ Add custom subscription] menu with Create new… (flow F3) (BLUEPRINT §14) | P12 criteria met, the calendar's and exports' with M7 |
| M6.7 | Lists overview (P3): a card per list with its average a month until the bars, its rank counts (`rankCounts`), View and 🗑 with Undo (`DraftsRepository.deleteList` and `restoreList`), the New Subscription List tile, and every list's feature summary (`featureSummary`) (BLUEPRINT §14) | P3 criteria met (the bars can wait for M7.2) |
| M6.8 | List view (P4), without the money parts, with `ss-sub-card`'s list variant (§4.3, moved from M4.5), built as `ss-item-card`; core's `listView` (search, sorts and filters, pinned first) in `user/list-view.ts` (BLUEPRINT §14) | Cards, pinning, search/filter and the edit button work |
| M6.9 | Backup export/import (the "Your data" section of P13, and the first-run dialog's "Import a backup instead"), with an optional passphrase that encrypts the file, and the crypto module it uses (BLUEPRINT §11.5). As built: core's `user/backup.ts` (the file, its checks, Merge), the app's `core/crypto/passphrase-crypto.ts` and `BackupRepository` (BLUEPRINT §14) | Export → delete all → import restores everything, encrypted or not; a wrong passphrase or a tampered file imports nothing |
| M6.10 | Optional app lock: a passphrase encrypts the user tables at rest, with a lock screen and an idle lock (P13, P15; BLUEPRINT §11.5). As built: core's `user/app-lock.ts` (what's sealed, the lock's settings) and `user/lock-idle.ts` (Lock after), `StorageEngine`'s sealing with `RowCipher` and `AppLockRepository`, the lock screen (`layout/lock-screen.ts`) and the idle lock (`core/lock/auto-lock.ts`) (BLUEPRINT §14) | Locked data on disk is unreadable without the passphrase; turning the lock on and off round-trips every table; a wrong passphrase unlocks nothing |
| M6.11 | Custom tags (the Settings section of P13, added 2026-10-28 so M6 covers all of Settings): each tag renamed inline, recoloured (the 12 presets plus a hex field) and deleted, asking first when it's in use ("Used by 5 subscriptions"), and ⊕ to add one. As built: core's `user/tag-rules.ts` (names, colours, `tagUsage`, `withoutTag`), `TagsRepository.usage` and `removeWithItems` (one transaction on tags, items and drafts), Settings' `ss-tags-setting` and `ss-tag-editor`, the shared `ss-tag-colours` and `TagDeleter`, and the item dialog's Delete a tag menu (BLUEPRINT §14) | P13's tag criteria met: tags persist and update every page live |
| M6.12 | Add-ons and renewals on the cards (added 2026-10-28, the feedback after M9): List view's cards list their add-ons with their prices ("+ Extra member × 2 $15.98 / mo"), the editor's rows say what each adds ("Extra member (with ads) for $7.99 a month"), and the status badge says when an active item renews by itself ("Auto-renews Nov 12"), on Search's cards too (core's `providerRenewals.renews`) (BLUEPRINT §14) | An add-on added, swapped or removed in the item dialog shows on its card; Netflix's card says when it auto-renews |
| M6.13 | List view's bar stays in reach (added 2026-10-28, the feedback after M9): the search box and Sort pinned below the top bar as the cards scroll; from 960 px View optimizations pinned at the side column's foot once the column's other parts have scrolled away; under 960 px a compact View optimizations in the pinned bar (BLUEPRINT §14) | Scrolled down a long list, the search box, Sort and View optimizations are on screen at 360 and 1280 px, over nothing in the side column |
| M6.14 | Shared ranks (added 2026-10-28, the feedback after M9): ranks changed in a plan's item dialog go to the same provider's other plans in that list (the user's choice), saved with the list's Save; Essential stays on its plan; "Ranks for this plan only" (`ListItem.ownRanks`) keeps a plan out; a new plan starts with its siblings' ranks. Core's `ranking/shared-ranks.ts` (BLUEPRINT §4.6, §14) | Changing Netflix Standard's 1080p rank changes Standard with Ads' too, in the draft, and not with the box ticked |
| M6.15 | Any colour for a tag (added 2026-10-28, the feedback after M9): `ss-colour-picker`, the device's own colour picker as a swatch beside the hex field, each following the other, in Settings' tag editor and the item dialog's New tag (which gets the hex field too) (BLUEPRINT §14) | A colour picked on a phone or a desktop fills the hex field, and a hex typed colours the swatch |
| M6.16 | Menus you can type in (added 2026-10-28, the feedback after M9): `ss-choice-field`, a Signal Forms control on Material's autocomplete, for the first-run and 📍 dialogs' Country, Province or territory (State) and Currency: typing narrows the list (a name's start first, then anywhere, or a code), Enter picks the first, and leaving without a pick puts the choice back (BLUEPRINT §14) | Typing "al" and Enter picks Alberta; "usd" finds US Dollar; leaving the field restores the chosen one |
| M6.17 | List view's filters pinned with their button (added 2026-10-29, the feedback after M3): the search box, Sort and the filters Sort opens are pinned together below the top bar, at every width, and open filters taller than the window leaves them scroll on their own (P4) | Scrolled to the end of a long list with the filters open, they're still under the bar, and every filter can be reached |
| M6.18 | List view's round buttons centred (added 2026-10-29, the feedback after M3): under 600 px Sort's icon, and under 960 px View optimizations' compact icon, sit in the middle of their buttons, with the same padding on both sides (P4) | The icon's centre is within 1 px of its button's, in both themes, with and without a count beside it |
| M6.19 | Auto-renews with an end date, in words that agree (added 2026-10-29, the feedback after M3): Auto-renews says how it's charged and Ends on when it stops, so both can be set; the dialog says "Auto-renews until it ends" and "It stops then: no renewal after"; one badge says "Renews Nov 12, then ends Nov 28" (or "Renew by …, then ends …"), never a renewal on or after the end; the billing line says "auto-renews until Nov 28, 2026" (P4, P5, P6) | No text reads "Auto-renews" next to "Ends" as two facts; an item ending before its next charge says only "Ends Nov 28" |

### M7 — Money, schedule & calendar
| ID | Task | Done when |
|---|---|---|
| M7.1 | core: schedule engine for charges, statuses (`ItemStatus` on M5.1's `itemActivity`, adding the end date and manual renewal), totals and budget checks (§3.1, §3.3), with `addMonths` in core's `dates/` (built in M4.5 for the mini calendar), on M4.6's resolved items (`ResolvedItem.status` and `nextCharge`, `ListMetrics`; unresolved items left out of totals and counted; an add-on billed on its own period); sales tax on charges in `tax/`, from `addedSalesTax` (M4.2's rates, none on a price with `taxIncluded`) (BLUEPRINT §4.8; recheck the rates if `canadianSalesTaxCheckedOn` is old). As built: core's `schedule/` (`chargeDates`, `itemCharges`, `nextCharge`, `itemStatus`, `listMetrics` with the budget checks), `tax/charge-tax.ts` (`salesTaxOn`), `user/reanchor.ts` and `dates/period.ts`; `ResolvedItem.status`, `nextCharge` and `overridePrice`; and the UI it was waiting for: the cards' next charge and "Wrong date?", the editor's renewal dates, the item dialog's "next charge" and Search's "Ends" and "Renew by" (BLUEPRINT §14) | Charges include tax by province and "plus tax" amounts, and none on a price that includes it (Mullvad). Tests cover month-end with and without `billingDay`, leap years, 30-day and 2-week cycles, windows, yearly repeats, start/end dates, a re-anchored date and a price override ending |
| M7.2 | Totals and budget bars on Home, Lists and List view. As built: `MetricsService`'s `metrics`, `global`, `metricsOf` and `charges` (core's `listMetrics`, with a conversion flag for each total), `ss-budget-totals` (a bar against each budget that's set, else the total alone, and Home's "Set a monthly budget →"), the Lists cards' bars, List view's side column and each card's "31% of list", and the list editor's "This month" (BLUEPRINT §14) | The numbers match the §3.1 definitions |
| M7.3 | Home (P2). As built: the mini calendar on a card beside every list's totals (stacked under 720 px), the Subscription Lists pill, Next payments (the next three charges), the empty state's Create a list, Browse services and Import backup, and pulsing dots while prices load (BLUEPRINT §14) | P2 criteria met |
| M7.4 | Calendar (P10): grid, day panel, list filter, upcoming list, agenda layout on mobile. As built: core's `readCalendarParams`, `writeCalendarParams`, `hiddenLists` (`user/calendar-params.ts`), `monthGrid` and `settings.calendarHiddenLists`; the page, `ss-day-panel` and its bottom sheet; List view's mini calendar; and `ClockService.today` moving on at midnight (BLUEPRINT §14) | P10 criteria met |
| M7.5 | Exports: ICS (one all-day event per charge, no `RRULE`s: BLUEPRINT §11.2), CSV, XLSX, TXT (lazy-loaded). As built: core's `export/` (`itemTable`, `paymentTable`, `summaryTable`, `exportWorkbook`, `calendarEvents`, `listText`, `listFile`, `exportFileName`) and `periodCost`; the app's `Exporter` and `export-files.ts` with papaparse, exceljs and ics; List view's Export, the Calendar's Sync calendar and Export to file, and a per-list JSON (BLUEPRINT §14) | The files open in Google Calendar and Excel, and a plan billed on the 31st shows in every month |
| M7.6 | Budget warning banners. As built: `ss-budget-warnings` on Home (every list together) and List view (the list alone), from M7.1's budget checks, with the month's link to the Calendar (BLUEPRINT §14) | A warning appears for a projected over-budget month |
| M7.7 | Budget bars' colour scale and warnings you can dismiss (added 2026-10-28, the feedback after M9): every budget bar's fill is one colour, changing gradually from green, to yellow exactly at the budget, to red at 150% (core's `budgetBar.towardYellow` and `towardRed`, the user's choice), the Calendar's by the month's total against the budget; the budget warnings' ✕ hides one until its period or budget changes (`settings.dismissedBudgetWarnings`, core's `budgetWarningKey`), and "Show 1 hidden budget warning" brings them back (BLUEPRINT §8.1.1, §14) | A bar's colour moves gradually from green to yellow at its budget and on to red; a dismissed warning stays hidden after a reload and comes back for a new month or budget |
| M7.8 | The Calendar, still and reachable (added 2026-10-28, the feedback after M9): from 960 px a column of its own beside the grid, for the day's panel and Upcoming, so opening a day never moves the grid; under 600 px a compact grid (dates and dots) above the agenda, any day opening in the bottom sheet; a back button to the page it was opened from, named by it, but not from the sidebar (BLUEPRINT §14) | The grid keeps its width when a day opens; a phone can open any day from the grid; from List view's mini calendar, "← Work Related" goes back |
| M7.9 | The Calendar's JSON and Text, and its own calendar (added 2026-10-28, the feedback after M9): Export to file adds JSON (core's `paymentsFile`) and Text (`paymentsText`); each event lists its tags and has them as `CATEGORIES`; Sync calendar's steps make a Simply Sub calendar first in Google, Apple and Proton Calendar, since they colour a calendar and not an event (BLUEPRINT §11.2, §11.3, §14) | Both files download with the lists shown; the steps import into a calendar of its own |
| M7.10 | Home as a hub (added 2026-10-28, UI polish, the owner's OK of its 360 and 1280 px wireframes): quick actions (Add a subscription to a list or a custom one, New list, Open a list); the budget warnings and budgets; Coming up, every payment in the next 14 days, with Mark renewed on a manual renewal (the next renewal moves to the charge after it, with Undo; a charge the schedule counts as paid, before an item's next one, isn't listed); the mini calendar; Your lists, a card each with this month; Ways to save, each list's View optimizations; Price changes, what catalog updates changed in the lists' prices this past month (core's `priceChangesBetween`, `withPriceChanges`, kept in `settings.priceChanges` by CatalogStore after an update, in a chunk of its own) (P2) | The hub at 1280 px has budgets and Coming up beside the calendar, and one column at 360 px; Mark renewed moves the renewal on a period and Undo puts it back; a catalog update that changes a listed plan's price lists it for a month |
| M7.11 | Statuses you can see (added 2026-10-29, the feedback after M3; §3.3): a manual renewal says "Manual · renew by Nov 29"; an item a bundle, suite or extra member replaces says what it becomes ("Moves to Netflix and Crave on Nov 15", "Extra member on Mine (Netflix Standard) from Nov 20"; core's `itemReplacements`); and Search says which bundle a provider is in ("Active · 1 list · in Netflix and Crave"; `ProviderActivity.bundleIds`) (P4, P8) | Proton Family with auto-renew off shows "Manual"; a bundle applied on Optimizations, saved, shows on each plan it replaces; a provider in a listed bundle shows the bundle's name on Search |
| M7.12 | Calendar events that repeat (added 2026-10-29, the feedback after M3): the .ics has a repeating event for each run of an ongoing subscription's charges at one amount, with the schedule's own rule (core's `repeatRule`: the day of the month, or the 28th up to it with `BYSETPOS=-1` for a shorter month's last day, which M10.2 made `BYMONTHDAY=-1` for Proton Calendar; `INTERVAL`; `UNTIL` where the plan or a price of the user's own ends), so it shows past the first year; Specific dates stay an event per charge; `X-WR-CALNAME` names the calendar, which only a subscribed feed (M10's live feed) makes on its own (P10, BLUEPRINT §11.2) | A monthly plan billed on the 31st imports as one event on the 31st or each month's last day, every year after; an end date or an own price's end stops its run there |

### M8 — Optimizer & bot
| ID | Task | Done when |
|---|---|---|
| M8.1 | core: optimizer (BLUEPRINT §10) with fixtures. As built: core's `optimizer/` (`optimize`, its model, coverage map, search, cards and fingerprints, and `actionTitle`), with per-level plans split into independent cards, per-item coverage, the service itself lost on removal and removal only with a reason, the user's choices (BLUEPRINT §14) | All fixture cases pass |
| M8.2 | Optimizations page (P14) + "Apply" to a draft. As built: `ss-suggestion-card` in the sections, Apply through core's `suggestionEdits` onto the draft, Dismiss into `dismissedSuggestions` (its schema, repository, Dexie v3, sealed by the lock and in backups v2), List view's `ss-optimizations-link`, and `OptimizerService` with a Web Worker for lists over 12 items under the production CSP (BLUEPRINT §14) | P14 criteria met |
| M8.3 | `apps/bot` nightly price check → GitHub PR (BLUEPRINT §6.4, §7.7), which also checks each `taxIncluded` quote is still on its page, rereads reseller prices and checks each reseller's approval quotes on the provider's page (BLUEPRINT §4.9); the same run proposes a new logo when a provider's or reseller's icon changed (a rebrand). As built: a cron-started Workflow with a step per provider, prices confirmed on their pages before any Workers AI, Browser Rendering as a fallback, YAML edited line by line, and one `Price updates <date>` PR on `bot/price-updates`; deployed by hand on 2026-10-28, with its token (BLUEPRINT §7.2, §14) | A changed price produces a PR, and so does a changed logo, a `taxIncluded` quote gone from its page or a reseller the provider no longer names |
| M8.4 | Apply several optimizations (added 2026-10-28, the feedback after M9): Apply puts a card's changes on the list's draft and stays, the optimizer running on the list as its draft has it, so the next suggestion counts them; Undo puts the draft back (`ListDraftService.putBack`), and Review and save opens the editor (BLUEPRINT §10, §14) | Two suggestions applied one after the other are both in the editor's draft, and Undo takes back the last |
| M8.5 | Apply replaces what a suggestion replaces (added 2026-10-29, the feedback after M3): a bundle or suite Optimizations adds starts on its first charge (`startDate`), and an extra member joins its host on the day the account it replaces ends (an add-on's optional `since`), so nothing new is charged before it starts and this year's past charges stay as they were; the optimizer prices them the same way; equal savings are listed by title (P14, BLUEPRINT §4.6, §10.3) | Replacing Crave Premium and Disney+ Premium with their bundle lowers this year's total and the next 12 months' by what the card said, never raises them; an extra member adds nothing to its host's charges before it joins; the item dialog keeps the day it joins unless its quantity changes |
| M8.6 | Review changes, and suggestions that never clash (added 2026-10-29, the feedback after M3): each suggestion applied is recorded on the draft with the items it changed as they were and what it added (core's `appliedChangeSchema`, `withDraftEdits`, `dependentChanges`, `withoutApplied`); Review changes (`/lists/:listId/optimize/review`) lists each one like a diff (− what goes, + what comes, ~ what changes), what it saves, and the list's totals before and after, with Undo for each (and the later ones that build on it), Save changes, Open in the editor and a back button to Optimizations; while the suggestions are worked out again after an Apply, no card can be applied (P14) | Applying two suggestions and undoing the first takes back the second only when it builds on the first; Save changes saves the list with the rest; no card that clashes with one applied can be applied |

### M9 — Payment (Phase 4)
| ID | Task | Done when |
|---|---|---|
| M9.1 | Cards repo, Payment page and card dialog (P11). As built: `CardsRepository` (with `usage` and `removeWithItems`), the page's tiles from core's `cardSummary` and `monthlyWithTax`, and the card dialog (`CardEditor`) on core's `cardFormIssues`, with `cardUsage` and `withoutCard` for deleting one (BLUEPRINT §14) | P11 criteria met |
| M9.2 | `acceptedNetworks` in the data and the extraction pipeline (the schema has validated the field since M1.1). As built: per region, each with its page and quotes (the user's choice), core's `networksNamedIn`; read for all ten providers (five name none); the price-research skill and §6.5's extraction record it, and the nightly bot rechecks it (BLUEPRINT §14) | The pipeline fills it |
| M9.3 | core: eligibility, FX and cash-back maths, card assignment, limit checks (BLUEPRINT §9.3). As built: core's `rewards/` (`networkRate`, `cardCost`, `cardAcceptance`, `itemOnCard`, `cardLoads`, `overLimits`, `monthlyOnCard`, `bestCard`, `assignCards`), `Charge.charged` and `ResolvedItem.acceptedNetworks`, and the optimizer's `card` action; open question 1 decided with the user (BLUEPRINT §14) | Tests pass |
| M9.4 | Card select in the item dialog, net-cost displays, over-limit warnings. As built: the item dialog's Payment (only the cards its seller takes, the Best card chip and notes on acceptance and FX fees), List view's net in its header and on its cards, P11's Assign best cards (a preview per list, lists with unsaved edits skipped, Apply with Undo through `CardsRepository.assign`) and each tile's net and over-limit warning, the Calendar's days that take a card over its limit with the card in the day's panel, and the optimizer's card action wired in (BLUEPRINT §14) | All visible on P4, P6, P10 and P11 |
| M9.5 | Examples that name no real card (added 2026-10-28, UI polish): the card dialog's Name hint ("As on the card: Cash Back Mastercard"), and every example card in the docs and the tests ("Cash Back Mastercard", "Rewards Mastercard", "Rewards Discover"), where real products were named | No real card product is named in the app, the docs or the tests; the card dialog's hint shows the generic example |
| M9.6 | Pay in another currency (added 2026-10-29, the feedback after M3): when a plan's seller prices it in several currencies for where it's bought, a group of it or GLOBAL (Proton's USD, CAD, EUR and CHF), the optimizer suggests the one that costs least on the item's card after its FX fee and cash back, as a free saving ("Pay for Proton Unlimited in CAD" for a US buyer, whose US$12.99 a month is about US$11.60 in CAD at late October’s rate; core's `currencySuggestions`); another country's price never counts, since it's set by where the buyer is; Apply makes it the user's own price in that currency from the item's next charge (`priceOverride.since`, the item dialog's From); cards, editor rows, Review changes and the text export say what an own price still to come will be, and from when (P6, P14, BLUEPRINT §4.7, §10.3) | A plan sold in USD and CAD, paid with a card with no FX fee, is suggested in the cheaper one with its saving; a card whose FX fee cancels the difference gets no suggestion, nor does a plan priced by country; after Apply its next charge is in that currency, this year's past ones are as they were, and nothing more is suggested for it |

### M10 — Extras (Phase 5)
Planned on 2026-10-29 with the owner, from BLUEPRINT §11.3, §11.4 and §14, where their decisions are recorded:
three pull requests, each built a task at a time with a commit per task.
1. **The Calendar** (M10.1–M10.4): the server's user data and the live calendar feeds, with a test calendar the owner
   subscribes to in Proton Calendar before the app's side is built; then the year view.
2. **Offline and sync** (M10.5–M10.9): the service worker, the update prompt and install, then encrypted device sync.
3. **The catalog** (M10.10–M10.12): price reports, and regional prices in the discovery pipeline. The regions' prices
   (M10.13) then arrive as the pipeline's own batch pull requests: the US's gaps, the United Kingdom, the euro
   countries, and Australia and New Zealand.

The local-first rule still holds: the feeds and sync are opt-in, a report is anonymous, and nothing leaves the device
that the user hasn't chosen to send. "Suggest a service" (BLUEPRINT §12) isn't part of M10.

| ID | Task | Done when |
|---|---|---|
| M10.1 | The server's user data: a D1 database of its own (`simply-sub-user`), the API's write rules (rate limits per IP and per resource, size limits, daily caps, secrets kept as hashes) and a nightly clean-up | A write over any limit is refused with its error code; user data can't use more than half of D1's daily writes; what has expired is gone the next night |
| M10.2 | Live calendar feeds, the API: `POST /cal`, `PUT /cal/:id`, `DELETE /cal/:id` and `GET /cal/:token.ics`, on core's feed schema and calendar writer; repeat rules Proton Calendar accepts, for the .ics download too | The contract's examples pass; a revoked feed answers 404; the owner's Proton Calendar shows every event of the test calendar |
| M10.3 | Live calendar in the app (P10, P13): the opt-in dialog, a calendar for everything and one per tag, the subscribe steps for each app, updates after every change, Revoke | A change to a list reaches its feeds within seconds; each tag's calendar holds only its payments; Revoke ends every link |
| M10.4 | Calendar year view (P10): `view=year`, twelve small months with their totals, and the year against the annual budget | Each month's total matches the month view's; it works by keyboard, in both themes at 360 and 1280 px, from a lazy chunk |
| M10.5 | Offline start: the service worker, registered through a Trusted Types policy of its own, with `navigationRequestStrategy: 'freshness'` | Under `wrangler dev` the app starts and every page works with the network off, with no CSP or Trusted Types error; the worker's code is lazy and the initial bundle stays under 500 kB |
| M10.6 | The update prompt and install: "A new version is ready" with Reload, the web app manifest and icons, Settings' Install | A new build served reaches an open tab as the prompt, and Reload runs it; Edge offers to install the app |
| M10.7 | Sync's code and merge: a 32-byte seed shown as 24 words and a QR code, keys derived from it on the device (HKDF), core's sync payload and per-record merge by `updatedAt` and `deletedAt` | Tests: the newer of each record wins and every deletion carries; the keys match their test vectors; a wrong code opens nothing |
| M10.8 | Sync, the API: `GET`, `PUT` and `DELETE /sync/:chain`, each write conditional on the version read | Two devices writing at once never overwrite each other; the server holds nothing it can read |
| M10.9 | Sync in the app (P13): turn it on, join with the code, the devices, syncing after changes, turn it off, start over with a new code | Two browsers stay the same through adds, edits and deletes on either, offline ones included |
| M10.10 | Price reports, the API and the bot: `POST /reports` (choices only, no free text), the bot checking each reported plan's page the next night, and the weekly digest | A report its page confirms becomes the digest's price edit; one it doesn't costs the reviewer nothing |
| M10.11 | Report a wrong price in the app (P8) | A report sent by keyboard from a Search card reaches the server, and each refusal is explained |
| M10.12 | Regional prices in the pipeline: each page's other regions (hreflang links, locale paths), `--region` for rendering, extraction and batches, and pages that redirect to another country refused | A batch drafts a region's prices for the catalog's providers, every price quoted on its page |
| M10.13 | The first regions: a batch pull request each for the US's gaps, the United Kingdom, the euro countries, and Australia and New Zealand | A user there sees native prices for every provider whose pages could be read |

#### M10 specs

**M10.1 — The server's user data** (BLUEPRINT §5.4, §7.1)
- **Where:** a second D1 database, `simply-sub-user` (binding `USER_DB`, migrations in `apps/api/migrations-user/`,
  applied by `npm run deploy` as the catalog's are), so user data never shares the catalog's database, which a deploy
  can reseed. Made with `wrangler d1 create` (free); its id goes in `wrangler.jsonc`. Branch previews use the same
  database (a preview version keeps the Worker's resources).
- **Write rules**, for every request that stores something (`apps/api/src/writes.ts`):
  - per IP, 10 writes a minute (a Rate Limiting binding, on top of the 60 requests a minute); per feed set or sync
    chain, 6 a minute (the same kind of binding, keyed by the resource);
  - JSON bodies only, but sync's sealed payload, with a size limit per route;
  - daily caps, counted in the database and reset at 00:00 UTC, so user data never uses more than half of D1's
    100,000 rows written a day, which the catalog's deploys share (the limit is the account's); new feeds and sync
    chains stop at 400 MB stored (of 500);
  - secrets (a feed's token, its manage key, sync's auth secret) are random values of at least 128 bits, kept only
    as SHA-256 hashes and compared in constant time; none is ever logged, and errors log the route's pattern only
    (M2.8);
  - `Cache-Control: no-store` on every write's answer.
- **Clean-up:** a cron trigger on the API Worker, nightly before the bot's 03:00 UTC run, deletes what has expired
  (M10.2, M10.8) and old daily counts, and hands the day's reports to the bot (M10.10).
- **Contract:** new error codes for a body too large (413), a stale sync version (412) and a daily cap reached (503,
  with `Retry-After`), in the examples' `errorCodes` and core's `errorBodySchema`.
- **Acceptance**
  - [x] Over each limit the Worker answers with its code and writes nothing; the daily caps hold under a loop of
        writes (Worker tests)
  - [x] No token, key or chain id appears in a log line, with every route made to throw in tests (the live calendar's
        in M10.2; sync's come with M10.8)
  - [x] The nightly clean-up deletes only what has expired
- **As built:** `apps/api/src/writes.ts` (`writeLimit` on every `/api/*` write, `resourceAllowed`, `readBody` and
  `readJson`, `countWrite` with `dailyCaps` and `storageCap`, `capReached` and `storageFull`, `newSecret`,
  `secretHash`, `isSecretOf` and `bearerSecret`), `src/clean-up.ts` from the Worker's `scheduled` handler (its default
  export is now `{ fetch, scheduled }`), the user database's first migration (`daily_counts`), and core's new error
  codes with `bodyProblemSchema`. Tested in `apps/api/test/writes.spec.ts`.

**M10.2 — Live calendar feeds, the API** (BLUEPRINT §5.2, §11.3)
- **A feed set**, made by one device: a calendar for everything, one for each tag chosen and one for payments
  without a tag.
  - `POST /cal` `{ feeds: [{ name, color?, events }] }` → `201` with the set's id, its manage key (shown once) and each
    feed's token, `https://` URL and `webcal://` URL.
  - `PUT /cal/:id` (`Authorization: Bearer <manage key>`) replaces the set: a feed sent with its token keeps its URL,
    one without gets a new token, and a feed left out is revoked.
  - `DELETE /cal/:id` revokes the whole set (`204`). A missing or wrong key gets `403 forbidden`.
  - `GET /cal/:token.ics` serves one calendar (`text/calendar`, an ETag and `304`), or `404` once revoked or expired.
    Calendar apps' servers fetch it, and they share IP addresses, so it's limited per feed (30 a minute), not per IP.
- **What's sent and kept:** each payment's title (its name and amount as charged, or its name alone), its day and its
  repeat rule (M7.12), and each calendar's name and colour. No list names unless chosen, no notes, no record ids: each
  event's UID is a hash the app makes. The server keeps the set's id, the manage key's hash and an expiry date, and
  per feed its token's hash and its calendar file, written when the set is.
- **Expiry:** 180 days after the app last wrote the set; the app writes at least every 30 days while it's used.
- **Repeat rules Proton Calendar accepts** (the owner's calendar; its web client's `getIsRruleSupported`, read
  2026-10-29, takes one day of the month, and `BYSETPOS` only with a weekday, and drops other events on import): core's
  `repeatRule` writes a plan billed on the 31st as `BYMONTHDAY=-1` (the 31st, or a shorter month's last day: the
  billing rule exactly) and a yearly Feb 29 as `BYMONTH=2;BYMONTHDAY=-1`, and `calendarEvents` makes a monthly plan
  billed on the 29th or 30th an event per charge (the download's next 12 months; a feed's events roll forward with it).
  M7.12's `BYMONTHDAY=28,29,30,31;BYSETPOS=-1` goes, from the download too.
- **The test calendar:** once M10.1 and M10.2 are on the branch's preview link, a feed made with `POST /cal` holds an
  event for each kind of rule the app writes (a day of the month, the 31st, every 3 months, every 30 days, every 2
  weeks, yearly, a yearly Feb 29, a run with an end, a single charge), each titled with what it tests. The owner
  subscribes in Proton Calendar and says which show; a rule that doesn't becomes single events before M10.3. A title
  then changed with `PUT` shows whether Proton picks the change up on its own (every 4 to 16 hours, by its help page).
  The test feed is revoked after.
- **Core:** `calendarFeedsSchema` (strict: up to 26 feeds and 2,000 events in all, titles up to 120 characters, ISO
  dates, repeat rules only of the form `repeatRule` writes, colours `#rrggbb`) and `feedIcs`, RFC 5545's text: CRLF
  lines folded at 75 octets without splitting a character, escaped text, all-day `VALUE=DATE` events that don't block
  time, `X-WR-CALNAME` and RFC 7986's `NAME`, a refresh hint of 12 hours (`REFRESH-INTERVAL`, `X-PUBLISHED-TTL`), and
  the colour where apps read one (Apple's `X-APPLE-CALENDAR-COLOR`; RFC 7986's `COLOR` takes only a CSS colour name, so
  it's left out). The bodies' schemas join `successBodySchemas`.
- **Contract:** the Phase 5 sketch rewritten for sets; its note "never repeat rules" has been wrong since M7.12.
- **Acceptance**
  - [x] Every example passes the contract tests; `feedIcs` has tests for folding, escaping and repeat rules, and its
        output parses back as a calendar (a test-only parser, pinned)
  - [x] A PUT keeps each kept feed's URL and revokes the ones left out; a wrong key changes nothing
  - [x] A revoked or expired feed answers 404 at once
  - [ ] No rule `repeatRule` writes fails Proton's check (a test against its supported forms), and the owner's Proton
        Calendar shows every event of the test calendar (the test: done; the owner's calendar: pending)
- **As built:** core's `export/calendar-feed.ts` (`calendarFeedsSchema` with `feedRulePattern`, `feedIcs`, the bodies'
  schemas) and `repeatRule`'s Proton forms, tested against Proton's conditions and against `chargeDates` for every
  anchor of 2027 and 2028, monthly and yearly, every 1 to 3 periods with each billing day, and by `ical.js` 2.2.1 (a
  test-only dependency of core) expanding each kind of rule; `apps/api/src/routes/cal.ts` on the user database's second
  migration (`cal_sets`, `cal_feeds`), `FEED_RATE_LIMIT` and `rateLimit` leaving feeds to it, and the clean-up of
  expired sets; the contract's calendar examples rewritten, the GET example's file written by `feedIcs` and held to
  the Worker's answer word for word. Tested in `apps/api/test/cal.spec.ts`.

**M10.3 — Live calendar in the app** (P10, P13; BLUEPRINT §11.3)
- **Where:** Sync calendar ▾ starts with "Live calendar…", above the three apps' file imports; Settings' Your data
  gets a Live calendar card that opens the same dialog.
- **Turning it on:** the dialog says what's uploaded and who can see it ("Anyone with a link can see that calendar"),
  then asks which calendars (Everything, on by default; each tag, with its colour; Without a tag), what each payment
  shows (its name and amount, the default, or its name only; and whether to add its list's name), and [Create links]
  uploads them (M10.2).
- **With links:** each calendar's name and colour, Copy link, Add to Google Calendar (Google's add-by-URL page, in a
  new tab), Add to Apple Calendar (the `webcal://` link) and Proton Calendar's steps, each app's steps folded under it
  (from its own help pages, read when built: where the link goes, how to give it the tag's colour, how soon a change
  shows, and that each calendar counts toward the app's calendars: Proton's free plan has 3); when the links were
  last updated; Change calendars, New links (revoke and create, for a link shared too far) and Revoke all (asks
  first).
- **Keeping it current:** a lazy `LiveCalendarService`, started when there are links, builds each calendar's events
  (core's `feedEvents`, from `calendarEvents`, with amounts as the provider charges them, so exchange rates never
  change a feed), hashes them, and sends a PUT only when the hash changed: 5 s after a save, a catalog update or a
  change of country or tax rate, on start, when back online, and at least every 30 days. A tag renamed or recoloured
  updates its calendar under the same link; a tag deleted revokes its calendar. Offline, it waits; a `404` or `403`
  says the links no longer work, with New links.
- **Stored:** a `calendarFeeds` record (Dexie v4): the set's id, the manage key, each calendar's token and what it's
  for, the choices and the last hash. The app lock seals it, backups leave it out (it holds a key), and sync carries
  it (M10.9), so any device keeps the links current.
- **Acceptance**
  - [x] Links for Everything and two tags serve three calendars; an item with both tags is in both; Without a tag has
        the rest
  - [x] A saved change reaches the feeds within 10 s; a change that touches no payment, or new exchange rates, sends
        nothing
  - [x] Revoke all makes every link answer 404, and the dialog starts over
  - [x] Keyboard only, both themes at 360 and 1280 px, axe with the dialog open, no horizontal scroll; the dialog and
        the service in lazy chunks
  - [ ] The owner subscribes to a preview link in Proton Calendar and sees a change arrive
- **As built:** core's `liveCalendars` (`export/live-calendars.ts`) on `calendarEvents`' new options (amounts as
  charged; the titles chosen; a list's name; a run starting from its anchor once that has passed, so its start and UID
  hold still as the days go by and a feed changes only when the lists do), and the `liveCalendar` record
  (`user/live-calendar.ts`, Dexie v4, sealed by the lock, left out of backups); the app's `LiveCalendarRepository`,
  `shared/live-calendar/` (the client, `LiveCalendarService` with a Web Lock across tabs, the dialog and its opener),
  started from a chunk of its own once the app is stable; Sync calendar's menu now names each app's item "… file";
  Settings' Live calendar card (Your data, after App lock); Delete all data revokes the links first when it can. Tested
  in `live-calendar-service.spec.ts`, `live-calendar-dialog.spec.ts` and core's `live-calendars.spec.ts`;
  `check-m10-calendar.cjs` in the browser.

**M10.4 — Calendar year view** (P10; BLUEPRINT §8.3, §13.1)
- **URL:** `?view=year` beside the `month` the page already has: its year is shown, and Month returns to that month.
  Core's `readCalendarParams` and `writeCalendarParams` gain `view` (`month` by default, written only when `year`).
- **Controls:** a Month | Year switch (two buttons with `aria-pressed`) before the arrows. In the year view the Month
  select is gone, the arrows move a year ("Previous year", "Next year") and Today goes to this year.
- **The bar:** this year's payments so far against the year's total, with the annual budget's tick and M7.7's colour
  against it (§3.1's This year); a past year shows full, a future one $0 so far.
- **The months:** twelve cards (four a row from 1280 px, three from 960, two from 600, one below), each with the
  month's name, its total (≈ when converted) and payment count, coloured against the monthly budget as the Calendar's
  bar is, a warning when a card goes over its limit that month (M9.4), and a small grid of its days, a dot on each
  day with a payment and today ringed. The grid is decorative: the card is one link, named with all it shows ("March
  2026, 4 payments, $63.21"), to that month's view, which opens with focus on its grid.
- **Built from:** core's `yearSummary` (each month's total, conversion, count, days with payments, budget state and
  over-limit cards) from the charges the month view uses; the view is in the Calendar's own lazy chunk (the page is a
  lazy route), since the app's first `@defer` would bring Angular's defer runtime, 7.6 kB, into the initial bundle.
- **Unchanged:** Showing, Sync calendar and Export to file (the next 12 months). Upcoming isn't shown in the year view.
- **Acceptance**
  - [x] Every month's total equals the month view's for the same lists, and the bar matches §3.1's This year
  - [x] Month ↔ Year keeps the month; the arrows, the Year select and Today work; a reload, Back and Forward restore
        the view
  - [x] Keyboard only: the switch, the year's controls, then each month in order; Enter on a month opens it
  - [x] Both themes at 360 and 1280 px with axe and no horizontal scroll; the initial bundle unchanged
- **As built:** core's `view` in `readCalendarParams` and `writeCalendarParams` (only `year` is written; another value
  is rewritten away) and `yearSummary` (`schedule/year-summary.ts`); the page's Month | Year switch (the one shown
  filled, `aria-pressed`; on a phone a line of its own, so the arrows stay with the year), and `ss-calendar-year`. A
  card's link is its month's name, stretched over the card, named with all the card shows ("March 2026, 2 payments,
  $43.04"), its other text hidden from screen readers: a link around all of it failed axe's label-in-name, its visible
  text in another order than its name. A strip gives each month's total against the biggest month's, coloured against
  the monthly budget on M7.7's scale when one is set. The initial bundle stays at 498.90 kB.

**M10.5 — Offline start** (BLUEPRINT §6.3, §7.6, §14)
- **The worker:** `@angular/service-worker` 22.2.3 (exact) and `ngsw-config.json`:
  - `navigationRequestStrategy: 'freshness'`: a page load asks the network first, so Web Analytics keeps counting
    visits (BLUEPRINT §14, M4.3), and falls back to the cached `index.html` offline;
  - every script and style prefetched at install (about 1 MB compressed, once; after that only the files a version
    changed), so a page never opened online still works offline;
  - the fonts kept as they're used (43 files and 1 MB in all, most of them subsets a page never needs), and the
    provider icons (`/icons/*`) for 30 days;
  - `/api/*` and `/data/*` left to the network: the catalog and the rates are kept in IndexedDB (M4.3, M4.4), and the
    catalog's check must reach the server to see a new version.
- **Registration:** after the first render, from a lazy chunk, in production builds only, through a Trusted Types
  policy of its own, `simply-sub#service-worker`, which accepts only `/ngsw-worker.js` and joins `_headers`'
  `trusted-types` (Angular's `provideServiceWorker` registers with a plain string, which the CSP blocks). `SwUpdate`
  comes from an environment injector made in that chunk, so none of the worker's code is in the initial bundle.
- **Headers:** `ngsw-worker.js` and `ngsw.json` revalidated on every load (Cloudflare's default, as for `index.html`);
  the kill switch documented (`safety-worker.js` deployed as `ngsw-worker.js` unregisters the worker everywhere).
- **Checks:** under `wrangler dev`. Browser checks that answer requests themselves (`context.route`) block the worker
  (`serviceWorkers: 'block'`), since Playwright doesn't see a worker's requests.
- **Web Analytics:** whether Cloudflare still adds its beacon to a page the worker fetched is checked on the live site
  after the merge; if visits stop counting, `index.html` carries Web Analytics' own snippet instead (the owner's
  call).
- **Acceptance**
  - [x] After one online visit, with the network off, `/`, a deep link and every sidebar page load with the catalog,
        the rates and the lists, and no CSP or Trusted Types error in the console
  - [x] No `/api/` or `/data/` answer is kept by the worker: its caches hold none (Angular's worker answers every
        request in its scope, passing on those it doesn't keep, so CDP's `fromServiceWorker` can't tell them apart)
  - [x] The worker's code is in a lazy chunk, and the initial bundle stays under 500 kB: 499.00 kB, 0.10 kB more than
        M10.4's
- **As built:** `apps/web/ngsw-config.json` and the production build's `serviceWorker`; `core/pwa/service-worker.ts`
  (the policy, the registration, and `SwUpdate` from an injector made there with a `registrationStrategy` that never
  fires); `app.background.ts`, the one chunk the app loads once it's stable, which starts the live calendar's updates
  (moved there from `app.config.ts`) and the worker, so a third background job adds nothing to the initial bundle. A
  browser that refuses service workers gets a console warning and the app needs the network, as before. `_headers`
  adds `simply-sub#service-worker`. Tested in `service-worker.spec.ts`; `check-m10-offline-sync.cjs` (29: offline
  start, the rates from IndexedDB, the worker's caches) under `wrangler dev`, and the older scripts that answer
  requests themselves now block the worker. Their counts had fallen behind the catalog (#76) and the Lists heading
  (#77) and are brought up to date (BLUEPRINT §14).

**M10.6 — The update prompt and install** (P1, P13)
- **Update prompt:** when the worker has a new version ready, a snackbar "A new version of Simply Sub is ready."
  [Reload] (with the lock on, it adds "Reloading locks the app."). Reload reloads, which the worker answers with the
  new version; a list being edited is a draft in IndexedDB, so nothing is lost. If the worker can't serve the app any
  more: "Simply Sub needs to reload to keep working." [Reload]. The worker checks on each page load, and the app asks
  it again when a tab is shown after an hour and from Settings' Check for updates. A page load fetches `index.html`
  from the network first (M10.5), so it may already run a version the worker learns of only afterwards: then the page
  moves onto it with no prompt.
- **Manifest:** `manifest.webmanifest` (`id` and `start_url` `/`, `display: standalone`, the name, a description,
  `theme_color` and `background_color` with `_tokens.scss`'s values, which a test compares), icons of 192 and 512 px
  and a maskable 512 made by a script (`sharp`) from an SVG mark and committed. The mark is a simple one drawn for the
  app from the logo's "Sub" pill, in the theme's colours, shown to the owner before it's committed; it replaces the
  favicon, still Angular's default logo, too. `<link rel="manifest">` and a
  `theme-color` meta per colour scheme in `index.html`, its inline script and that script's CSP hash unchanged; once
  the app has started, both take the theme on screen, so an installed app's title bar follows a theme chosen in the
  app.
- **Install** (Settings, a new App group after Your data): [Install] when the browser offers it
  (`beforeinstallprompt`, Chromium), else the steps for Safari (Share, then Add to Home Screen; on a Mac, File, then
  Add to Dock) and Firefox on Android; hidden when the app runs installed. The app's version and Check for updates sit
  under it.
- **Acceptance**
  - [x] Under `wrangler dev`, a new build served reaches an open tab through Check for updates as the prompt, and
        Reload runs it; a page load runs a new build at once, with no prompt
  - [x] Edge offers to install the app (Settings' Install); CDP reports no manifest or installability error
  - [x] The owner approves the icon: in both themes, as a maskable icon and at favicon sizes (2026-10-29, the white S
        on burgundy over the inverted one)
  - [x] Keyboard only, both themes at 360 and 1280 px, axe with the snackbar shown
- **As built:** `core/pwa/app-updates.ts` (the prompt, the hourly and Settings' checks, a page already on the new
  version moved onto it quietly), `core/pwa/install-offer.ts` (Chromium's offer, listened for from the start: the only
  part in the initial bundle, 0.14 kB), `core/pwa/app-version.ts` with `apps/web/scripts/build.mjs` (the commit and
  day as defines), `core/theme/title-bar.ts`, the manifest and `scripts/app-icons.ts` (`npm run app:icons`: the icon
  SVG, PNGs of 192, 512 and a maskable 512, a 180 px apple-touch-icon and `favicon.ico`), and Settings' App group.
  "A second build served brings the prompt within a page load" became two cases: with `freshness` a page load already
  runs a new build, so only an open tab is prompted, which the hourly check or Check for updates finds. Tested in
  `app-updates.spec.ts`, `install-offer.spec.ts`, `title-bar.spec.ts`, Settings' spec and the API's
  `web-manifest.spec.ts` (the manifest's and the metas' colours against `_tokens.scss`); `check-m10-offline-sync.cjs`
  with two more builds (BLUEPRINT §14). Since M10.9 a check the worker answers "none" waits for a version its own
  check has just downloaded, until the page has offered it or moved onto it.

**M10.7 — Sync's code and merge** (BLUEPRINT §11.4, §11.5)
- **The code:** 32 random bytes, shown as 24 BIP39 words (the last word carries a checksum) and a QR code of the
  words, which a phone's camera app can read; scanning inside the app comes later (Firefox and Safari can't).
  `@scure/bip39` and a QR library that returns the modules, both pinned exactly and in the lazy sync chunk; the QR is
  one SVG path bound with `[attr.d]` (no `innerHTML`).
- **Keys** (the app's crypto module): HKDF-SHA256 over the seed, an info string per key: the chain's id (16 bytes),
  the auth secret (32 bytes; the server keeps its SHA-256) and the AES-256-GCM key (non-extractable). A random seed
  needs no slow stretching, unlike a passphrase. The payload is gzipped (`CompressionStream`), then sealed with
  AES-256-GCM, bound to the chain's id. The key protects the copy on the server from the server; on the device the seed
  is the user's secret, sealed by the app lock when it's on (BLUEPRINT §11.5).
- **The payload** (core's `user/sync.ts`): the backup's tables (lists, items, custom subscriptions, tags, rankings,
  cards, dismissed suggestions) with their soft-deleted records, M10.3's links, the settings every device shares
  (country, subdivision, currency, tax rate, budgets, Search's defaults, dismissed budget warnings) with a
  `sharedUpdatedAt` of their own, the backup's `schemaVersion`, and the devices (an id, a name and when each last
  synced). Never the theme, the Calendar's shown lists, Home's price changes, the app lock, drafts or the caches.
- **The merge:** `mergeSync(local, remote)`, per record by id: the later `updatedAt` wins, a deletion included; a tie
  goes the same way on both sides; a record only one side has is kept. It says which records this device must write
  and whether the chain needs a new version. Remote records are checked with their schemas (a bad one is left out and
  logged by table and key only); a newer `schemaVersion` stops sync on this device; an older one is migrated as
  backups are.
- **Acceptance**
  - [x] Tests: newer wins, deletions carry, ties agree, shared settings by their own time, per-device settings never
        leave the device, invalid records left out, a newer version refused
  - [x] Tests: the words round-trip and a changed word fails its checksum; known seeds give known chain ids; a wrong
        key or a changed byte opens nothing
- **As built:** core's `user/sync.ts` (`syncTables`, `sharedSettingsFields`, `sharedSettings`, `withSharedSettings`,
  `touchesSharedSettings`, `readSyncCopy`, `mergeSync`; the copy holds the tables under `data`, as a backup does, so
  its migrations apply), the settings' `sharedUpdatedAt` (the backup's version 3), and the crypto module's
  `sync-crypto.ts` (`@scure/bip39` 2.4.0: the words, `completeWord`; `syncKeys`, `sealCopy`, `openCopy`). A tie is
  settled by the records' canonical JSON (keys sorted), the same on every device; a device with nothing new writes
  once a day, to move its "last synced" on. Tested in core's `sync.spec.ts` (BIP39's and Node's HKDF known answers in
  `sync-crypto.spec.ts`). Nothing imports the crypto yet: M10.9's lazy sync chunk will.

**M10.8 — Sync, the API** (BLUEPRINT §5.2, §11.4)
- `GET /sync/:chain` (`Authorization: Bearer <auth secret>`): the sealed payload (`application/octet-stream`) with
  `ETag: "<version>"`, `304` when it hasn't changed, `404` when there's none.
- `PUT /sync/:chain`: with `If-None-Match: *` it starts a chain and keeps the secret's hash; with `If-Match:
  "<version>"` it replaces the payload only if nobody wrote since, else `412` (the app reads, merges and tries
  again). Up to 1 MiB. One SQL statement compares and writes, so two devices can't both win.
- `DELETE /sync/:chain`: the chain is gone for every device (`204`).
- **Stored:** the chain's id, the secret's hash, the version, the sealed payload, its size and when it changed;
  deleted 180 days after its last write (the app writes at least every 30 days while it's used).
- **Acceptance**
  - [x] Contract examples and Worker tests: start, read, `304`, a write after another's gets `412` and changes nothing,
        a wrong secret `403`, too big `413`, delete
  - [x] What's stored has no list name, amount or record id in it (a test searches the stored bytes)
- **As built:** `apps/api/src/routes/sync.ts` and `migrations-user/0003_sync_chains.sql` (the copy as base64, since D1
  answers a BLOB as an array of numbers); PUT answers `201` or `200` with `{ data: { version, updatedAt } }` and the
  ETag; core's `maxSealedCopyBytes`, `syncWriteBodySchema` and `syncBody`; the nightly clean-up deletes chains past
  their days. A write that can't be made (none, another secret, a stale version) is answered before it's counted, and
  a chain past its days starts again with its version moving on. The contract's examples carry bytes as `bodyBase64`
  (BLUEPRINT §14).

**M10.9 — Sync in the app** (P13; BLUEPRINT §11.4)
- **Settings' Your data, Sync between devices** (replacing "Create local sync"):
  - Off: [Turn on sync] and [Join with a code].
  - Turn on makes the code and shows its words (numbered, with Copy) and its QR code: "Keep it in a password manager
    or on paper: it's how you add a device, and nobody can recover it." [I've saved it] sends the first copy.
  - Join: 24 fields, each completing a word from its first four letters, or the words pasted at once; a wrong
    checksum says so; then what the synced copy holds (counts, as Import shows them), and Merge (the default) or
    Replace this device's data (asks first).
  - On: "Synced 2 minutes ago" and Sync now; the devices, this one first with its name editable; Show the code (asks
    first); Turn off on this device (the data stays here); Start over with a new code (moves the data to a new chain
    and deletes the old, for a lost device: the others join again); Delete the synced copy.
  - Problems in words: offline (it waits), the chain deleted from another device, a newer version of the app needed,
    a copy that won't open.
- **`SyncService`** (lazy, started when sync is on, after unlocking): syncs on start, when back online, when a tab is
  shown again, 10 s after a change to a synced table, every 10 s while the tab is shown, and from Sync now; one tab at
  a time (a Web Lock, like the catalog's check); reads with `If-None-Match`, merges, writes this device's changes in
  one transaction, then sends a new version with `If-Match`, up to three tries.
- **Stored:** a `sync` record (Dexie v5): the seed, this device's id and name, the last version and when. The app lock
  seals it; backups leave it out. Delete all data asks whether to delete the synced copy too; Import's Replace waits
  until sync is off (Merge works).
- **Acceptance**
  - [x] Two browsers on `wrangler dev`: turned on in one and joined in the other by keyboard, an item added, edited or
        deleted on either shows on the other after Sync now, and within 15 s on its own
  - [x] Changes made offline on both, to different records, all survive; the theme stays per device
  - [x] Start over and Delete the synced copy leave the other browser saying what happened
  - [x] Keyboard only, both themes at 360 and 1280 px, axe with each dialog open, no horizontal scroll
- **As built:** core's `user/sync-record.ts` (the record, `defaultDeviceName`) and `shared-settings.ts`
  (`withSharedTime`, which the settings repository stamps every write with, Zod-free since it's in the initial
  bundle); `SyncRepository` (Dexie v5); the crypto module's `sync-code.ts` (the words, apart from the keys, so only the
  dialogs load the word list); `shared/sync/` (the client, `SyncService`), `shared/qr-code/` (`@paulmillr/qr` 0.3.0,
  exact), and Settings' `ss-sync-setting` with its three dialogs (the code, Join, Rename). Polling is every 10 s, not
  15, to keep "within 15 s" with a margin. Join takes the chain's shared settings, which a new device's first run would
  otherwise outweigh. Tested in `sync-service.spec.ts` (against a stand-in server, another device's writes sealed with
  core's functions), the card's and the join dialog's specs, and `check-m10-offline-sync.cjs`'s two browsers
  (BLUEPRINT §14).

**M10.10 — Price reports, the API and the bot** (BLUEPRINT §5.2, §5.4, §6.4)
- **`POST /reports`:** a plan, the country, and what's wrong: a different price (amount, currency and period), not
  sold any more, or not sold in that country. No free text: nothing a visitor types reaches a person or a model.
  Checked by core's `priceReportSchema` against the catalog's ids; `202` with nothing to read back. The write rules
  apply (M10.1), with 3 a minute per IP and 500 a day. No Turnstile: the limits and the bot's check keep spam from
  costing anyone time.
- **Kept:** a row per plan, country, problem and price, with a count and the first and last day. No IP address, and
  nothing else about the sender.
- **To the bot:** the nightly clean-up (M10.1) moves the day's reports into the bot's KV (one key per reported plan,
  so its writes stay few) and deletes them from D1. The bot checks each reported plan's price pages that night, ahead
  of their cadence and within its budgets, and the weekly digest gets:
  - the page shows a new price: the price edit, as from any check, noting the reports;
  - the page still shows the catalog's price: a line in the digest's body, nothing to review;
  - the page can't be read: a review item;
  - a country the catalog doesn't price yet: counted under "Regions people asked about", for M10.13.
- **Acceptance**
  - [x] Worker tests: a valid report is counted; an unknown plan, a bad price or an extra field gets `400`; the
        limits hold
  - [x] Bot tests: a reported plan is checked that night, and each outcome lands in the digest as above
  - [x] The catalog-review skill handles the new items
- **As built:** core's `catalog/price-report.ts` (`priceReportSchema` with the problems `price`, `discontinued` and
  `not-in-country`; the counts' and the KV entry's schemas; `addReports`; `reportedPrices`); the API's
  `routes/reports.ts`, user migration `0004_price_reports` and the clean-up's hand-over; the bot's `reports.ts`, its
  state's `reports()` and the digest's two sections and review items. Tested in core's `price-report.spec.ts`, the
  API's `reports.spec.ts` and contract examples, and the bot's `run.spec.ts` (BLUEPRINT §6.4, §14).

**M10.11 — Report a wrong price in the app** (P8)
- **Where:** Search's expanded card, beside the price's date: "Report a wrong price".
- **The dialog:** the plan and the user's country; What's wrong: The price is different (amount, currency and period,
  filled in with the price shown), It's not sold any more, or It's not sold in Canada; [Send report]. Offline, it
  says so and sends nothing. After: "Thanks. Netflix's page will be checked tonight." Refusals in words (too many just
  now, paused for today).
- **Acceptance**
  - [x] By keyboard from a Search card to the dialog and Send; the report reaches the local database under
        `wrangler dev`
  - [x] Both themes at 360 and 1280 px, axe with the dialog open, no horizontal scroll; the dialog in a lazy chunk
- **As built:** `shared/report-price/` (the dialog and `sendReport`), opened from `ss-plan-details`, the expanded
  card's section, with the plan its details show (a card's first plan until another is chosen). "The price is
  different" is filled in with the catalog's price before any conversion (`PickedPrice.source`), asking which billing
  period when the card shows several; it's offered only when the card shows a price. A report sent closes the dialog,
  and a snackbar thanks the user. Tested in the dialog's spec, `plan-details.spec.ts` and `check-m10-reports.cjs`
  (BLUEPRINT §14).

**M10.12 — Regional prices in the pipeline** (BLUEPRINT §6.5)
- **Finding a region's page:** a pricing page's other regions from its `hreflang` links and the site's locale paths
  (`/en-gb/`, `/uk/`), mapped to ISO countries (core's `regionalPages`); `find-pages` and the search score pages for
  the region asked for, not Canada.
- **Reading it:** `data:render --region GB` with that region's locale, language and time zone. A page that redirects
  to another country or shows another country's currency is recorded as unread, never extracted. A page that shows
  prices only to visitors in the country is left for a browser there (the computer's VPN, if the owner wants).
- **Drafting:** `data:extract --region` and `draftFromAnswer` add only that region's prices to an existing provider,
  each quoted on its page; `data:batch --region GB` opens one pull request for the region, with the review table and
  the providers left out and why.
- **The bot:** a regional page is a page like any other, with its own baseline, so the nightly checks cover it; a
  redirect to another country counts as unread.
- **Skills:** price-research reads a region this way.
- **Acceptance**
  - [x] Tests: hreflang links and locale paths map to countries; a redirected page is refused
  - [x] A dry run for one region finds the regional pricing page for most of the catalog's providers that have one,
        and its drafts pass `data:validate`
- **As built:** core's `pipeline/regional-pages.ts` (locales to countries, `regionalPages`, `regionalVariants`,
  `regionBrowser`, `regionalRefusal`, `wentToAnotherCountry`) and `pipeline/regional-draft.ts` (the request, the answer
  and `regionalPrices`, a check of its own rather than `draftFromAnswer`, which drafts whole providers), and
  `regionalReview` in `batch-review.ts`; `ProviderSite.region` in find-pages; the scripts' `--region`, working in
  `.pipeline/<id>/regions/<region>/`; and the bot's page reader. The dry run for GB (2026-10-29): a regional pricing
  page read for Bitdefender (hreflang), Netflix and Xbox Game Pass (their addresses with GB's country), and Mullvad;
  Disney+'s went to Canada's (a page that needs a visitor there); the rest are sold in Canada or the US only, or at
  one price everywhere. 11 prices for 3 providers, none dropped, each file passing `data:validate`
  (BLUEPRINT §6.5, §14).

**M10.13 — The first regions** (the owner's choice)
- A batch pull request from `data:batch --region` for each of: the US's gaps (the providers sold there with Canada's
  prices only, such as Bitdefender and Xbox Game Pass), the United Kingdom, the euro countries (the `EU` group's price
  where a provider charges every euro country the same, else each country's), and Australia and New Zealand. Each is
  reviewed and merged by the owner like any batch; each region's catalog file follows from `data:build`.
- **Acceptance**
  - [x] In each region, every provider whose pages could be read has native prices, and the pull request lists the
        rest with why
- **As built (2026-10-29):** four pull requests into `main`, data only with the tests that read those provider
  files, as the owner chose: the United Kingdom (#81: Bitdefender, Netflix, Xbox Game Pass, 11 prices), the US's gaps
  (#82: Bitdefender and Xbox Game Pass, 6), Australia and New Zealand (#83: the same three, 21), and the euro
  countries (#84: Germany, France, Ireland, the Netherlands, Spain and Italy read; Xbox Game Pass the same in all six,
  so one EU price; Bitdefender and Netflix each country's). Left out with why: Disney+, whose pages for every region
  went to Canada's (no VPN, the owner's choice), the services sold only in Canada or the US, the ones priced the same
  everywhere, and the plans a region's page doesn't price (BLUEPRINT §14).

---

## 3. Core rules every page uses

These live in `packages/core` as pure functions, so every page computes them the same way.

### 3.1 Money and time
| Term | Definition | Used by |
|---|---|---|
| **Picked price** | The price `pickPrice` chooses for the user's region and currency: one source region and currency per plan, add-on or bundle, with every interval priced there, converted if it isn't in the user's currency. Native means no conversion was needed (BLUEPRINT §4.7) | Everywhere a price appears |
| **Item price** | The price override if one is set and the charge is dated on or after its `since` (if any, M9.6) and before its `until` (if any); otherwise the picked plan price plus each picked add-on price × its quantity. Bundle items use the bundle price. An add-on not sold for the item's billing period is billed on its own (M4.6: Disney+'s monthly extra member on a yearly plan), so its charges follow its period | Charges |
| **Sales tax** | Added to the item price for a buyer in a tax-added region (Canada, US) at their rate: the built-in rate for their province, or their own `salesTaxPercent`. Typed amounts (a custom plan, a price override) already include it unless marked `plusTax` (BLUEPRINT §4.8) | Charges |
| **Monthly equivalent** | Price per month: year ÷ 12, week × 52 ÷ 12, day × 365 ÷ 12, each ÷ `intervalCount`. Before tax, like the price tags | Sorting, the price filter, "≈ $x/mo" hints |
| **Charge** | One scheduled payment: `{ date, amount, tax, currency, itemId, listId, converted, manual, charged }`. `amount` includes `tax`, the sales tax part; `charged` is the same in the currency the provider charges it in, before any conversion, which a payment card's FX fee is judged against (M9.3) | Calendar and all totals |
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
- **Next charge:** an item's first charge on or after today. An Ongoing item's anchor that's still to come is its next
  renewal (P6 asks for it so), so its next charge is on or after it: a charge counted back from it onto today is the
  payment just made, which totals count and the calendar shows (M7.1).
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
- "Not ranked" is never stored. Removing a rank soft-deletes its record (`deletedAt`), so a sync can pass the removal
  on (BLUEPRINT §4.6).
- Features with `rankable: false` (e.g. `includes-subscription`) never appear in ranking UIs.

**Counts and summaries**
- **Rank counts** (list cards): for each item, and each key its plan provides, count the key's effective rank.
  Show all eight ranks from Essential to Unwanted, with zero counts in grey. Not ranked isn't shown.
- **Feature summary** ("VPN 2 / 3"): for each summary key, *active items that provide it* / *all items that provide it*.
  The summary keys are:
  - the keys marked `headline: true` in the registry;
  - any key the user ranked Essential, Critical, Needed or Wanted;
  - since the feedback after M6.8, what each item has itself: its booleans, and its own rung of a ladder (not the
    lower rungs that rung provides too). A set's values count only when ranked or headline.

  Only keys with a total of at least 1 are shown, sorted by rank, then headlines first, then by name. A key's rank
  there is its highest among the items that provide it (each item's override, else the profile's), and a row is
  named as Search's Features chips are, "Video quality: 4K (Ultra HD)" (M6.1). The Lists pages show 8 rows, then
  "Show all".

### 3.3 Statuses
| Status | Rule | Shown as |
|---|---|---|
| Active | Today is inside a paid period (ongoing: on or after `startDate` and before `endDate`; limited: from a window's start through its end) | Green dot, "Active" |
| Inactive | In a list but not active today | Amber dot, "Inactive", plus "Active from Sep 10, 2026" when a future window or start date exists |
| Not listed | (Search only) The provider isn't in any list | Grey dot, "Not listed" |
| Ending | `endDate` is within the next 30 days | Small "Ends Nov 3" badge; with a renewal before it, one badge: "Renews Nov 1, then ends Nov 3" (M6.19) |
| Manual renewal | The next charge is `manual` | Small ↻ "Manual · renew by Nov 3" badge (the word since M7.11) |
| Replaced | (List view) It ends on a day when, in the same list, a bundle or suite that includes it has started, or an extra member joins another account of its provider (core's `itemReplacements`, M7.11) | Small "Moves to Netflix and Crave on Nov 15", or "Extra member on Mine (Netflix Standard) from Nov 20", in place of the renewal and end |
| In a bundle | (Search only) A bundle in a list includes one of the provider's plans (`ProviderActivity.bundleIds`, M7.11) | "Active · 1 list · in Netflix and Crave" |

In Search the status is per provider, across all lists ("Active · 2 lists").

Active and Inactive, with "Active from", come from the billing dates alone (core's `itemActivity`, M5.1); a window
that repeats yearly is copied into each later year, never earlier ones. Ending and Manual renewal need the charges:
core's `itemStatus` (M7.1), and for Search's providers `providerRenewals`, where "Ends" needs every item still going
on to end within 30 days.

### 3.4 View models
```ts
// packages/core/src/user/resolved.ts: resolveItem(item, context) → { ok: true, resolved } | { ok: false, unresolved }
export interface ResolvedItem {        // as built in M4.6, M6.1 and M7.1
  item: ListItem;
  listId: string;
  providerId?: string; planId?: string; bundleId?: string; customSubId?: string;
  name: string;            // "Netflix"; a bundle's or custom subscription's own name
  planName: string;        // "Standard"; a bundle's plans: "Netflix Standard + Crave Premium"
  iconUrl?: string;        // catalog: the relative icons/<id>.webp when the provider has an iconUrl (the absolute URL
                           // points at production, so a preview would miss a new logo); custom subs:
                           // api/v1/icon?domain=<its link's domain>; none → ss-provider-icon shows a letter
  link?: string; cancelUrl?: string;   // a catalog plan's link, else the provider's website
  region: string;          // where it's priced: the item's region, else Settings' country
  price: PickedPrice;      // the plan's, bundle's or custom plan's price for the item's billing period
  addOns: { id: string; name: string; quantity: number; price: PickedPrice }[];
                           // each priced for the item's period when sold that way, else its shortest (Disney+ bills
                           // extra members monthly, even on a yearly plan)
  override?: PickedPrice;  // the price override with the item's period, while it applies (before its `until`)
  overridePrice?: PickedPrice; // M7.1: the same whatever the date, for the charges dated before its `until`
  monthlyEquivalent: number; // today: the override, else price + add-ons × quantity; before tax, except typed amounts
  features: Plan['features']; // the plan's, a bundle's plans' together (bundleFeatures), or the custom plan's
  providedKeys: RankKey[];
  status: ItemStatus;      // M7.1: { kind: 'active' | 'inactive'; activeFrom?; endsOn?; manual }
  nextCharge?: Charge;     // M7.1: with tax; none for a free plan or once nothing is left
  effectiveRanks: Record<RankKey, Rank>; // M6.1: each provided key's rank, override > profile > not-ranked
  acceptedNetworks?: CardNetwork[]; // M9.3: the seller's where it's bought; left out when unknown (custom too)
  // cardId is the item's own (item.cardId), Phase 4
}

export interface UnresolvedItem {     // pages say why; totals leave it out and report how many (M7.1)
  item: ListItem; listId: string;
  reason: 'pending'                   // the catalog file for its region, or the custom subscriptions, haven't loaded
    | 'plan-gone' | 'bundle-gone' | 'custom-gone' | 'add-on-gone'
    | 'no-price';                     // no price for the item's billing period where it's bought
}

export interface ListMetrics {       // as built in M7.1: core's listMetrics (schedule/list-metrics.ts)
  thisMonth: number; thisYear: number; next12: number;
  approx: boolean;                                   // true if converted amounts are included
  notCounted: number;                                // unresolved items, and ones with a charge it couldn't convert
  shares: ReadonlyMap<string, number>;               // each item's share of next12: a card's "31% of list"
  rankCounts: Record<Exclude<Rank, 'not-ranked'>, number>;
  featureSummary: { key: RankKey; label: string; active: number; total: number }[];
  monthlyBudgetShare?: number; annualBudgetShare?: number;
  warnings: BudgetWarnings;                          // §3.1's budget checks: { month?, year? }
}
```
`MetricsService` (Angular) builds these as `computed()` signals from the repositories, `CatalogStore`,
`FxStore` and `SettingsStore`. Components never recompute money or ranks themselves. As built in M4.6:
`resolutions` (every item's, by id), `byList` and `list(listId)` (`{ resolved, unresolved }`, in the order the
items were added), and `status` (the items' loading status). Each item is priced with the catalog file of the region
it was bought in (`CatalogStore.catalogFor`).

### 3.5 State and URL conventions
- **Saved data** (lists, items, rankings, tags, cards, settings, drafts) → Dexie.
- **Shareable UI state** (search query and filters, calendar month, selected lists) → URL query parameters.
- **Small per-device preferences** (the calendar's list filter, collapsed groups) → `settings`. The Calendar keeps
  the lists it leaves out (`calendarHiddenLists`, M7.4), so a list made since shows.
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

**Scrollbars (M4.9, UI polish):** thin everywhere, in the theme's colours: `--ss-scrollbar-thumb` (the muted text
colour: 5.0:1 or more on every light background and 4.2:1 or more on the dark ones, Material's dark menus being the
least; WCAG 1.4.11 asks 3:1), `--ss-scrollbar-thumb-active` (the text colour, while Safari's thumb is hovered or
dragged) and `--ss-scrollbar-track` (transparent), all in `_tokens.scss`. `styles.scss` sets `scrollbar-color` and `scrollbar-width: thin` (Firefox,
Chromium) and, where those aren't supported (Safari), `::-webkit-scrollbar` with a 6 px thumb in a 10 px gutter.

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
- Global pieces: the skip-to-content link and the "Something went wrong" snackbar (P15) arrive in M0.5; the offline banner and the "Catalog updated" toast arrive with `CatalogStore` in M4.3:
  - The banner is a line at the top of every page while the browser is offline or the last check couldn't reach the server: "Offline — catalog from Oct 22" (the cached catalog's build date), or "Offline — the catalog will load when you're back online" when nothing is cached yet. It's a polite live region.
  - The toast shows "Catalog updated" for 5 seconds when a new version replaces the one on screen, in every open tab. A first download, or a new country's file at the same version, isn't announced.
  - Since M10.6, "A new version of Simply Sub is ready." [Reload] (with "Reloading locks the app." when the lock is on) when the service worker has a version an open tab isn't running, and "Simply Sub needs to reload to keep working." [Reload] when the worker can't serve the app any more. It stays until used or dismissed, the page's last tab stop.
- Page titles like "Lists · Simply Sub" come from each route's `title`.

**First-run dialog** (shown when no settings are saved, M4.2):
```
┌ Welcome to Simply Sub ──────────────────────────────┐
│ Country                [ Canada                 ▾ ] │
│ Province or territory  [ Ontario                ▾ ] │
│ Currency               [ CAD — Canadian Dollar  ▾ ] │
│ Sales tax 13% (Ontario)   [ ] Use my own rate       │
│ Monthly budget  [ optional ]  Annual [ optional ]   │
│ Your data stays in this browser. No account needed. │
│ [Import a backup instead]             [Get started] │
└─────────────────────────────────────────────────────┘
```
- **When:** only once the settings have loaded and none are saved, so it never flashes up while they load. It can't
  be dismissed without saving (Escape and the backdrop do nothing). It comes back whenever no settings are saved:
  on each visit in in-memory mode (P15), and after Delete all data (M6.9).
- **Defaults** come from the browser's languages (`navigator.languages`): the first country one names (`en-CA` →
  Canada), else the one a language implies (`fr` → France), else the US. The currency follows the country (its own
  where the ECB has rates for it, else USD) until the user picks one. The theme on screen is saved with them.
- **Province or State** lists only the chosen country's subdivisions and appears only where sales tax is added
  (Canada, the US). A Canadian province is required, with no default (a time zone can't tell Ontario from Quebec),
  and shows its built-in rate, "Sales tax 13% (Ontario)", with a "Use my own rate" checkbox (BLUEPRINT §4.8). A US
  state is optional ("Not given"), and the rate field starts empty, with the hint "Your state and city sales tax on
  subscriptions, if any". Elsewhere: "Prices for United Kingdom already include sales tax."
- **[Import a backup instead]** (M6.9) opens Import backup (P13) as one Import, with no question, since there's
  nothing here yet. The backup's settings end the first run.

**Since the feedback after M9 (M6.16):** Country, Province or territory (State) and Currency are menus you can type
in (`ss-choice-field`): typing narrows the list to the names that start with it, then those that have it anywhere, or
whose code starts with it ("al" is Alberta, "usd" US Dollar), and Enter picks the first. With nothing typed it lists
them all and Enter submits; leaving without a pick puts the chosen one back. Settings' 📍 dialog has the same fields.

**Acceptance**
- [ ] Navigation works with the keyboard
- [ ] The drawer works at 360 px
- [ ] The theme persists across reloads
- [ ] The first-run dialog appears once and saves the settings

### 4.3 Shared components
| Component | Purpose | Key inputs → outputs |
|---|---|---|
| `ss-page-header` | Title (`<h1>`), projected actions, and a line under it in an element marked `subtitle`. On every page the sidebar doesn't list, a back button above the title, on a line of its own ("← Lists", the feedback after M6.9) | `heading` (not `title`: the attribute would be the element's tooltip), `backLink?`, `backLabel?` (where it goes, by name), `backInHistory` (Settings: back where the user came from, to `backLink` when it was the first page opened) |
| `ss-budget-bar` | Pill progress bar (wireframe style) with the label inside the fill; core's `budgetBar` gives the colour and percent (BLUEPRINT §8.1). The element is the `progressbar`: name it with `aria-label` or `aria-labelledby` | `value`, `max`, `labelMode: 'percent' \| 'amount'`, `marker?` (the Calendar's budget: the colour then compares `max` to it), `currency?` |
| `ss-price` | Price + interval; ≈ and the `currency_exchange` icon when converted; tooltip with the source price; "+ tax" or "incl. tax" in Canada and the US (M4.4) | `price: PickedPrice`, `clickable`, `region?` (an item bought elsewhere), `menu?` (a menu the clickable price opens, M5.4), `action?` (what clicking does, read after the price: "add to a list") → `priceSelect` |
| `ss-provider-icon` | Icon, with a letter fallback when there's none or it fails to load; at most 48 px, since catalog icons are 96 px files (BLUEPRINT §6.3). Decorative: the name is beside it | `src?`, `name`, `size` (px) |
| `ss-status-badge` | Active / Inactive / Not listed with its dot, "active from Sep 10, 2026", and "Ends Nov 3" and ↻ "Renew by Nov 3" badges (§3.3); Search's " · 2 lists" (`ss-in-lists`) is projected | `status` (core's `ItemStatus`, or `{ kind: 'not-listed' }`), `nextCharge?` |
| `ss-rank-select` | The single rank dropdown: a Material select with each rank's dot (BLUEPRINT §14). "Profile default (Wanted)" is muted and clears the override | `value` (`model`), `subscriptionLevel` (adds Essential and Critical, with hints), `inherited?` (shows "Profile default (Wanted)"), `labelledBy` or `label` → `valueChange` |
| `ss-rank-dot`, `ss-rank-chip` | Colour dot (decorative), and dot + name | `rank` |
| `ss-rank-counts` | Two-column rank counts, as on the Lists wireframe. Compact, the ranks counted only, in a row that wraps: a Search card's "1 Needed · 1 Unwanted" (the feedback after M6.9) | `counts` (core's `RankCounts`), `compact` |
| `ss-feature-summary` | "VPN: 2 / 3" list, read as "2 of 3 active"; with a limit, its first rows and "Show all" | `rows` (core's `FeatureSummaryRow[]`), `limit?` |
| `ss-type-counts` | "Streaming video: 3", how many subscriptions of each type, with the type's icon (the feedback after M6.8) | `types` (core's `TypeCount[]`) |
| `ss-feature-list` | A plan's features under their parent groups, with the user's rank for each ranked key it provides; core's `planFeatureRows`, on the catalog's registry | `plan`, `ranks` |
| `ss-mini-calendar` | Month grid with dots on payment days and the payments in each day's tooltip; ‹ › change the month; one tab stop, moved with the arrow keys, Home/End and Page Up/Down | `month` (`model`), `charges` (`CalendarCharge`: date, name, amount, currency, converted, manual; M7.1's charges map to it) → `dayClick`, `monthClick` |
| `ss-sub-card` | Subscription card (`variant: 'search' \| 'list'`), built with its pages: the search variant in M5.2, the list variant in M6.8. As built (M5.2): the search variant takes a `searchCatalog` result; its plan chips are radio buttons (one tab stop, arrow keys, never none chosen); the expanded section is `ss-plan-details`. M5.4: its prices and its bundles' prices open the card's `ss-add-to-list-menu`. M5.7: its chips sit right below its names and never move, a lone plan gets a chip too, and its details slide open and shut, with Hide details at their foot. M6.8: the list variant is a component of its own, `ss-item-card`, which takes a resolved item and shares the card's look (`_card.scss`) and sliding details (`SlidingDetails`); Edit is a link in its details. Since the feedback after M6.9 the search variant counts the user's ranks of its plan's features under the status, and its "· 2 lists" names the lists | `result`, `ranks` (M5.2), `listNames` (the feedback after M6.9); `ss-item-card`: `resolved`, `tags` and `pinToggle` (M6.8) |
| `ss-in-lists` | "2 lists" after a Search card's status: a button whose tooltip names the lists ("In Work Related and Family") and whose menu links to them; only words without their names | `count`, `lists` (id and name), `provider` (names the menu) |
| `ss-add-to-list-menu` | P7's Add to list menu (M5.4): the user's lists in the order they were made, each with its number of subscriptions, then New list…; picking one opens that list's editor, or `/lists/new`, with core's `addRequestParams` | `prepare(request)` (the price that opens it says what it adds); `menu` for `ss-price` |
| `ss-tag-chip`, `ss-tag-picker` | A tag as a dot in its colour and its name; the picker is chips with an autocomplete, and "Create tag “…”" asks for a name and one of core's 12 `tagColorPresets` (`ss-tag-colours`), saved through `TagsRepository`. Since M6.11, "Delete a tag" beside it is a menu that deletes one everywhere, asking first when it's in use | `tag`; `tagIds` (`model`) → `tagIdsChange` |
| `ss-price-range` | Price per month as a filter (Search's panel, List view's Sort menu): a dual slider from $0 to the range's top, which means "Unlimited" | `range` (core's `PriceRange`), `min?`, `max?`, `currency`, `country?` → `limitsChange` (a limit at its end of the slider is left out) |
| `ss-feature-filter` | Features as a filter: a chip per rank key chosen, which a click removes, and a box that suggests the rest by what's typed, grouped by feature category (core's `featureSuggestions`). Off with nothing to suggest or chosen | `keys` (what can be suggested), `features`, `categories`, `hint`, `value` (`model`) |
| `ss-chip-choices` | A labelled group of checkboxes drawn as chips, each with an optional colour dot: Search's Activity, List view's Status and Tags. None chosen is all | `legend`, `choices` (value, label, colour?), `value` (`model`) |
| `ss-split-button` | Main action + dropdown (the Calendar buttons): the main button does the first item, and the menu lists them all | `label`, `items` → `action` (the item's id) |
| `ss-empty-state` | Icon, heading, projected text and an element marked `actions` | `icon`, `heading` |
| `ss-confirm` (service) | `confirm({ title, message, confirmText, danger })` → `Promise<boolean>`: true only from the confirm button. An alert dialog described by its message; with `danger`, the button is red and focus starts on Cancel. Material's dialog loads with the first question | — |

Every component is in the `/dev/components` gallery (M4.5), with hand-made inputs where its data comes later. Pages
are lazy, so the components and the Material modules they use (select, menu, chips, autocomplete, dialog, tooltip)
stay out of the initial bundle.

---

**Choices, which control (M4.8, UI polish):** a long list (over about 15) is a menu you can type in
(`ss-choice-field`, M6.16): Settings', the first run's and 📍's Country, province or state and Currency; the item
dialog's Bought in and its own price's Currency; a custom plan's Currency; the card dialog's Card currency. A short one
stays a `mat-select`: the item dialog's Plan, billing period, Unit, add-on Quantity and Paid with; a custom plan's
Unit; a feature's Value; the card dialog's Type and Network; Search's Sort and Category; List view's Sort; the
Calendar's Showing, Month and Year; Lock after (Settings and its dialog); the rank menus. Features, tags and Add a
feature were typed into already. Every page with nothing to show uses `ss-empty-state` (Lists' too, M4.8), and every
loading line is the page's muted `.note`.

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
| P13 | Settings | `/settings` | 08-settings | M4.2, M6.9, M6.10, M6.11 |
| P14 | Optimizations | `/lists/:listId/optimize` | **new** | M8.2 |
| P15 | Not found & errors | `**` | **new** | M0.5, M4.2, M6.10 |

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

**As built (M7.3):**
- **Layout:** the mini calendar on a card, with the totals on its right from 720 px and under it below that; then the
  Subscription Lists pill, centred; then Next payments ("Nov 12 Netflix $19.94", as charged, ↻ for a manual renewal).
  The page's heading, "Home", is for screen readers only: the wireframe has none.
- **Mini calendar:** the shown month's charges for every list, the same as the Calendar's (`MetricsService.charges`); a
  day or the month's title opens `/calendar?month=YYYY-MM`; it follows today into a new month at midnight.
- **Catalog loading:** while an item's catalog file hasn't loaded, the calendar has no dots, a row of pulsing dots
  under it, and "Loading your payments…" in a live region.
- **No lists:** "Start with a list", with Create a list, Browse services (Search) and Import backup (Settings' dialog,
  loaded on the click).

**As built (M7.6):** above the calendar, a warning for each budget check that fails, for every list together: "Your
payments in January 2027 add up to ≈ $137.20, over your $50.00 monthly budget." with "See January 2027 in the
Calendar", and "Your payments this year, past and to come, add up to ≈ $610.64, over your $500.00 annual budget."

**Since the feedback after M9 (M7.7):** each bar is one colour, changing gradually from green to yellow exactly at the
budget and on to red at 150%, and each budget warning has ✕, which hides it until its period or budget changes, with "Show 1 hidden budget
warning" to bring it back.

**Since the UI polish (M7.10):** Home is a hub. Quick actions first: Add a subscription (a menu: each list, which opens
Search in its pick mode, or a custom subscription), New list and Open a list. Then the budget warnings, the budgets,
and Coming up: every payment of the next 14 days still to pay, as charged, with Mark renewed on one renewed by hand: the
renewal due is paid, so the next one is the charge after it (as P4's Wrong date? would set it), saved at once with Undo,
and the line goes. A charge the schedule counts as paid already (before the item's next one, such as the payment for a
plan whose next renewal is a month away) isn't listed. The payment stays on its due date, in the totals as before. The mini calendar sits
beside the budgets and Coming up from 960 px. Your lists has a card each (its name, this month's total and how many
subscriptions), with a New list card and Subscription Lists; Ways to save has each list's View optimizations; and Price
changes lists what catalog updates changed in the lists' prices this past month ("Netflix Standard $18.99 → $19.99 a
month, Nov 1"), which CatalogStore keeps in the settings when an update changes the catalog. Under 960 px it's one
column, in that order.

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
**As built (M6.7):** until the bars (M7.2), a card says what the list costs a month on average and how many
subscriptions it has, "≈ $26.84 / mo average · 2 subscriptions". Under 960 px the Features column comes after the
cards.

**As built (M7.2):** the average gives way to the bars: "[bar] $50 this month" and "[bar] $250 this year", each a bar
only while its budget is set (named "Work Related, monthly budget"), else the amount alone; then "2 subscriptions",
and "1 subscription not counted" when one can't be priced or converted.

**Data:** lists, `ListMetrics` for each list, the global feature summary.
**Behaviour**
- One card per list, in creation order. The name and [View] open `/lists/:listId`.
- Bars: this list's "this month" ÷ the monthly budget, and "this year" ÷ the annual budget. Without a budget the bar is hidden and only the amount shows.
- Rank counts follow §3.2 (zero counts in grey).
- 🗑 → confirm "Delete “Work Related”? Its 12 subscriptions will be removed." → soft delete → snackbar with Undo (10 s).
- "New Subscription List ⊕" → `/lists/new`.
- Right column: the feature summary across all lists (§3.2).
- Header link "Custom subscriptions" → `/custom`.

**Since the feedback after M6.9:** New list is at the top too, after Custom subscriptions. The tile under the cards
stays.

**States:** no lists → only the New tile and a one-line hint; the feature column is hidden.

**Since the feedback after M9 (M7.7):** each card's bars take their colour from the scale (P2).

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

**As built (M6.8):**
- **Header:** the average a month and the count. It stays with M7.2's totals (the user's choice).
- **Sort:** opens a panel under the search box with the sorts and the filters, and Clear all. The default sort is
  Highest price first.
- **Feature summary:** under the cards below 960 px, as on the Lists overview. Since M7.2 the totals take the place
  above them.
- **Cards** are `ss-item-card`, whose details have Edit. Since M7.1 they start with the next charge as charged, tax
  included ("Next charge Nov 12, 2026: $19.94, with $0.95 tax"), with "Wrong date?" for an Ongoing item, and the
  status shows "Ends" and "Renew by".
- **Unsaved changes:** a note links back to the editor when it has changes not saved.

**Since the feedback after M6.8:**
- **Side column:** Types ("Streaming video: 2") comes first, then the feature summary, which folds after 8 rows.
  Since M7.4 the list's mini calendar follows the totals, folded behind a Calendar button under 960 px; a day or its
  title opens the Calendar on that month, showing this list. From 960 px the Tab order reaches it after the cards.
- **Cards:** a card shows its nickname over its plan, and its details have its note and View in Search.
- **Search box:** finds a nickname or a note.
- **Sort menu:** Features and Tags are always there, turned off when there's nothing to choose.

**Since the feedback after M6.9:**
- **Header:** the back button ("← Lists") is above the title, and Edit list is beside it. The one under the cards
  stays.
- **Sort menu:** Search's filter controls. Price per month is a dual slider up to the priciest item's monthly
  equivalent. Features is the chip box with suggestions. Status is Active and Inactive chips (none chosen is both),
  and Tags are chips with their colour dots, or a hint saying how to add them.

**As built (M7.2):**
- **Side column:** this month's and this year's totals first: "Monthly budget [bar] ≈ $27.79 of $200.00 this month"
  and the annual one, each bar named by its heading, or without a budget the amount alone ("$27.79 this month"), as
  the user chose. Under 960 px they come above the cards, and Types and Features stay after them.
- **Cards:** each gives its share of the list's next 12 months under its price, "31% of list" (read "… over the next
  12 months"), or "<1% of list"; none with no charge to come.

**As built (M8.2):** View optimizations (`ss-optimizations-link`) comes after the feature summary in the side column:
"View optimizations (9)", its outline and dot in the strongest suggestion's colour (green for free savings alone), its
name saying the strongest's section; "No suggestions" in a neutral outline. Dismissed suggestions aren't counted.

**As built (M7.6):** the list's own budget warnings come first, as on Home but for this list alone ("This list's
payments in January 2027 add up to…", the user's choice), the month's link opening the Calendar showing the list.

**As built (M7.5):**
- **Export ▾** beside Edit list, when the list has something in it: CSV (a row per item: what it costs as charged,
  how it renews, its next charge and live tags), Excel (Summary, the list's items, Payments), JSON (the list and its
  items as stored, not importable, as the user chose), Text (a summary) and Calendar (.ics, the next 12 months).

**As built (M9.4):** the net, both with tax (the user's choice: today's monthly equivalents, net = gross + FX fee − cash
back):
- **Header:** once an item is paid with a card, a second line, "≈ $27.79 / mo with tax · ≈ $27.56 after cash back & FX
  fees", an item with no card counting at its gross.
- **Cards:** one paid with a card says so after its tags: "Paid with Everyday: $19.94 / mo with tax · $19.64 after cash
  back & FX fees".
- The card is chosen in the item dialog (P6), not here: the cards change only through the editor, but for pinning and
  Wrong date?.

**Since the feedback after M9:**
- **Cards (M6.12):** a card lists its add-ons under its names, each with its price for all it has ("+ Extra member × 2
  $15.98 / mo"); the price tag on the right is the plan's. An active item that renews by itself says when, "Auto-renews
  Nov 12", beside the manual "Renew by".
- **View in Search (M5.11)** opens Search on the item's own plan (`plan=`), not the user's other plan of the provider.
- **Pinned bar (M6.13):** the search box and Sort stay below the top bar while the cards scroll. From 960 px View
  optimizations, at the side column's foot, stays pinned once the column's other parts have scrolled away; under
  960 px a compact one (its icon and count, in the strongest's colour) is in the pinned bar, before Sort, so Tab goes
  from Sort into the menu it opens.
- **Budget warnings (M7.7):** each has ✕ and "Show 1 hidden budget warning", for this list alone; the bars take their
  colour from the scale (P2).

BLUEPRINT §14 has the details.

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
**As built (M6.4):** the heading is "Edit list" ("New list" for a new list), with the List name field beside
Cancel, Save and ⋮ under it. Since M7.1 a row says when it renews ("Renews Nov 12 · auto", "Renews Jan 20, 2027 ·
manual"), and since M7.2 the footer says "This month $26.52" before the average.

**Data:** `ListDraftService` (the draft lives in the Dexie `drafts` table), catalog, custom subscriptions.
**Behaviour**
- **Draft model:** opening edit mode copies the list and its items into a draft saved in Dexie, so a trip to
  Search (pick mode) or a reload keeps the changes. An existing draft is resumed ("Resumed unsaved changes").
- **Save:**
  - One Dexie transaction writes the list and its items (add / update / soft delete), deletes the draft, then goes to `/lists/:listId`.
  - A field the draft didn't change keeps its saved value, so what was edited elsewhere since stays: `pinned` and "Wrong date?" (P4), and the Phase 4 `cardId` assignment. An item deleted since stays deleted, and a list deleted since can't be saved.
- **Cancel:** confirm if anything changed → delete the draft → back to the list view (or `/lists` for a new list).
- Save, Cancel and Delete list replace the editor's history entry, so Back doesn't open it again.
- **`/lists/new`:**
  - Creates a draft with a new id, named "Subscription List" (or "Subscription List 2", 3… while a saved list has it).
  - Then replaces the URL with `/lists/<newId>/edit`.
  - Nothing is saved to the lists table until Save.
- The name is required, with a maximum of 60 characters.
- [+ Add from catalog] → `/search?addTo=<listId>` (flow F2). On a new list it uses the draft's id, and Search counts
  the draft's list as one it can add to, though it isn't in the lists table until Save (M6.3).
- [+ Add custom subscription] → a menu of existing custom subscriptions plus "Create new…" (the P12 editor) → item dialog.
- ✎ opens the item dialog (P6) for that item. 🗑 removes it from the draft (it stays there, marked), with Undo in a
  snackbar.
- ⋮ → Delete list (confirm) → soft-delete the list and its items, and delete the draft → `/lists`. Only a saved
  list has ⋮: a new one has Cancel.
- On load, these query params open the item dialog and are then removed from the URL:
  `?add=<planId>&interval=<day|week|month|year>` · `?addBundle=<bundleId>&interval=…` · `?addCustom=<customSubId>` ·
  `?item=<itemId>`. `add` and `addBundle` take `&count=<n>` for a period of n intervals ("every 3 months"); core's
  `readAddRequest` reads them (M5.4). Each opens it once; one that names a plan, bundle, custom subscription or item
  there isn't says so, and opens nothing (M6.5). `add` also takes a reseller's `&price=…&currency=…&plusTax=1`, which
  fills in the dialog's own price.
- Leaving with unsaved changes asks "Discard changes?", except when going to Search in pick mode for this list.
  Leaving drops the draft, after asking if there's anything to lose, so a new list nobody changed isn't kept; a
  reload or a closed tab keeps it.
- The footer shows live totals for the draft.

**Since the feedback after M6.9:** a back button above the heading goes to the list, by its saved name, or to Lists
for a new list. Leaving with changes asks first, as above.

**Since the feedback after M9 (M6.12, M6.14):** a row's add-on says what it adds ("Extra member (with ads) for $7.99 a
month"). After the item dialog shares a rank change, the snackbar says so: "Saved Netflix Standard, and its ranks to 1
more plan".

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
│ PAYMENT  [ Cash Back Mastercard ▾ ]  Best card: saves $0.27/mo (Phase 4)  │
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
**Since the feedback after M6.7:** dates are datepickers (typed YYYY-MM-DD, or picked from a calendar), feature rank
groups fold, a click on a tag chip removes it, and a reseller's price arrives with "I pay a different price" filled in.

**Since the feedback after M6.8:** an optional Nickname under Plan (at most 60 characters), which tells two of the same
plan apart, and an optional Note at the end (at most 1000). Fields in a row keep their own heights.

**Since M6.11:** "Delete a tag" beside the Tags field is a menu of the tags, which deletes one everywhere, asking
first when it's in use, as Settings' ✕ does (P13).

**As built (M6.5):** the sections run Plan, Add-ons (P6's "Extra members": an add-on can be a channel), Billing, "I
pay a different price", Advanced, Feature ranks and Tags, and Plus tax shows only where tax is added. The billing day
is a "Billed on" choice. The footer's ≈ marks a converted price only, and "next charge Nov 12" came with M7.1.
BLUEPRINT §14 has the rest.

**As built (M9.4):** Payment comes after Tags, for a plan that isn't free:
- **Paid with:** No card, then the cards its seller takes where it's bought ("Everyday (Mastercard, 1.5% back)"), or
  every card where that isn't known, marked "· acceptance not confirmed" (but for a custom subscription, which never
  says). Its hint gives the month with tax and after cash back and FX fees.
- **Best card:** a chip beside it, "Best card: Everyday, saves $0.30 / mo", when another card leaves a cent or more
  less to pay a month; Enter or a click pays with it.
- **Notes:** "Acceptance not confirmed: Mullvad VPN doesn't say which cards it takes.", and for a charge in another
  currency, the card's FX fee estimated at the ECB's rate and a checkout's own conversion (the user's choice for
  Mullvad, BLUEPRINT §14).
- **A card its seller doesn't take** (its networks became known since): dropped as the dialog opens, with a note
  naming it.
- **No cards:** "Add your cards on the Payment page to see what each one pays back here."
- **A free plan:** no Payment section, and saving drops a card it had, as it drops an own price.

**Since the feedback after M9:**
- **Shared ranks (M6.14, the user's choice):** ranks changed here go to the same provider's other plans in the list that
  provide each key, saved with the list's Save; Essential stays on this plan. Feature ranks names them ("Changes here go
  to the same features of Netflix Standard with ads in this list too. Essential stays on this plan."), and "Ranks for
  this plan only" keeps this one out both ways. A new plan starts with the ranks its siblings share.
- **New tag (M6.15):** a hex field under the presets, checked as Settings checks it, and the device's colour picker
  beside it, each following the other.

**Rules**
- **Plan:** plans of the same provider (or of the custom subscription), with their prices. Changing the plan keeps the interval if the new plan offers it; otherwise the first available interval is picked.
- **Extra members:** add-ons of the selected plan, with quantity up to `addOnLimit`.
- **Billed:** only intervals the plan has prices for (custom plans: any interval and count).
- **Next renewal** (= `anchorDate`): required for Ongoing. Defaults to one interval from today, with the hint "Check your account page for the exact date". For month and year intervals, when the date is the last day of a month shorter than 31 days, a choice appears: "Billed on the 28th" or "the 29th / 30th / 31st (the last day in shorter months)", which sets `billingDay` (§3.1). The default from today keeps today's day (added on Jan 31 → Feb 28 with `billingDay: 31`).
- **Auto-renews:** shown only when the price's `autoRenew` is true. Otherwise a note says "This plan renews manually — we'll remind you".
- **Free plans:** when the picked price is 0, Billed, Next renewal, Auto-renews and the price override are hidden, and so is the Ongoing / Specific dates choice. The item is saved as Ongoing, with today as the anchor date (an item being changed keeps its own).
- **Specific dates:** at least one window; each end must be after its start; windows can't overlap. Two that share a
  day overlap (a window is active through its end), and one that repeats every year must be shorter than a year.
- **Price override:** an amount above 0, with a currency, and an optional "until" date for an offer that ends (first-term discounts): charges from that date on use the catalog price. Since M9.6 an optional "From" date too, the first charge at that price (another currency from the next charge, a known increase), which Until must come after: charges before it use the catalog price, and the cards say "Your own price from Nov 10, 2026: CA$16.24 a month + tax" until then. The amount is taken as charged, tax included, unless "plus tax" is ticked (BLUEPRINT §4.8). It's also how an item bought from a reseller records what it cost, until an item can name its shop (BLUEPRINT §4.9).
- **Bought in region** (Advanced): any country; it sets `region`, which picks the item's price and availability. Defaults to Settings' country.
- **Feature ranks:** the plan's provided keys (§3.2), grouped. The dropdown starts with "Profile default (X)" and includes Essential ("keep this plan") and Critical ("keep this provider"), each with a one-line hint. Only the provided keys' ranks are saved.
- **Tags:** autocomplete from the Settings tags, with "Create tag" inline (name + colour).
- **Bundles:** bundle items show the bundle's included plans read-only, and their combined features for ranking.
- **Duplicates:** adding a plan that's already in the list shows "Already in this list — add another?" (duplicates are allowed), and so does changing an item to another item's plan.
- **Save** writes to the **draft** (P5), closes the dialog and shows "Added Netflix Standard".

**Since the feedback after M3 (M6.19):** Auto-renews and Ends on can both be set: one says how it's charged, the
other when it stops. With an end date the checkbox reads "Auto-renews until it ends" and Ends on's hint "It stops then:
no renewal after"; the cards' badge reads "Renews Nov 12, then ends Nov 28" (or "Renew by Nov 12, then ends Nov 28"),
and the billing line "Monthly · auto-renews until Nov 28, 2026".

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
- The clicked interval is preselected: the URL carries it as `interval`, and `count` when the period is more than one
  interval (`interval=month&count=3`).
- Add-on prices don't open the menu: an add-on is added with its plan, in the item dialog. A reseller's price does:
  it adds the plan with the shop's price as the item's own (P6's price override, filled in), carried in the URL as
  `&price=87&currency=CAD&plusTax=1`.
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
- **Plan chips** (M5.7): cheapest first by each plan's price for its shortest billing period, per month (its monthly
  price, usually), then by its lowest monthly equivalent, so TSN lists Standard ($24.99 a month) before Premium,
  whose yearly price is less a month. They sit right below the names, and switching plans moves none of them: a
  chip is as wide checked as not, and from 600 px the card keeps room for its plans' longest list of prices. A card
  with one plan shows that plan's chip too, which isn't a control.
- **Layout while scrolling** (M5.7): the search bar stays pinned at the top (below the top bar under 960 px), and the
  filter panel stays pinned below it from 960 px, scrolling on its own when it's taller than the window; only the
  results scroll under them. Under 960 px the pinned bar is one row, the search box ("Search services") and a
  Filters icon button with a badge counting what's on, and Sort moves to the top of the drawer.
- **Matching:** text matches provider names and aliases, plan names, feature names and aliases, and category names, in this order: exact or prefix name → substring → alias → plan name → feature or category. It's matched term by term, and every term must match ("netflix 4k"): a term is the longest run of words a feature's or category's name contains ("ultra hd"), else a word, and a plural matches its singular ("vpns"). As built in M5.1 (`searchProviders`' rules, BLUEPRINT §14). 150 ms debounce.
- **Sort:** Best match (default when there's text), Price low→high (default otherwise), Price high→low, Name A–Z, Most features, and Best for my ranks (the feedback after M6.9). Price sorts use the lowest monthly equivalent of the plan shown.
- **Prices:** every interval price is a button → flow F1 (or F2 in pick mode). Converted prices show ≈, the icon and a tooltip. A $0 price shows as "Free". In Canada and the US prices are shown before tax, with "+ tax" (BLUEPRINT §4.8). On a phone (a card under 600 px) each is a pill at least 36 px high, up to 44, and they wrap side by side.
- **Resellers** (BLUEPRINT §4.9): under a plan's prices, each official reseller that sells it for less per month after the user's sales tax (`resellerDeals`), cheapest first: "Cheaper at [icon] Amazon.ca: $87.00 / 12 mo ↗", a link to the shop's page that opens in a new tab (`rel="noopener"`). Only shops that sell where the user is; none without exchange rates. The shop's price is a button too, which adds the plan with that price as the item's own (P7). On a phone (a card under 600 px) "Cheaper at" shows once, over a row per shop with its price on the right.
- **Availability** (`availability` in core, BLUEPRINT §4.7): plans and bundles not offered in the user's region are left out. A provider with nothing offered there shows "Not offered in Canada" instead of prices, and only when the search text names it. An unknown item shows its fallback price with "No price for Canada yet" (a country's name, since English has no table of demonyms).
- **Links:** Plan ↗ and Cancel ↗ open in a new tab (`rel="noopener"`).
- **Status:** follows §3.3, at provider level.
- **Expanded section:**
  - The plan's features grouped by registry parent, with the user's rank dot next to each.
  - Add-ons with prices, and bundles containing the plan with their savings (a bundle price click → F4).
  - For a suite plan (BLUEPRINT §4.4): the plans it includes, and its savings against buying them separately when there are any.
  - Perks, and accepted cards (Phase 4).
  - "Price checked Oct 14, 2026", with a "may be out of date" badge when it's older than 90 days, and beside it
    Report a wrong price (M10.11).
  - Terms and policies (M1.13, BLUEPRINT §4.10): the provider's ratings on `data/policy-topics.yaml`'s topics for
    the plan and the user's country, by group (Privacy, Billing, Legal, Service), each a dot in its grade's colour
    (Great to Bad, green to red), with the topic in bold, its grade in words, muted ("Disputes (Good):", M5.9),
    and a reason in plain words, muted, citing each page it quotes ("[2]", linked to the quote), then the numbered
    pages.
  - It slides open and shut (none with reduced motion), and a "Hide details" bar at its foot closes it too, putting
    focus back on the details button. When opening or closing leaves part of the card off screen, the page scrolls
    it back into view below the pinned bar (M5.7).
- **Filter panel** (on the right from 960 px, after the search bar in the Tab order; below that a drawer opened by a
  Filters button in the search bar, with the tune icon and a badge counting what's on (named "Filters, 2 applied"),
  whose first control is Sort since M5.7. Not ☰: the top bar's ☰ opens the navigation at that width). As built in
  M5.3 (BLUEPRINT §14):
  - Price per month: dual slider on the monthly equivalent in the user's currency, before tax, from $0 to the
    priciest plan sold in the user's country, rounded up to about 40 round steps (CA$28.19 is $0 to $30 by $1); the
    right end means "Unlimited". The URL's amounts are in Settings' currency.
  - Category: a select of the categories a plan sold in the user's country is in. A plan is in its own
    `categories`, else its provider's (M1.10), so under VPN Proton shows its VPN plans.
  - Features: autocomplete over the rank keys some plan sold there provides. Typing "Video quality" offers its
    values (480p to 4K), then the rest of its feature category, such as HDR and Ad free ("More in Streaming"). Each
    pick adds a chip named by the registry ("Video quality: 4K (Ultra HD)", a boolean by its own name), and chips
    combine with AND. A click on a chip, or on its X, removes it (M5.9).
  - Activity: Active / Inactive / Not listed (multi-select, checkboxes drawn as chips).
  - Native pricing only ("Hides prices in other currencies").
  - Sold in Canada (the user's country, M5.6; "Only plans priced for Canada"): only plans priced where the user is, so none with only a fallback
    price ("No price for Canada yet"), and no card for a provider that isn't sold there even when the text names
    it. It starts as Settings' Search option says (P13), off unless the user turns it on there.
  - Clear all (keeps the text and the sort, and puts Sold in back to the user's default).
  - The panel has no scrollbar of its own (M5.9): pinned below the search bar while it fits the window, and when it's
    taller, it scrolls with the page until its foot is in view, then stays.
- **URL state:** `?q=&sort=&min=&max=&cat=&f=video.quality%3D4k,streaming.ad-free&act=active,none&native=1&sold=1`,
  in that order, leaving defaults out: `sold` appears only when it differs from the user's default (`sold=1` on,
  `sold=0` off), and the Filters count doesn't count a default. Typing replaces the current history entry once it pauses; a run of price changes (a
  drag, or arrow keys) makes one entry; every other change adds one, so Back undoes the last filter. A value the
  catalog doesn't have (an unknown sort, category, rank key or parameter, a bad amount, a minimum above the maximum,
  Best match without text) is dropped and the URL rewritten in place. A filter change doesn't scroll the page.
- **Pick mode** (M5.5): `?addTo=<listId>` shows a banner "Adding to Work Related ✕" at the top of the pinned bar,
  above the search box at both widths, and price clicks, a bundle's too, go straight to F2 with no menu (add-on and
  reseller prices stay text). The ✕ goes back to `/lists/<id>/edit` without adding anything. `addTo` comes last in
  the URL and isn't a filter (the Filters count leaves it out, and Clear all keeps it); it survives every filter
  change, typing, a reload and Back/Forward. One that names no list, or a deleted one, is dropped and the URL
  rewritten in place.

**Since the feedback after M6.9:**
- **Rank counts:** under the status, how many of the plan's features the user ranks each way ("1 Needed · 1
  Unwanted"), following the chip picked; nothing when no feature of the plan is ranked.
- **Best for my ranks** (`sort=ranks`): each card shows the user's own plan, else the provider's plan that scores
  best on the user's ranks (the cheaper of two that score the same). Cards go best first, then by price. The API
  doesn't have this sort: it can't know the user's ranks.
- **"· 2 lists"** after the status names the lists on hover or keyboard focus ("In Work Related and Family"), and
  opens a menu of links to them.
- **Filter panel:** its price, Features and Activity controls are the ones List view's Sort menu uses (§4.3).

**Since the feedback after M9:**
- **`plan=` (M5.11):** a plan the URL names is the one its provider's card shows, over the user's own; List view's View
  in Search sets it. It isn't a filter.
- **Renewals (M6.12):** a listed provider's status says "Auto-renews Nov 12" when its soonest charge renews by itself.
- **Where to change it (M5.12):** a policy rating whose reason says the user has to change something themselves links
  the provider's own page for it under the reason ("How to turn off Behavioral Advertising ↗").

BLUEPRINT §14 has the scores.

**States:**
- First load → skeleton cards.
- Offline → banner, cached catalog.
- No results → "No services match" with [Clear filters] [Add a custom subscription].

**Acceptance**
- [ ] Filtering for 4k shows each provider's cheapest 4k plan
- [ ] Converted prices are marked, and "Native pricing only" hides them
- [ ] A Canadian never sees a US-only plan (Disney+ With Ads), and a provider without Canadian prices or `availableIn` shows "No price for Canada yet"
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
  As built in M6.2: a card per feature category, in `categories.yaml`'s order, with a parent's children under it;
  the categories your lists use start open, and all of them while no list has anything in it; a feature with more
  than four rows ("Storable item types (22)") folds until one of them is ranked. The heading is "Your feature ranks".
- Each rank key has one dropdown: **Not ranked** (the default, muted), Needed, Wanted, Uses, Sometimes, Unused, Unwanted, each with its colour dot. Essential and Critical aren't offered here: they're set per subscription in the item dialog (P6).
- A ranked row gets a coloured left border.
- A group row's rank applies to the group only ("I want a password manager"). [Set all ▾] ranks every child in one step. Ranks never cascade on their own (§3.2).
- Changes save immediately; there's no Save button. Choosing Not ranked deletes the record.
- Search filters rows by name or alias. "Ranked only" hides unranked rows. [Reset all] (with confirmation) deletes every profile rank.
  As built in M6.2: text matches as Search's Features box does, and text that names a feature keeps all of it, a
  parent's children too; while a filter is on, every card is open.
- A muted counter per row, "in 3 subscriptions": how many list items provide the key (M6.2).

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
  - A tick marks the monthly budget, if one is set and the month's total reaches it (a budget past the bar's end
    has no tick; the colour says the month is under it).
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
  - Phase 5: "Live calendar link" → opt-in dialog → `POST /cal` → shows the URL, subscribe steps for each app and a Revoke button (M10.2, M10.3).
- A year view (12 small months plus monthly totals) comes in M10.4 (built: `?view=year`, its spec is M10.4's).

**As built (M7.4):**
- **Layout:** "Calendar", the month's bar with its total, then Showing (a multi-select of the lists, "All lists" or
  their names) and ‹ [Month] [Year] › [Today]; the grid with the day's panel on its right from 960 px; then Upcoming,
  the next five charges. Sync calendar and Export to file come with the exports (M7.5).
- **The grid:** each day's date is a button over its cell, named with its payments ("Monday, October 12, 1 payment,
  $19.94"), one tab stop that the arrow keys, Home, End and Page Up/Down move, as the mini calendar's. Its chips
  (icon, amount, ≈, ↻, and the name where the cell is wide enough), "+2 more" and the day's total sit beside the
  button, hidden from screen readers; a chip's click opens the day on that charge. Other months' days are muted
  numbers.
- **The panel:** the day's heading (focus starts there), then each charge: its name, as charged with tax, how it
  renews, "Ends" on its last charge, its list as a link, and Wrong date? for a charge still to come of an Ongoing item.
  ✕ and Escape close it, with focus back on the day.
- **Under 600 px:** an agenda, a card per day with payments; a payment opens its day in a bottom sheet, with focus on
  it.
- **The URL:** `?month=` and `lists=` only when not every list is shown; a month that isn't one, or a list that's
  gone, is rewritten in place. Without `lists`, the Calendar shows what it last showed on this device.

**As built (M7.5):** beside the heading, for the lists shown, over the next 12 months:
- **Sync calendar ▾:** Google, Apple and Proton Calendar. Each downloads the .ics, then a dialog gives that app's
  import steps, with Download again.
- **Export to file ▾:** Calendar (.ics) as the main button, then Payment schedule (.csv, a row per charge) and Excel.

**As built (M9.4):** every list's charges count against a card's limit, shown or not (BLUEPRINT §9.3):
- **The grid:** the day of the charge that takes a card over its limit, and its later charges on the card that month,
  have a warning icon after the day's total, and the day's name ends ", over a card's limit". In the agenda, the
  payment itself has it, read ", over its card's limit".
- **The panel** (and the bottom sheet): each charge's card ("Paid with Everyday"), and on such a day "Everyday goes over
  its $30.00 limit in October 2026: ≈ $116.46", read with "Warning:".

**Since the feedback after M9:**
- **Layout (M7.8):** from 960 px the grid has a column of its own on its right: the day's panel when one is chosen
  ("Choose a day to see its payments." until then), then Upcoming, so opening a day never narrows the grid. Upcoming
  is one payment to a line.
- **Phones (M7.8):** under 600 px a compact grid (each day's date, a dot on the days with payments) comes above the
  agenda, with the same tab stop and arrow keys; any day opens in the bottom sheet.
- **Back (M7.8):** opened from another page (List view's mini calendar, a budget warning, Home's calendar), a back
  button above the heading goes back to it, by name ("← Work Related"); opened from the sidebar, or first, none.
- **Exports (M7.9):** Export to file adds JSON (the payments, as data) and Text (each month's total and payments).
  Each event lists its tags, also as its categories. Sync calendar's steps make a Simply Sub calendar first in each
  app and import into it, since the apps colour a whole calendar, not each event.
- **The bar (M7.7):** its one colour is the month's total against the budget, on the scale (P2).

**Since M10 (M10.3):** Sync calendar ▾ starts with **Live calendar…**, the dialog that makes, shows, changes and
revokes the live calendar's links (a calendar for everything, each tag chosen, the payments without a tag); the file
items below it are named "Google Calendar file" and so on. The dialog's spec is M10.3's.

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
│ Cash Back Mastercard    [MC]  CREDIT │  │ Everyday Debit      [Interac]  DEBIT │
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

**As built (M9.1):**
- **Header:** "Payment cards" with Add card, and the line about card numbers under it. No cards: an empty state.
- **Tiles:** two side by side where they fit, one under 600 px. Each has its nickname over its name, the network and
  Credit or Debit as outlined badges (their names, not logos), "1.5% cash back · FX fee 2.5%", then "This month" with
  a bar of this month's charges paid with it against its limit ("≈ $114.10 of $500.00", in the card's currency), or
  "No limit". Then the subscriptions paid with it, from every list, each with what it costs a month with sales tax,
  and their total ("≈ $27.79 / mo with tax", the user's choice in M9: the net costs are with tax too), then ✎ and 🗑.
- **Under the tiles:** "1 subscription has no card".
- **The dialog:** P11's fields in that order, the limit in the card's currency, starting with "Never enter a card
  number…". Cash back and FX fee left empty are 0. 12 or more digits in a row are refused in every field, the number
  fields too.
- **Deleting:** "Delete Everyday?", with how many subscriptions it pays for, in lists and drafts ("…, and will have
  no card."); focus then moves to the next tile's 🗑, else Add card.

**As built (M9.4):**
- **Tiles:** after the total, what the subscriptions come to after cash back & FX fees ("≈ $27.56 after cash back & FX
  fees"). Under the limit bar, the first of the next 12 months whose charges go over it: "Over its limit in October
  2026: ≈ $116.46 of $30.00, and in 1 more month", read with "Warning:" (the bar is red when it's this month).
- **Assign best cards** under the tiles, after "1 subscription has no card" (turned off while prices load). Its dialog
  has a heading per list with changes and a row per item ("Mullvad VPN · Everyday → Rewards Discover · saves ≈ $0.48
  a year"), a note for each list with unsaved edits ("Family has changes in the editor that aren't saved, so its
  subscriptions keep their cards."), and the total over the next 12 months. Apply writes the cards to the saved items
  in one transaction, with Undo in the snackbar. With nothing to change: "Every subscription is on its best card
  already." and Close.

BLUEPRINT §14 has the details.

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
**As built (M6.6):** rows rather than cards, as the list editor has them, and each plan in the editor is a box of its
own. A set feature asks for one or more of its values, as enum and number features ask for theirs.

**Behaviour**
- Features come from a registry search; enum and number features ask for a value.
- The cost is what you pay, tax included, unless "plus tax" is ticked (BLUEPRINT §4.8).
- Website and cancel links accept only `https://` URLs (BLUEPRINT §11.5).
- The icon comes from `/api/v1/icon?domain=<website>` (asked only when the subscription is saved, BLUEPRINT §5.4). When it answers 404, the card shows the subscription's first letter, as for a catalog provider without a logo.
- Editing a plan updates every item that uses it, after a warning that shows the count. Removing a plan that items
  use removes them from their lists too, after the same warning (M6.6).
- Deleting a custom subscription asks to confirm, saying "Also remove it from 1 list" when it's in use.
- Reachable from the P3 header, from P5, and from the Search empty state. Its back button goes to Lists (the
  feedback after M6.9).

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
**Built so far:** the budgets, Appearance and 📍 (M4.2), each a card ("Location and currency" holds 📍 and the tax
line under it), the Catalog line (M4.3), Your data (M6.9), Security (M6.10) and Custom tags (M6.11), after Budgets.
The App group (M10.6) comes last. Sync between devices (M10.9) opens Your data, in the wireframe's "Create local sync"
place.
- **Your data** (M6.9):
  - **Export backup:** a dialog with "Protect with a passphrase" (at least 8 characters, typed twice). It downloads
    the file.
  - **Import backup:** choose a file → its passphrase if it's encrypted → what it has → Merge, or Replace after
    asking.
  - **Delete all data:** typing DELETE, then Home with the first-run dialog.

  The file and the rules are in BLUEPRINT §14.
- **Search** (M5.6): "Show only what's sold in Canada", which makes Search start with its Sold in filter on
  (`settings.searchSoldOnly`, kept only when it's on). Search's own checkbox still turns it off for one search
  (`sold=0`).

**Behaviour**
- ← Back goes back (to Home if there's no history). Since the feedback after M6.9 it's the back button every page
  off the sidebar has, above the title.
- **Budgets:** click to edit inline. Enter saves; an empty value means no budget.
- **Tags** (M6.11):
  - Names are renamed inline.
  - The colour swatch opens a palette (12 presets plus a hex field).
  - ✕ deletes, asking for confirmation if the tag is in use: "Used by 5 subscriptions".
  - ⊕ adds a new tag in edit mode.
  - As built: a row per tag with its colour button, name, ✎ and ✕. ✎ and the colour open one editor in the row (Name,
    the presets, Hex colour; Enter saves, Escape cancels). Names are trimmed and unique in any case. Deleting takes the
    tag off every item and every list's draft in one transaction, and "Used by" counts both. BLUEPRINT §14 has the
    rest.
- 📍 opens a dialog for country, province or state, and currency (the currency follows the country unless you change it), with the sales tax that follows: "Sales tax 13% (Ontario)" and a "Use my own rate" checkbox (BLUEPRINT §4.8). It shares the first-run dialog's fields (P1). Cancel or Escape changes nothing.
- **Appearance** (M4.2): System, Light or Dark, saved in `settings.theme` (BLUEPRINT §8.1).
- **Catalog** (M4.3): "Updated Oct 22, 2026 · version c4f9a21" (the build date and version of the user's region's file), or "Not downloaded yet". [Check for updates] checks now and says what it found in a live region under it: "You have the latest catalog.", "Downloaded the latest catalog.", "You're offline. Try again when you're back online." or "Couldn't check for updates. Try again later."
- **App** (M10.6), after Your data:
  - **Install**, left out in the installed app: what installing does, then [Install Simply Sub] when the browser offers it (Chromium), which shows the browser's dialog once, or else the steps for each browser (Chrome or Edge's address bar, Chrome on Android, Safari on an iPhone or iPad and on a Mac, Firefox on Android). Installed from the tab: "Installed: open Simply Sub from your apps, home screen or taskbar."
  - **Version:** "Version fd54aac, built Oct 29, 2026" (the commit and day of the build), or "A development build". Its own [Check for updates] asks the service worker and says what it found: "You have the latest version.", "A new version is ready: reload to use it." (the prompt shows too), the offline message or the failure. With no worker (a development build, or a browser that refuses them): "Each visit loads the latest version." instead.
- **Export backup** downloads `simply-sub-backup-YYYY-MM-DD.json`:
  ```json
  {
    "app": "simply-sub",
    "schemaVersion": 1,
    "exportedAt": "2026-10-22T18:30:00Z",
    "catalogVersion": "c4f9a21",
    "data": {
      "settings": { "key": "settings", "country": "CA", "subdivision": "CA-ON", "currency": "CAD", "monthlyBudget": 200, "annualBudget": 1000, "theme": "system", "updatedAt": "2026-10-20T09:15:00.000Z" },
      "lists": [{ "id": "0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d", "name": "Work Related", "createdAt": "2026-10-01T12:00:00.000Z", "updatedAt": "2026-10-20T09:15:00.000Z" }],
      "items": [], "customSubs": [], "rankings": [], "cards": [], "tags": []
    }
  }
  ```
- **Encrypt the backup** (M6.9): the export dialog offers "Protect with a passphrase" (entered twice). The file then holds `{ "app", "schemaVersion", "encrypted": { "kdf", "iterations", "salt", "iv", "ciphertext" } }` instead of `data` (BLUEPRINT §11.5). The dialog says a forgotten passphrase can't be recovered.
- **Import backup:** pick a file → (passphrase, if it's encrypted) → the whole file is validated with Zod before anything is written → preview the counts → **Merge** (by id; the newest `updatedAt` wins) or **Replace** (with confirmation). Backups with an older `schemaVersion` are migrated. A wrong passphrase, a tampered file or one that fails validation imports nothing and says why.
- **Delete all data:** type DELETE to confirm. Every table is cleared, then the first-run dialog appears.
- **Lock with a passphrase** (M6.10, off by default; BLUEPRINT §11.5):
  - A checkbox that opens a dialog, and shows what's so until the dialog has done it.
  - Turning it on asks for a passphrase twice (at least 8 characters), explains that nobody can recover a forgotten one, offers an encrypted backup first, then encrypts every user table in one transaction.
  - "Lock after" sets the idle time: 5, 15 or 30 minutes, 1 hour, or Never, which locks only when the tab closes (15 by default; the task asked for these). It's in the turn-on dialog, and on the card once the lock is on.
  - Turning it off asks for the passphrase and decrypts everything. A wrong one says so and changes nothing.
  - With nothing saved (in-memory mode, P15) it's turned off and says why.
  - As built: BLUEPRINT §14.
- **Sync between devices** (M10.9), first in Your data:
  - Off: what it does and that the server can't read it, then [Turn on sync] and [Join with a code].
  - Turn on: a new code's 24 words, numbered, with Copy, and its QR code, to keep first; [I've saved it] starts the
    chain with this device's data.
  - Join: the 24 words, each completed from its first letters as its box is left, or pasted at once; a mistyped word is
    caught by the checksum; then what the synced copy holds and Merge (the default) or Replace, which asks first. Either
    way the chain's shared settings come with it, and the theme stays this device's.
  - On: "Synced 2 minutes ago" and [Sync now]; the devices, this one first with [Rename…]; [Show the code…],
    [Start over with a new code…], [Turn off on this device…] and [Delete the synced copy…], each asking first.
  - Stopped: why (the copy was deleted, it needs a newer app, or it won't open), with [Join with a code] or
    [Check for updates], and [Turn off sync here…]. What holds a sync back for now (offline, busy, full) is said in
    the status line, and sync tries again by itself.
  - Delete all data asks whether to delete the synced copy too; Import's Replace waits until sync is off.

**Since the feedback after M9:** the 📍 dialog's menus can be typed in (M6.16, as P1's), and a tag's colour can also
come from the device's own colour picker beside Hex colour, each following the other (M6.15).

**Since M10 (M10.3):** Your data has a **Live calendar** card after App lock: "Off" with Set up…, or "On: 2 calendars,
last sent Oct 29, 2026." with Manage…, both opening the live calendar's dialog (P10). Delete all data revokes the links
first, while it can read their key.

**Since the UI polish (M4.7):** the sections are grouped, the most used first: **Everyday** (Budgets, Custom tags,
Appearance), **Where you are** (Location and currency, Search) and **Your data** (Backups, App lock, which was
Security, Catalog, and Delete all data, folded under its summary until opened, its button "Delete all data…"). "On
this page" links each group and its sections: a sticky side column from 960 px, and a chip for each group, wrapping,
above them on a phone. A link moves focus to its heading, below the top bar. A long list of tags folds after six, with
"Show all 14 tags" and "Show fewer".

**Acceptance**
- [ ] Budgets and tags persist and update every page live
- [ ] Export → Delete all → Import (Replace) restores identical data, with and without a passphrase
- [ ] Changing the currency re-prices everything (the converted markers update)
- [ ] With the lock on, the IndexedDB records hold no readable names or amounts

### P14 — Optimizations `/lists/:listId/optimize` (new)
**Purpose:** show how to pay less without losing what matters (BLUEPRINT §10).
```
‹ Work Related   Optimizations                                    Save up to $214 / year
FREE SAVINGS — nothing is lost
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
  - the changes (keep / downgrade / switch / remove / convert to extra member / bundle or suite / interval / card /
    currency)
  - savings over the next 12 months
  - features lost or gained, with rank dots
  - an "estimated" tag when converted prices are involved
- [Apply] opens `/lists/:listId/edit` with that change applied to a draft, so you review it and press Save.
- [Dismiss] stores the suggestion's fingerprint in `dismissedSuggestions`. It comes back if the list changes, and "Show dismissed" reveals it.
- An info tooltip explains the Essential, Critical and Needed rules.
- The back button goes to the list, by its name. The placeholder has it already (the feedback after M6.9).

**As built (M8.1, M8.2):** the user's choices, which BLUEPRINT §14 has in full:
- **Sections** are per-level plans: each lists its own plan's cards, which never conflict and can each be applied
  alone; a card in a looser section can be an alternative for the same item. "Save up to" is the yellow plan's.
- **Free savings lose nothing at all** (losing a Not-ranked feature is red, as §10.4 says), and List view's button is
  green when they're all there is.
- **Removing an item loses its service itself** (yellow, unless everything it gives is Unused or Unwanted), and it's
  suggested only with a reason: another provider's item gives one of its features all along, or nothing it gives is
  wanted. Two items of the same provider are two people's accounts: never removed for overlapping each other.
- **Features are judged per item**: a change keeps what replaces the item; only a removal counts other providers.
- **Apply** puts the change on the draft at the item's next renewal: a removal is an end date, a plan change a new
  anchor.
- **Cards** show each change with its prices from and to and when, the saving with an Estimated tag, the features lost
  or gained with their ranks, and Apply and Dismiss named for the changes. Dismiss says so with Undo and moves focus to
  the next card. Show dismissed shows them with Show again.

**Since the feedback after M9 (M8.4):** Apply puts a card's changes on the list's draft and stays on the page, so more
can follow: the suggestions are for the list as its draft has it, the card applied goes, and focus moves to the next
card (the first left, else Review and save). "Applied: <change>" has Undo, which puts the draft back as it was. A note
says the list has changes not saved and that the suggestions count them, with Review and save, which opens the
editor.

**Since the feedback after M3 (M8.5):** what Apply adds never charges before it starts. A bundle or suite starts on
the earliest next charge of the items it replaces, with that as its "Subscribed since", and each item it replaces ends
on its own next charge, when what's paid for runs out. An extra member joins its host on the day the account it
replaces ends (the add-on's `since`): the host's charges before then don't include it, and its card says "Extra
member, joins Nov 20" until then. So the list never pays for both, and this year's past charges stay as they were:
before, a bundle with no start date was counted as if it had been paid all year, which raised this year's total.

**Since the feedback after M3 (M8.6):** "Review changes" takes the place of Review and save. It opens a page of its
own (`/lists/:listId/optimize/review`, its back button to Optimizations) that lists each suggestion applied, in
order, like a diff: − for what goes ("Crave Premium · $22.00 a month · Ends Nov 5, when what's paid for runs out"),
+ for what comes ("Netflix and Crave · $35.00 a month · From Nov 5"), ~ for what changes ("Paid with Cash Back
Mastercard"), with what it saves and the list's totals this year and over the next 12 months, before and after. Each
has Undo, which takes back that change and any later one that changed what it changed or added; then Save changes
(the list with every change kept) or Open in the editor. The snackbar's Undo after Apply takes back that one change.
While the suggestions are worked out again after an Apply, the cards can't be applied ("Updating the suggestions…"),
so a card that clashes with what was applied (a card for a plan a bundle replaces) is never in reach.

**Since the feedback after M3 (M9.6):** another currency is a free saving too. When a plan's seller prices it in
several currencies for the buyer (Proton sells every paid plan in USD, CAD, EUR and CHF, wherever you are), a US buyer
sees "Pay for Proton Unlimited in CAD": the price it is now, and the CAD price converted (its tooltip giving the CAD
amount), "From Nov 10, paid with Everyday", and what it saves over the next 12 months on that card after its FX fee and
cash back, marked Estimated. It needs the item's card: a card with an FX fee as large as the
difference gets nothing, and an item with no card gets a better card first. Only the currencies of the price list the
buyer's own price comes from count (their country's, a group's such as EU, or GLOBAL): a price another country sets for
its own buyers is never offered. An item with an own price, add-ons, or another free change suggested (annual billing,
a better card) waits until that's applied or dismissed. Apply makes it the user's own price in that currency from the
item's next charge, plus tax where the catalog's price is before tax, and Review changes says "Paid in CAD from Nov 10,
2026: CA$16.24 a month + tax".

**Acceptance**
- [ ] The optimizer fixtures produce the expected cards and colours
- [ ] Apply never saves until the user presses Save in edit mode or Save changes on Review changes
- [ ] Dismissed suggestions stay hidden until the list changes

### P15 — Not found & errors
- Unknown route → "Page not found", with links to Home and Lists.
- Unknown list → "This list doesn't exist (it may have been deleted)" with [Back to lists].
- Unexpected error → snackbar "Something went wrong". Details go to the console; nothing is sent anywhere.
- IndexedDB blocked (some private browsing modes, or site data blocked) → a full-page notice in place of the app,
  "Your browser is blocking local storage, so nothing will be saved", with [Continue anyway] (M4.2, from the
  repositories' `error` status). Continuing runs every repository in memory (BLUEPRINT §11.1): the first-run dialog
  asks next, and a line at the top of every page says "Nothing is being saved: your browser is blocking local
  storage. What you enter lasts until you close this tab." The choice isn't remembered (nothing can be), so the
  notice comes back on the next visit.
- A saved record that can't be read (it fails its schema) → hidden, and a snackbar once per session: "Some saved
  data couldn't be read, so it's hidden. The rest is fine." The console names its table, key and issues, never its
  values (M4.1, BLUEPRINT §11.1).
- **Lock screen** (M6.10, when the app lock is on): a full-page passphrase prompt before anything else loads, and
  again after the idle time and on coming back to a page that was left (Back). Focus starts in the field. A wrong
  passphrase says so, keeps focus in the field and changes nothing; the right one opens the page the visit was on.
  "Forgot it?" explains the two ways out, which both turn the lock off: import a backup, as one Replace after asking,
  or delete all data (with the DELETE confirmation), then the first-run dialog. As built: BLUEPRINT §14.

---

## 6. API work plan
- **Contract first:** `docs/api-output-examples.json` holds an example request and response for every endpoint.
  Implement the endpoints in M2 order; task M2.7 makes the examples part of the test suite.
- **Envelope:** `{ "data": …, "meta": … }` on success, `{ "error": { "code", "message", "details?" } }` on failure.
- **Error codes:** `bad_request` (400), `forbidden` (403), `not_found` (404), `stale_version` (412), `too_large` (413), `rate_limited` (429), `upstream_unavailable` (502), `internal` (500), `over_capacity` (503). A body's problems are listed by path (`{ path, issue }`, M10.1).
- **Limits and headers:** 60 requests a minute per IP, 10 on `/icon` (`429 rate_limited`, `Retry-After: 60`); a write 10 a minute per IP and 6 per feed set or sync chain, a size limit per route, and daily caps (M10.1); every `/api/*` response carries the CORS header and the security headers (BLUEPRINT §5.4).
- **Validation:** core's query readers (`readProvidersQuery`, `readPricingQuery`, `readBundlesQuery`, `readIconQuery`) check every parameter. Unknown or invalid params → 400, listing each problem.
- **Pagination:** `limit` (1–50, default 20) plus an opaque `cursor`. `meta.nextCursor` is `null` on the last page.
- **What the app actually calls:**

  | Request | Served by | Caching | Uses Worker quota? |
  |---|---|---|---|
  | `/data/catalog/index.json`, then `/data/catalog/<region>.json` (or `catalog.json` for a region without a file) | static asset | ETag; the browser revalidates the index on each visit, and fetches the region's file when the catalog version changes | No |
  | `/icons/<id>.webp` | static asset | 1 day, then revalidated (the URL has no version, so a new logo must show up) | No |
  | `/api/v1/fx?base=CAD` | Worker → Frankfurter | 12 h at the edge + browser cache (about once a day per user) | Yes (tiny) |
  | `/api/v1/icon?domain=` | Worker → Google/DuckDuckGo | 30 days (KV) | Yes (custom subscriptions only) |
  | `POST /api/v1/cal`, `PUT` and `DELETE /api/v1/cal/:id` | Worker → the user database | Never (`no-store`) | Yes (only with a live calendar: 5 s after a change that reaches it, and at least monthly) |
  | `/api/v1/cal/<token>.ics` | Worker → the user database | `no-cache` with an ETag | Yes (calendar apps' servers, a few times a day per calendar) |
  | `GET`, `PUT` and `DELETE /api/v1/sync/:chain` | Worker → the user database | Never (`no-store`); `GET` answers `304` to the version the device has | Yes (only with sync on: on start, a tab shown again, back online, 10 s after a change, and a write at least daily, M10.9) |
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
| Search | ☰ in the search bar opens the filters | A "Filters · 2" button, under 960 px only | The top bar's ☰ opens the navigation there |
| Calendar | Placeholder grid and note | Full-size grid, day panel, upcoming list, mobile agenda | Spec |
| Calendar | "Sync Calendar ▾" | Phase 3: import help + .ics; Phase 5: live link | A live link needs data on the server (BLUEPRINT §11.3) |
| Settings | "Create Local Sync" | Disabled until Phase 5 | Sync is Phase 5 |
| Settings | — | Appearance, Your data and Catalog sections | Backups need a home |
| Payment | Placeholder text | Card tiles + card dialog | Decision of 2026-10-22 |
| Home | Empty space under the bars | Optional "Next payments" strip | Uses the space |
