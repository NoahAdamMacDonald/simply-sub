# Simply Sub — Project Blueprint

> **What this is:** the single source of truth for planning and building Simply Sub (Simply Subscription).
> It replaces the rough notes in `plan.txt`, `pages.txt`, `subscriptions.txt` and the draft `api-*.json` files.
> Those stay in the repo as history; when they disagree with this file, **this file wins**.
>
> **Companion files:** [PROJECT-PLAN.md](PROJECT-PLAN.md) (build order and page-by-page specs),
> [docs/api-output-examples.json](docs/api-output-examples.json) (example API responses) and
> [docs/wireframes/](docs/wireframes/) (Figma screenshots).
>
> **For AI assistants:** read this whole document before proposing code or architecture. Section 1.3 lists
> decisions that are already made. Section 14 lists what is still open, so ask about those rather than guessing.

Last updated: 2026-10-23

---

## Table of contents

1. [Overview & goals](#1-overview--goals)
2. [Architecture](#2-architecture)
3. [Repository structure](#3-repository-structure)
4. [Data model](#4-data-model)
5. [Catalog API](#5-catalog-api)
6. [Populating & maintaining the catalog](#6-populating--maintaining-the-catalog)
7. [Hosting & deployment on Cloudflare](#7-hosting--deployment-on-cloudflare)
8. [Pages & UI](#8-pages--ui)
9. [Payment page](#9-payment-page)
10. [Optimizer engine](#10-optimizer-engine)
11. [User data, export, calendar & sync](#11-user-data-export-calendar--sync)
12. [Roadmap](#12-roadmap)
13. [Conventions](#13-conventions)
14. [Open questions](#14-open-questions)
15. [Reference links](#15-reference-links)

---

## 1. Overview & goals

### 1.1 What the app does
A website that helps people **track, budget and optimize their subscriptions**. Users build one or more
*subscription lists*. Each entry is picked from a shared catalog (Netflix Standard, Proton Unlimited, …) or
added as a custom entry. Users rank how much they care about each feature. The app then shows:

- monthly and annual totals against the user's budgets
- a calendar of upcoming payments
- feature coverage (for example "2 / 3 VPNs")
- **optimization suggestions**: bundles, annual vs monthly, overlap, unused features, and later card rewards

### 1.2 Goals & constraints
| Goal | Target |
|---|---|
| Cost | Free, at most $10/mo. Realistic cost is just the domain, about $10–15/yr |
| Privacy | No sign-in required. Personal data never leaves the browser unless the user opts in |
| Hosting | Cloudflare (Workers + D1) |
| Maintainability | One person can maintain it. Catalog updates are mostly automated, with a human approving each change |
| Future-proof | Sign-in, sync and more regions can be added without rewriting the data model |

### 1.3 Decisions already made
| Area | Decision |
|---|---|
| Frontend | **Angular 22.2.3** (CLI and build tools 22.2.4, pinned exactly), TypeScript, standalone components, signals, zoneless change detection |
| UI kit | **Angular Material 3** + CDK (matches the search, chip and select styles in the wireframes) |
| Toolchain | **Volta 2.0.2** pins **Node 24.22.1** and **npm 12.0.2** through the root `package.json` |
| Repo layout | npm-workspaces monorepo (section 3) |
| User data | **Local-first**: IndexedDB through Dexie. No accounts in v1 |
| Catalog API | Our own read-only API on a **Cloudflare Worker (Hono) + D1**, because no free API exists (section 5) |
| Catalog source of truth | **YAML files in Git**, validated in CI and seeded into D1 automatically |
| Catalog scope | **Personal and family plans**, free tiers included (a $0 price). Business and per-seat plans aren't in the v1 catalog. A provider's all-in-one plans (Proton Unlimited, Duo, Family) are **suite plans**, not bundles (section 4.4) |
| Domain & URLs | **sub.simplely.ca**, a subdomain of its own (an origin no other app shares, section 7.3): app at `https://sub.simplely.ca/`, API at `https://sub.simplely.ca/api/v1/` |
| Security of user data | Local only, with defences against injected script (strict CSP, Trusted Types), validated imports, optional encrypted backups and an optional passphrase lock that encrypts the data at rest (section 11.5) |
| Regions | **Every region a service supports** is stored. The user's own region and currency are the default. Prices without a native price in the user's currency are converted and marked with a "converted" icon (section 4.7). Canadian data is filled first |
| Sales tax | Added for buyers in **Canada and the US**, where listed prices exclude it: a built-in rate per Canadian province, the user's own rate otherwise. Totals include it; price tags show "+ tax" (section 4.8) |
| Payment cards | **Kept**, manual entry: network, flat cash-back %, FX fee %, optional monthly limit (section 9). Built in Phase 4 |
| Automation | Cloudflare-first: Workers Builds deploys, Cron Worker + Workflows run price checks, Workers AI extracts. GitHub hosts the repo and PRs. Large discovery batches run locally (section 7.7) |
| Theming | All colours, tints and states are CSS custom properties, so the palette can change in one place |
| Tests | Vitest (Angular's default runner) for unit tests, Playwright for end-to-end tests |

### 1.4 Does a free API already exist?
Short answer: **no, not for what this app needs.** Research done in October 2026 found:

- **Subscription plan and pricing data:** no free public API offers structured plan, price and feature
  data for services like Netflix, Proton or Bitdefender. Existing subscription trackers (Bobby, Rocket Money,
  and the open-source, self-hosted Wallos) either keep private data or have users type prices in manually.
  Streaming-availability APIs (JustWatch, Streaming Availability on RapidAPI) cover *which titles are on
  which service*, not plan prices or features.
- **Credit card rewards (Canada):** no free API or open dataset. Sites like Rewards Canada, Milesopedia and
  Ratehub publish comparison *pages*, not data. Commercial card APIs are aimed at banks and are paid.
- **Pieces that do exist for free and that we will use:**
  - **Frankfurter** (ECB exchange rates) for currency conversion
  - DuckDuckGo and Google favicon endpoints for service icons (proxied and cached)
  - open MCC-code lists, for reference only (section 9)

So we build a **small, data-driven catalog API**. Because the catalog is read-only, changes rarely and is
served from a cache, it is cheap and easy to maintain.

---

## 2. Architecture

```
                      https://sub.simplely.ca
                               │
                     ┌─────────┴──────────────────────────┐
                     │      Cloudflare Worker "simply-sub" │
                     │                                     │
              /*  ──►│  Static assets (Angular build)      │  free, no request cap
                     │                                     │
       /api/v1/*  ──►│  Hono router  ──►  D1 (catalog)     │  counts against Worker quota
                     │       │                             │
                     │       └──► Cache API (edge cache)   │
                     └─────────────────────────────────────┘
                               ▲
                               │  deploy + seed D1
                     ┌─────────┴──────────────┐      ┌──────────────────────────────┐
                     │  Workers Builds (CI/CD)│      │ Cron Worker "simply-sub-bot" │
                     └─────────┬──────────────┘      │ Workflows + Workers AI       │
                               │ on push to main     │ nightly price check          │
                               │                     └──────────────┬───────────────┘
                     data/*.yaml in GitHub  ◄───── opens PRs via GitHub API ──┘
                     (catalog source of truth)


   Browser ── Angular SPA ── IndexedDB (lists, rankings, cards, tags, settings)
                │
                └── fetches catalog snapshot, caches it, runs the optimizer locally
```

**Key ideas**
1. **The server only knows public catalog data.** Every user-specific record lives in IndexedDB.
2. **The app downloads a catalog snapshot** (static files: `/data/catalog/index.json` lists the regions with a
   file, then its region's `/data/catalog/<region>.json`, the same JSON as `GET /api/v1/catalog?region=`, or the
   full `catalog.json` for a region without one; section 6.3), caches it, and does
   search, filtering and optimization locally. This makes the UI fast, lets it work offline, and keeps API calls far below the free limit.
   Per-item endpoints still exist for deep links and for other consumers of the API.
3. **Everything is static or cached.** The Worker runs only for `/api/*` requests, and those responses are edge-cached.

---

## 3. Repository structure

```
simply-sub/
├─ package.json              # npm workspaces + "volta" pin
├─ tsconfig.base.json        # shared TS settings and path aliases
├─ BLUEPRINT.md              # this file
├─ PROJECT-PLAN.md           # build order + page-by-page specs
├─ CLAUDE.md                 # short AI context that points here
├─ docs/
│  ├─ api-output-examples.json  # example API requests/responses (the contract)
│  ├─ wireframes/            # Figma screenshots (local only, gitignored)
│  └─ drafts/                # original plan.txt, pages.txt, … (history only; local only, gitignored)
│
├─ apps/
│  ├─ web/                   # Angular 22 app
│  │  ├─ src/app/
│  │  │  ├─ core/            # app-wide services (singletons)
│  │  │  │  ├─ storage/      # Dexie database, repositories, migrations, the crypto module (section 11.5)
│  │  │  │  ├─ catalog/      # CatalogService: fetch, cache, search
│  │  │  │  ├─ theme/        # light/dark, CSS tokens
│  │  │  │  ├─ clock/        # ClockService: the only reader of the device clock (`today`)
│  │  │  │  ├─ currency/     # Intl formatting, FX conversion
│  │  │  │  └─ settings/
│  │  │  ├─ features/        # one folder per page (lazy-loaded routes)
│  │  │  │  ├─ home/
│  │  │  │  ├─ lists/        # overview, view, edit
│  │  │  │  ├─ search/
│  │  │  │  ├─ features-ranking/
│  │  │  │  ├─ calendar/
│  │  │  │  ├─ payment/
│  │  │  │  ├─ custom-subs/
│  │  │  │  └─ settings/
│  │  │  ├─ shared/ui/       # sub-card, rank-select, budget-bar, price-tag, mini-calendar…; export/ (M7.5)
│  │  │  ├─ layout/          # sidebar, shell
│  │  │  ├─ app.routes.ts
│  │  │  └─ app.config.ts
│  │  ├─ public/             # favicon, logo; `npm run data:build` writes data/catalog.json, the per-region
│  │  │                      # data/catalog/<region>.json, index.json, features.json, categories.json and
│  │  │                      # ids.json, and icons/<id>.webp here (gitignored)
│  │  └─ proxy.conf.json     # dev: /api → wrangler dev
│  │
│  └─ api/                   # Cloudflare Worker
│     ├─ src/
│     │  ├─ index.ts         # Hono app, routes mounted at /api/v1
│     │  ├─ catalog-files.ts # the routes that stream a static catalog file: ETag and 304 (section 5.1)
│     │  ├─ http.ts          # what every route answers alike: 400 bad_request, 404 not_found, 502, If-None-Match
│     │  ├─ fx.ts            # the ECB's rates, kept in KV (section 5.2)
│     │  ├─ icons.ts         # custom subscriptions' icons from the icon services, kept in KV (section 5.4)
│     │  ├─ lookup.ts        # what GET /providers/:id, /plans/:id and /bundles share: rates, ETag, 304
│     │  ├─ middleware.ts    # every /api/* request: the API's headers, rate limits, edge cache, JSON 404 and 500
│     │  ├─ routes/          # health.ts, providers.ts, provider.ts, plans.ts, features.ts, categories.ts,
│     │  │                   # bundles.ts, catalog.ts, fx.ts, icon.ts
│     │  └─ db/              # SQL queries (D1): providers.ts for GET /providers, lookups.ts for the M2.4 routes
│     │                      # (section 5.3)
│     ├─ test/               # route tests, run in workerd (@cloudflare/vitest-plugin); contract.spec.ts sends
│     │                      # every example to the Worker (M2.7)
│     ├─ migrations/         # D1 schema migrations (0001_init.sql …)
│     ├─ scripts/
│     │  └─ copy-web-build.mjs  # web build → public/ (section 7.3)
│     ├─ public/             # ← Angular build is copied here at build time (gitignored, except `_headers`: the
│     │                      # static files' CSP, security headers and caching, M2.8)
│     ├─ worker-configuration.d.ts  # generated by `wrangler types` (`npm run types` after config changes)
│     └─ wrangler.jsonc
│
├─ packages/
│  └─ core/                  # pure TypeScript with no Angular or Worker dependencies
│     ├─ src/
│     │  ├─ index.ts         # the public API, imported as `@simply-sub/core`
│     │  ├─ api/             # the error envelope, GET /health's body and every endpoint's response schema (M2.7)
│     │  ├─ catalog/         # Zod schemas + inferred types for the catalog files, JSON Schema export (section 4.5),
│     │  │                   # validateCatalog (section 6.2), regions, availability, pickPrice and convert (section 4.7)
│     │  ├─ user/            # user-data types (lists, items, cards…), resolveItem (M4.6), itemActivity (M5.1)
│     │  ├─ dates/           # ISO calendar dates in UTC: IsoDate, toIsoDate, addDays, addMonths, daysBetween, and
│     │  │                   # billing periods (Period, addPeriods)
│     │  ├─ icons/           # PNG and ICO reading, a page's icon links, the icon services, picking the best icon,
│     │  │                   # GET /icon's query (M2.6)
│     │  ├─ schedule/        # charge dates, charges with tax, the next charge, statuses, totals and budget checks
│     │  │                   # (M7.1)
│     │  ├─ tax/             # sales tax: tax-added regions, the Canadian rate table, subdivisions, the tax on a
│     │  │                   # charge (section 4.8)
│     │  ├─ ranking/         # rank keys, providesKey (M2.3) and providedKeys (M2.4); rank resolution (item override >
│     │  │                   # profile > not ranked), rank counts and the feature summary (M6.1)
│     │  ├─ search/          # searchProviders, readProvidersQuery, providersBody (GET /providers); searchCatalog
│     │  │                   # and providerActivity (Search, P8, M5.1); its URL, filter options and Features
│     │  │                   # suggestions (M5.3)
│     │  ├─ lookup/          # readPricingQuery, readBundlesQuery and the GET /providers/:id, /plans/:id and /bundles
│     │  │                   # bodies (M2.4)
│     │  ├─ optimizer/       # suggestion engine (section 10)
│     │  ├─ rewards/         # card reward maths (section 9)
│     │  └─ export/          # the exports' tables, calendar events, text and list file, which the app writes
│     │                      # with papaparse, exceljs and ics (M7.5)
│     └─ test/               # Vitest specs, mirroring src/ (run in the America/Vancouver time zone)
│
├─ data/                     # catalog source of truth (human-edited)
│  ├─ features.yaml          # feature registry
│  ├─ categories.yaml        # service, feature and spend categories
│  ├─ providers/
│  │  ├─ netflix.yaml
│  │  ├─ proton.yaml
│  │  └─ …
│  ├─ bundles/
│  │  └─ disney-crave-premium.yaml
│  ├─ schema/                # JSON Schema for the YAML above, generated from core's Zod schemas (committed)
│  └─ logos/                 # provider logos, <id>.png: fetched by `npm run data:icons` or added by hand (committed);
│                            # data:build publishes each as a WebP of at most 96 px (section 6.3)
│
├─ scripts/                  # run by tsx; type-checked by `npm run build` (scripts/tsconfig.json)
│  ├─ generate-json-schema.ts  # core's Zod schemas → data/schema/*.schema.json (`--check` in CI)
│  ├─ validate-data.ts       # data/**/*.yaml → core's validateCatalog → file:line messages (section 6.2)
│  ├─ build-catalog.ts       # data/ → apps/web/public/data/catalog.json, catalog/<region>.json, index.json,
│  │                         # features.json, categories.json and ids.json, and icons/<id>.webp (section 6.3)
│  ├─ seed-d1.ts             # catalog.json + what D1 holds → apps/api/dist/seed.sql, run on D1 (sections 5.3, 7.6)
│  ├─ lib/catalog-files.ts   # reads, parses and checks data/ for the catalog scripts
│  ├─ fetch-icons.ts         # any website's best icon → data/logos/<id>.png (`npm run data:icons`)
│  ├─ price-check.ts         # nightly price monitor (section 6.4)
│  └─ draft-provider.ts      # AI-assisted: pricing page URL → draft YAML
│
├─ apps/bot/                # Cron Worker: nightly price check (Workflows + Workers AI) → GitHub PRs
│
└─ .github/workflows/
   └─ ci.yml                 # the required PR check `ci`: npm audit, lint, format, data:schema --check, data:validate,
                             # test, build (deploys run on Cloudflare Workers Builds, section 7.6)
```

**Why this layout**
- `packages/core` holds the business logic (optimizer, schedules, rewards, exporters) as plain functions. It can be
  unit-tested without Angular and reused by the API and scripts.
- Apps import core as TypeScript source through the `@simply-sub/core` path alias in `tsconfig.base.json`, so core
  has no build step. Angular's build and Wrangler read the alias themselves. A Vitest config that imports core
  sets `resolve.tsconfigPaths: true`. Core's `package.json` `exports` points at the same file, so the npm workspace
  link resolves it too; that's how tsx finds it for `scripts/`, which run from the root (no root `tsconfig.json`).
  Workspace tsconfigs extend the base with a relative path, because Vite can't follow an absolute Windows `extends`.
- The root `package.json` has `"type": "module"`, so `scripts/*.ts` run as ES modules (top-level `await`,
  `import.meta.url`). tsx strips types without checking them, so `npm run build` type-checks `scripts/` too.
- `data/` makes catalog edits plain Git diffs: easy to review, revert and automate.
- One Worker serves both the app and the API: one deploy, one domain, no CORS problems in production.

### Root `package.json` (sketch)
```jsonc
{
  "name": "simply-sub",
  "private": true,
  "type": "module",
  // packages/* first, so `npm test` runs core's tests before `ng test` (which watches in a terminal)
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev:web": "npm -w apps/web run start",
    "dev:api": "npm -w apps/api run dev",
    // core and scripts have nothing to emit; their tsc checks run first because Vitest and tsx strip types
    // without checking them
    // data:build writes the catalog snapshot into apps/web/public before the web build picks it up
    "build": "npm -w packages/core run typecheck && tsc -p scripts && npm run data:build && npm -w apps/web run build && npm -w apps/api run build",
    "test": "npm run test --workspaces --if-present",
    "data:schema": "tsx scripts/generate-json-schema.ts",   // add -- --check to only verify (CI)
    "data:validate": "tsx scripts/validate-data.ts",
    "data:build": "tsx scripts/build-catalog.ts"
  },
  "volta": { "node": "24.22.1", "npm": "12.0.2" }
}
```
Set this up with `volta pin node@24.22.1 npm@12.0.2` in the repo root. That command writes the `volta` block.
Each workspace's own `package.json` adds `"volta": { "extends": "../../package.json" }`. Volta reads the nearest
`package.json`, so without this the pin wouldn't apply inside `apps/web` and the other workspaces.

---

## 4. Data model

### 4.1 Problems in the draft JSONs and how this model fixes them
| Draft issue | Fix |
|---|---|
| Free-text feature keys (`"video quality"`, `"ad free"`) differ per provider and can't be compared reliably | A **feature registry** with stable ids, types and categories |
| Random numeric ids (`123`, `48294`) | Stable, readable **slugs**: `netflix`, `netflix.standard` |
| Extra-member pricing nested as `features["discounted plans"]` | A separate **add-on** entity |
| Bundles copy plan details | Bundles **reference plan ids**. Savings are computed, never stored |
| `api-all-example.json` stores the cheapest price per feature by hand | **Computed on demand** from plans and today's exchange rates (`cheapestByRankKey` in `packages/core`) |
| No currency region, no record of when a price was checked | `region`, `lastVerified` and `sourceUrl` on every price |
| `"auto renew"` key contains a space | camelCase everywhere: `autoRenew` |

### 4.2 Feature registry (`data/features.yaml`)
Features are what users rank and what the optimizer compares. The registry is **detailed but generic**:
one canonical feature describes the same capability across every provider, whatever each provider calls it.

**Rules**
1. **Canonical name + aliases.** Each feature, and each value of a `set` or `enum` feature, has one canonical id
   and name plus `aliases` for provider wording. For example, Bitdefender's "Identity / personal information"
   and Proton's "Identity" both map to the value `identity`. Aliases are used by search, by the AI drafting
   pipeline (section 6.5) and for the plan-level display label.
2. **Groups.** Features are organised in a tree through `parent` (`password-manager` → `password-manager.item-types`,
   `password-manager.sharing` …; `vpn.included` → `vpn.devices`). A group's own rank means "I want this kind of
   thing at all" (for example *any* password manager). Children start as Not ranked, so detailed options only
   matter once you rank them, and a "Set all in this group" action makes bulk ranking quick. Ranks deliberately
   **don't cascade**. Otherwise ranking "Password manager: Needed" would make all 22 item types Needed, and the
   optimizer could never suggest a simpler password manager.
3. **Reusable or nothing.** A feature goes in the registry if it is comparable and either exists at **two or more
   providers** or matters for ranking. Anything else that is truly provider-specific (the Fortnite Crew passes in
   Game Pass Ultimate) goes in a plan's `perks` list (free text, shown but not compared). How to find, model and add
   features from providers' pages: `.claude/skills/feature-discovery/SKILL.md`.
4. **Prefer structured types:** `boolean`, `number` (with `unlimited`), `enum` (ordered) and `set` (a
   multi-select of canonical values, for example the item types a password manager can store).
5. **Plans can show provider wording.** `featureLabels: { password-manager.item-types=identity: "Personal info" }`
   on a plan overrides the displayed name without breaking comparison. The key is a feature id or a rank key.
6. **Every value is an object** with an `id` and a `name` (plus optional `aliases` and `headline`), and every
   feature has a `category`, children included. There's no shorthand, so the file reads one way and the display
   names stay deliberate ("480p (SD)", not "480p").

```yaml
# data/features.yaml (an excerpt: the file is the registry)
- id: video.quality
  name: Video quality
  category: streaming
  type: enum
  values: # ordered low → high, so "at least 1080p" queries work
    - { id: 480p, name: 480p (SD) }
    - { id: 720p, name: 720p (HD) }
    - { id: 1080p, name: 1080p (Full HD), headline: true }
    - { id: 4k, name: 4K (Ultra HD), aliases: [uhd, 2160p], headline: true }
  aliases: [resolution, picture quality]
- id: streaming.ad-free
  name: Ad free
  category: streaming
  type: boolean
  aliases: [no ads, ad-free]
- id: streaming.concurrent-streams
  name: Simultaneous streams
  category: streaming
  type: number
  unit: devices
  tiers: # rankable buckets (the Features page rows); a plan provides one when its value is at least min
    - { id: '1', name: Single device, min: 1, max: 1 }
    - { id: 2-4, name: 2 to 4 devices, min: 2, max: 4 }
    - { id: 5+, name: More than 4 devices, min: 5 }
  aliases: [screens, streams, devices at once]
- id: streaming.live
  name: Live TV and sports
  category: streaming
  type: set
  values:
    - { id: tv-channels, name: Live TV channels, aliases: [live tv, linear tv] }
    - { id: sports, name: Live sports, aliases: [sports streaming, live games] }
  aliases: [live broadcasts]
- id: vpn.included
  name: VPN
  category: vpn
  type: boolean
  aliases: [vpn, virtual private network]
  headline: true
- id: vpn.devices
  parent: vpn.included
  name: VPN devices
  category: vpn
  type: number
  unit: devices
  tiers:
    - { id: 1-5, name: 1 to 5 devices, min: 1, max: 5 }
    - { id: 6-10, name: 6 to 10 devices, min: 6, max: 10 }
    - { id: 11+, name: More than 10 devices, min: 11 }
- id: storage.cloud
  name: Cloud storage
  category: storage
  type: number
  unit: GB
  tiers:
    - { id: 1+, name: Any cloud storage, min: 1 }
    - { id: 200+, name: 200 GB or more, min: 200 }
    - { id: 1000+, name: 1 TB or more, min: 1000 }
  aliases: [drive, online storage]

# ── Detailed, shared password-manager taxonomy ─────────────────────────────
- id: password-manager
  name: Password manager
  category: security
  type: boolean
  aliases: [password vault, pass]
  headline: true
- id: password-manager.item-types
  parent: password-manager
  name: Storable item types
  category: security
  type: set
  values:
    - { id: login, name: Logins, aliases: [account logins, passwords] }
    - { id: totp, name: 2FA codes, aliases: [authenticator, one-time codes, otp] }
    - { id: passkey, name: Passkeys }
    - { id: credit-card, name: Credit cards, aliases: [payment cards] }
    - { id: identity, name: Identity, aliases: [personal information, personal info, identities] }
    - { id: secure-note, name: Secure notes, aliases: [notes] }
    # … 16 more values in data/features.yaml

# ── Services that include other services (overlap detection) ───────────────
- id: includes-subscription
  name: Includes another subscription
  category: bundle
  type: set
  valuesFrom: providers # provider or plan ids (proton.pass-plus); listing plans makes a suite (section 4.4)
  rankable: false
```

`number` features support `unlimited` as a value. Booleans that aren't listed on a plan are treated as `false`,
and `set` features that aren't listed are treated as empty. Plans for several people (Duo, Family) list
`account.users`, and a plan without it is for one person. Other categories (VPN, storage, email, gaming,
security, AI) get the same detailed treatment as their providers are added. Grow the registry as you go
instead of trying to finish it up front.

**Rank keys.** Users rank *rank keys*, one per rankable option:
- `streaming.ad-free` (boolean)
- `video.quality=4k` (enum value; a plan provides it if its value is at least 4k)
- `streaming.concurrent-streams=2-4` (number tier; provided if the value is at least the tier's min)
- `password-manager.item-types=passkey` (set value)

`headline: true` on a feature, value or tier puts it in feature summaries ("VPN 2 / 3", "4k 2 / 5"); on an enum,
number or set feature, it puts all its values or tiers in.
`rankable: false` hides helper features such as `includes-subscription`. Full rules: PROJECT-PLAN.md §3.2.

**Feature summaries** such as "VPN: 2/3" (Lists page) are produced from the feature categories:
*active subscriptions providing the feature / total subscriptions in the list providing it*.

### 4.3 Provider file (`data/providers/netflix.yaml`)
```yaml
id: netflix
name: Netflix
website: https://www.netflix.com
category: streaming                 # from categories.yaml
spendCategory: streaming            # used for card-reward maths (section 9)
acceptedNetworks:                   # the cards it takes, per region, quoted from its own page (section 9.3)
  CA:
    networks: [visa, mastercard, amex]
    url: https://help.netflix.com/en/node/116380/ca
    quotes: [Visa, MasterCard, American Express]   # word for word, which the nightly check looks for
  US: { networks: [visa, mastercard, amex, discover], url: …, quotes: […] }
  # a region left out (or the whole field) = unknown → every card allowed, with a hint
billingCurrency: { CA: CAD }        # currency actually charged per region (drives FX-fee maths)
cancelUrl: https://www.netflix.com/cancelplan   # required: its cancel page, or its help article on cancelling
sources: { pricing: https://help.netflix.com/en/node/24926 }
# Optional and left out here: aliases, domains (its other sites, section 4.9), availableIn (section 4.7), cancelFee
# (text), notes, resellers (section 4.9).
# Optional fields are
# omitted, never empty or null.

plans:
  - id: netflix.standard-ads
    name: Standard with ads
    link: https://www.netflix.com/signup   # required: where to sign up for this plan
    # categories: [vpn]   # optional: the service categories it's in when they aren't just the provider's
    #                     # (Proton VPN Plus; Proton Unlimited is [privacy-suite, vpn, storage]). M1.10
    features:
      video.quality: 1080p
      video.hdr: false
      streaming.ad-free: false
      streaming.concurrent-streams: 2
      streaming.download-devices: 2
    prices:
      - region: CA
        currency: CAD
        amount: 7.99
        interval: month          # day | week | month | year
        intervalCount: 1         # e.g. 3 + month = quarterly
        autoRenew: true          # false for prepaid-only plans (e.g. Mullvad)
        lastVerified: 2026-10-21
        sourceUrl: https://help.netflix.com/en/node/24926

  - id: netflix.standard
    name: Standard
    link: https://www.netflix.com/signup
    features:
      video.quality: 1080p
      video.hdr: false
      streaming.ad-free: true
      streaming.concurrent-streams: 2
      streaming.download-devices: 2
    prices:
      - { region: CA, currency: CAD, amount: 18.99, interval: month, intervalCount: 1, autoRenew: true, lastVerified: 2026-10-21, sourceUrl: https://help.netflix.com/en/node/24926 }
    addOnIds: [netflix.extra-member-ads, netflix.extra-member]   # ids from addOns below
    addOnLimit: 1                 # max extra members on this plan

  - id: netflix.premium
    name: Premium
    link: https://www.netflix.com/signup
    features:
      video.quality: 4k
      video.hdr: true
      streaming.ad-free: true
      streaming.concurrent-streams: 4
      streaming.download-devices: 6
    prices:
      - { region: CA, currency: CAD, amount: 23.99, interval: month, intervalCount: 1, autoRenew: true, lastVerified: 2026-10-21, sourceUrl: https://help.netflix.com/en/node/24926 }
    addOnIds: [netflix.extra-member-ads, netflix.extra-member]
    addOnLimit: 2

addOns:
  - id: netflix.extra-member-ads
    name: Extra member (with ads)
    grantsPlan: netflix.standard-ads   # the extra member gets these features
    prices:
      - { region: CA, currency: CAD, amount: 5.99, interval: month, intervalCount: 1, autoRenew: true, lastVerified: 2026-10-21 }
  - id: netflix.extra-member
    name: Extra member
    grantsPlan: netflix.standard
    prices:
      - { region: CA, currency: CAD, amount: 7.99, interval: month, intervalCount: 1, autoRenew: true, lastVerified: 2026-10-21 }
```
> These prices come from the draft JSON. Verify them before seeding.

Plans can also have `featureLabels` (rule 5 in section 4.2), `perks` (provider-specific extras, shown but not
compared) and `notes`. The Proton example in `docs/api-output-examples.json` uses all three.

**Free plans** have one price with `amount: 0` (Proton Free, Bitdefender's free plan). A $0 price creates no
charges, shows as "Free" (never with ≈), and lets the optimizer suggest moving down to the free tier
(section 10.3). When one free account covers several products, as Proton Free covers Mail, Drive, VPN and Pass,
it's one plan, not one per product. A paid plan that upgrades one product keeps the free tier of the others, so
its `features` list those too (Proton Mail Plus still has Proton Free's VPN and Pass).

**Regular prices, not offers.** A price is what the subscription renews at. "$53.88 for the first 12 months, then
$83.88" stores 83.88. First-term discounts are common (VPNs, antivirus), so a user who got one enters it as their
own price with an end date (`priceOverride.until`, section 4.6), after which the schedule uses the catalog price.
An offer can be mentioned in `notes`.

**The billing period as the provider states it.** `interval` and `intervalCount` say how often a payment is taken,
and they cover any period: "monthly" is `month`, "every 30 days" is `day` × 30 (prepaid phone plans), "every 4
weeks" is `week` × 4, "every 2 weeks" is `week` × 2 (gyms), "quarterly" is `month` × 3. A 30-day plan isn't a
monthly one: it's charged about 12.2 times a year, and some months get two charges (PROJECT-PLAN §3.1).

**Money-back features** (for example a savings-account plan paying 3.5% interest, or Xbox Rewards) will use a
`returns` block on the plan. It's **not in the schema yet**, so the strict schema rejects it: add it, with its
rules, in the task that first needs it.
```yaml
    returns:
      - type: interest           # interest | cashback | store-credit | points
        description: 3.5% savings interest
        rate: 0.035
        estimate: user-input     # the user enters a balance to estimate value
```

### 4.4 Bundle file (`data/bundles/disney-crave-premium.yaml`)
```yaml
id: bundle.disney-crave-premium      # always bundle.<slug>, so it can't clash with a provider or plan id
name: Disney+ and Crave Premium Bundle
soldBy: crave                        # the provider id of who sells the bundle
includes: [disney-plus.premium, crave.premium]   # plan ids, at least two
link: https://www.crave.ca/en/disneypluscravebundle
prices:
  - region: CA
    currency: CAD
    amount: 29.25
    interval: month
    intervalCount: 1
    autoRenew: true
    lastVerified: 2026-10-23
    sourceUrl: https://www.crave.ca/en/disneypluscravebundle
# Features = union of the included plans' features (computed)
# Savings  = sum of the included plans' prices − bundle price (computed per region/interval)
```

**Features and savings are computed**, never stored, by core's `bundleFeatures` and `bundleSavings`
(`bundle-deal.ts`, M2.4). `GET /bundles` adds them per request, and the app will compute them the same way.
- **Features:** the union of the included plans' features, each in the order it first appears. Booleans are OR'd,
  numbers and enums take the highest value (`unlimited` above any number, an enum's in registry order), and sets
  are merged.
- **Savings:** for each interval of the bundle's picked price (section 4.7), the included plans' picked prices for
  the same `interval` and `intervalCount`, added up, minus the bundle's. An interval counts only when the bundle and
  every plan are offered in the region (a fallback price from another region isn't comparable) and every price is
  in the same currency. An interval where the bundle costs as much or more is left out, as a suite's would be.

**Bundle or suite?** Use a bundle file only when the deal is exactly its parts: plans that are also sold on
their own, whose features add up to the bundle's (Disney+ Premium & Crave Premium). A provider's own
all-in-one plan with its own limits is a **suite plan** instead. Proton Unlimited has 500 GB where Drive Plus
has 200 GB, and Duo and Family add people, so a computed union would get them wrong. Proton also allows only
one paid plan per account, so its Plus plans are never held together on one account.
- A suite is a normal plan in the provider file. It states its own `features`, and `includes-subscription`
  lists the plans it replaces. Any plan that lists plans there is a suite, and inclusion is transitive (Duo
  includes Unlimited, which includes the Plus plans).
- Suites get the bundle treatment where it matters, all computed in `packages/core`:
  - **Overlap:** a list with a suite and a plan it includes gets an overlap warning.
  - **Savings:** the directly included plans' picked prices minus the suite's price, for the same interval,
    shown only when positive. The API doesn't return suite savings in v1.
  - **Optimizer:** a suite can replace the items whose plans it includes (section 10.3). With
    `account.users: n`, it can replace up to n copies of each included plan in one list.

```yaml
# data/providers/proton.yaml (excerpt)
  - id: proton.unlimited
    name: Proton Unlimited
    features:
      storage.cloud: 500                # its own value, above Drive Plus's 200
      email.addresses: 15
      vpn.included: true
      vpn.devices: 10
      includes-subscription: [proton.mail-plus, proton.drive-plus, proton.vpn-plus, proton.pass-plus]
    prices: [ … ]
  - id: proton.duo
    name: Proton Duo
    features:
      account.users: 2
      storage.cloud: 2000
      # … plus the rest of Unlimited's features
      includes-subscription: [proton.unlimited]   # transitive: the Plus plans too
    prices: [ … ]
```

### 4.5 Catalog schemas and types (`packages/core/src/catalog/`)
The **Zod schemas** are the single validation source. They're used by `validateCatalog` (section 6.2), by the
API, and by the app when it parses cached snapshots. The TypeScript types are inferred from them (`z.infer`), so the two
can't drift. Everything is exported from `@simply-sub/core`.

| File | Schemas (and inferred types) |
|---|---|
| `formats.ts` | `slugSchema`, `dottedSlugSchema`, `planIdSchema`, `bundleIdSchema`, `tierIdSchema`, `rankKeySchema`, `regionSchema`, `currencySchema`, `isoDateSchema`, `httpsUrlSchema`, `domainSchema`, `iconNameSchema`, `textSchema`, `aliasesSchema` |
| `price.ts` | `intervalSchema` (`Interval`), `priceSchema` (`Price`) |
| `feature.ts` | `featuresFileSchema`, `featureSchema` (`Feature`), `featureValueDefSchema`, `featureTierSchema`, `featureValueSchema` (`FeatureValue`) |
| `category.ts` | `categoriesFileSchema` (`Categories`), `categorySchema`, `serviceCategorySchema` |
| `provider.ts` | `providerSchema` (`Provider`), `planSchema` (`Plan`), `addOnSchema` (`AddOn`), `cardNetworkSchema` (`CardNetwork`) |
| `bundle.ts` | `bundleSchema` (`Bundle`) |
| `bundle-deal.ts` | `bundleFeatures`, `bundleSavings` (`BundleSaving`, `PricedPart`): a bundle's computed features and savings (section 4.4) |
| `catalog-ids.ts` | `catalogIdsSchema` (`CatalogIds`), `catalogIds`, `suggestedProviderId`, `suggestedPlanId`: the static ids file behind the API's suggestions (section 6.3) |
| `json-schema.ts` | `catalogJsonSchemas()`: the JSON Schema of each kind of file |
| `validate-catalog.ts`, `validate-features.ts` | `validateCatalog(files, today)` (`CatalogIssue`), `formatCatalogIssue`: the cross-file checks (section 6.2) |
| `snapshot.ts` | Output: `catalogSnapshotSchema` (`CatalogSnapshot`), `catalogDataSchema`, `catalogMetaSchema`, `snapshotProviderSchema`; `readCatalogSource`, `buildCatalogData`, `buildCatalogMeta` (section 6.3) |
| `region-files.ts` | `regionPrices`, `regionSnapshot`, `catalogIndexSchema` (`CatalogIndex`), `buildCatalogIndex`, `regionFileFor`: the per-region catalog files (section 6.3) |
| `seed-sql.ts` | `buildSeedSql(snapshot, { providerHashes, current })`, `seedStateQueries`, `readSeedState` (`SeedState`), `seedFormat`: the D1 seed, which writes only what changed (sections 5.3, 6.3) |
| `monthly-equivalent.ts` | `monthlyEquivalent(price)` (PROJECT-PLAN §3.1) |
| `regions.ts` | `isoRegions`, `regionGroups` (EU), `groupsOf`, `membersOf`, `isCatalogRegion`, `regionProblem`: the region codes a catalog file can use (section 4.7) |
| `region-currency.ts` | `regionCurrency(region)`: the currency each region pays in (EU: EUR, GLOBAL: USD), the default `currency` of `GET /providers` and the first-run dialog |
| `availability.ts` | `providerAvailability(provider, region)`, `availability(prices, provider, region)` (`Availability`): whether something is sold in a region (section 4.7) |
| `pick-price.ts` | `pickPrice(prices, context)` (`PickedPrice`, `PriceContext`): the prices a user sees (section 4.7) |
| `registry-files.ts` | `featuresBody`, `categoriesBody` (`featuresBodySchema`, `categoriesBodySchema`): the `GET /features` and `GET /categories` files (section 6.3) |
| `convert.ts` | `fxRatesSchema` (`FxRates`, the `/fx` data), `exchangeRate`, `convert` (section 4.7) |
| `ecb-rates.ts` | `readEcbRates` (Frankfurter's answer → `EcbRates`, in euros), `rebaseRates(ecb, base)` (→ `FxRates`), `ecbCurrencies`, `fxFreshFor`, `keptEcbRatesSchema`: the rates `/fx` serves (section 5.2) |

The shapes in short (the Zod source is authoritative). `?` marks an optional field, which is left out when
empty, never `null` or `""`:
```ts
type Interval = 'day' | 'week' | 'month' | 'year';

interface Price {
  region: string;            // ISO 3166-1 alpha-2 in capitals ('CA', 'GB'), a group ('EU'), or 'GLOBAL'
  currency: string;          // ISO 4217 ('CAD')
  amount: number;            // ≥ 0 (0 = a free plan), in the major unit (18.99)
  interval: Interval;
  intervalCount: number;     // whole number ≥ 1 (3 + month = quarterly)
  autoRenew: boolean;
  taxIncluded?: { quote: string };  // the amount includes sales tax wherever the buyer is, as the page says (4.8)
  lastVerified: string;      // YYYY-MM-DD
  sourceUrl?: string;        // https
}

interface FeatureValueDef { id: string; name: string; aliases?: string[]; headline?: boolean }
interface FeatureTier { id: string; name: string; min: number; max?: number; headline?: boolean } // id: '1', '2-4', '5+'

// A discriminated union on `type`: each type accepts only its own keys.
type Feature = {
  id: string;                // 'video.quality'
  parent?: string;           // group feature id
  name: string;
  category: string;          // feature category, required on child features too
  aliases?: string[];
  headline?: boolean;        // show in feature summaries
  rankable?: boolean;        // default true
} & (
  | { type: 'boolean' }
  | { type: 'number'; unit?: string; tiers?: FeatureTier[] }    // tiers: the rankable buckets
  | { type: 'enum'; values: FeatureValueDef[] }                 // ordered low → high
  | { type: 'set'; values: FeatureValueDef[] }                  // a set has values …
  | { type: 'set'; valuesFrom: 'providers' }                    // … or valuesFrom, never both
);

// A plan's value: boolean | number | 'unlimited' | enum value id | set value ids (plan or provider ids for valuesFrom)
type FeatureValue = boolean | number | string | string[];
type RankKey = string;       // 'streaming.ad-free' | 'video.quality=4k' | 'streaming.concurrent-streams=2-4' …

interface Plan {
  id: string;                // '<provider id>.<slug>' (netflix.standard)
  name: string;
  link?: string;
  features: Record<string, FeatureValue>;    // feature id → value
  featureLabels?: Record<RankKey, string>;   // feature id or rank key → the provider's wording
  perks?: string[];          // provider-specific extras, shown but never compared
  notes?: string;
  prices: Price[];           // at least one
  addOnIds?: string[];       // ids from the provider's addOns
  addOnLimit?: number;       // needs addOnIds
}

interface AddOn { id: string; name: string; grantsPlan?: string; prices: Price[] }  // id: '<provider id>.<slug>'

type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'discover' | 'interac' | 'unionpay' | 'jcb' | 'other';

interface Provider {
  id: string;                // kebab-case, the same as the file name
  name: string;
  aliases?: string[];
  website: string;
  domains?: string[];        // its other sites, whose pages can name its resellers (protonvpn.com)
  category: string;          // service category
  spendCategory: string;
  acceptedNetworks?: Record<string, {        // region (its group, or GLOBAL) → the cards it takes there (M9.2)
    networks: CardNetwork[]; url: string; quotes: string[] }>;   // left out = unknown
  billingCurrency?: Record<string, string>;  // region → the currency charged there
  availableIn?: string[];    // every region it sells in, when known (section 4.7)
  cancelUrl?: string;
  cancelFee?: string;
  sources?: { pricing?: string };
  notes?: string;
  plans: Plan[];             // at least one
  addOns?: AddOn[];
}

interface Bundle {
  id: string;                // 'bundle.<slug>'
  name: string;
  soldBy: string;            // provider id
  includes: string[];        // plan ids, at least two
  link?: string;
  cancelUrl?: string;
  prices: Price[];
}

interface Categories {
  service: { id: string; name: string; icon: string }[];  // icon: a Material Symbols name
  feature: { id: string; name: string }[];
  spend: { id: string; name: string }[];
}
```
These are the **source** shapes: what the YAML files hold. They match the catalog objects in
`docs/api-output-examples.json` minus what the build and the API add (`iconUrl`, `schemaVersion`, picked
`pricing`, `providedRankKeys`, and a bundle's expanded `includes`, `savings` and feature union). A core test
parses every catalog object in the contract, minus those fields, so the two stay compatible. The output schemas
are built on these: `catalogSnapshotSchema` (`snapshot.ts`, M1.5) is the `GET /catalog` body and `catalog.json`,
and another core test parses the `GET /catalog` example with it. The other API responses get theirs in M2.7.
Plans have no `providerId`: it comes
from the file a plan is in, and flattened views add it.

**What the schemas check**
- **Strict objects:** an unknown key is an error at every level, whether it's a typo or an old name (a plan's
  `addOns`, a bundle's `provider`).
- **Formats:**
  - ids are kebab-case slugs: dotted for features, `<provider id>.<slug>` for plans and add-ons, `bundle.<slug>`
    for bundles, `1` / `2-4` / `5+` for tiers;
  - regions are two capital letters or `GLOBAL`, and currencies three capital letters (`validateCatalog` checks
    that both are real codes);
  - dates are real `YYYY-MM-DD` dates; URLs are `https://` on a domain name;
  - amounts are 0 or more (0 is a free plan), and `intervalCount` and `addOnLimit` are whole numbers of at
    least 1;
  - icons are Material Symbols names; text isn't empty; optional lists are left out rather than empty.
- **Within one file:**
  - plan and add-on ids start with the provider id and are unique in the file;
  - value and tier ids are unique within a feature, and a tier's `max` is at least its `min`;
  - a set feature has `values` or `valuesFrom: providers`, not both;
  - `addOnLimit` needs `addOnIds`, and a plan or bundle doesn't list the same id twice.
- **Readable errors:** each one names the exact path and says what to write, for example
  `plans.0.prices.0.currency: Use a three-letter ISO 4217 currency code in capitals (CAD)`.
- **Left to `validateCatalog`** (section 6.2): anything that needs another file or the date, such as feature ids
  and values against the registry, category ids, add-on, `grantsPlan` and bundle references, duplicate ids across
  files, and a `lastVerified` in the future. It also holds the add-on, price, region, `billingCurrency` and
  `availableIn` rules listed there, which could run on one file but are kept with the other catalog rules.
- Parse the YAML as YAML 1.2 (the default in the `yaml` package and in the editor), so dates such as
  `2026-10-21` stay strings. Quote ids that look like numbers (`id: "1"`).

**Editor autocomplete**
- `npm run data:schema` (`scripts/generate-json-schema.ts`) writes
  `data/schema/{features,categories,provider,bundle}.schema.json`. They're JSON Schema 2020-12, made with
  `z.toJSONSchema` from the input side of each schema.
- The files are committed. CI runs `npm run data:schema -- --check`, which fails when they're out of date, so run
  `npm run data:schema` after changing a schema.
- `.vscode/settings.json` maps them to `data/features.yaml`, `data/categories.yaml`, `data/providers/*.yaml` and
  `data/bundles/*.yaml` for the Red Hat YAML extension (`redhat.vscode-yaml`, recommended in
  `.vscode/extensions.json`).
- The extension autocompletes keys and enum values, shows each field's description on hover, and flags mistakes
  as you type. It uses the same messages as Zod (through `patternErrorMessage`).
- The within-file checks above run only in Zod, so the editor doesn't show them.

### 4.6 User data model (IndexedDB, `packages/core/src/user/`)
Every record has `id` (UUID v7), `createdAt`, `updatedAt` and `deletedAt?` (a soft delete, so future sync can merge
changes). Rankings and settings are keyed by `rankKey` and `key` instead of an id.
- **Schemas, not interfaces:** each record is a strict Zod schema in `packages/core/src/user/`, one file per record
  (`list-item.ts`, `settings.ts`, …), and its type comes from `z.infer`, as for the catalog. `userRecordSchemas`
  (`records.ts`) maps each Dexie table to its schema, for the repositories and for backups (M6.9). The interfaces
  below are what the schemas infer.
- **Timestamps** are `toISOString()`'s UTC form with milliseconds (`2026-10-22T18:30:00.000Z`), and nothing else, so
  they sort as strings, which is how the `updatedAt` index orders them. `updatedAt` only moves forward: a change made
  after the device clock went back gets a millisecond after the last one (`nextUpdatedAt` in `stamps.ts`).
- **Structure only:** the schemas check a record on its own, never its links to the catalog or to other records. An
  item whose plan has left the catalog is still the user's data, and resolving it (M4.6) says the plan is gone. The
  item dialog's catalog rules (windows that overlap, an add-on the plan doesn't offer) are form checks (P6).

```ts
export type Rank =
  | 'essential' | 'critical' | 'needed' | 'wanted' | 'uses'
  | 'sometimes' | 'not-ranked' | 'unused' | 'unwanted';
// essential and critical are subscription-level only (section 10.2): essential keeps this exact plan,
// critical keeps this provider (any of its plans that still provides the feature).

export interface SubscriptionList {
  id: string; name: string;          // default "Subscription List"
  createdAt: string; updatedAt: string; deletedAt?: string;
}

export interface ListItem {
  id: string; listId: string;
  source:
    | { kind: 'catalog'; planId: string; addOns?: { id: string; quantity: number }[] }  // quantity ≥ 1
    | { kind: 'bundle'; bundleId: string }   // the bundle's plans come from the catalog
    | { kind: 'custom'; customSubId: string; customPlanId: string };
  region?: string;                   // bought in another region than Settings.country (pickPrice's region)
  billing:
    | { mode: 'recurring'; interval: Interval; intervalCount: number;
        anchorDate: string;          // a known charge date; every other date is counted from it
        billingDay?: 29 | 30 | 31;   // month and year intervals: the day it's billed on, when anchorDate is the
                                     // last day of a shorter month (Feb 28 for a plan billed on the 31st)
        startDate?: string;          // subscribed since (no charges before it)
        endDate?: string;            // planned cancellation (no charges from this date on)
        autoRenew: boolean }         // false = charges still projected, marked "renew manually"
    | { mode: 'limited'; windows: { start: string; end: string; repeatYearly: boolean }[];
        interval: Interval; intervalCount: number };  // e.g. Netflix Premium every Sep–Oct
  priceOverride?: { amount: number; currency: string;   // promos, first-term offers, grandfathered prices
                    until?: string;                     // the date the catalog price applies again
                    plusTax?: boolean };                // the amount is before sales tax (default: tax included, 4.8)
  cardId?: string;
  tagIds: string[];
  rankOverrides: Record<RankKey, Rank>;  // subscription-level ranks (PROJECT-PLAN.md §3.2)
  ownRanks?: true;                       // not shared with its provider's other plans in the list (M6.14)
  pinned: boolean;
  createdAt: string; updatedAt: string; deletedAt?: string;
}

export interface ProfileRanking {     // global ranks; 'essential' and 'critical' aren't allowed; 'not-ranked' is never stored
  rankKey: RankKey;                   // the key, not a UUID: the same key ranked on two devices is one record
  rank: Exclude<Rank, 'essential' | 'critical' | 'not-ranked'>;
  createdAt: string; updatedAt: string; deletedAt?: string;   // clearing a rank soft-deletes it, so sync passes it on
}

export interface CustomSubscription {
  id: string; name: string; link?: string; cancelUrl?: string;
  plans: { id: string; name: string; features: Record<string, FeatureValue>;
           price: { amount: number; currency: string; interval: Interval; intervalCount: number;
                    plusTax?: boolean };     // the amount is before sales tax (default: tax included, 4.8)
           autoRenewAvailable: boolean }[];
  createdAt: string; updatedAt: string; deletedAt?: string;
}

export interface PaymentCard { /* see section 9 */ }

export interface Tag {
  id: string; name: string;
  color: string;                      // '#rrggbb' only, so it's safe to bind as a style
  createdAt: string; updatedAt: string; deletedAt?: string;
}

export interface Settings {             // one record, under the key 'settings'
  key: 'settings';
  country: string; currency: string;            // e.g. 'CA', 'CAD'; country is the region for pickPrice
  subdivision?: string;                         // ISO 3166-2 province or state ('CA-ON'), where tax is added (4.8)
  salesTaxPercent?: number;                     // the user's own rate, in place of the built-in one (4.8)
  monthlyBudget?: number; annualBudget?: number;
  theme: 'light' | 'dark' | 'system';
  searchSoldOnly?: true;                        // Search starts with Sold in on (M5.6); left out when off
  calendarHiddenLists?: string[];               // the lists the Calendar leaves out on this device (M7.4)
  dismissedBudgetWarnings?: string[];           // budget warnings hidden until their period or budget changes (M7.7)
  appLock?: {                                   // the app lock, when it's on (M6.10, 11.5): no secret, only the salt
    salt: string; iterations: number;           // and a sealed check value. Plain while the rest of the settings are
    check: { iv: string; ciphertext: string };  // sealed, changed only by the lock's own methods, never backed up
    idleMinutes?: 5 | 15 | 30 | 60 };           // Lock after; left out: Never
  updatedAt: string;
  // Per-device preferences (PROJECT-PLAN §3.5) come with their tasks. Optional fields added later need no migration:
  // stored records without them still pass.
}

export interface CatalogCache {         // a downloaded catalog file (M4.3, section 6.3): a cache, not the user's data
  key: string;                          // the region it serves (CA for CA.json, EU), or 'catalog' for catalog.json
  snapshot: CatalogSnapshot;            // the file as downloaded: its meta has catalogVersion, generatedAt and region
  fetchedAt: string;
}

export interface FxCache {              // the last exchange rates fetched (M4.4, section 4.7): a cache too
  key: 'fx';                            // one record
  rates: FxRates;                       // GET /fx's data: base, date, source and rates
  fetchedAt: string;
}

export interface ListDraft {            // a list's unsaved edits (PROJECT-PLAN P5, M6.3), one per list
  listId: string;                       // the key
  isNew: boolean;                       // made on /lists/new: the list is only in its draft until Save
  name: string; startName: string;      // the name now, and when the draft started
  items: { item: ListItem;              // as edited
           saved?: ListItem;            // as saved when the draft started; absent for an item the draft added
           removed?: true }[];          // removed in the draft, kept for Undo; Save soft-deletes a saved one
  startedAt: string;
}
```
`Settings.country` and `ListItem.region` are countries (ISO 3166-1 alpha-2), never `EU` or `GLOBAL`, and a
subdivision must belong to the country.

**Rank resolution:** `item.rankOverrides[key]` → `profileRanking[key]` → `'not-ranked'`. Group ranks never cascade to children.
Since M6.14 a rank changed in an item dialog is also written to the same provider's other plans in the list (their own
`rankOverrides`, in the draft), unless either has `ownRanks`; Essential stays on its plan (section 14).

**Why these fields** (settled before M4.1 ships Dexie v1, since every later change needs an upgrade function):
- `billingDay`: a date alone can't tell "billed on the 28th" from "billed on the 31st" when it's Feb 28. Without
  it, every later date of a plan billed on the 31st would come out up to 3 days early (PROJECT-PLAN §3.1).
- `region`: what pickPrice and availability use for this item, for services bought abroad. Settings' `country`
  is the default.
- `addOns` with a quantity: a plan can allow two extra members (`addOnLimit: 2`).
- `bundle` as its own kind: a bundle covers several plans, so it has no single `planId`.
- `priceOverride.until`: a first-term offer ends (section 4.3); charges dated before `until` use the override.

**Dexie schema** (`apps/web/src/app/core/storage/db.ts`, a plain `Dexie`: TypeScript gives up on Dexie's
transaction types for a subclass). Dexie keeps only keys and indexes, not the records' shapes:
- A **new table or index** needs only a new version number.
- A **change to stored records' shape** (a field renamed, a new required field) needs a new version with an upgrade
  function. Export files carry a `schemaVersion` so old backups can still be imported, migrated the same way.

v1 declares every table, so it's the full list the app lock (M6.10) encrypts. `catalogCache` got its record schema
with M4.3 and `drafts` with M6.3, which needed no new version since nothing had written to them, and `cards` gets its
repository with M9.1 (its schema is in core already, since backups carry cards). v2 (M4.4) adds `fxRates`. v3 (M8.2)
gives `dismissedSuggestions` its record schema and an index of its list, with an upgrade that empties it: nothing wrote
to it before, so a row there wasn't the app's. The cache tables (`cacheTables` in core: `catalogCache` and `fxRates`) are left out of
backups and left plain by the app lock, and their records are replaced and deleted outright. Drafts are deleted
outright too, on Save or Cancel: they're edits not saved yet, with no deletion for a sync to pass on.
```ts
db.version(1).stores({
  lists: 'id, updatedAt',
  items: 'id, listId, updatedAt',
  customSubs: 'id, updatedAt',
  rankings: 'rankKey',
  cards: 'id',
  tags: 'id',
  settings: 'key',
  catalogCache: 'key',         // one record per downloaded catalog file (M4.3)
  drafts: 'listId',            // unsaved list edits (PROJECT-PLAN.md P5)
  dismissedSuggestions: 'fingerprint'
});
db.version(2).stores({ fxRates: 'key' });   // the last exchange rates fetched (M4.4); a new table needs no upgrade
db.version(3)                                // dismissed optimizer suggestions get their schema (M8.2)
  .stores({ dismissedSuggestions: 'fingerprint, listId' })
  .upgrade((transaction) => transaction.table('dismissedSuggestions').clear());
```

### 4.7 Regions & currency conversion
Every price row carries its `region` and `currency` (`regions.ts`). A region is one of:
- an **ISO 3166-1 alpha-2 code** (`CA`, `US`, `GB`; never `UK`, which `validateCatalog` rejects with that hint);
- a **group** priced once for all its members: `EU` covers the 27 member states, so a Swede is offered and charged
  the EU price. New groups go in `regionGroups`;
- **`GLOBAL`**: one price wherever the provider sells.

**Where something is sold** (`availability.ts`). The catalog fills Canada first, so a missing price isn't proof
that a service isn't sold somewhere. Each check gives `offered`, `not-offered` or `unknown`:
- **A provider** (`providerAvailability`) is sold where its plans have a price: in the region, in its group, or
  GLOBAL. An optional **`availableIn`** list, taken only from the provider's own list of countries, is the full
  answer: elsewhere it's `not-offered` (Hulu, US only), even with a GLOBAL price, and it may name regions with no
  price of their own (charged a fallback price). Without `availableIn`, a region with no prices is `unknown`.
- **A plan, add-on or bundle** (`availability`, with the bundle's `soldBy` provider) is `offered` where it has a
  price. Where the provider has prices
  but this item has none, it's `not-offered`: Canada's Disney+ plans are known, and the US-only With Ads plan isn't
  one of them. Elsewhere it follows the provider.
- The app hides `not-offered` plans, shows "Not offered in Canada" on a provider with none offered (it can still be
  added as a custom subscription), and shows an `unknown` item's fallback price with "No price for Canada yet".
- `validateCatalog` checks that every region code is real, that `availableIn` lists every region the provider is
  priced in (a member through its group counts), and that it doesn't list `GLOBAL`.

**Choosing which price to show** (`pickPrice` in `packages/core/src/catalog/pick-price.ts`, M1.7), given the
user's region and currency from Settings (or a list item's own region). It works on any price list: a plan's, an
add-on's or a bundle's. It picks one **source**, a region and a currency, then returns every interval priced there,
shortest first, so a plan never mixes one region's monthly price with another region's yearly one. The source is
the first that fits:
1. The user's **region**, then a **group** it belongs to (`EU` for Sweden): what they're charged there. It's native
   when it's in the user's currency, and converted when it isn't (a Canadian who shows USD sees Netflix's CAD price
   converted, not the US price).
2. A price in the user's **currency** from elsewhere: `GLOBAL` first (Proton's CAD prices for a Canadian), then
   US, GB, EU and the regions listed. Shown as native.
3. A `GLOBAL` price in another currency, converted.
4. A fallback region, US → GB → EU, then the first region listed, converted.

In a region priced in several currencies, the user's currency wins, then the one the provider's `billingCurrency`
names for that region, then the first listed. A picked price has the shape of the API's `pricing` entries
(`PickedPrice`): `amount` and `currency`, `monthlyEquivalent`, `autoRenew`, `native`, the `source` price, and `fx`
(rate, date, source) when it was converted. Amounts keep full precision; the UI rounds to 2 decimals, and the API
also rounds rates to 4. Without a rate (offline on the first visit, or `/fx` down), the price stays in its own
currency with `native: false` and no `fx`. A **free** price is native in the user's currency whatever its source,
since 0 needs no rate, so every screen shows "Free" without special cases. pickPrice doesn't decide whether the
item is sold in the region; `availability` does, and the app asks it first. `convert(amount, from, to, fx)` and `exchangeRate` do the maths, from
`fxRatesSchema` (the `/fx` data: rates per unit of the user's currency).

**Converted prices**
- Converted using daily ECB rates (Frankfurter, through `/api/v1/fx`, cached in the browser with the rate date).
  Settings offers only the currencies the ECB has rates for (`displayCurrencies` in core, M4.2).
- **`FxStore`** (M4.4) fetches `/api/v1/fx?base=<currency>` once the settings have a currency, again when it changes,
  on the browser's `online` event and when a tab is shown again. The browser's HTTP cache answers until `/fx`'s
  `max-age` runs out (up to 12 hours), so most of these send nothing and the Worker sees about one request a day per
  user. The last rates are kept in Dexie (`fxRates`, section 4.6), so converted prices show at once on start and with
  no network; offline or a 502 keeps them. Rates in any base convert between any two currencies they list
  (`exchangeRate`), so stored rates keep converting after a change of currency until the new currency's arrive. The
  fetch and its schema load as a chunk of their own (1 kB).
- Shown with a **≈ prefix plus a small currency-exchange icon** (Material Symbols `currency_exchange`). The tooltip
  reads "Converted from 9.99 USD at 1.3806 on 2026-10-22. You'll be charged in USD.": the source in its currency's
  own decimals, the rate to at most 4. A price with no rate to convert it (a first visit with `/fx` down) shows in
  its own currency, with the icon but no ≈, and the tooltip says "There's no exchange rate yet, so this is the
  price in USD."
- **Amounts** are written the way English is in the user's country, as Settings' budgets are: a Canadian sees $7.53,
  US$9.99 and €5.00; an American sees $9.99 and CA$18.99. Periods read "/ mo", "/ 3 mo", "/ year", "/ 30 days", and
  screen readers hear "about $7.53 a month".
- Native prices show no icon. The search filters offer a **"Native pricing only"** toggle, and **"Sold in
  Canada"** (M5.6), which hides fallback prices and providers not sold in the user's country.
- **Not available in your region:** see "Where something is sold" above.
- The optimizer uses converted amounts but labels the resulting savings "estimated". In Phase 4, card **FX fees**
  apply automatically when the charged currency differs from the card's currency.
- Users can view prices for any region by changing the region in Settings, or pick a region per list item
  (useful for services bought abroad).

### 4.8 Sales tax
Catalog prices are what providers list, and whether that includes sales tax depends on the buyer's region.
Canadian and US prices exclude it (Netflix Canada adds GST/HST, so $18.99 is $21.46 in Ontario), while EU, UK,
Australian and most other prices include VAT or GST. Without tax, a Canadian's totals would come out 5–15% low.
The rules live in `packages/core/src/tax/`: the rates and subdivision lists since M4.2 (`salesTaxRate`,
`subdivisionsOf`), and the tax on a charge since M7.1 (`salesTaxOn` in `charge-tax.ts`):
- **The buyer's location decides**, not where the price came from: Settings' `country` and `subdivision`. In a
  **tax-added region** (`taxAddedRegions` in core: CA and US), tax is added to every catalog price, converted ones
  included, since foreign services such as Proton must collect GST/HST from Canadians. Elsewhere prices already
  include it, and nothing is added. An item bought in another region (`ListItem.region`) follows that region's
  rule, but gets a rate only in the user's own country, the only one whose rate the app knows.
- **Unless the price includes tax everywhere.** Some providers list one price that includes tax wherever the buyer
  is: Mullvad's flat €5 a month says "Including VAT.", and that's all a Canadian pays. Such a catalog price has
  `taxIncluded: { quote }`, the source page's own words, and nothing is added to it anywhere (`addedSalesTax` in
  core). It's per price, since a provider can include tax in one price list and not another. pickPrice passes it on
  as `taxIncluded: true` in the API's `pricing` entries. Price research, the extraction (section 6.5) and the
  nightly check (section 6.4) all record or recheck the wording.
- **Rates:**
  - A built-in table for Canada's 13 provinces and territories (`canadianSalesTax`): each one's combined rate on
    digital subscriptions, GST/HST plus the provincial tax where it covers digital services (BC's PST, Manitoba's
    RST, Saskatchewan's PST and Quebec's QST, each charged on the price before GST, so the rates add up). Built in
    M4.2 and checked on 2026-10-26 against the CRA's GST/HST rate table and each province's own pages
    (`canadianSalesTaxCheckedOn`): AB, NT, NU and YT 5%, SK 11%, BC and MB 12%, ON 13%, NS 14% (since 2025-04-01),
    QC 14.975%, NB, NL and PE 15%.
  - No built-in US rates. Whether streaming and software are taxed varies by state and city, so a table would
    often be wrong. US users enter their own percentage.
  - `salesTaxPercent` replaces the built-in rate anywhere tax is added. Outside CA and US it's ignored, and the
    Settings forms clear it when the country changes.
- **Amounts the user types** (a custom plan's price, a price override) are what they pay, tax included. A "plus
  tax" checkbox (`plusTax`) marks an amount copied from an ad, and tax is then added like on catalog prices.
- **A reseller's price** can say it leaves VAT to be added everywhere (`taxExcluded`, section 4.9), and is then
  compared only in Canada and the US.
- **Where it shows:**
  - Charges, totals, budgets, the calendar and exports include tax, because that's what leaves the account. Each
    charge keeps its tax part (`Charge.tax`, PROJECT-PLAN §3.1).
  - Price tags (`ss-price`: Search, plan pickers, cards) show the listed price, with a small "+ tax" in tax-added
    regions, the way Canadian prices are normally shown, or "incl. tax" for a price that includes it. The monthly
    equivalent is before tax too. As built (M4.4, core's `priceTaxNote`): the notes show only in Canada and the US,
    since everywhere else every price includes tax; "+ tax" only where a rate is added, so a US user who gave no
    rate sees none, as their totals add none; nothing on a free price. An item bought in another region
    (`ListItem.region`) follows that region's rule without the user's own rate (`buyerTaxPlace`).
  - An item's billing details show the amount charged, tax included.
- **Payment cards** (section 9.3): cash back and FX fees apply to the amount charged, tax included.
- **Settings:** the first-run dialog and the 📍 dialog ask for the province or state, in a menu that lists the
  chosen country's subdivisions (ISO 3166-2 codes with English names, kept in core for CA and US only: the 13
  provinces and territories, the 50 states and DC; Puerto Rico and the other territories are countries of their
  own), shown only for tax-added countries. A Canadian province is required, since it sets the rate; a US state is
  optional. Under it the form shows "Sales tax 13% (Ontario)" and a "Use my own rate" checkbox (a US user always
  gives their own rate). Changing it re-prices every total.

### 4.9 Resellers
Some providers sell their subscription through other shops too: Mullvad's scratch cards are on Amazon and at
Swedish and German retailers, sometimes for less than Mullvad's own price. The catalog lists these **resellers**,
and Search shows one next to a plan's prices when it's cheaper for the buyer (M5.2).
- **Only official resellers:** a shop is listed only when the provider's own site names it as one, and its listing
  quotes that page (`approvedBy: { url, quotes }`, on the provider's website's domain or one of its other sites'
  `domains`, such as Proton VPN's protonvpn.com, which validation checks). Partners that
  run their own product on the provider's service (Mozilla VPN, Tailscale and Obscura on Mullvad's servers) don't
  sell the provider's subscription, so they're never listed. The same goes for every other provider.
- **`data/resellers.yaml`** lists each shop once: `id`, `name`, `website`, and any other `domains` its pages are on
  (Amazon's country stores). Its logo is `data/logos/<id>.png`, fetched by `npm run data:icons` and published as
  `/icons/<id>.webp` like a provider's, so reseller and provider ids share one namespace. A shop can sell many
  providers' plans.
- **A provider's `resellers`** say which shops sell its plans: for each, the approval and one offer per plan with the
  shop's **regular** prices, each read from the shop's own page for it (`sourceUrl`, required, on its website or
  domains), which the app links to. Sales aren't stored, as for every catalog price (SerialCart's 20–26% off of the
  day is left out). A price applies only where it's set (its region, a group the buyer is in, or `GLOBAL`): a
  reseller price never stands in for another region's, unlike pickPrice's fallbacks.
- **Tax:** like any price, a reseller's has sales tax added in Canada and the US unless it has `taxIncluded`.
  `taxExcluded: { quote }` marks a price that leaves VAT to be added everywhere ("excl. VAT"), which the app can only
  work out in Canada and the US (section 4.8), so it's compared nowhere else.
- **Cheaper** (`resellerDeals` in core) means less per month **after the buyer's sales tax**, since that's what
  leaves the account. Mullvad's €5 includes tax everywhere and Amazon.ca adds HST, so Amazon's CA$87 for 12 months
  (CA$98.31 in Ontario, CA$91.35 in Alberta) is cheaper than Mullvad's CA$94.17 in Alberta only. Each shop is shown at
  its cheapest price per month; of two that cost the same per month, the shorter one. Nothing is compared without
  an exchange rate.
- **In the files:** the snapshot gains the `resellers` list (each with its `iconUrl`), and `GET /providers/:id`
  shows a provider's resellers as written. A region's file keeps the reseller prices a buyer there can use, and a
  group's file (`EU.json`) its members' too, since a member without a file of its own gets the group's (section 6.3).
  The D1 tables don't change: resellers travel in each provider's JSON.
- **Bought from a reseller:** a list item records the plan, and its price override says what was paid (P6), until an
  item can name its shop. A reseller's price in Search adds the plan with that override filled in (section 14).
- **Kept up to date:** the discovery pipeline finds each provider's official reseller page (section 6.5, M3.7), and
  the nightly check rereads reseller prices and the approval quotes (section 6.4, M8.3).

As read on 2026-10-26 (M1.8) and 2026-10-27 (M1.12), Mullvad's official resellers are Amazon (13 country stores),
Inet, Webhallen, ProxyStore, SerialCart and Laptop with Linux. The catalog has all but Amazon's 12 stores outside
Canada, which show Mullvad's price only in the basket. Laptop with Linux's price with VAT follows the buyer's country,
so its price before VAT is stored, as SerialCart's is.

### 4.10 Terms and policies
A card's expanded section grades the provider's terms of service, privacy policy and other policies (M1.13,
M1.14), so a buyer can see what signing up means beyond the price.
- **Topics** come from `data/policy-topics.yaml`, in four groups: privacy (data collection, selling or sharing data,
  ads and tracking, deleting your data), billing (cancelling and refunds, price changes, free trials), legal
  (disputes, changes to the terms, closing your account) and service (VPN logging for VPNs; account sharing and
  device limits for streaming services). Each has a rubric for five grades, great, good, neutral, poor and bad
  (M1.14; M1.13 called them good, leaning good, neutral, leaning bad and bad), so a grade means the same for every
  provider. Data collection's is the model: collecting only what the service needs is great, asking first good, an
  opt-out neutral, a partial opt-out poor and none bad.
- **A provider's `policies`:** its ratings and the pages they quote (`links`). A rating is a topic, a grade
  (`tier`), a reason of a sentence or two in plain words anyone can follow (240 characters at most; M1.13 kept it to
  one line of 100), one to three sources (a URL and the page's words, word for word) and the date they were read, optionally for some plans (an ad tier's tracking) or regions (a country's own terms), which
  sit over a rating for every plan or everywhere. Every quoted page is linked and every link is quoted; a topic for
  some categories applies only to a provider with a plan in one (`validateCatalog`). A rating whose reason says the
  user has to change something themselves (a setting to turn off, a request to make) has an `action` (M5.12): what the
  link does, in a few words, and the provider's own page for it, which its policy or help pages link; validation takes
  it on the provider's own sites or its quoted policies' site, never another company's.
- **On the card:** core's `planPolicies` picks, for the plan shown and the user's country, each topic's rating, by
  group in the registry's order, and the pages those ratings quote, numbered from 1. Each rating is a dot in its
  grade's colour, green to red (`--policy-*`, section 8.1), like the rank dots and as decorative, then the topic in
  bold, its grade in words, muted ("Disputes (Good):", M5.9), and the reason, muted, with an inline citation of each page it quotes ("[2]", once however many
  quotes it takes from it): a link to the page with a text fragment (`#:~:text=`, core's `quoteLink`) that scrolls
  to its first quote and highlights each, and the quotes as its tooltip. The numbered pages follow, under Sources.
  A topic with no rating isn't shown, and a provider with none has no
  section. A rating's action is a link under its reason, in a new tab (M5.12).
- **Read like prices:** the policy-research skill, from the provider's own pages; a page behind a bot check stays
  unread. The quotes are in the catalog files, and the card shows them in its citations' tooltips and links (about
  7 kB more to download, compressed, for ten providers). Nothing rereads them nightly yet: validation warns once a rating is
  a year old.

---

## 5. Catalog API

### 5.1 Stack
- **Hono**: a tiny router built for Workers, with typed routes and middleware for CORS, caching and ETags.
- **D1**: Cloudflare's SQLite database. Normalized tables, plus each provider's full JSON stored for fast reads.
- **Cache API** (M2.8): the routes that read D1 or KV (`/providers`, `/plans`, `/bundles`, `/fx`, `/icon`) keep each
  answer marked `public` in Cloudflare's edge cache, keyed by its URL, for its own max-age (an hour for catalog
  answers: `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`). The cache answers that URL again,
  `If-None-Match` included (304), without the route running. The Worker still runs on every `/api/*` request, so this
  saves D1 and KV reads and CPU, not requests. Errors (`no-store`) and 304s are never kept, and the static-file routes
  don't need it. The cache is written after the answer (`waitUntil`), so a test calling the Worker without an
  execution context skips it. Catalog responses carry a `catalogVersion` as the ETag: the first 7 hex digits of a SHA-256 of the snapshot's `data`, so it
  changes only when the catalog does, never on a code-only deploy (decided in M1.5; it was the Git commit SHA).
  `GET /catalog`, `GET /features` and `GET /categories` read it from the static `data/catalog/index.json`, deployed
  with the catalog files, so it always describes the body it's sent with: their bodies are static files too
  (section 6.3). The `catalog` row in D1 can't be the source: the seed runs before the new files are deployed, so
  clients would cache the old body under the new version (M2.1).

### 5.2 Endpoints (all under `https://sub.simplely.ca/api/v1`)
| Method & path | Purpose |
|---|---|
| `GET /catalog` | Full snapshot (providers, plans, add-ons, bundles, features, **all regions' prices**), ETag-cached. `?region=CA` keeps only the prices pickPrice can pick for a buyer there (section 6.3). Both are static files built by `data:build`, which the Worker streams through its `ASSETS` binding without parsing them, not D1 rows. The app fetches its region's static file directly, which uses no Worker quota |
| `GET /providers?q=&category=&feature=<rankKey,…>&minPrice=&maxPrice=&interval=&region=&currency=&nativeOnly=&sort=&cursor=&limit=` | Search and filter (for deep links and other consumers). Core's `searchProviders` does the matching, filters, prices and sorting (the rules are in the examples file), on the providers D1 narrows down to: rank keys through the `plan_features` index, then providers by primary key. The registry and the categories come from the static `features.json` and `categories.json`. With a region, prices are picked with `/fx`'s rates. The ETag is D1's catalog version plus a hash of the query, the rates' date and the static files' version |
| `GET /providers/:id` | One provider as written, with its plans and add-ons, and with a region the picked prices of each one sold there (core's `providerBody`). It reads 2 D1 rows: the `catalog` row and the provider's, by primary key. An unknown id gets `404 not_found` with a suggestion from the static `data/catalog/ids.json`, so a typo reads no more rows. Region and currency follow `GET /providers`' rules, and so does the ETag: D1's catalog version plus a hash of the id, the query and the rates' date |
| `GET /plans/:id` | One plan, with its provider in short, its add-ons, the rank keys it provides (`providedKeys`, with the static `features.json`) and the bundles that include it (`planBody`). Its provider's row holds it, so it reads the `catalog` row, that row and one `bundle_plans (plan_id)` index entry per bundle: 3 rows for Disney+ Premium. 404s and ETags work as for `/providers/:id` |
| `GET /features` | Feature registry, in `features.yaml` order (each group before its features). The static file `data/catalog/features.json`, built by `data:build` and streamed like `/catalog`, so it reads no D1 rows. No query parameters |
| `GET /categories` | Service, feature and spend categories: the static file `data/catalog/categories.json`, streamed the same way. No query parameters |
| `GET /bundles?plans=netflix.standard,crave.premium` | Bundles that include any of the given plans (1 to 20), with their plans expanded, the union of their features and, with a region, savings (section 4.4, `bundlesBody`). One batch reads the `catalog` row, each plan asked for by primary key (an unknown one gets 400 with a suggestion from `ids.json`), the bundles through the `bundle_plans (plan_id)` index with their sellers, and the providers of their plans: 11 rows for one plan in today's catalog |
| `GET /icon?domain=example.com` | Icon proxy for **custom subscriptions**: asks Google's and DuckDuckGo's icon services (core's `iconServices`) and returns the best square PNG of at least 32 pixels (`pickIcon`, Google's on a tie), or `404` when neither has one, and the app shows the subscription's first letter. KV keeps an icon for 30 days and "no icon" for a day (section 5.4). No `size`: the Worker can't resize, so the app scales the icon. Catalog icons are fetched once by `scripts/fetch-icons.ts` into `data/logos/` (committed, so builds never fetch) and served as static WebP files at `/icons/<id>.webp` (section 6.3) |
| `GET /fx?base=CAD` | The ECB's daily rates in the user's currency. The Worker fetches them in euros from Frankfurter's ECB-only route (`/v2/providers/ecb/rates?base=EUR`; v1 is deprecated, and v2's default blends in other central banks), keeps them in KV under `fx:ecb` for 12 hours, and rebases them to any currency the ECB publishes (core's `rebaseRates`), so one fetch serves every base. When Frankfurter fails after that, the last good rates are sent with `meta.stale: true`; with none kept, `502 upstream_unavailable`. `GET /providers` uses the same rates (M2.3) |
| `GET /health` | Returns the API version, and the catalog version, build time and counts that D1 holds (the `catalog` row, section 5.3) |
| *(Phase 5)* `POST /reports` | "This price looks wrong" reports (Turnstile-protected, rate-limited) |
| *(Phase 5)* `GET /cal/:token.ics` | Opt-in live calendar feed (section 11.3) |

Example requests and responses for every endpoint are in [docs/api-output-examples.json](docs/api-output-examples.json).
Core holds the contract's response schemas (M2.7): `successBodySchemas` names each built endpoint's (the bodies'
types come from them), and `errorBodySchema` is every error's. The contract tests hold both the examples and the
Worker's answers to them (section 13.3).
Successful responses use `{ "data": …, "meta": … }`, and errors use `{ "error": { "code": "not_found", "message": "…" } }`.
Responses are JSON and versioned through the `/v1` path. Breaking changes go under `/v2`.

### 5.3 D1 schema (`apps/api/migrations/`)
The database `simply-sub-catalog` (binding `DB`) lives in Eastern North America (`enam`). Columns, condensed
(`0002_seed_what_changed.sql` and `0003_provider_categories.sql` have the full SQL). Every table is `STRICT`, so
SQLite enforces the column types, and
`WITHOUT ROWID` (since M2.1), so its primary key is the table itself rather than a second index next to a rowid:
```sql
providers     (id PK, name, category, spend_category, hash, json)   -- category: its main one
provider_categories (category, provider_id → providers, PK (category, provider_id))   -- every one its plans
              are in (M1.10), which GET /providers?category= reads by
plans         (id PK, provider_id → providers, name, json)
prices        (plan_id → plans, region, currency, amount, interval, interval_count, monthly_equiv,
               PK (plan_id, region, currency, interval, interval_count))
features      (id PK, category, json)
plan_features (plan_id → plans, feature_id → features, value, rank_value, PK (plan_id, feature_id, value))
bundles       (id PK, json)
bundle_plans  (bundle_id → bundles, plan_id → plans, PK (bundle_id, plan_id))
catalog       (id PK = 1, version, built_at, seed_format, counts)   -- the one row: what D1 holds
indexes: prices (region, monthly_equiv) · plan_features (feature_id, rank_value) · plans (provider_id)
         · bundle_plans (plan_id)
```
- Every `→` is a foreign key with `ON DELETE CASCADE`, so deleting a provider removes its categories, plans,
  prices, plan features and bundle links, and emptying the parent tables leaves no orphans. D1 always enforces
  foreign keys. `provider_categories` has no index by provider: each index entry is a row written, and the
  cascade that would use one runs only when a provider changes.
- `rank_value` stores an enum's position (1080p = 2, 4k = 3) or the number itself, so rank-key filters like
  `feature=video.quality=1080p` ("1080p or better") become plain numeric comparisons. `unlimited` stores 1e308
  (above any number, and still a finite number in JSON) with `value` `unlimited`. A boolean stores 1 or 0, with
  `value` `true` or `false`. A `set` feature has one row per member, with no `rank_value`.
- The `catalog` row is the catalog D1 holds: `version` and `built_at` are the snapshot's `catalogVersion` and
  `generatedAt`, `counts` is its `meta.counts` as JSON, and `seed_format` is the `seedFormat` in core that it was
  written with. `/health` reports it. `providers.hash` is a SHA-256 of the provider's `json`. Until M2.1 a
  `snapshots` table held the full snapshot in D1 as well.
- D1 rejects a statement over 100 KB, so the seed checks every statement's size.
- Only plan prices go in `prices`. Add-on prices stay in the provider's `json`, and bundle prices in the bundle's.
- Add-ons stay inside each provider's `json`; they get their own table only if an endpoint needs to filter on them.
- Schema changes are new numbered migrations, never edits to an applied one: `npm -w apps/api run
  db:migrate:local`, then `db:migrate:remote` (or the deploy command, section 7.6). The API tests apply every
  migration to a local D1 first (`apps/api/test/apply-migrations.ts`).

**Free-plan limits, and what M2.1 changed.** D1's free plan allows 5 GB of storage per account (500 MB per
database), 5 million rows read and **100,000 rows written per day**, and no row over 2 MB. Going over makes the
seed fail, which stops the deploy until 00:00 UTC (the app itself keeps working: it reads static files, never D1).
Before M2.1 every deploy reseeded in full, even a code-only one: 1,633 rows at 5 providers, about 330 each, so at
about 300 providers one deploy would have used a whole day's writes. The full snapshot's row in `snapshots` would
also have passed 2 MB at about 300 providers. Storage isn't the constraint: about 21 KB per provider, so a 500 MB
database holds about 20,000.

M2.1 changed four things:
1. **The snapshots are static files** (section 6.3), which `GET /catalog` streams through the `ASSETS` binding.
   Static files are free, have no request cap and allow 25 MiB each.
2. **A one-row `catalog` table** replaces `snapshots`: the version, build time and counts, for `/health` and the
   seed.
3. **The seed writes only what changed** (`buildSeedSql` in core; `scripts/seed-d1.ts` reads what D1 holds with
   `seedStateQueries` and runs the result, section 7.6):
   - nothing at all when nothing differs, which is every code-only deploy;
   - a provider whose `hash` changed, or a new one, is deleted (the cascade takes its rows) and inserted again,
     and unchanged bundles that include its plans are linked to them again. A removed provider is deleted;
   - features are upserted (`INSERT … ON CONFLICT DO UPDATE`), never deleted and inserted again, which would
     cascade to every plan's rows for them. A removed feature is deleted. `rank_value` depends on an enum's value
     order, so when values move (1440p added before 4k), one `UPDATE` per moved value fixes the rows of unchanged
     providers, writing only those whose rank changed;
   - bundles are compared by their `json`, and a changed one is replaced;
   - the `catalog` row is written when the version changes, so a `categories.yaml` edit writes 1 row (D1 has no
     categories table).

   A full reseed (empty every table, insert everything) runs only when D1 has no `catalog` row (a new database, or
   the first deploy after a migration that rebuilds the tables, like 0002), when the row's `seed_format` differs
   from core's `seedFormat` (bumped when a migration or a derived column's rule changes), or by hand with `--full`.
4. **The tables are `WITHOUT ROWID`** (migration 0002).

Measured in workerd at 5 providers (`apps/api/test/seed.spec.ts` checks the rules; these numbers are from one
run). An insert writes its row plus one per index entry, and a delete writes one per row:

| Deploy | Rows written |
|---|---|
| Code only (the same catalog) | 0 |
| One provider's price changed | 18 (Mullvad), 63 (Crave), 90 (Netflix), 114 (Disney+), 882 (Proton) |
| Full seed into empty tables (the first deploy after 0002) | 800 |
| Full reseed by hand | 1,216 |

Proton is the outlier: its suite plans each list many features, and `plan_features` holds most of every
provider's rows. If price PRs for providers that size ever matter, a hash per plan would replace one plan instead
of the whole provider.

### 5.4 Abuse protection
The API is public and read-only on purpose: it serves public catalog data, and no user data ever reaches the
server (section 1.3), so there is nothing to log in to. A key in the app wouldn't help either, since everything
shipped to the browser is visible. The risks are abuse, and M2 builds these defences:
- **Rate limit** (M2.8): per IP, with the Workers Rate Limiting binding (`ratelimits` in `wrangler.jsonc`, no extra
  cost): 60 requests a minute on `/api/*`, and 10 a minute on `/icon`, whose misses cost KV writes. Cloudflare
  counts them in each location, and only roughly: its machines share counts asynchronously, so a burst overshoots
  (on the M2.8 preview, the first 429 came about 100 requests into a minute, then mixed with 200s). It's a brake on
  abuse, not an exact quota. Over a limit: `429 rate_limited` with `Retry-After: 60` and `no-store`. The
  key is `CF-Connecting-IP`, which Cloudflare's edge sets on every request; it's never stored or logged, and a
  request without it (a test calling the Worker directly) isn't limited. People who share an IP share its limit,
  which is why it's generous. On the free plan, going over the daily Worker quota makes requests fail; it can't run
  up a bill. The app's own pages and catalog files are static assets and don't count.
- **Caching:** the routes that read D1 or KV are edge-cached (section 5.1), so repeated requests rarely touch D1 or
  KV.
- **Errors** (M2.8): a path or method no route answers gets the JSON `404 not_found`, and an unexpected throw `500
  internal`, logged by the error's name and the route's pattern, never the URL. No error may be cached.
- **Icon proxy (`/icon`, M2.6):** accepts only a well-formed public domain name (`readIconQuery`: no scheme, port,
  path, IP address or single label; an international name in its `xn--` form), only ever asks the fixed icon
  services (Google, DuckDuckGo) for that domain, never fetches a URL from the request, and follows a redirect only
  to the services' own hosts (`isIconServiceUrl`: Google's answers from gstatic.com). That keeps it from becoming an
  open proxy or reaching internal addresses. It reuses core's icon functions (`packages/core/src/icons/`:
  `iconServices`, `readIconImage`, `pickIcon`), but never the site's own pages, which only the catalog's
  `fetch-icons.ts` reads. KV keeps each answer under `icon:<SHA-256 of the domain>`, so its key list doesn't show
  what people subscribe to: an icon for 30 days, "no icon" for a day so a site that adds one shows up soon. A miss
  costs two subrequests and one KV write (1,000 a day on the free plan); when KV refuses the write, the icon is
  still answered. The rate limit holds each IP to 10 `/icon` requests a minute.
- **No user data in logs:** the domain a user typed for a custom subscription says what they subscribe to, and
  Workers Logs record every request's URL. So `wrangler.jsonc` turns off automatic request logs
  (`observability.logs.invocation_logs: false`, since M2.6), the Worker logs errors without the domain or a URL
  that contains it, and the app
  asks for an icon only when a custom subscription with a website is saved.
- **Validation:** core's query readers check every parameter, and anything unknown or invalid gets `400`.
- **CORS and headers** (M2.8, `middleware.ts`): the app and the API share an origin, so the app needs no CORS at
  all. Every `/api/*` response's CORS header names only `https://sub.simplely.ca`, so other sites' pages can't read
  it from a browser. It's an extra layer, not authentication. Every response also carries `X-Content-Type-Options:
  nosniff`, a CSP that allows nothing (`default-src 'none'; frame-ancestors 'none'`: an API answer is never a page)
  and `Cross-Origin-Resource-Policy: same-origin`, so other sites can't embed the answers, `/icon` images included.
- **Writes** arrive only in Phase 5 (`POST /reports`), with Turnstile and a stricter rate limit.
- **Secrets** (the bot's GitHub token, AI keys) are Worker secrets (`wrangler secret put`) or a gitignored `.env`,
  never tracked files. The D1 `database_id` in `wrangler.jsonc` isn't a secret: using it needs a Cloudflare login.

### 5.5 Worker entry (as built, M2.8)
```ts
// apps/api/src/index.ts, shortened
const v1 = new Hono<{ Bindings: Env }>()
  .use('*', edgeCache)                 // only the routes that read D1 or KV use it
  .route('/catalog', catalog)
  .route('/providers', providers)
  .route('/health', health);           // … and every other route

const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', apiHeaders, rateLimit);   // every /api/* answer, errors included
app.route('/api/v1', v1);
app.notFound(noRoute);                 // JSON 404 not_found
app.onError(unexpectedError);          // JSON 500 internal, logged without the URL

export default app;   // non-API paths never reach the Worker (see run_worker_first)
```

---

## 6. Populating & maintaining the catalog

### 6.1 Principle: Git is the database, D1 is a cache
People (and bots) edit `data/**/*.yaml` through pull requests. CI validates every change. Merging to `main`
rebuilds the static catalog files and updates D1 with what changed (section 5.3). This gives you:
- full history and easy rollback (`git revert`)
- reviewable diffs ("Netflix Premium 23.99 → 24.99")
- no admin UI to build or secure

### 6.2 Validation (`scripts/validate-data.ts`, runs in CI on every PR)
`npm run data:validate` parses every `.yaml` and `.yml` file under `data/` as YAML 1.2 and runs
`validateCatalog(files, today)` from `packages/core` (`catalog/validate-catalog.ts`), which never reads the clock
or the disk. Today is the date where the script runs, which is UTC in CI.

Validation fails if:
- a file isn't valid YAML (a duplicate key, more than one document), isn't one of `data/features.yaml`,
  `data/categories.yaml`, `data/resellers.yaml` (optional), `data/policy-topics.yaml` (optional until a provider
  rates its policies), `data/providers/<id>.yaml` or `data/bundles/<slug>.yaml` (always `.yaml`), or
  `features.yaml` or `categories.yaml` is missing
- a file doesn't match its Zod schema (section 4.5), which already covers unknown keys, formats, negative amounts
  and the checks within one file
- a provider's `id` isn't its file name, or a bundle's `id` isn't `bundle.<file name>`
- a plan uses a feature id that isn't in `features.yaml`, a value of the wrong type for the feature, an enum or
  set value that isn't listed (for `valuesFrom: providers`, an id that isn't a provider or plan), or the same set
  value twice
- a plan lists a child feature (`vpn.devices`) without its group set to `true` (`vpn.included: true`)
- a `featureLabels` key isn't a feature id, or a rank key whose value or tier exists (`video.quality=4k`; a
  boolean feature takes no `=value`)
- a feature's `parent` isn't a top-level boolean feature (groups are one level deep), or is listed after the
  feature (`GET /features` keeps the file's order)
- a feature's `category`, or a provider's `category` or `spendCategory`, isn't defined
- ids are duplicated: across files (provider, plan, add-on, bundle and reseller ids share one namespace), in
  `features.yaml`, or within one category list
- a reference doesn't exist: a bundle's `soldBy` (a provider) and `includes` (plans), a plan's `addOnIds`
  (add-ons in the same file), an add-on's `grantsPlan` (a plan in the same file)
- an add-on isn't listed in any plan's `addOnIds`
- a file in `data/logos/` isn't a PNG named after a provider or reseller id (`netflix.png`), or the image isn't
  square, is under 32 pixels or is over 100 KB
- a provider's `resellers` name a shop that isn't in `data/resellers.yaml`, quote an approval page off the
  provider's own domain, or give a price whose `sourceUrl` isn't on the shop's website or `domains` (section 4.9)
- a provider's `policies` rate a topic that isn't in `data/policy-topics.yaml`, or one for categories none of its
  plans is in, quote a page its `links` don't list or list one no rating quotes, rate a topic twice for the same
  plans and regions, name a plan that isn't its own, or were read after today (section 4.10); a warning once a
  rating is over a year old
- `includes-subscription` lists the plan itself or its own provider, or makes a loop (Duo → Unlimited → Duo)
- a provider has `billingCurrency`, and a plan or add-on is priced in a region that isn't in it, or has no price
  in the charged currency for that region
- a region in a price, `billingCurrency` or `availableIn` isn't an ISO 3166-1 alpha-2 code, a group (`EU`) or
  `GLOBAL` (`UK` gets "use GB")
- a provider has `availableIn`, and a plan or add-on is priced in a region it doesn't cover (a member state is
  covered by its group, and a group by itself or a member), or it lists `GLOBAL`
- a plan, add-on or bundle repeats a price (the same region, currency, interval and intervalCount)
- a currency in a price or in `billingCurrency` isn't a real ISO 4217 code (`Intl.supportedValuesOf('currency')`;
  the schema only checks that it's three capital letters)
- `lastVerified` is after today

Validation warns (but passes) when `lastVerified` is older than 90 days: one warning per file, with the count and
the oldest price. It also warns about a provider or reseller without a logo in `data/logos/`, which the app shows as
a letter, and about a reseller no provider lists.

A broken file gets its own errors, and the checks that would only repeat them are skipped: a provider that fails
its schema isn't checked against the registry, references to it aren't flagged, and a broken feature definition
isn't used to check plans.

Each message is `file:line path: what's wrong and what to write`, for example
`data/providers/netflix.yaml:73 plans.2.features.video.quality: "8k" isn't a video.quality value (480p, 720p,
1080p, 4k)`. In GitHub Actions each one is also a workflow command (`::error file=…,line=…::`), so it shows as
an annotation on the PR's Files tab. GitHub shows up to 10 errors and 10 warnings per step that way; the log
has all of them.

### 6.3 Build & seed (`scripts/build-catalog.ts` and `scripts/seed-d1.ts`)
`npm run build` runs `npm run data:build` (`build-catalog.ts`) before the web build, so CI builds the catalog on
every PR and Workers Builds on every deploy (section 7.6). The deploy then seeds D1 with `seed-d1.ts`. The logic is
in `packages/core` (`snapshot.ts`, `region-files.ts`, `registry-files.ts`, `seed-sql.ts`); the scripts read and
write the files.
1. Load and validate all YAML the way `data:validate` does (section 6.2). Any error stops the build; warnings are
   only counted.
2. Build the snapshot `{ data, meta }`:
   - `data` is `schemaVersion` plus the source files: features, categories, providers sorted by id (with an
     `iconUrl` when the provider has a logo; without one, the app shows its first letter), bundles sorted by id,
     `data/resellers.yaml`'s resellers sorted by id, each with an `iconUrl` the same way (section 4.9), and
     `data/policy-topics.yaml`'s topics in its order (`policyTopics`, section 4.10). Bundles stay in their source shape: the app computes feature unions and
     savings in core for the user's region, and `GET /bundles` adds them per request (M2.4).
   - `meta` is `catalogVersion` (section 5.1), `generatedAt` (the build time, UTC), every priced region, and
     counts.
3. Write the snapshot files into `apps/web/public/data/` (gitignored), which the Angular build publishes under
   `/data/` and `ng serve` serves too:
   - `catalog.json`, the exact JSON of the snapshot;
   - `catalog/<region>.json` for every priced region except `GLOBAL`: each country, and each group (`EU`), with
     `meta.region` set. These are the `GET /catalog?region=` bodies;
   - `catalog/index.json`: the `catalogVersion`, `generatedAt` and the regions that have a file;
   - `catalog/features.json` and `catalog/categories.json`: the `GET /features` and `GET /categories` bodies
     (`featuresBody` and `categoriesBody`), the snapshot's features and categories in file order with the
     `catalogVersion`. The Worker streams them like the snapshots, so neither route reads D1 (M2.2);
   - `catalog/ids.json`: every provider id with its plan ids (`catalogIds`). The Worker reads it only to suggest an
     id after a 404 or 400 (M2.4), so a typo costs no D1 rows.
4. Convert each provider's and reseller's logo in `data/logos/` to `apps/web/public/icons/<id>.webp`, published as
   `/icons/<id>.webp`: at
   most 96 pixels wide (`catalogIconSize` in core, twice the 48 px the app shows icons at, for high-density
   screens; a smaller logo isn't enlarged), lossy at quality 90 with exact transparency, by `sharp`. At icon sizes
   it looks the same as the PNG: today's five logos went from 54 KB to 10 KB. The PNGs stay the source, held to
   validation's rules. The build never fetches icons: `npm run data:icons` does that once per provider (section
   13.4).
5. The deploy applies the migrations, then runs `seed-d1.ts` (section 7.6). It reads what D1 holds with
   `wrangler d1 execute --json`, writes the statements for what changed to `apps/api/dist/seed.sql` (one per line,
   with the derived columns `monthly_equiv` and `rank_value`, section 5.3) and runs them with
   `wrangler d1 execute --file`, which leaves D1 as it was if a statement fails. It writes nothing when D1 already
   holds the build's catalog.

**A region's file** (`regionSnapshot` in core) keeps every provider, plan, add-on and bundle, each with only the
prices pickPrice can pick for a buyer in that region, whatever their currency: the region's own prices, or else its
group's (`EU` for a Swede), since pickPrice's first rule then always wins. An item priced in neither keeps every
price: rules 2 to 4 can pick any region, depending on the buyer's currency (a Canadian who shows EUR gets a German
EUR price before a US one). A test checks that pickPrice and availability give the same answers from each region's
file as from the full catalog, for every region and currency. The version, build time, `regions` and counts are
the full snapshot's. With today's catalog, `CA.json` drops the US prices of every item that has a Canadian price.
A provider's resellers keep only the prices for that region, a group it belongs to and `GLOBAL`, plus, in a group's
file, its members' (`regionResellers`): `CA.json` has Amazon.ca, ProxyStore and SerialCart, and not the Swedish
shops (section 4.9).

**Which file a buyer gets** (`regionFileFor`): their country's, else their group's (a Swede gets `EU.json` when
Sweden has no prices of its own), else the full `catalog.json`. A country with no prices and no group needs every
price, since any region's can be its fallback, so there is no separate file for "other" countries. A missing
static file is answered with the app's `index.html` (the SPA fallback), so the Worker and the app look the region
up in `index.json` instead of trying a file. The app loads its country's file, plus the file of any other region a
list item was bought in (`ListItem.region`), saved or not yet (a draft's, or the item dialog's Bought in: M6.5), so it
never downloads every region's prices.

**In the app** (`CatalogStore`, M4.3; the choices are core's `catalog-sync.ts`):
- **Kept per file, never merged:** each downloaded file is a `catalogCache` record (section 4.6), and an item's
  prices come from the file that serves its own region (`catalogFor(region)`). The test above already proves that
  file gives the full catalog's answers; a merge would need its own proof, and a simple one changes pickPrice's
  "first region listed" fallback. The files have the same plans, names and features; only the prices differ.
- **On start** the cached files show at once. Then the store fetches `index.json` (revalidated with its ETag, so an
  unchanged catalog costs a 304, section 7.6) and downloads only the files that are missing or of another version
  (`planCatalogSync`), all at the index's version, saved in one transaction that also drops the files no region
  needs any more. A file of another version (a deploy between the two requests), one that fails its schema, or the
  SPA fallback in its place isn't kept, and the cached files stay.
- **Unsaved items' regions:** a page asks for the files its items not saved yet need with `need(regions)`, for as long
  as the page lives (its `DestroyRef`): the list editor for its draft's items, and the item dialog for its Bought in
  (M6.5). Without it a region chosen in the dialog would have no prices until Save, and a check would drop its file.
- **Checks again** when the regions change (the first run, 📍, an item bought elsewhere), on the browser's `online`
  event, when a tab is shown again after an hour (`catalogCheckDue`), and from Settings' [Check for updates] (P13).
  A Web Lock (`navigator.locks`) lets one tab check at a time, so tabs that open together download a new version
  once. There's no timer: the catalog changes at most daily.
- **Before the first run** there's no region, so only `index.json` is fetched; the country's file follows as soon as
  the first-run dialog saves.
- **Offline:** when a request can't reach the server (or takes 30 s), the cached files stay in use and the shell
  shows "Offline — catalog from Oct 22" (the cached file's `generatedAt`), or "Offline — the catalog will load when
  you're back online" on a first visit. A new version replacing the one on screen shows "Catalog updated" in every
  open tab; a first download doesn't. A file that can't be saved (a full disk) is still used in that tab.
- **Not offline on start yet:** without a service worker the browser revalidates `index.html` on every visit, so the
  app keeps working only when the network drops while it's open. M10's service worker makes it start offline
  (section 14).

The cheapest price per feature (what `api-all-example.json` tried to store) is computed on demand with today's
exchange rates instead, so it's never stale.

The catalog will be small (hundreds of plans), so even a full reseed takes seconds. What limits deploys is D1's
100,000 rows written a day, which is why the seed writes only what changed (section 5.3).

### 6.4 Automated price monitoring (nightly)
Runs on the Cloudflare Cron Worker by default, with GitHub Actions as a fallback (section 7.7). The steps are the same either way:
```
Cron trigger (03:00 UTC) → Workflow (one step per provider, automatic retries)
  └─ for each price with a sourceUrl
       ├─ fetch the page (plain fetch first; Browser Rendering only for JS-rendered pages, since the free tier is ~10 browser-min/day)
       ├─ extract the price
       │    1. per-provider extractor if defined (CSS selector / regex in the YAML: `extract:`)
       │    2. otherwise LLM extraction (Workers AI free tier, or the Claude API) given the page text + plan name
       ├─ compare with the YAML value
       └─ on change → update the YAML + lastVerified, then open/refresh ONE PR "Price updates YYYY-MM-DD"
            with a table of the changes and links to the sources (peter-evans/create-pull-request)
     ├─ for a price with taxIncluded: check its quote is still on the page, and look for wording that says the
     │    opposite ("+ tax", "excl. VAT", "taxes calculated at checkout"); either is a change for review
     ├─ reseller prices too (section 4.9), and each reseller's approval: its quotes still on the provider's page;
     │    a reseller no longer named there is a change for review, and a sale price is never taken
     ├─ each region's accepted card networks (section 9.3): its quotes still on its page, else the region's networks
     │    are taken out, for review; a network named beside them that isn't listed is for review too
     on no change → bump lastVerified (batched into the same PR, or skipped to avoid noise)
     on failure  → list it in the PR body as "needs manual check"
```
**Logos** ride along (M8.3): the run fetches each provider's best icon the way `npm run data:icons` does, and when
it differs from the committed `data/logos/<id>.png` (a rebrand), the same PR proposes the new one.

**As built (M8.3)** in `apps/bot`, with section 14 (M8.3) for the details: a step per provider, with the bundles that
cite its pages; Workers AI only for a price whose stored amount isn't on its page; no per-provider `extract:` selectors
(the schema has none); the YAML edited line by line, which CI's `data:validate` then checks; `lastVerified` bumped
for a price confirmed 30 or more days after it was last verified; and a night with nothing to change opens no PR.

**Guardrails**
- **Never auto-merge.** You review the PR, which takes a minute a day at most.
- Flag changes larger than ±30% as suspicious.
- Pricing pages differ by region and currency. Fetch with Canadian locale headers, and add a proxy only if a site needs one.
- Respect each site's robots.txt and terms. Make one polite request per URL per night.
- A plan whose `lastVerified` is more than 90 days old shows a small "price may be out of date" badge in the app.

### 6.5 Filling the catalog without picking URLs by hand
The goal: you give the pipeline **service names** (or not even that), and it finds the pages, extracts the
plans and opens PRs. **Your only manual step is reviewing PRs.**

```
 ① Discover services ─► ② Find URLs ─► ③ Render pages ─► ④ AI extraction ─► ⑤ Validate ─► ⑥ PR for review
   (names + websites)    (pricing,      (Playwright,      (structured JSON     (Zod +          (batches of
                          cancel, help)  en-CA locale)     against registry)    sanity checks)   ~10 providers)
```

**① Discover services:** `scripts/discover-services.ts` writes `data/queue.yaml` (name, website, category, status).
- **Wikidata** (free, CC0 licensed): a SPARQL query for instances of streaming service, VPN service,
  password manager, cloud storage service, antivirus software, video-game subscription service and so on,
  with their **official website (P856)**. This gives hundreds of services and their domains with no hand-picking.
- Your own list (`subscriptions.txt`) and category "top lists" go to the front of the queue.
- **Demand signal (later):** opt-in anonymous "suggest this service" reports from custom subscriptions raise a
  service's priority.

**② Find URLs automatically:** `scripts/find-urls.ts`. For each website, it tries these in order and stops at
the first strong match:
1. Common paths: `/pricing`, `/plans`, `/premium`, `/subscribe`, `/compare`, `/en-ca/pricing`, `/ca/plans`.
2. `sitemap.xml` / `robots.txt` sitemaps: URLs containing `pricing|plans|subscribe|compare|premium`.
3. The homepage's nav and footer links whose text matches "Pricing", "Plans", "Get started" and so on.
4. A search API as a last resort, querying "`<name>` plans pricing Canada" and
   "how to cancel `<name>` subscription" (the Brave Search API or similar; check current free-tier limits).

The cancel page comes from the same steps, using help-centre paths and searches. Each URL is scored by an LLM
check ("is this a pricing page for X?"). The discovered URLs are saved in the provider YAML (`sources:`), so the
nightly price check reuses them. **You never type them.**

The provider's **official reseller page** comes from the same steps (paths and links such as `resellers`,
`partners`, "Where to buy"; Mullvad's is `/en/help/partnerships-and-resellers`), and so do its **blog and news
posts** on every site it runs, searched for "reseller", "partnered" and "voucher": Proton names its resellers only
in a Proton VPN blog post (M1.15). Only the shops it names as selling
the provider's own subscription become resellers (section 4.9); partners that run their own product on the
provider's service don't. Each shop's product pages are then read like a pricing page, for regular prices only (M3.7).

Every run also collects, for every provider (M1.12), whether or not it's new or only being re-checked:
- its **bundle pages**: the subscribe page's bundle cards, the help centre's bundle articles, partners' landing pages
  and a search for "`<name>` bundle";
- its **terms of service, privacy policy** and the other policies the footer links (refunds, cookies, household or
  sharing rules), from footer links whose text matches "Terms", "Privacy" and "Legal", and `/terms`, `/privacy`,
  `/legal`. Extraction reads them for what pricing pages leave out: where it's sold, billing periods,
  auto-renewal, refunds, notice of price changes, and limits on streams, devices and downloads.

A provider file's header comment says what each check found, "none" included, so a PR's reviewer can tell a check
that found nothing from one that wasn't done.

**③ Render:** Playwright (free on GitHub Actions) loads each page with `en-CA` locale headers, waits for prices
to render, clicks visible "Monthly/Annual" toggles, and saves the visible text plus a screenshot as evidence.
- **Region gotcha:** many sites price by IP address, and GitHub runners are in the US. For Canadian prices,
  either run discovery **from your own PC** (`npm run data:discover`, the simplest option since you're in
  Canada) or use the site's region URL or selector. Many services also publish per-country price pages in
  their help centre (Netflix does), which are ideal sources for multi-region data.

**④ AI extraction:** `scripts/extract-plans.ts` sends the cleaned page text to an LLM with **structured
output** constrained to the provider schema. The prompt includes the feature registry, so the model can only
use canonical ids, and it maps provider wording through `aliases`. The output contains:
- plans, prices (amount, currency, interval), add-ons, perks. Personal and family plans only, free tiers
  included as $0 prices; business and per-seat plans are skipped (section 1.3)
- the **regular** price, not a first-term offer, and the billing period as stated ("every 30 days" is `day` × 30,
  not `month`), both from the terms or checkout wording (section 4.3)
- `availableIn`, only when the provider publishes the countries it sells in (section 4.7)
- each plan's sign-up `link` and the provider's `cancelUrl` (its cancel page or help article), which the schema
  requires
- a plan's `categories` when it's in other service categories than its provider's (a suite's VPN plan)
- **accepted card networks** for each region the page covers (from the checkout or help page, for example "We
  accept Visa, Mastercard, Amex"), with the page's URL on the provider's own site and its words quoted, each network
  named in them (`acceptedNetworks`, M9.2); none when no page names them ("all major credit cards" names none),
  and the billing currency
- an **evidence quote** for every price and feature (shown in the PR, so review is fast)
- whether the prices **include tax** for every buyer ("Including VAT", "taxes included"), as `taxIncluded` with
  the page's words as its quote; without such wording, Canadian and US prices are taken as before tax (section 4.8)
- `proposedFeatures`: capabilities that don't match the registry, for you to approve. Once approved they're
  added to `features.yaml` and reused for every later provider.

Model choice: the Workers AI free daily allowance, or a small Claude model (`claude-haiku-5-5`), which costs
cents per provider. Check current pricing. One run fills hundreds of providers.

**⑤ Validate:** the same `validate-data.ts` rules (section 6.2), plus checks for missing prices, implausible
amounts and duplicate plans.

**⑥ Review:** a PR per batch with a table (provider, plans, prices, evidence links, screenshots, warnings), and
each new provider's logo, fetched into `data/logos/<id>.png` the way `npm run data:icons` does (M3.5). You merge,
fix or close. Rejected items are marked in `queue.yaml` so they aren't retried every night.

**Ongoing:** the nightly price check (section 6.4) reuses the saved `sources:` URLs. A weekly job takes the next
N services from the queue, so the catalog grows on its own while you only review.

**Licensing & etiquette:** store facts (prices, feature flags) and links, never copied marketing text. Follow
robots.txt, make one request per page per run, and send an identifying User-Agent. Logos come from favicons
or a manual override, not scraped images.

**Manual fallbacks still exist:** copy a YAML file, or run `npm run data:draft -- <url-or-name>` for one provider.

### 6.6 First seed (Phase 1)
Run the pipeline on your own services first (`subscriptions.txt`), all in CAD, to tune the prompts. Then add
the Wikidata queue:
- Bitdefender (Premium Security, Family, Digital Identity Protection, the free plan)
- Proton (Free, Mail Plus, Drive Plus, VPN Plus, Pass Plus, and the Unlimited, Duo and Family suites)
- Xbox Game Pass (PC, Standard, Ultimate)
- Crunchyroll (Fan, Mega Fan, Ultimate Fan)
- Claude (Free, Pro, Max)
- Netflix, Disney+ and Crave, plus a Crave + Disney+ bundle, so the streaming wireframes have real data

---

## 7. Hosting & deployment on Cloudflare

### 7.1 Cost
| Item | Free allowance (verify at setup) | Our expected use |
|---|---|---|
| Workers requests | ~100,000 per day | API calls only: a few hundred per day at first |
| Static assets | Free and unlimited. Up to 20,000 files per version, 25 MiB per file | The Angular build has well under 100 files |
| D1 | 5 GB storage per account (500 MB per database), 5M rows read and 100k rows written per day (index entries count), 2 MB per row | Under 25 MB even at 1,000 providers. **Rows written** is the one to watch: from M2.1 a deploy writes only what changed (section 5.3) |
| KV | 1 GB, 100k reads and 1k writes per day, 25 MiB per value | One namespace, `simply-sub-kv` (binding `KV`, M2.5), for small values that must survive: the last good `/fx` rates (M2.5: one key, `fx:ecb`, written when the rates are fetched, about twice a day) and the `/icon` cache (M2.6: one key per domain asked for, written on a miss and kept 30 days, or a day for "no icon"). The Cache API is per data centre and can evict them. A few dozen writes a day |
| R2 | 10 GB-month storage, 1M writes and 10M reads per month, no egress fees. Activating R2 asks for a payment method, even within the free tier | Not used yet: see the triggers below |

**Each store has one job:** static files serve the catalog and icons, D1 answers the API's searches, KV keeps
small values that must survive, and R2 will hold large files. Using a store outside its job gains nothing: KV
values and static files have the same 25 MiB cap, and KV allows far fewer writes.
- **Setting one up:** create the KV namespace (or the R2 bucket) in the dashboard or with `wrangler` (section 7.2;
  `simply-sub-kv` was made with `wrangler kv namespace create`), and its id goes in `wrangler.jsonc`, like D1's. Wrangler can create resources on deploy (an open beta), but an id in the config is
  reviewable, and a branch preview can't create one by accident. The Workers Builds token already has KV and R2
  permissions (section 7.6). Tests need no account: miniflare simulates KV and R2.
- **When R2 starts to pay off** (none of these is close):
  - Phase 5's encrypted sync blobs and calendar feeds.
  - The full `catalog.json` nearing the 25 MiB static-file cap: about 4,000 providers at today's ~6 KB each,
    sooner with many regions. The per-region files the app loads stay far smaller.
  - Static files nearing 20,000 per deploy: icons are one file per provider, so about 19,000 providers.
- **D1 rows read** count every row a query scans, not just the rows returned (5M a day). `GET /providers` (M2.3)
  reads the `catalog` row, then the providers that can match in one batch: every one when nothing narrows them, or
  through the `plan_features (feature_id, rank_value)` index for each rank key (EXPLAIN QUERY PLAN shows no table
  scan, `apps/api/test/providers.spec.ts`). Measured at 5 providers: 6 rows with no filter or a category, 17 for
  `feature=video.quality=4k`, 31 for two keys. A key costs about twice the rows of the plans that have its feature,
  so it grows with them, not with the catalog. A text search reads every provider, which core matches in the
  Worker: at about 200 providers that nears 10 ms of CPU and 200 rows a request, the trigger for an FTS5 table, a
  category index and per-region price rows (a migration and a `seedFormat` bump). The edge cache (M2.8) absorbs
  repeated searches. `GET /providers/:id`, `GET /plans/:id` and `GET /bundles` (M2.4) look up only by primary key and
  the `bundle_plans (plan_id)` index, so their cost doesn't grow with the catalog: 2 rows for a provider, 3 for
  Disney+ Premium's plan, 11 for the bundles of one plan (D1 counts about two rows per lookup,
  `apps/api/test/lookups.spec.ts`). A 304 reads the `catalog` row alone, and a typo's suggestion comes from the
  static `ids.json`.
| GitHub Actions | Free for public repos, 2,000 min/month for private | CI plus a nightly check, around 300 min/month |
| Domain | **simplely.ca**, already bought through Cloudflare Registrar, which renews at cost | The only real expense |
| Workers Builds | ~3,000 build minutes/month, 1 concurrent build | A few minutes per deploy |
| Browser Rendering | 10 browser-minutes a day, 3 concurrent browsers, a new one every 20 s, 60 s timeout (confirmed 2026-10-28) | Only pages a plain fetch gets nothing from, at most 5 a night (M8.3) |
| Workers AI | 10,000 Neurons a day, reset at 00:00 UTC (confirmed 2026-10-28) | Prices whose stored amount isn't on their page: Llama 3.3 70B in JSON mode, at most 8,000 Neurons a night (M8.3) |
| Cron Triggers / Workflows | Included in Workers free. Workflows on the free plan (confirmed 2026-10-28): 10 ms of CPU and 50 requests out per step, 1,024 steps, 100 concurrent instances, 100,000 executions a day shared with Workers, 1 MiB per step result, 3 days' retention | One nightly run, a step per provider (M8.3) |
| If you outgrow it | Workers Paid at $5/mo for 10M requests | Still under the $10/mo goal |

> **Free-tier gotcha:** requests that invoke the Worker get an HTTP 429 once the daily limit is used up. That's why
> `run_worker_first` is limited to `/api/*`, so the app itself keeps loading even if the API quota runs out.

### 7.2 One-time setup
1. **Accounts:** create a Cloudflare account and a GitHub repo (`simply-sub`).
2. **Domain:** ✅ `simplely.ca` was bought through Cloudflare Registrar, so the zone already exists with
   Cloudflare DNS and SSL. Nothing more to do here. Turn on *Auto-renew* in the dashboard, and turn on
   DNSSEC if it isn't on already.
3. **Tooling:**
   ```bash
   volta install node@24.22.1 npm@12.0.2
   npm i -g @angular/cli@22.2.4        # or use npx
   npm i -D wrangler -w apps/api       # Wrangler stays per-project
   npx wrangler login
   ```
4. **Scaffold:**
   ```bash
   mkdir simply-sub && cd simply-sub && npm init -y
   volta pin node@24.22.1 npm@12.0.2
   npx @angular/cli@22.2.4 new web --directory apps/web --style=scss --routing --ssr=false
   npm create cloudflare@latest apps/api -- --type=hello-world --lang=ts   # then add hono
   mkdir -p packages/core/src data/providers data/bundles scripts
   ```
5. **D1:**
   ```bash
   npx wrangler d1 create simply-sub-catalog --location enam   # ✅ done in M0.8; the id is in wrangler.jsonc
   npx wrangler d1 migrations apply simply-sub-catalog --remote   # ✅ M0.8: applies migrations/0001_init.sql
   ```
6. **KV:**
   ```bash
   npx wrangler kv namespace create simply-sub-kv   # ✅ done in M2.5; the id is in wrangler.jsonc (binding KV)
   ```
7. **No Cloudflare token in GitHub.** Workers Builds deploys with a token Cloudflare keeps (section 7.6), and
   GitHub's CI only checks code, so the repo has no Cloudflare secrets. The bot's GitHub token (M8.3) is a
   Worker secret on the Cloudflare side.
8. **The bot** (M8.3): ✅ deployed on 2026-10-28 by the owner, with its `GITHUB_TOKEN` secret, a fine-grained token
   for this repository only (Contents and Pull requests, read and write). Workers Builds doesn't deploy it (it isn't
   connected to it), so a change to `apps/bot` reaches Cloudflare only by `npx wrangler deploy` in `apps/bot`, from
   `main` once the change has merged. When the token expires, a new one replaces it with
   `npx wrangler secret put GITHUB_TOKEN` (the value typed at its prompt, never on the command line), with no
   redeploy: the next night uses it.

### 7.3 Serving the app from `sub.simplely.ca`
The app and the API have the subdomain to themselves: **https://sub.simplely.ca/** for the app, and
**https://sub.simplely.ca/api/v1/** for the API, both from the one Worker.
- **Why a subdomain:** browser storage (IndexedDB, localStorage) belongs to an origin (scheme, host and port), never
  to a path. When the app lived at `simplely.ca/simply/sub/` (M0.3 to the pre-M2 review), any other app on
  `simplely.ca`, or a script-injection bug in one, could read every user's lists. OWASP's advice is one application
  per origin (section 11.5). Moving cost nothing then, since nobody had data saved; moving after launch would
  strand every user's data on the old origin.
- **How it's served:** the Angular build uses the default `<base href="/">`, and `npm -w apps/api run build`
  (`scripts/copy-web-build.mjs`) copies `apps/web/dist/web/browser/*` into `apps/api/public/`, keeping the tracked
  `_headers`. It refuses a development build: only a production build names its bundle with a hash
  (`main-6XMYCLII.js`).
- Unknown paths get `public/index.html` (`not_found_handling: single-page-application`), so deep links such as
  `/lists/abc` render and survive a reload without invoking the Worker. Checked with `wrangler dev`: `/`, a deep
  link, `/data/catalog.json`, `/icons/netflix.webp` and `/api/v1/health` all answer, and the old `/api/sub/v1/`
  path is a 404.

### 7.4 `apps/api/wrangler.jsonc` (sketch)
```jsonc
{
  "name": "simply-sub",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]          // only API paths invoke the Worker
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "simply-sub-catalog", "database_id": "<from step 5>",
      "migrations_dir": "migrations" }
  ],
  "routes": [{ "pattern": "sub.simplely.ca", "custom_domain": true }],
  "observability": { "enabled": true }
}
```
A **custom domain** sends every path on `sub.simplely.ca` to this Worker, and the deploy creates the DNS record and
the certificate. The rest of `simplely.ca` (the root and other future apps, each on its own subdomain) stays free
for other Workers or Pages projects.

The real file grows with the tasks: M0.7 has `assets` and `observability` only, M0.8 adds `d1_databases`, and
M0.9 adds `routes` with `workers_dev: false` and `preview_urls: true` (section 7.6), so the config never names an
account resource before it exists. The pre-M2 review replaced M0.9's two `simplely.ca` path routes with the custom
domain. `apps/api/wrangler.jsonc` is the current version. `npm -w apps/api run build`
ends with `wrangler deploy --dry-run`, which bundles the Worker without logging in or deploying.

### 7.5 Local development
- Terminal 1: `npm run dev:api` (`wrangler dev`, port 8787, with a local D1). Seed it with `npm run data:build`,
  then `npm -w apps/api run db:seed:local` (the migrations, then `seed-d1.ts --local`; add `-- --full` to replace
  everything). It also serves the last production build of the app at http://localhost:8787/ (run
  `npm run build` first to refresh it), and the API at http://localhost:8787/api/v1/.
- Terminal 2: `npm run dev:web` (`ng serve` with `apps/web/proxy.conf.json`):
  ```json
  { "/api": { "target": "http://localhost:8787", "secure": false } }
  ```

### 7.6 CI/CD (Workers Builds)
Connected in M0.9 (*Workers & Pages → Create → Import a repository*; later changes go in *simply-sub →
Settings → Build*). The settings as they are now:

| Setting | Value |
|---|---|
| Worker name | `simply-sub` (must match `name` in `wrangler.jsonc`) |
| Production branch | `main` |
| Root directory | `apps/api` |
| Build command | `cd ../.. && npm ci && npm run build` |
| Deploy command | `npm run deploy` (since M2.1): `apps/api/package.json` runs `db:seed:remote` (the migrations, then `seed-d1.ts --remote`) and then `wrangler deploy`. From M1.5 it was `npx wrangler d1 migrations apply simply-sub-catalog --remote && npx wrangler d1 execute simply-sub-catalog --remote --file dist/seed.sql && npx wrangler deploy`, and before that `npx wrangler deploy` |
| Preview (non-production branch) command | `npx wrangler versions upload`: a preview link on workers.dev, production untouched |
| Build variable | `NODE_VERSION` = `24.22.1` (since 2026-10-26; it was 24.19.0, and the image defaults to 24.18.0). It must match the root `package.json`'s `volta` pin, which CI reads too. The first build detected Node 24.19.0 and npm 12.0.2 (from `packageManager`); npm 10.9.2 would also install our lockfile cleanly |
| API token | `simply-sub-builds`, created by Workers Builds: Workers scripts, KV, R2, **D1 (edit)**, routes on the zone, and a few unused products. Cloudflare keeps it; it's never in GitHub |

- **The deploy seeds D1 first:** `npm run deploy` applies any new migrations, writes only what changed to D1
  (section 6.3) and only then deploys, so a failing seed stops the deploy. Its steps live in `apps/api/package.json`,
  so a change to them is reviewed in a PR and never has to be made in the dashboard at the moment of a merge. The
  build command needs no change, because `npm run build` runs `data:build`. The build token already has D1 edit.
  Preview builds never touch D1, since they share the production database; a preview of a change that needs a new
  migration can fail on D1 queries until it's merged.
- **Rolling out M2.1:** with the PR green, change the deploy command to `npm run deploy` and merge straight away
  (a push to `main` in between would fail on the missing script before touching D1 or the Worker). The merge's
  deploy applies 0002, which empties D1, finds no `catalog` row and seeds in full, then deploys. A second deploy of
  the same commit (*Retry build*) should log `already holds catalog …: nothing to write`.
- **Domain:** the custom domain `sub.simplely.ca` (section 7.3), whose DNS record and certificate the deploy
  creates. From M0.9 until the pre-M2 review the Worker had two path routes on `simplely.ca` instead, which is why
  the zone still has a placeholder `AAAA @ 100::` record (proxied): routes only fire for a proxied hostname. Nothing
  serves the rest of `simplely.ca`. If a deploy can't create the custom domain (the token lacks a permission), add
  it by hand: *simply-sub → Settings → Domains & Routes → Add → Custom domain*.
- `workers_dev: false` and `preview_urls: true`: production is only on sub.simplely.ca, and branch builds still get
  a (public, unguessable) preview link. *Protect with Cloudflare Access* is off; turn it on to put a login in
  front of preview links (needs Zero Trust).
- Before running the build command, Workers Builds also runs its own `npm clean-install` in `apps/api`. It's
  redundant (about 7 s) but harmless.
- **Cloudflare Web Analytics** stays on (decided in M0.9). Cloudflare injects its beacon
  (`static.cloudflareinsights.com/beacon.min.js`) into HTML pages requested by browsers. It uses no cookies and
  sends only page views and timings, never anything from IndexedDB. The beacon is a module script from
  `static.cloudflareinsights.com`, and it reports to `/cdn-cgi/rum` on the site itself (or to
  `cloudflareinsights.com`), which the CSP allows (M2.8). Content blockers stop it, which is harmless.
- Workers Builds deploys straight from `main`; it doesn't wait for GitHub checks. Branch protection (M0.10) is
  what keeps a failing change off `main`.
- A small GitHub Actions `.github/workflows/ci.yml` (M0.10) runs `npm audit --audit-level=high`, lint, the Prettier check, the generated JSON
  Schema check (`data:schema -- --check`, M1.1), the catalog checks (`data:validate`, M1.4), tests and the build
  as the required **PR check** `ci`, because that's what blocks merging a bad
  change. Actions are free for public repos. It has a read-only token and no secrets, runs on `pull_request`
  (fork PRs get nothing), and pins its actions to commit SHAs.
- **`main` is protected** by a GitHub ruleset with no bypass, not even for the admin: changes arrive only through
  a pull request, `ci` must pass on a branch that's up to date with `main`, and force pushes and deletion are
  blocked. No approval is required (one developer). The repo allows only squash merges and deletes merged
  branches.
- **`_headers` (M2.8):** a tracked `apps/api/public/_headers` file for the static files (the Worker's own answers
  set theirs in code, section 5.4), checked by `apps/api/test/static-headers.spec.ts`:
  - a strict Content-Security-Policy:
    - `default-src 'self'`; `script-src 'self'`, the inline theme script's SHA-256 and the Web Analytics beacon's
      host; `connect-src 'self' https://cloudflareinsights.com` for its reports;
    - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'none'`;
    - **Trusted Types**: `require-trusted-types-for 'script'` with Angular's policies
      (`trusted-types angular angular#bundler`), so no string can reach a script sink. Zod would otherwise test
      for `new Function` (a sink) to compile its parsers, so `apps/web/src/zod-setup.ts`, the app's first import,
      turns that off (`jitless`) through the global Zod reads, keeping Zod out of the first bundle; a test checks
      Zod still reads it;
    - the inline theme script in `apps/web/src/index.html` stays inline (no extra request before the first paint):
      the build keeps it byte for byte, and the test recomputes its hash, so changing the script without updating
      `_headers` fails with the new hash. Angular's `autoCsp` was ruled out: its `strict-dynamic` would block the
      beacon, which Cloudflare inserts into the HTML;
    - `style-src 'self' 'unsafe-inline'`: Angular and Material add component styles at run time, and a static
      `index.html` can't carry a per-request nonce. Scripts, the real risk, stay strict;
  - `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and `Cross-Origin-Opener-Policy: same-origin`;
  - caching. The app's hashed files (`main-*.js`, `chunk-*.js`, `styles-*.css`, `media/*`) are immutable for a year.
    Icons (`/icons/*`) get one day and are then revalidated, because their URLs carry no version and a replaced logo
    must show up. `index.html` and the catalog files keep the default, revalidated on every visit: Cloudflare sends
    `Cache-Control: public, max-age=0, must-revalidate` with an ETag and answers `If-None-Match` with a 304 (checked
    on 2026-10-26), which is what makes the app's catalog check cheap (section 6.3).
  - Checked in Edge on the production build under `wrangler dev` (which applies `_headers`): every page, in-app
    navigation, both themes, the drawer and the error snackbar run with no CSP or Trusted Types violations, and
    the beacon, inserted the way Cloudflare does, loads and sends its report.

### 7.7 Where automation runs: Cloudflare vs GitHub
| Job | Cloudflare option | GitHub option | **Choice** |
|---|---|---|---|
| Deploy on push | Workers Builds | Actions + `wrangler-action` | **Cloudflare**: native, no API token in GitHub |
| PR checks (lint, tests, data validation) | Workers Builds previews (no merge blocking) | Actions required checks | **GitHub**: needed to block bad merges |
| Nightly price check | Cron Trigger → **Workflows** (durable steps, retries) + `fetch` + Browser Rendering + Workers AI | Actions cron + Playwright | **Cloudflare**: always on, no runner minutes, AI built in |
| Opening update PRs | Worker calls the GitHub REST API with a fine-grained token (`contents:write`, `pull_requests:write`) saved as a Worker secret | `create-pull-request` action | **Cloudflare** (it's the same API call) |
| Big discovery batches (hundreds of pages, browser-heavy) | Browser Rendering free tier (~10 min/day) is too small | Actions + Playwright (free minutes) | **Your PC** (Canadian IP, unlimited) or Actions |

**The catalog stays in Git either way.** The Cloudflare bot only *proposes* changes as PRs. The bot is a second
Worker (`apps/bot/`) with its own `wrangler.jsonc` (cron `0 3 * * *`, Workflows, AI and Browser bindings, and a
read binding to the catalog D1 to know the current prices).

**Region caveat:** you can't choose which country a Cloudflare request comes from, so geo-priced sites may show
non-Canadian prices. Prefer pages that state the region in the URL, or fixed per-country help pages. The bot
flags currency mismatches instead of trusting them.

**Alternative (not chosen for now):** move the source of truth into D1 with a small admin review page. That
means no Git round-trip, but it's more to build and secure, and you lose free history and diffs. Reconsider if
PR volume gets annoying.

### 7.8 Hosting comparison: Cloudflare vs GitHub vs Fly.io
**First, the key distinction: GitHub cannot host a live API.** GitHub offers *storage* (repo), *static files*
(GitHub Pages) and *scheduled jobs* (Actions), but no server that answers requests with logic. So the real
question is "which platform runs the API", and each platform gets the jobs it's best at.

| | **Cloudflare Workers + D1** | **Fly.io** | **GitHub** |
|---|---|---|---|
| What it is | Serverless functions at the edge + SQLite DB | Your app in a Docker container on a small VM | Git hosting, Pages (static), Actions (CI/cron) |
| Can run a live API? | ✅ | ✅ | ❌ (static JSON on Pages only) |
| Cost for this project | **$0** (free tier is far above our needs) | ~**$2–5/mo** minimum. No free tier for new accounts since 2024; trial only | $0 (public repo) |
| Domain fit | ✅ `simplely.ca` is already on Cloudflare; a custom domain (`sub.simplely.ca`) is one config line | Needs DNS records + certificate on Fly, and can't share `simplely.ca` paths with the app without a proxy | Pages wants its own (sub)domain; path sharing needs a Cloudflare proxy anyway |
| Server upkeep | None: no OS, no memory sizing, no restarts | You own the container: Node updates, memory limits, health checks, auto-stop/cold starts | None |
| Global speed | Runs in 300+ cities, close to every user | One region unless you pay for more machines | CDN for static files |
| Runtime | Workers runtime (web-standard APIs + `nodejs_compat`). Most npm packages work, but not everything Node can do; short CPU time per request (~10 ms free) | **Full Node.js**: any package, long-running processes, websockets, Playwright, background jobs | Actions: full Linux VM for jobs up to 6 h |
| Database | D1 (SQLite) free, KV, R2 | Any (SQLite on a volume, Postgres ~$38/mo managed) | none (files in the repo) |
| Scheduled jobs | Cron Triggers + Workflows (free) | Machines on a schedule (paid runtime) | Actions cron (free for public repos) |
| Headless browser | Browser Rendering, ~10 min/day free | Run Playwright yourself (needs ~1 GB RAM machine, ~$5+/mo) | Playwright in Actions, free minutes |
| Lock-in | Medium (Workers API), but Hono runs on Node/Bun/Deno too | Low (it's just Docker) | Low |

**Why you'd pick each one**
- **Cloudflare.** For a *read-only catalog API* that has to be free, fast and maintenance-free, and live on the
  same domain as the app. Our API does small, quick lookups on data that rarely changes, which is exactly
  the workload Workers are built for.
- **Fly.io.** When you need a *real server*: long-running processes, websockets, heavy libraries, background
  queues, a big Postgres database, or code that doesn't fit the Workers runtime. It's great for "run my Node app
  as-is", but you pay monthly and you maintain the container.
- **GitHub.** As the *source of truth and the review gate*: the repo, the PRs, required checks that block bad
  catalog changes, and free Linux runners for heavy one-off jobs. It's not a host for this API.

**Decision**
| Job | Platform | Reason |
|---|---|---|
| Web app + catalog API | **Cloudflare** | Free, same domain, no servers, fast everywhere |
| Nightly price check bot | **Cloudflare** | Cron + Workflows + Workers AI, all free |
| Repo, PRs, required checks | **GitHub** | Only GitHub can block merges; Actions free for public repos |
| Heavy discovery batches | **Your PC** (or GitHub Actions) | Unlimited Playwright, Canadian IP, free |
| Fly.io | **Not used** | It costs money and needs upkeep, and nothing in this design needs a long-running server |

**When to revisit Fly.io:** if a future feature needs a long-running server (for example real-time sync over
websockets, a heavy headless-browser farm, or a large relational database with complex queries), add a
small Fly app *for that piece only* and keep the rest on Cloudflare. Hono code moves over with almost no changes.

**Cost tip:** the `/catalog` snapshot is prebuilt during deploy. It can be served as a **static asset**
(for example `/data/catalog.json`, which is free and has no request cap) instead of going through the
Worker. The Worker quota is then spent only on search and detail endpoints.

---

## 8. Pages & UI

> Detailed specs for every page (layouts, behaviour, states, acceptance criteria), including the pages not in Figma
> yet, are in **PROJECT-PLAN.md §5**. This section keeps the theme, the budget rules and a summary.

### 8.1 Layout & theme
- **Shell:** a fixed left sidebar (logo, Home, Lists, Payment, Features, Calendar, then Search, with the settings
  cog and theme toggle at the bottom) and a main content area. The active nav item gets an underline in the
  accent colour. On narrow screens the sidebar collapses into a drawer.
- **Theme tokens.** These are CSS custom properties fed into the Material 3 theme. The suggested palette below
  keeps your colours and fixes readability.
  - **The problem:** neon yellow, cyan and green text on `#D9D9D9` grey is very hard to read (roughly 1.1–1.5:1
    contrast; WCAG asks for at least 4.5:1).
  - **The fix:** each rank gets two shades. A **vivid fill** (close to your originals) is used for dots, chips
    and bar segments, with a dark or light label. A **text shade** is used when the colour itself is text.
    Dark mode keeps the vivid colours, which read well on dark backgrounds.
  - **Lighter background:** a slightly lighter app background (`#E4E4E4`) with **white cards** gives more contrast
    and depth than grey cards on grey.

  ```scss
  :root {                                   /* light */
    --ss-accent: #6E062E;                   /* unchanged: buttons, active nav, logo pill */
    --ss-accent-hover: oklch(from var(--ss-accent) calc(l + 0.06) c h);  /* derived */
    --ss-accent-text: var(--ss-accent);     /* accent as TEXT/underline (12:1 on white) */
    --ss-on-accent: #FFFFFF;
    --ss-text: #111111;  --ss-text-muted: #5F5F5F;
    --ss-sidebar-bg: #FFFFFF;  --ss-app-bg: #E4E4E4;  --ss-card-bg: #FFFFFF;  --ss-divider: #D0D0D0;

    /*            vivid fill (dots/chips/bars)    text shade (≥4.5:1 on white)  */
    --rank-essential: #CC00FF;  --rank-essential-text: #9B00C2;
    --rank-critical:  #4D6BFF;  --rank-critical-text:  #2E4BD9;
    --rank-needed:    #00D5EA;  --rank-needed-text:    #00737F;
    --rank-wanted:    #2EE62E;  --rank-wanted-text:    #1B7A1B;
    --rank-uses:      #FFE600;  --rank-uses-text:      #7A6500;
    --rank-sometimes: #FFB200;  --rank-sometimes-text: #8F5A00;
    --rank-unused:    #FF7700;  --rank-unused-text:    #B34700;
    --rank-unwanted:  #FF1A1A;  --rank-unwanted-text:  #C40000;
    --rank-none:      #BDBDBD;  --rank-none-text:      #6B6B6B;

    --budget-ok: var(--rank-wanted);  --budget-warn: var(--rank-sometimes);  --budget-over: var(--rank-unwanted);  --budget-track: var(--rank-none);
    --budget-label: #111111;                 /* the label on every fill and on the track, in both themes (M4.5) */
    --ss-danger: var(--rank-unwanted-text);  --ss-on-danger: var(--ss-on-accent);  /* ss-confirm's danger button */
    --ss-dot-ring: oklch(from var(--ss-text) l c h / 0.3);  /* a faint ring that keeps pale dots visible */
    --ss-state-tint: oklch(from var(--ss-text) l c h / 0.05);  --ss-state-hover: oklch(from var(--ss-text) l c h / 0.1);  /* a plain control drawn as a bar, at rest and hovered: a card's Hide details (M5.7) */
    --policy-great: var(--rank-wanted);  --policy-good: #B5E61D;  --policy-neutral: var(--rank-uses);  --policy-poor: var(--rank-unused);  --policy-bad: var(--rank-unwanted);  /* Terms and policies' grade dots, green to red, with --ss-dot-ring round them and the grade's name beside the topic (M1.13, M1.14, M5.9) */
    --ss-icon-tile: #FFFFFF;                 /* behind logos in both themes: sites draw icons for white (M5.2) */
  }
  [data-theme='dark'] {
    --ss-accent-text: oklch(from var(--ss-accent) 0.76 calc(c * 1.15) h);  /* ≈ #FF83A0: readable on dark, follows the accent hue */
    --ss-text: #F2F2F2;  --ss-text-muted: #A8A8A8;
    --ss-sidebar-bg: #000000;  --ss-app-bg: #2B2B2B;  --ss-card-bg: #3A3A3A;  --ss-divider: #555555;
    /* text shades = vivid fills on dark, lightened where needed to reach 4.5:1 on dark cards */
    --rank-essential-text: #DF7DFF;  --rank-critical-text: #93A6FF;  --rank-needed-text: #00EAFF;  --rank-wanted-text: #5CFF5C;
    --rank-uses-text: #FFF000;  --rank-sometimes-text: var(--rank-sometimes);  --rank-unused-text: #FF8C33;
    --rank-unwanted-text: #FF7E7E;  --rank-none-text: #A5A5A5;
    --ss-on-danger: var(--ss-app-bg);  /* the danger fill is the light unwanted shade here, so its label is dark */
    /* the accent fill, --ss-on-accent, the vivid rank fills and the budget colours are inherited from :root on purpose */
  }
  ```
  **Contrast (checked in M0.4, WCAG 2 ratios).** Body, muted and accent text pass AA on every background in both
  themes, as do white on the accent and the `#111` label on every budget fill. Three dark rank text shades failed
  on dark cards (essential 3.95, unwanted 3.76, none 4.25) and were lightened to the values above (about 4.6:1).
  Critical was added later (2026-10-23): its text shades are 6.7:1 on white and 4.95:1 on dark cards.
  The derived accent shades were rechecked when they replaced the hex values: the dark accent text is 4.9:1 on
  dark cards and 9:1 on the sidebar, and the hover keeps the old value's 9.6:1 on white.
  M4.5 checked the budget label (`#111`): 11.2:1 on the ok fill, 10.5:1 on warn, 4.87:1 on over and 10.1:1 on the
  track. The danger button's label is 6.3:1 (white on `#C40000`) and 5.8:1 in dark mode (the app background on
  `#FF7E7E`).
  The dark divider was `#393939`, the dark card's own colour, so borders on cards vanished; `#555555` is 1.5:1 on dark
  cards, as the light divider is on white (2026-10-26).
  Usage rules that follow from the check:
  - Light rank **text** shades reach 4.5:1 on white cards but not on the grey app background (4.2–4.5), so put
    rank text on cards.
  - Most vivid fills are under 3:1 against white, and budget fills against the track. That is acceptable only
    because the colour is never the only cue: rank chips always show the name, and budget bars show a label.
  - In dark mode the accent **fill** barely differs from the app background (1.2:1). Buttons stay identifiable by
    their white label, but don't use the accent fill alone to mark state there; use `--ss-accent-text`.
  - Keyboard focus is a 2px ring in `--ss-accent-text`: Material's strong focus indicators (in
    `_material-theme.scss`) and the same outline on custom links. Material's default focus state layer is too
    faint for the 3:1 contrast that focus indicators need.
  - Form fields are outlined (`<mat-form-field appearance="outline">`, M4.2), so labels, hints and suffixes sit on
    the card colour, where the token contrasts above hold. The filled appearance sits on Material's
    `surface-variant`, an unmapped palette colour, and its labels fail contrast on it in dark mode. It's set on each
    field: providing `MAT_FORM_FIELD_DEFAULT_OPTIONS` in `app.config.ts` puts Material's form field in the initial
    bundle (600 kB).
  - Option group labels (Material's `mat-optgroup`) take `--ss-text`, not the muted shade, which is 4.3:1 on dark
    mode's raised overlay surface (M5.3).

  Always show the rank **name** next to its colour, for colour-blind users.
- **Theme mode:** System (follows `prefers-color-scheme` live), Light or Dark. `ThemeService` sets
  `data-theme` on `<html>` and `color-scheme` follows it. The production build doesn't inline critical CSS, because
  the inliner would drop the `[data-theme='dark']` rules and flash the light theme.
  - **Saved:** `settings.theme` in Dexie is the source of truth (M4.2). `localStorage` (`ss-theme`) is the startup
    cache, which an inline script in `index.html` reads before the first paint, since IndexedDB can't be read that
    early. The script and its CSP hash didn't change: same key, same values.
  - **When they disagree, Dexie wins.** `ThemeService` starts from the cache, then follows the saved settings through
    the live query once they load and whenever they change: a toggle in another tab or an import updates every tab,
    and each rewrites the cache. A toggle writes both. While its writes are on their way, saved settings older than
    the last one it wrote are ignored, so quick toggles never flash back.
  - **Before the first run** there's no settings record to save it in (country and currency are required), so the
    choice is only cached, and the first-run dialog saves the theme on screen.
- **Rank chips:** a coloured dot (vivid fill) + the rank name in normal text colour. This is readable in both
  themes and in every rank.
- **Budget bars:** a vivid fill with a dark label inside (as in the wireframes). Green under 75%, amber at
  75–100%, red over 100%. Core's `budgetBar` decides: a bar over its max is full with the real percent, which rounds
  down up to 100 and up past it, so the label never contradicts the colour (100.4% shows 101%, red). The label is
  `--budget-label` in both themes and reads on every fill and on the track, so it sits at the end of the fill and,
  when the fill is too short to hold it, starts at the bar's left edge and runs onto the track, with nothing measured
  (M4.5).

### 8.1.1 What each budget bar measures
| Where | Bar shows |
|---|---|
| **Home** | **All lists combined** against the monthly and annual budgets |
| **Lists overview: each list card** | **That list's share** of the total budget (its own cost ÷ budget) |
| **View list** | Only **that list's** cost against the budgets |
| **Calendar** | **The displayed month only**: spent so far (payments dated up to today) against the month's total, for the lists currently shown, with a tick mark at the monthly budget (none when the budget is past the month's total). Its colour compares the month's total with the budget |

**Colours (M7.7, the user's choice):** a bar's fill is one colour, which changes gradually with how far along its
budget it is, with no hard step: green with nothing spent, yellow exactly at the budget, red at half again over it
(150%) and beyond (core's `budgetBar`: `towardYellow` and `towardRed`, mixed from `--budget-ok`, `--budget-warn` and
`--budget-over` in OKLab). The Calendar's bar takes its colour from the month's total against the budget, so a month
that goes over shows it before it's paid. The level (ok under 75%, warn to 100%, over past it) keeps its meaning
(`data-level`). The dark label is 4.9:1 or more on every colour of the scale.

**Every item counts, including duplicates.** The same plan can legitimately appear several times: a family
might have several Netflix plans, and lists can be used **per family member** to track each person's costs.
Home simply sums every item in every list. (The optimizer can still spot these and suggest, for example,
turning a second Netflix plan into an extra-member add-on.)

### 8.2 Routes
| Route | Page | Wireframe |
|---|---|---|
| `/` | Home | calendar widget, monthly and annual budget bars, "Subscription Lists" button |
| `/lists` | Lists overview | list cards with totals, rank counts, View button, delete; "New Subscription List"; feature summary |
| `/lists/:id` | View list | sub cards, mini calendar, budget bars, feature totals, Optimizations button, export |
| `/lists/new`, `/lists/:id/edit` | Edit list (works on a saved draft) | item dialog for adding and editing items |
| `/lists/:id/optimize` | Optimizations | suggestions grouped by severity, with Apply / Dismiss |
| `/search` | Search | search bar, sort, expandable sub cards, filters panel (price range, features, chips, activity) |
| `/features` | Profile feature ranking | grouped features, each with a single rank dropdown (Not ranked is the default; no separate × button) |
| `/calendar` | Calendar | month/year view, spent-vs-total bar, Sync Calendar and Export buttons |
| `/payment` | Payment cards | (Phase 4, section 9) |
| `/custom` | Custom subscriptions | cards and an edit dialog |
| `/settings` | Settings | local sync (later), monthly and annual budget, custom tags with colours, country/currency |
| `/dev/components` | Component gallery, **development builds only** (M4.4, M4.5): `dev-routes.ts`, which the production build replaces with an empty `dev-routes.prod.ts` (`fileReplacements`) | — |

### 8.3 Page notes
**Home.** Shows the current-month mini calendar with payment days highlighted, plus the monthly and annual budget
bars for **all lists combined** (section 8.1.1). The bars appear only if a budget is set; without one, the total and
"Set a monthly budget →". The big CTA opens `/lists`, and the next three payments follow (M7.3).

**Lists overview.** Each card shows the name, a monthly bar (**this list's share** of the monthly budget), a yearly bar, rank
counts in rank colours (zero counts in grey), a View button and delete (with confirmation and Undo). Without a budget
a card shows the amount alone (M7.2; until then it showed what the list costs a month on average, section 14, M6.7). Below the cards is a
"New Subscription List" tile, which opens `/lists/new` with the default name. The right column shows feature
summaries ("VPN 2/3", "4k 2/5").

**View list.** Contents:
- the list name and an export menu (CSV, JSON, XLSX, TXT, ICS)
- a search/filter bar, pinned cards first, then the other cards
- each card shows the favicon, name, plan, cost, interval, % of the annual total and an Active/Inactive status
  (computed from today's date and the billing windows), and expands to list features with their rank colours
- an edit button
- a right column with the budget bars, a mini calendar, feature totals and the **Optimizations** button, coloured
  by the most severe suggestion (red, orange or yellow)

**Edit list.** Supports add (opens search in "pick" mode), delete, rename, delete list and Save. Clicking an item
opens a dialog (not a separate page) with:
- a plan switcher (same provider)
- tags (with inline create)
- feature rank overrides: the same single dropdown, with Essential and Critical added and a first option
  **"Profile default (Wanted)"** that shows the inherited rank. Picking it removes the override.
- billing mode: recurring (interval, anchor date picker, auto-renew checkbox shown only if supported) or
  limited (date windows, repeat yearly)
- payment card (Phase 4)
- price override

**Search.** Free text matches provider names, plan names and feature names, term by term ("netflix 4k", PROJECT-PLAN
P8). Filters:
- price range (monthly equivalent)
- features (autocomplete from the registry, with a minimum value for numbers and enums)
- active chips
- activity: Active, Inactive, Not listed (relative to the user's lists)

Sort by price, A–Z, or most features. Cards show Plan and Cancel links and the prices for each interval.
Bundles appear under the relevant cards. **Clicking a price** opens an "Add to list" menu (pick a list,
or create one), as noted on the wireframe, which then opens that list's edit dialog with the item prefilled.

**Features (profile ranking).** All registry features grouped by category and parent group (collapsible),
each with **one dropdown**. The dropdown lists **Not ranked** (the default) first, then Needed, Wanted, Uses,
Sometimes, Unused and Unwanted. Essential and Critical are only available per subscription, because they tie
the feature to that subscription's plan or provider. Resetting means choosing
"Not ranked", so the separate × button is gone.
- Each option shows its colour dot.
- Ranked rows get a coloured left border, so you can see your choices at a glance.
- A **group** row (for example "Password manager") ranks only the group itself ("I want a password manager").
  Its "Set all in this group" menu ranks every child in one step. Ranks never cascade on their own.
- A "Show ranked only" toggle and a search box help with the large registry.

**Calendar.** A month view (a year view later) shows payment dates and amounts per day, plus a progress bar
covering **the displayed month only**: *spent so far / that month's total*, with a monthly-budget marker. Users can toggle which lists are shown. **Export to file** downloads
an `.ics` file. **Sync Calendar** is a Phase 5 feature (section 11.3). Until then it shows "Download .ics" with
import instructions for Google, Apple and Proton.

**Settings.** A back button, plus:
- budgets (warnings appear when any projected month or year goes over)
- country and currency (defaults detected from the browser locale). These choose the native prices; anything
  else is converted and marked with the ≈ icon (section 4.7)
- custom tags with colours
- backup: export and import JSON
- local sync (Phase 5)

**Custom subscriptions.** Cards for user-created services. The edit dialog has name, plans (name, cost, currency,
interval, auto-renew available), features (search the registry and add, or × to remove), link and cancel link.
The favicon comes from the link through `/icon`, and without one the card shows the subscription's first letter,
as it does for a catalog provider without a logo. As built in M6.6, the page is a list of rows rather than cards
(section 14).

---

## 9. Payment page

### 9.1 Decision
**Keep it**, as a **manual-entry** page built in Phase 4. Keep the model deliberately flat so the maths stays simple:
- There's **no free card-rewards API**, especially for Canadian cards, and merchant category codes (MCCs)
  aren't publicly available per merchant. So: no category multipliers and no points programmes.
- **One flat cash-back %.** Points-card users convert points to their own effective % if they want to.
- **Debit cards are supported too**, since the limit field covers a debit limit or a credit limit.

### 9.2 Model (stored locally only)
```ts
// Inferred from cardNetworkSchema (packages/core/src/catalog/provider.ts), which providers' acceptedNetworks also use
export type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'discover' | 'interac' | 'unionpay' | 'jcb' | 'other';

export interface PaymentCard {
  id: string;
  name: string;                 // "Simplii Cashback Mastercard"
  nickname?: string;            // shown instead of name if set
  type: 'credit' | 'debit';
  network: CardNetwork;
  currency: string;             // card's home currency, defaults to the user's currency (CAD)
  cashbackPercent: number;      // flat, e.g. 1.5 (points users enter their own effective %)
  fxFeePercent: number;         // issuer foreign-transaction fee, e.g. 2.5; 0 for no-FX cards
  monthlyLimit?: number;        // debit limit, or credit limit (assumes paid in full monthly); empty = no limit
  createdAt: string; updatedAt: string; deletedAt?: string;
}
```
The type comes from `paymentCardSchema` (`packages/core/src/user/payment-card.ts`, section 4.6).
**Never** store card numbers, expiry dates or CVVs. The add-card dialog says so, and the schema itself rejects a name
or nickname with 12 or more digits in a row (spaces and dashes between them included), so no import can store one.

### 9.3 Calculations (`packages/core/src/rewards/`)
**Which cards can pay for a subscription:**
- A card is eligible if the provider's `acceptedNetworks` for the item's region (else its group, else `GLOBAL`)
  include its network. Since M9.2 they're per region, since a provider can take other cards in another country
  (Netflix takes Discover in the US, not in Canada), each quoted from its own page (section 4.3).
- If the provider's networks are **unknown** there, every card is allowed and shown with an "acceptance not
  confirmed" hint.
- Ineligible cards are hidden from the item's card dropdown, and the optimizer never assigns them.

**Effective monthly cost of an item on a card:**
```
charged        = price in the provider's billing currency for the user's region, plus sales tax (section 4.8)
inCardCurrency = charged × networkRate(chargedCurrency → cardCurrency)     (1 if same currency)
fxFee          = chargedCurrency ≠ cardCurrency ? inCardCurrency × fxFeePercent / 100 : 0
cashback       = (inCardCurrency + fxFee) × cashbackPercent / 100          (most cards pay on the full posted amount)
net            = inCardCurrency + fxFee − cashback
```

**Can FX markup be calculated?** Yes, as a good estimate. A foreign charge has two parts:
1. **The network's exchange rate** (Visa, Mastercard and Amex each set their own daily rate). This is usually
   within a fraction of a percent of the mid-market (ECB) rate, so the small difference is inside the margin of error.
   - **Visa** offers a Foreign Exchange Rates API that any developer can apply for (Visa reviews projects
     before production access).
   - **Mastercard's** rate APIs are for issuers and banks only. Its public converter webpage has no supported API.
   - **Amex** publishes no API.
2. **The issuer's foreign transaction fee** (commonly ~2.5% on Canadian cards, 0% on no-FX cards). This is
   the big part, and it's the `fxFeePercent` the user enters.

**Decision:** use **ECB rate (Frankfurter) × (1 + fxFeePercent)** for every network, labelled "estimated".
No network API (it isn't worth Visa's application process). `networkRate()` stays the single place to plug in
network-specific rates if that ever changes. Watch out for **dynamic currency
conversion** (a merchant charging in your currency at its own rate). It's rare for subscriptions, so it's only
noted in a help tooltip.

**As built (M9.3):** `packages/core/src/rewards/`, with the user's choices in section 14 (M9.3): the charge is in
the item's own currency (Proton's buyer-chosen lists: pickPrice's; Mullvad: EUR), every charge carries it
(`Charge.charged`), and the monthly figures are with tax (P4).

**Choosing a card for each subscription (optimizer):**
- Maximize total monthly `cashback − fxFee` across all items, subject to each card's `monthlyLimit` and network acceptance.
- Greedy approach: sort items by the biggest difference between their best and second-best card, assign each
  to its best card with room left, then do a quick swap pass.
- Fixed costs in a given month are summed from the schedule engine (an annual plan counts against the limit in
  the month it's charged).
- **Over-limit warning:** if a card's assigned charges in any month exceed its limit, the card tile and the
  calendar day are flagged.

### 9.4 Page UI
- Card tiles show the nickname or name, a network logo, a credit/debit badge, cash-back %, FX fee % and a limit
  bar (this month's assigned charges against the limit, or "No limit").
- Each tile lists **the subscriptions using it** with their monthly total.
- Add, edit and delete open a dialog with exactly the fields in 9.2, no more.
- The list view and the item dialog show a card dropdown (eligible cards only), plus a "Best card" suggestion
  chip that names the expected savings.
- The list view shows **net cost after cash back and FX fees** next to the gross cost.

**As built (M9.4):** the card dropdown and the Best card chip are in the item dialog only, where the user's M9.4 tasks
put them: the list view's cards change only through the editor's draft (but for pinning and Wrong date?), so it shows
the net beside the gross, in its header and on each card paid with one (section 14, M9.4). Since M9.1 the tiles name
the network in a badge rather than show its logo.

---

## 10. Optimizer engine

Lives in `packages/core/src/optimizer/`. It's a **pure function**:
`optimize(list, catalog, rankings, cards?, settings) → Suggestion[]`, and it runs in the browser
(in a Web Worker if it's slow). As built (M8.1): `optimize({ items, catalogs, context, cards? })` →
`{ suggestions, bestSavings, … }`, with the rules the user chose in section 14 (M8.1).

### 10.1 Inputs, prepared first
0. The list's items as its draft has them when it has one, else as saved (M8.4): the suggestions are for what Save
   would keep, so one applied on the Optimizations page counts in the next.
1. Resolve each item's effective feature ranks (section 4.6).
2. Build a **month-by-month coverage map** for the next 12 months: for each feature, which items provide it in
   each month. Limited-timeframe items count only in the months they're active.

### 10.2 Hard constraints
- **Essential** (this plan): an item with any Essential feature keeps its exact plan. It can't be removed,
  downgraded or switched. Only changes that keep the plan apply: annual instead of monthly billing, a better card,
  or a bundle that contains this same plan.
- **Critical** (this provider): an item with any Critical feature can't be removed, and can only move to another
  plan of the same provider that keeps that feature at the same or a higher level.
- **Needed:** after any change, every Needed feature must still be provided by at least one item **in every
  month it was provided before**.

### 10.3 Candidate actions per item
1. Keep.
2. Change interval (monthly → annual if cheaper over 12 months and the item renews automatically).
3. Downgrade or switch plans within the same provider, including down to its free plan.
4. Convert to an **add-on** of another item's plan (for example a second Netflix account becomes an extra member).
5. Replace with a **bundle** or a **suite plan** (section 4.4) that covers two or more items.
6. Remove.
7. (Phase 4) Move to a better card (an eligible network, within limits; section 9.3). Built in M9.3 as a free
   saving of its own (section 14).

### 10.4 Search
- Enumerate combinations of actions (lists are usually under about 15 items, and each item has only a few
  candidates). Exhaustive search with pruning works up to about 10^5 combinations. Beyond that, use greedy
  search plus local improvement.
- Score each valid combination by **annual cost**.
- Assign severity by **which ranks lose coverage**:
  | Severity | Meaning |
  |---|---|
  | **Red (hard)** | Removes only Unwanted (and Not-ranked) features. "You're paying for things you don't want" |
  | **Orange** | Also removes Unused features |
  | **Yellow (soft)** | Also affects Wanted, Uses or Sometimes features. "Possible, with trade-offs" |
- Pure-savings actions that lose nothing (annual vs monthly, bundles, add-ons) are listed as their own **"free
  savings"** suggestions.
- Output for each suggestion: items to keep, downgrade, switch or remove; new monthly and annual totals; savings;
  and the features gained or lost.

### 10.5 Testing
Fixture-based Vitest tests, for example: "2 VPNs, VPN ranked Needed → suggest removing one, never both" (the
pricier when they're alike, the cheaper when only the pricier has another Needed feature), "Essential feature
blocks a downgrade", "Critical feature allows a same-provider downgrade that keeps it but blocks removal" and "a
limited Sep–Oct window keeps a Needed feature covered".

---

## 11. User data, export, calendar & sync

### 11.1 Local storage
IndexedDB through Dexie, with repositories exposed as Angular services that return signals or observables.
Request persistent storage with `navigator.storage.persist()`, and remind users to back up (they can be
prompted after each big change, or weekly).
- **Repositories are the only way in.** Nothing else touches Dexie, so the app lock (section 11.5) works under them
  without changing a page.
- **Only non-sensitive fields are indexed:** ids, `listId`, `updatedAt` and keys, as in the Dexie schema in section
  4.6. Everything else can then be stored encrypted.
- **Records are validated on the way in and out** with the same Zod schemas as backups. Treat stored data as
  untrusted: script on the origin, or a bad import, could have written it.

**As built (M4.1)**, in `apps/web/src/app/core/storage/`:
- **Repositories** (`ListsRepository`, `ItemsRepository`, `CustomSubsRepository`, `TagsRepository`,
  `RankingsRepository`, `SettingsRepository`, and `CardsRepository` since M9.1) are `@Service()`s. Each streams a Dexie
  `liveQuery` of its whole table through `rxResource`, so every write, in any tab, updates every signal. They expose
  the valid, non-deleted records, a `status` (`loading`, `ready` or `error`) and computed lookups (`byId`,
  `byList`). A user has a few hundred records at most, so pages filter them with `computed()` instead of querying.
- **Writes:** `create` adds a UUID v7 id and the time, `update` changes a record in a transaction, and `remove`
  soft-deletes it. Ids come from the `uuid` package, with the time from `ClockService.now()` (the only clock read),
  and count up within a millisecond, so they sort in the order they were made. A record that fails its schema on
  the way in throws an `InvalidRecordError` and nothing is written.
- **A stored record that fails its schema** is never shown, and stays in IndexedDB as it is: deleting it would let
  a schema bug destroy data. The console gets its table, key and each issue's path and code, never a value (Zod's
  messages can quote the data), and the user sees one snackbar per session: "Some saved data couldn't be read, so
  it's hidden. The rest is fine." It can't be changed either, except settings and a ranking, which the user's next
  save replaces whole.
- **Only the repositories import Dexie:** ESLint rejects a `dexie` import anywhere else in the app. The app lock
  (M6.10) is in `StorageEngine`, the one class that reads and writes rows: it seals what it writes and opens what it
  reads (section 14).
- **Loaded on first use:** Dexie, Zod and the record schemas (216 kB minified, 60 kB compressed) load as a chunk of
  their own when a repository first needs them. Since M4.2 the settings load at startup (the theme and the first-run
  check need them), which brought `rxResource`, the storage service and the settings store into the initial bundle:
  466 kB of its 500 kB budget, from 426 kB. The first-run dialog, its form and the locale defaults stay lazy. Core imports Zod as `import * as z from 'zod'`, which ESLint enforces: `import { z }`
  brings all of Zod, every locale's messages included, and made the chunk 541 kB.
- **Persistent storage** is requested after the first write, not on load: Firefox asks the user, and the question
  only makes sense once there's something to keep.
- **The catalog cache (M4.3):** `CatalogCacheRepository` keeps the downloaded catalog files (section 6.3). It's a
  cache, so the storage engine replaces and deletes its records outright (`replace`, for cache tables only) where
  user records are soft-deleted. A cached file that fails its schema is only logged ("A cached catalog file couldn't
  be read, so it's downloaded again"), with no snackbar, and the next check downloads it again. The files are checked
  against core's catalog schemas on every read too (about 0.7 ms for a 40 kB file). The catalog schemas share the
  Zod chunk the settings load at startup, which went from 216 kB to 218 kB minified (61 kB compressed); the store,
  the banner and the region list brought the initial bundle to 474 kB of its 500 kB budget. The download code is a
  chunk of its own (1 kB).
- **The exchange rates (M4.4):** `FxRatesRepository` keeps the last rates fetched, one record (section 4.7). Like
  the catalog cache, a record that fails its schema is only logged and fetched again. `FxStore` brought the initial
  bundle to 475.7 kB.
- **List drafts (M6.3):** `DraftsRepository` is the only way into the `drafts` table, and `ListDraftService`
  (`core/lists/`) edits the drafts through it (section 14). Starting a draft and Save read and write the lists and
  items too, each in one transaction (`StorageEngine.transaction`, whose reads and writes are checked like the others).
- **Transactions (M6.10):** inside `StorageEngine`'s transactions, every table comes from the transaction object
  (`transaction.table(name)`), and a promise that isn't IndexedDB's (WebCrypto's) goes through the transaction's
  `waitFor`, as `Dexie.waitFor` does. Dexie's zone, which otherwise finds the transaction, is lost a couple of native
  `await`s deep, and IndexedDB commits a transaction with nothing to do when a task ends.
- **The app lock (M6.10):** the database opens as soon as `StorageService` starts. The user's repositories load once
  it has said whether the lock is on, and drop their records while it's locked (`StorageService.access`); the caches
  load regardless (section 14).
- **IndexedDB blocked** (some private browsing modes, or site data blocked): the repositories' status is `error`, and
  the app shows the P15 notice in place of the shell. [Continue anyway] calls `StorageService.useMemory()`: the same
  Dexie database opens on `fake-indexeddb` (57 kB, a chunk loaded only then), and every repository reloads from it
  through its `mode` parameter, so everything works and nothing is saved. A line at the top of every page says so,
  the first-run dialog asks again on each visit, and persistent storage isn't requested.
- **Tests** run on `fake-indexeddb`, loaded in `test-setup.ts` (Dexie's live queries never run without a global
  IndexedDB), with a fresh database for each test (`storage.testing.ts`).

### 11.2 Export & import
| Format | Library | Notes |
|---|---|---|
| JSON | native | **Full backup**: all tables plus `schemaVersion`. The only format that can be re-imported. An optional passphrase encrypts it (section 11.5), since backups sit in Downloads unencrypted. Imports are validated with Zod before anything is written |
| CSV | papaparse | List view: one row per item (list, service, plan, cost as charged with tax, interval, next charge, live tags). The Calendar: one row per charge in the next 12 months |
| XLSX | exceljs (lazy-loaded) | Summary, one sheet per list of its items, then Payments, the next 12 months' charges |
| TXT | native | A readable summary of one list; the Calendar's, its next 12 months by month (M7.9) |
| JSON (one list) | native | List view's: the list, its items and what they name, as stored. Not a backup, so not importable (M7.5) |
| JSON (payments) | native | The Calendar's: the lists shown and each charge in the next 12 months as charged, with its tax, renewal and live tags (core's `paymentsFile`, M7.9). Not a backup either |
| ICS | `ics` npm package | One all-day event (`VALUE=DATE`, so no time zone can move it) per charge in the next 12 months, from the schedule engine. Not `RRULE`s: a monthly rule starting on the 31st skips every shorter month (RFC 5545 drops dates that don't exist), and separate events also follow windows, end dates and price changes. Each event lists its item's live tags, also as `CATEGORIES` (M7.9) |

### 11.3 Calendar integration
- **Phase 3, download `.ics`:** works with Google, Apple and Proton through their import features. This is
  offline and private, but a snapshot, so it doesn't update when the list changes. Since M7.9 Sync calendar's steps
  make a "Simply Sub" calendar first and import into it: each app colours a whole calendar, not an event (Apple's
  guide: imported events "lose any custom color"; Google's and Proton's import pages say nothing of one), so a
  calendar of its own keeps the payments apart, in a colour the user picks, and easy to replace.
- **Phase 5, live subscription URL:** Google, Apple and **Proton Calendar ("Add calendar from URL")** all
  support subscribing to an `.ics` URL. This needs the payment schedule stored on the server, so it's
  **opt-in**: the app uploads a **minimal schedule** (titles and amounts only, or event titles alone if
  the user prefers) under a random 128-bit token. The Worker then serves `/api/v1/cal/<token>.ics`. Users can
  revoke the token at any time. Subscribed calendars are read-only in Proton, which is fine for this. A feed per tag,
  besides the one for everything, would give each tag a calendar of its own and so a colour of its own: the way the
  apps can show tags in colour (M7.9).

### 11.4 Device sync and future accounts
- **Phase 5, encrypted sync ("sync chain", like Brave's):** generate a sync code (a passphrase). The browser
  encrypts the whole user database with a key derived from the code (the same crypto module as encrypted backups
  and the app lock, section 11.5) and stores the blob in R2 (section 7.1), keyed by a hash of the code. Other devices enter the code to pull and merge.
  The server can't read the data. Merging works per record using `updatedAt` and `deletedAt`
  (last write wins), which is why every record has those fields.
- **How Brave does it** (its Sync v2 wiki and `brave/go-sync`, read 2026-10-28): the first device makes a random
  32-byte seed and shows it as a 24-word BIP39 phrase or a QR code; HKDF-SHA512 derives from it an Ed25519 key pair
  that signs the device's requests to Brave's own sync server, and the data is encrypted on the device with a key
  stretched from the phrase (scrypt, with a salt the first device stores on the server for the others). The server
  (Chromium's sync protocol, Commit and GetUpdates, on DynamoDB) holds only what it can't read. Brave has since added
  a word that changes daily to the code shown for adding a device, and doesn't support the code as a backup.
- **For Simply Sub, the same shape on Cloudflare** (the recommended design for M10): a random 32-byte seed as the sync
  code, shown as words (and a QR code; scanning one can come later, since not every browser can); from it, with
  WebCrypto's HKDF-SHA256 (a random seed needs no slow stretching, unlike a passphrase): the chain's id, an auth secret
  whose SHA-256 hash is all the server keeps to check writes, and the AES-256-GCM key. One encrypted snapshot of the
  synced tables per chain, in R2 (or a Durable Object, which would also serialize writes), written with a conditional
  PUT (`If-Match` its ETag) after merging what's there, so two devices never overwrite each other. Not synced: the
  catalog and rate caches, drafts (edits not saved), the app lock and per-device settings (the theme, Calendar's
  shown lists). The server sees a blob's size and when it changed, nothing else. Leaving a chain or a lost device:
  a new code moves the data to a new chain. Accounts, or a passkey to open the chain (WebAuthn's PRF extension), can
  come later without changing this.
- **Accounts later:** add Cloudflare Access or an auth library on top. An account just owns sync blobs, so
  the data model doesn't change.

### 11.5 Security of data on the device
**What's stored:** lists, prices, dates, budgets, rankings, tags, settings and card *metadata* (name, network,
cash-back %, FX fee, limit). It's personal and financial, but it holds no passwords, card numbers or account
logins. Card numbers are never stored, and card fields reject 12+ digit numbers (P11).

**The threat model**, and what actually protects against each threat:

| Threat | Does encrypting the data help? | The defence |
|---|---|---|
| Another website | Not needed | The browser keeps each origin's storage apart |
| Another app on the same origin, or a bug in one | No | An origin of its own: `sub.simplely.ca` (section 7.3). Future apps on `simplely.ca` get their own subdomains too |
| Script injected into Simply Sub (XSS) | No: it runs inside the unlocked app | Strict CSP and Trusted Types (section 7.6, M2.8); Angular's escaping, with no `innerHTML` of user or catalog text; `https://` links only, for users' links as for the catalog's |
| Malicious data: a crafted backup, tampered storage | No | Zod validation on import and on read (section 11.1); stored text is only ever shown as text |
| Someone else using the same browser profile | **Yes, with a passphrase the user types** | The optional app lock (below) |
| A lost or stolen device | Partly | Full-disk encryption (BitLocker, FileVault) and an OS password, which the privacy note recommends. Browsers store IndexedDB unencrypted |
| Malware on the device | No | Outside what a web app can defend |
| A compromised dependency | No | Pinned versions, CI's `npm audit --audit-level=high`, and Dependabot alerts |

**A key the app stores itself protects nothing**: whoever can read the data can read the key beside it.
Encryption at rest needs a secret the user supplies, and with no server, a forgotten passphrase means the data is
gone. That's why it's opt-in.

**Encrypted backups** (M6.9): the export dialog offers an optional passphrase.
- The file is then `{ app, schemaVersion, encrypted: { kdf, iterations, salt, iv, ciphertext } }`: AES-256-GCM,
  with a key derived by PBKDF2-HMAC-SHA256 at 600,000 iterations (OWASP's figure) from the passphrase and a random
  16-byte salt.
- The import asks for the passphrase; a wrong one fails the GCM check, and nothing is written.

**The app lock** (M6.10, opt-in from Settings): one passphrase encrypts the user tables at rest.
- **Key:** derived like the backup key, then held in memory only, as a non-extractable WebCrypto `CryptoKey`.
  Nothing secret is stored: only the salt and an encrypted check value, which tells a wrong passphrase.
- **What's encrypted:** each record of `settings`, `lists`, `items`, `customSubs`, `rankings`, `cards`, `tags` and
  `drafts` and `dismissedSuggestions` (M8.2) keeps its key and indexed fields in plain text and
  stores the whole record as one encrypted value. Of the settings, only what's needed before unlocking stays plain:
  the theme and the lock itself. The caches (the catalog files, the exchange rates) stay plain, since they're public.
- **Locking:** the lock screen asks for the passphrase on each visit. The app locks again after a chosen idle time
  (5, 15 or 30 minutes or an hour, 15 by default, or Never), when the page is left and when the tab closes.
- **Turning it on** encrypts everything in one transaction; turning it off decrypts it.
- **A forgotten passphrase** leaves two ways out, both on the lock screen: import a backup in place of everything, or
  delete all data. Either turns the lock off. The dialog that turns the lock on says so, and offers an encrypted
  backup first.
- **As built:** section 14 (M6.10).

**One crypto module** serves encrypted backups, the app lock and Phase 5's sync (section 11.4), so the maths is
written and tested once. It uses WebCrypto (`crypto.subtle`), available in every supported browser.

---

## 12. Roadmap

> The task-level breakdown (milestones M0–M10, each task with a "done when" check) is in **PROJECT-PLAN.md §2**.

### Phase 0: Setup
- [x] Register `simplely.ca` (bought through Cloudflare Registrar)
- [x] Monorepo scaffold, Volta pin, workspaces, `tsconfig.base.json`
- [x] Angular app with Material 3, theme tokens, sidebar shell, empty routes
- [x] Worker with Hono, D1 created, `/health`
- [x] Asset copy step + `wrangler.jsonc`; first deploy works (on `simplely.ca/simply/sub/` then; `sub.simplely.ca` since the pre-M2 review)
- [x] Workers Builds connected to the repo; GitHub `ci.yml` as required PR checks

### Phase 1: Catalog
- [x] `packages/core` catalog types + Zod schemas, generated JSON Schema
- [x] `features.yaml`, `categories.yaml`
- [x] `validate-data`, `build-catalog`, migrations, seed in deploy, provider icons
- [ ] Discovery pipeline: `discover-services` (Wikidata), `find-urls`, `extract-plans`, PR batching (section 6.5)
- [ ] Seed providers with the pipeline (section 6.6)
- [x] `pick-price` + FX conversion (section 4.7), regions and availability
- [ ] API endpoints: catalog, providers, plans, features, bundles, icon, fx

### Phase 2: Core app
- [ ] Dexie database + repositories, settings, theme toggle
- [ ] Search page (local search over the snapshot), filters, add-to-list
- [ ] Lists overview, view, edit, item dialog
- [ ] Custom subscriptions
- [ ] Profile feature ranking + overrides
- [ ] JSON backup export and import

### Phase 3: Insight
- [ ] Schedule engine (next dates, monthly and annual totals, limited windows)
- [ ] Home dashboard, budget bars and warnings
- [ ] Calendar page + `.ics` export
- [ ] CSV, XLSX and TXT export
- [ ] Optimizer v1 (interval, bundle, add-on, overlap, rank-based suggestions)
- [ ] `apps/bot` Cron Worker: nightly price check (Workflows + Workers AI) → GitHub PRs

### Phase 4: Payment
- [ ] Card model, page and dialog (network, type, cash-back %, FX fee %, monthly limit)
- [ ] `acceptedNetworks` in the catalog + extraction
- [ ] Eligibility filter, FX + cash-back maths, card-assignment optimizer, over-limit warnings
- [ ] Net-cost-after-rewards on the list view

### Phase 5: Extras
- [ ] Live calendar feed (opt-in)
- [ ] Encrypted device sync
- [ ] "Report wrong price" / "Suggest a service"
- [ ] Broaden regional price coverage (the schema and UI handle all regions from Phase 1)
- [ ] PWA (installable, offline)

---

## 13. Conventions

### 13.1 Angular
The general Angular rules are in [docs/angular-best-practices.md](docs/angular-best-practices.md), Angular's
official AI rules file, which CLAUDE.md loads automatically. On top of those rules:
- Zoneless change detection, which is the default. OnPush is the default too, so never set it explicitly.
- `resource` / `httpResource` for fetching, and `@defer` for heavy widgets (XLSX export, the year calendar).
- **Signal Forms** for every form (they're stable in v22).
- New singleton services in `core/` use the `@Service()` decorator.
- Templates and styles live in their own `.html` and `.scss` files, never inline, even for small components.
- Components stay thin: business logic belongs in `packages/core`, as pure functions that take `today` as a parameter.

### 13.2 Naming & style
- Files: `kebab-case.ts`; types and classes in `PascalCase`; ids and slugs in `kebab-case` with dot namespaces (`netflix.standard`).
- Money: store `amount` with its `currency`. Never format money in the logic layer, only in the UI (`Intl.NumberFormat`).
- Dates: ISO strings (`YYYY-MM-DD`) everywhere, never `Date` objects in data. Date maths uses core's own
  `dates/` helpers (`addDays`, `addMonths`, `daysBetween`, `addPeriods`), which work in UTC so a time zone or a
  daylight-saving change can't shift a date. No date library: date-fns works in local time.
- Lint and format with ESLint (angular-eslint) and Prettier.

### 13.3 Testing
- `packages/core`: high unit-test coverage, especially schedule, ranking, optimizer and rewards.
- `apps/api`: route tests with Vitest + `@cloudflare/vitest-plugin` (the renamed `@cloudflare/vitest-pool-workers`),
  run inside workerd.
- **Contract tests** (M2.7), so `docs/api-output-examples.json` and the code can't drift apart:
  - core checks every example: an error, on any endpoint (Phase 5's too), against `errorBodySchema` and its
    code's status; a built endpoint's success body against its schema. It also checks that every built endpoint
    has a schema and that the error codes match the examples' list.
  - `apps/api/test/contract.spec.ts` sends every example of a built endpoint to the Worker as its request says, on
    the real catalog seeded under the examples' version, and checks the status, the headers the Worker sends
    (`Access-Control-Allow-Origin` waits for M2.8, and `Content-Encoding` is Cloudflare's edge's), and the body:
    errors exactly, success bodies against their schema and their meta's keys, since the examples' values are
    illustrative. A new example is tested with no new test.
- `apps/web`: component tests for key dialogs, plus a few Playwright end-to-end flows
  (create list → add from search → see totals).

### 13.4 How to add a provider (checklist)
1. Create `data/providers/<id>.yaml` (copy `netflix.yaml`, or run `npm run data:draft -- <pricing-url>`). With
   the recommended Red Hat YAML extension, VS Code autocompletes and checks the file as you type (section 4.5).
2. Use only feature ids from `features.yaml`. Add new features there first, in a separate commit. Give a plan
   `categories` when it's in other service categories than the provider's (Proton VPN Plus is `[vpn]`).
3. Fill in `lastVerified` and `sourceUrl` for every price. Store regular prices, not first-term offers, and the
   billing period the provider states (`day` × 30 for "every 30 days"), with ISO region codes (`GB`, not `UK`). Add
   `availableIn` only when the provider lists the countries it sells in (sections 4.3, 4.7): every provider sold
   in certain countries only gets one, quoted in a comment.
   Every plan and bundle needs its sign-up `link`, and every provider a `cancelUrl`: its cancel page, or its help
   article on cancelling (for a prepaid service, on getting unused time back). The schema requires them (M1.9).
4. Run `npm run data:icons` to fetch its logo into `data/logos/<id>.png`, and look at it. It takes the largest
   square PNG (at least 32 px) from the site's own icon links, `/apple-touch-icon.png`, `/favicon.ico`, Google's
   favicon service and DuckDuckGo's. If none is good enough, add a PNG by hand, or leave it out and the app shows
   a letter. `npm run data:icons -- <id>` fetches again; `-- <id>=<website>` works for any site. The build
   publishes it as a 96 px WebP (section 6.3).
5. Run `npm run data:validate`, then open a PR.

### 13.5 Glossary
| Term | Meaning |
|---|---|
| Provider | The company or service (Netflix) |
| Plan | A purchasable tier (Netflix Standard) |
| Price | A plan's cost for one region and interval |
| Add-on | An extra purchasable on top of a plan (extra member) |
| Bundle | Several plans sold together for one price, with exactly their features |
| Suite plan | A provider's all-in-one plan that includes its other plans and states its own features (Proton Unlimited) |
| Free plan | A plan with a $0 price (Proton Free) |
| List / item | A user's subscription list / one subscription in it |
| Rank | How much the user cares about a feature: Essential > Critical > Needed > Wanted > Uses > Sometimes > Not ranked > Unused > Unwanted. Essential (this plan) and Critical (this provider) are subscription-level only |
| Spend category | The category used for card rewards (streaming, software…) |
| Snapshot | The full catalog JSON for one region, served by `/catalog` |

---

## 14. Open questions

**Still open**
None.

**Resolved (2026-10-28, the feedback after M9)**
The user's sixteen fixes and improvements after M9, as M5.11–M5.12, M6.12–M6.16, M7.7–M7.9 and M8.4:
- **View in Search shows the item's plan (M5.11):** Search's URL takes `plan=<plan id>` (kept while the catalog has
  it, not a filter), and its provider's card shows that plan over the user's own. A user with Standard with Ads and
  Standard saw Standard with Ads from the Standard card: the card showed the user's cheapest active plan.
- **Where to change a policy (M5.12):** a rating's optional `action` (section 4.10), read 2026-10-28 from each
  provider's own pages: Netflix's privacy statement links its choices (help.netflix.com/node/100637, Behavioral
  Advertising) and its deletion help (node/100625); Disney's privacy center explains its "Your Privacy Controls" for
  Disney+, Hulu and ESPN (its "Do Not Sell or Share" form is on OneTrust's domain, so it isn't linked); Bell's privacy
  page links its preferences (bell.ca/email-updates) for Crave, TSN and RDS. ICI TOU.TV's rating points to the
  browser's own settings and Mullvad's to a refund, so they have none.
- **Add-ons on the cards (M6.12):** an add-on chosen in the item dialog was saved, and counted in the totals, but no
  card showed it or its price, so it seemed not to be added (the optimizer's extra member looked no different). List
  view's cards list each add-on with its price, and the editor's rows say what it adds. **Renewals:** an active item
  that renews by itself says when ("Auto-renews Nov 12"), on Search's cards too.
- **List view's pinned bar (M6.13):** the search box and Sort stay below the top bar; View optimizations stays pinned at
  the side column's foot from 960 px, never over the column's other parts, and under 960 px a compact one (the icon and
  the count, named by hidden words, not an `aria-label`, which axe faults when the icon's word shows) is in the bar,
  where Sort is its icon under 600 px.
- **Shared ranks (M6.14), the user's choice:** within the list, saved with the list's Save (Cancel undoes them), not a
  provider-wide layer for every list saved at once. Only what changed in the dialog goes; Essential stays on its
  plan and a sibling's Essential stays too; "Ranks for this plan only" (`ListItem.ownRanks`) opts a plan out; a new plan
  starts with its siblings' ranks.
- **Tag colours (M6.15):** the device's own colour picker (`<input type="color">`, on iOS, Android and desktop, no
  library) beside the hex field, each following the other, in Settings and the item dialog's New tag, which gets the
  hex field too.
- **Menus you can type in (M6.16):** `ss-choice-field`, a Signal Forms control on Material's autocomplete, for Country,
  Province or territory (State) and Currency in the first-run and 📍 dialogs. Both dialogs now start on their heading:
  focused, the Country menu would open its list over the dialog. A list closes when focus moves on to another control,
  since Tab pressed right after it opened came before Material's own closing was set up and left it open.
- **Budget bars and warnings (M7.7):** one colour per bar, on a scale from green to yellow exactly at the budget to red
  at 150%, the user's choice over a first try that drew a green-to-red gradient along the fill (section 8.1.1); a
  dismissed warning's key is whose payments, month
  or year, the period and the budget, so it comes back for a new period or budget; keys of past periods are dropped.
  Focus waits for its target: the settings come back from storage a moment after they're saved.
- **The Calendar (M7.8):** a column beside the grid from 960 px, so a day's panel never narrows it (Upcoming, now
  `ss-upcoming`, sits there under the panel); a compact grid above the agenda on phones; a back button to the page it
  was opened from (the router's previous navigation, by name), none from the sidebar, whose links carry
  `{ sidebar: true }` in their navigation's state.
- **Its exports and its own calendar (M7.9):** JSON and Text; tags in each event; Sync calendar's steps make a Simply
  Sub calendar first. The apps colour a calendar, not an event (section 11.3), so no per-event `COLOR` is written.
- **Several optimizations before the editor (M8.4):** the optimizer runs on the list as its draft has it (section
  10.1), Apply stays, Undo puts the draft back, Review and save opens the editor.
- **Bundle:** the initial bundle is 496.91 kB (496.39 before), still under 500 kB: the settings' schema now holds the
  dismissed warnings' pattern, and the sidebar and page header their navigation state. The pages' chunks stay lazy.
- **Checks:** core 1569 tests, web 662, API 213, bot 41; `check-after-m9.cjs` (the batch, both themes at 360 and 1280
  px, keyboard only, with axe) and the scripts of the pages it changed (the browser-check skill).
- **M3 or M10 next:** M3, the discovery pipeline. The catalog has ten providers, so most of what a user pays for is a
  custom subscription; M3 fills it (the user's own services first, M3.6: Crunchyroll, Xbox Game Pass, Bitdefender,
  Claude) and builds on M8.3's bot, which already reads pages, asks Workers AI and opens PRs. M10's "Suggest a service"
  and broader regional coverage feed on the pipeline, and its sync is designed (section 11.4) for when it comes.

**Resolved (2026-10-28, M9.4)**
- **The item dialog's card** (PROJECT-PLAN P6): a Payment section after Tags, for a plan that isn't free.
  - "Paid with": No card, then the cards its seller takes where it's bought (core's `cardChoices`), or every card where
    that isn't known, marked "acceptance not confirmed" (but for a custom subscription, which never says). The hint
    gives the month with tax and after cash back and FX fees (`monthlyOnCard`).
  - The Best card chip (`bestCard`): the card that leaves the least to pay a month, when it saves a cent or more. Enter
    or a click pays with it.
  - Notes: acceptance not confirmed, and for a charge in another currency, the card's FX fee estimated at the ECB's
    rate and a checkout's own conversion (the user's choice for Mullvad, M9.3).
  - A card the seller doesn't take (its networks became known since) is dropped as the dialog opens, with a note. The
    form's `cardId` (core's `item-form.ts`) is saved to the draft with the rest, but not for a free plan, which has
    nothing to pay (its own price is dropped the same way).
- **The card select is in the item dialog only.** Section 9.4 also put one on the list view, but the user's M9.4 tasks
  put it in the dialog, and the list view's cards change only through the editor's draft (but for pinning and Wrong
  date?). The list view shows the net instead.
- **List view's net** (P4, the user's choice in M9: both with tax): once an item has a card, the header's second line
  ("≈ $27.79 / mo with tax · ≈ $27.56 after cash back & FX fees", an item with no card at its gross), and on each card
  paid with one, "Paid with Everyday: $19.94 / mo with tax · $19.64 after cash back & FX fees".
- **Assign best cards** (P11): core's `assignCards` over every list's saved items, then a preview per list in a dialog
  that loads on first use, as Material's dialog does. A list with unsaved edits is skipped, with a note: its items keep
  their cards, and their charges still count against the limits. Apply writes the cards in one transaction, with Undo.
  `CardsRepository.assign` does it rather than `ItemsRepository`, which the app starts with, so the initial bundle
  doesn't grow.
- **Over-limit warnings:** a tile names the first of the next 12 months over its limit, and how many more. The Calendar
  flags the charge that takes a card over and its later ones that month, on the day and in the agenda, and the day's
  panel names each charge's card, and the warning. Every list's charges count, shown or not.
- **The optimizer's card action, wired in:** `OptimizerService` passes the cards and what the other lists' items post
  to each (`cardLoads`), and waits for the cards to load. List view's suggestion reads "With Discover It instead of
  Everyday, from now on".
- **Bundle:** the initial bundle is 496.39 kB, as since M9.1 (497.31 kB before M9).
- **Checks:** `check-payment.cjs` (185 checks, both themes at 360 and 1280 px, keyboard only) on `ng serve` and under
  `wrangler dev`'s production CSP, csp-check, and the list-view, item-dialog, calendar, backup, app-lock, optimizations
  and shell scripts again.

**Resolved (2026-10-28, M9.3)**
- **Buyer-chosen charge currency** (the old open question 1), the user's choices:
  - **Proton** (fixed price lists in USD, CAD, EUR and CHF, the buyer picks one): a card's FX fee is judged against the
    item's own currency, pickPrice's, which its charges and totals already use: the user's own when Proton sells in
    it (a Canadian pays CAD), else `billingCurrency` (USD). A card in another currency pays its FX fee. Someone who
    pays in another currency records it with "I pay a different price" in that currency, and the fee follows it.
  - **Mullvad** (one fixed €5 a month, cards also charged in about 20 currencies at its own rate): charged in EUR, as
    stored, so a card in another currency pays its FX fee on the ECB's conversion (CA$94.17 + 2.5% = CA$96.52 for a
    year). Mullvad's own conversion cost CA$98.04 on 2026-10-26, 4.1% over the ECB's, more than a 2.5% fee. Its blog
    (2023-10-04, "Select your local currency when paying for Mullvad to avoid fees!") says the local price is "the
    equivalent of €5" at "the correct exchange rate ... without any extra fees", which that checkout didn't bear
    out. The item dialog's card hint says a checkout that offers your currency converts at its own rate.
  - So every charge now says what the provider charges, in its currency: `Charge.charged` (`{ amount, currency }`,
    tax included, the prices' `source` before any conversion). Parts charged in different currencies are separate
    charges, which no real item has.
- **The maths** (`packages/core/src/rewards/`, pure and tested):
  - `networkRate` (the ECB's for every network, the one place for a network's own) and `cardCost`: the charge with
    tax in the card's currency, the FX fee when the currencies differ, the posted amount (what counts against the
    limit), cash back on it, and the net; "estimated" when converted.
  - **Eligibility** (`cardAcceptance`, `eligibleCards`): the networks the seller takes where the item is bought
    (`ResolvedItem.acceptedNetworks`, from core's `acceptedNetworksIn`: the region, its group, GLOBAL; a bundle's
    seller's), every card where they aren't known (a custom subscription's never are).
  - **An item's charges on a card** (`itemLedger`, `itemOnCard`): the next 12 months for savings (PROJECT-PLAN
    §3.1), and what's posted to it in each of the 12 calendar months from this one for its limit, an annual plan in
    the month it's charged.
  - **Limits** (`cardLoads`, `overLimits`, `fits`): a month whose posted charges go over a card's limit, with the
    days past it (the one that goes over, and later ones that month), for P10's days and P11's tiles.
  - **A month on a card** (`monthlyOnCard`, `cardChoices`, `bestCard`): today's monthly equivalent with tax, its FX
    fee and cash back, so net = gross + FX fee − cash back (P11's acceptance), for P4's figures and P6's select and
    Best card chip.
  - **Assign best cards** (`assignCards`): the most cash back less FX fees over the next 12 months, within each
    card's limit in every one of the 12 months and the seller's networks: the items with the most to lose (best card
    against the next; an item with one card possible first) take their best card with room, then moves and swaps
    while they save more. An item with a card always keeps one, moving only to a better card or one its seller
    takes; one with no card gets one only when it pays back more than its FX fees; an item in a list with unsaved
    edits keeps its card, which its charges count against.
  - The tile's summary (`cardSummary`) now posts this month's charges with their FX fees, and gives the net a month
    and the months over the limit.
- **The optimizer's card action** (section 10.3's 7th, `optimizer/card-suggestions.ts`): "Pay for X with a better card"
  as a free saving, for any item, an Essential plan's too: its seller's card that leaves the least to pay over the next
  12 months, with room for its charges on top of what's on the card (the other lists' items, `cardLoads` in the
  input, and this list's). The items it saves the most for choose first, and each suggestion's charges count against
  the cards the next ones look at, never freeing room, so they all fit, alone or together. The action names the card
  (`cardTitle`) and the one it's paid with now (`fromCardTitle`); Apply sets the draft item's `cardId` and nothing
  else; the fingerprint includes both cards, so a dismissal ends when the item's card changes. "Save up to" adds the
  card savings of the items the best plan keeps.
- **Tests:** 34 more in core (the formula, Mullvad's euros, a USD card, eligibility per region, limits and their
  days, the assignment within limits with fixed items, the monthly figures and the best card, and the optimizer's
  card suggestions with Apply).


**Resolved (2026-10-28, M9.2)**
- **`acceptedNetworks` is per region, quoted** (the user's choice): a map keyed like `billingCurrency` (a country, a
  group such as EU, or GLOBAL), each entry `{ networks, url, quotes }`: the networks, the provider's own page that
  names them, and its words, word for word. Netflix showed why: its Canadian page lists Visa, MasterCard and American
  Express, and its US page adds Discover. The schema (`acceptedNetworksSchema`) needs each network named in the quotes
  (core's `card-networks.ts`: `namesNetwork`, `networksNamedIn`, MasterCard or Mastercard, Amex or American Express;
  `other` needs no name), and `validateCatalog` a real region and a page on the provider's own domains. A region left
  out is unknown. The API shows the map as written (the contract's examples changed with it), the D1 tables don't
  change, and a downloaded catalog file with the old list fails its schema in the browser and is downloaded again,
  as any cached file that doesn't read is (M4.3), so it needs no Dexie version.
- **The data, read 2026-10-28:**
  - Netflix: Canada Visa, MasterCard and American Express; the US adds Discover (`help.netflix.com/en/node/116380/ca`
    and `/us`).
  - Disney+: Canada JCB, Visa, Mastercard, American Express and Diners Club (`other`); the US Visa (the Disney Visa
    too), Mastercard, American Express and Discover. One help article, whose list follows the country picked.
  - Hulu (US): American Express, Visa, Mastercard and Discover, U.S. cards only. ESPN (US): Visa (the Disney Visa too),
    Mastercard, Amex and Discover.
  - Proton (GLOBAL): Visa, Mastercard and American Express, in `/pricing`'s FAQ; its support page says only "all
    major credit and debit cards".
  - None named, so none stored (each file's comment says what its pages said): Mullvad ("credit card"; the card
    checkout needs an account), Crave, TSN and RDS (Bell Media's help says "credit card", and the payment details are
    behind a sign-in), and ICI TOU.TV ("par carte de crédit").
- **The pipeline:** M3's scripts aren't built, so the price-research skill (its new rule) and section 6.5's extraction
  (for M3.4) record it, and the nightly bot rechecks it (section 6.4): each region's page is read once a night with
  the rest; a quote gone takes the region's networks out (`withoutAcceptedNetworks`), for review, so its cards are
  unknown again; a network named within 40 characters of the quotes that isn't listed is for review, since only the
  page's words can add one. A page several regions cite (Disney+'s) shows one country's list at a time, so when
  another region's quotes are all there, a region's missing ones are "needs manual check", never a removal. The bot's
  bundle is 680.8 KiB gzipped. It needs redeploying from main once this is merged (section 7.2).
- **The skill's driver:** Disney+'s help centre picker is now a button named "Change country or language", showing a
  flag and the language; `read-page.cjs`'s `country:` step finds it by that name.

**Resolved (2026-10-28, M9.1)**
- **Payment** (PROJECT-PLAN P11) is "Payment cards" with Add card, and under it "We never ask for card numbers, only
  what's needed to estimate cash back and fees." A tile per card, two side by side where they fit: its nickname with
  its name under it; the network and Credit or Debit as outlined badges (their names: no brand images); "1.5% cash
  back · FX fee 2.5%"; "This month" with a budget bar of this month's charges paid with it against its limit ("≈
  $114.10 of $500.00", in the card's currency at the ECB rate), or "No limit"; then the subscriptions paid with it,
  from every list, each with what it costs a month today with sales tax (core's `monthlyWithTax`), and their total
  ("≈ $27.79 / mo with tax"); then ✎ and 🗑. Under the tiles, "1 subscription has no card". With no cards, an empty
  state. Core's `cardSummary` (`rewards/card-summary.ts`) gives a tile's figures.
- **Amounts with tax** (the user's choice for P4's net costs, M9): cash back is earned on the amount charged, tax
  included (section 4.8), so the card figures are with tax, as the totals are, and the price tags stay before tax.
- **The card dialog** (`ss-card-dialog`, opened by `CardEditor`, so Material's dialog and it load on first use) has
  section 9.2's fields and no more: Name, Nickname, Type, Network, Card currency (the user's for a new card), Cash
  back ("Points cards: your own effective %"), FX fee ("Most Canadian cards charge 2.5%") and Monthly limit, in the
  card's currency, empty for none. It starts with "Never enter a card number. Simply Sub never asks for one, …".
  Cash back and FX fee left empty are 0. Core's `cardFormIssues` refuses 12 or more digits in a row in every field,
  the number fields too (typed as text), and the schema now refuses a limit of 12 digits (`maxMonthlyLimit`) as well
  as a name or nickname with a card number, so no import can store one either.
- **Deleting** asks "Delete Everyday?" with how many subscriptions it pays for, in lists and drafts (core's
  `cardUsage`): "2 subscriptions are paid with it, and will have no card." `CardsRepository.removeWithItems`
  soft-deletes it and takes it off every item and draft in one transaction (core's `withoutCard`), as deleting a tag
  does. Focus moves to the next tile's 🗑, else Add card.
- **`CardsRepository`** on the `cards` table: create, update and soft delete through `RecordRepository`, every record
  checked on the way in and out; the app lock seals its rows and backups carry them, as before.
- **Bundles:** the initial bundle went from 497.31 to 496.39 kB (esbuild regrouped a shared chunk). The page is 13.1
  kB raw (4.5 kB gzipped) and the dialog 8.7 kB (2.9 kB), both lazy.
- **Browser checks:** `check-payment.cjs` (new) passes 89/89 on `ng serve`.

**Resolved (2026-10-28, M8.3)**
- **The free-tier limits** (the old open question 1), read on Cloudflare's pages on 2026-10-28 and recorded in
  section 7.1:
  - Workflows (Workers Free): 10 ms of CPU and 50 requests out (1,000 to Cloudflare's services) per step, 1,024
    steps, 100 concurrent instances, 100 created a second, 100,000 executions a day shared with Workers, 1 MiB per
    step result and per event, 100 MB of state, 10,000 retries a step, and 3 days' retention. Cron-triggered
    `schedules` are Paid only; a cron trigger on the Worker starts the instance instead.
  - Browser Rendering (Workers Free): 10 browser-minutes a day, 3 concurrent browsers, a new browser every 20 s, a
    60 s timeout (`keep_alive` up to 20 minutes).
  - Workers AI: 10,000 Neurons a day, reset at 00:00 UTC. JSON mode is on Llama 3.3 70B (26,668 and 204,805 Neurons
    a million input and output tokens), Llama 3.1 and 3 8B and a few others.
- **The bot** is `apps/bot`, a second Worker (`simply-sub-bot`, its own `wrangler.jsonc`): a cron trigger at
  `0 3 * * *` creates the night's Workflow instance (`price-check-<date>`, so a second trigger starts nothing), with
  AI and Browser bindings and the catalog D1, which it only reads (every query goes through a SELECT-only helper:
  D1 has no read-only binding). No public URL. It's built and type-checked by `npm run build` (a dry-run bundle:
  3.3 MB, 679 KB gzipped, within the free plan's 3 MB), and deployed by hand: the owner deployed it on 2026-10-28
  with its token (section 7.2).
- **A night:** read the catalog's index from D1 (each provider's and bundle's pages, and every host); read the base
  branch (its commit, its logos' Git blob hashes, `data/resellers.yaml`); read each host's robots.txt once, 40 hosts a
  step; then a step per provider, with the bundles whose every page it cites, a step per group of the other bundles
  that share a page, and a step per reseller's logo, each retried twice, a failed one listed and the night going on;
  then one step for the pull request. A page is read in one step only, so it's requested once a night.
- **The checks** (`check-pages.ts`):
  - **Prices:** each page's text (`page-text.ts`: no scripts, styles or comments, inline tags joined, entities
    decoded). A price whose amount is on the page near its plan's name, in its currency (`amounts.ts`), or a price for
    several months shown a month at a time (Mullvad's "€5 /month"), is confirmed with no AI. The rest of a page's
    prices go to Workers AI together, on an excerpt around the plans' names (12,000 characters at most), which
    answers each plan's regular price, or that only a sale or first-term price shows. A yearly price isn't matched a
    month at a time: on a page like Proton's ("$3.99/month billed yearly") a changed yearly price could match another
    plan's.
  - **Guardrails (§6.4):** a change over ±30% is flagged ⚠️; a sale or first-term price alone, a price not found, a
    currency other than the stored one (a geo-priced page) and a page that can't be read are "needs manual check",
    never a change. Requests carry `SimplySubBot/1.0` and `Accept-Language: en-CA`, and follow robots.txt (RFC 9309:
    the bot's own group, else `*`; a 4xx allows everything, a 5xx or no answer nothing).
  - **taxIncluded:** its quote must still be on the page (in any quotes and spacing), and no "+ tax", "excl. VAT",
    "taxes calculated at checkout" and the like near the price; otherwise it's taken out, for review.
  - **Resellers:** each approval's quotes on the provider's page; a missing one removes the reseller's listing from
    the provider file, for review (a reseller no provider lists is only a warning in `data:validate`). Their offers'
    prices are checked like any price.
  - **Logos:** the provider's or reseller's best icon, found as `data:icons` finds it, compared by Git blob hash with
    the committed logo, which is read only when they differ. Only an icon at least as big as the committed one is
    proposed: the smoke run found Disney+'s and Hulu's own icons out of reach and the icon services' 96 px ones in
    their place, which is no rebrand.
  - **Browser Rendering** only when a fetch fails (not for robots.txt) or gets no plan name and no price at all, at
    most 5 pages a night (the user's choice). Workers AI stops at 8,000 estimated Neurons a night.
- **The pull request** (`proposal.ts`, `github.ts`): the YAML edited line by line (`yaml-edit.ts`: a price's amount
  and `lastVerified`, `taxIncluded` out, a reseller's listing out), keeping comments and layout; CI's `data:validate`
  checks the result. A price confirmed 30 or more days after it was last verified gets today's `lastVerified` (the
  user's choice), so the 90-day badge never shows on a price the bot keeps confirming. The commit goes on
  `bot/price-updates`, rebuilt from the base branch each night it has changes (force-pushed: the branch is the bot's
  own), and the open PR gets tonight's title and body, or a new one opens. It never merges. A night with nothing to
  change opens none, and what needs checking waits for the next PR's body (the user's choice). The body has Price
  changes (a table with the change in %), For review, Logos, Needs manual check (one line per page and reason) and
  Confirmed. Pages' words are only ever quoted, escaped and cut to 160 characters.
- **Libraries:** `@cloudflare/playwright` 1.3.6 for Browser Rendering, which has no dependencies.
  `@cloudflare/puppeteer` 1.4.0 was tried first: its `@puppeteer/browsers` (a Chrome downloader a Worker never runs)
  brings 7 high advisories, `extract-zip`'s with no fixed version, so CI's audit would fail. `npm audit
  --audit-level=high` passes.
- **The smoke run** (once, from this machine, on 2026-10-28): the real night against the live sites with the local
  catalog, no Browser Rendering and Workers AI answering nothing, in 42 s and 147 requests, every robots.txt
  followed. 41 prices were confirmed without AI. It found the fixes above (pages read twice by a provider and its
  bundles, the smaller icons, `&reg;` undecoded, which likely made SerialCart's quote look gone) and that many pages
  are rendered by scripts (Proton, Crave, TSN, RDS, Disney+'s help pages): on a real night those go to Workers AI
  when their text has the plans, or to the 5 browser pages, else they're "needs manual check".
- **Tests** (`apps/bot/test`, on Node with fakes): the four "done when" cases end to end on the real Netflix and
  Mullvad files (a changed price, a changed logo, a taxIncluded quote gone and a reseller no longer named each make a
  PR, with the edited file passing its schema), a quiet night opening none, a failed step, and the parts: page text,
  amounts, tax wording, robots.txt, the YAML edits on real files, the guardrails, the browser and AI budgets, logos,
  the step plan, the PR's text and GitHub's calls (one branch, one PR refreshed, never a merge).

**Resolved (2026-10-28, M8.2)**
- **Optimizations** (PROJECT-PLAN P14) is "Optimizations" under the back button by the list's name, with "Save up to
  $830.88 a year" (the yellow plan's savings, ≈ when estimated, shown while a card is) and an ⓘ button whose tooltip
  gives the rules (Needed never lost in a month it's needed, Essential keeps the plan, Critical the provider, savings
  over the next 12 months with tax, each change on the item's next charge). Then the sections in P14's order, each
  heading with its colour dot and what it means: Free savings ("nothing is lost", the user's choice in M8.1),
  Recommended, Suggested and Worth a look. "Show dismissed (n)" comes last, once something is dismissed.
- **A card** (`ss-suggestion-card`) has its section's colour as a stripe, its changes (core's `actionTitle`, a line
  each), "Save $138.60 over the next 12 months" with an Estimated tag (focusable, with a tooltip) when converted
  prices are in it, a line per change with the prices it goes from and to (`ss-price`) and when ("From Nov 20, 2026",
  "Ends Nov 21, 2026 instead of renewing"), then "You lose:" (each removed item "itself", by its title, then each
  feature with its rank's dot and name) and "You gain:". Apply and Dismiss are named for the changes ("Apply: Switch
  Disney+ Premium to annual billing"); a dismissed card shown again has Show again.
- **Apply** starts or resumes the list's draft, puts the card's edits on it in one write (core's `suggestionEdits` and
  `withDraftEdits`, `DraftsRepository.applyEdits`) and opens the editor, so nothing is saved until Save. The edits
  follow the user's choice, at the next renewal: a removed or replaced item gets its next charge as its end date (an
  item that would only start then, or Specific dates, which have no end date, leaves the draft); a plan or billing
  change keeps the item, re-anchored on its next charge, without its price override, with the add-ons its new plan
  allows; an extra member is added to the host; a bundle or suite is a new item from the earliest next charge, with the
  replaced items' tags and pins, and their own ranks (the more important where two rank a key). When the draft's
  unsaved changes took out an item the card changes, the snackbar says so and nothing is applied.
- **Dismiss** stores the card's fingerprint in `dismissedSuggestions` (`DismissedSuggestionsRepository`), says
  "Dismissed until the list changes" with Undo, and moves focus to the next card's heading (else the one before, else
  Show dismissed). Show again soft-deletes the record. A change to the list gives new fingerprints, so the card comes
  back.
- **`dismissedSuggestions`** (core's `user/dismissed-suggestion.ts`): `{ fingerprint, listId, createdAt, updatedAt,
  deletedAt? }`, keyed by the fingerprint (16 lowercase hex digits). Dexie v3 indexes `listId` and empties the table
  (section 4.6). The app lock seals it, with `fingerprint` and `listId` plain. Backups carry it: the file is version 2,
  and a version 1 file is read with no dismissals.
- **List view** (P4): `ss-optimizations-link` after the feature summary, "View optimizations (9)" with a dot and the
  outline in the strongest suggestion's colour (red, then orange, then yellow; green, `--suggest-free` from Wanted's,
  for free savings alone, the user's choice), named "View optimizations (9), the strongest: Recommended"; "No
  suggestions" in a neutral outline; "View optimizations" while they're found. Core's `suggestionSummary` counts what
  isn't dismissed.
- **Where it runs** (`OptimizerService`): its input from MetricsService's priced items (once none waits for its
  catalog file), the catalog file of each item's region, the rates, the settings' country, currency and tax place
  (nothing else of the settings), and the ranks. Up to 12 items run on the page: under 10 ms in Node (M8.1), well under
  50 ms on a slow phone. A bigger list goes to a Web Worker (`optimizer.worker.ts`, bundled by Angular as
  `worker-<hash>.js`). If the worker can't start or load, it runs on the page instead.
- **The worker under the production CSP:** Trusted Types make a Worker's URL a script sink, and Angular bundles a
  worker only for `new Worker(new URL('./x.worker', import.meta.url))`. `optimizer-worker.ts` shadows `Worker` with a
  subclass that passes the URL through a policy of its own, `simply-sub#worker`, which takes only this origin's
  `worker-*.js` files. `_headers` adds `worker-src 'self'`, the policy to `trusted-types`, and a year's immutable cache
  for `/worker-*.js`. No `blob:` URL and no eval: the worker imports `zod-setup.ts` first, so Zod never tries
  `new Function`. Checked in Edge under `wrangler dev`: a 14-item list optimized in the worker, with no CSP or Trusted
  Types violations, and `csp-check.cjs` passes.
- **Browser checks:** `check-optimizations.cjs` (new) passes 90/90 on `ng serve` and under `wrangler dev`, and the
  reruns pass: list view 187, list editor 77, backups 81, app lock 159, shell 51, Settings 80.
- **Bundles:** the initial bundle grew 0.04 kB (497.31 kB of 500). The optimizer, its service and the worker's starter
  are a chunk List view and the page share (14.2 kB raw, 5.8 kB gzipped); the page is 18.2 kB (6.1 kB); List view went
  from 38.7 to 41.0 kB raw; the worker is 159 kB raw (44 kB transferred), with Zod and the catalog code it needs.

**Resolved (2026-10-28, M8.1)**
- **The optimizer** (section 10) is core's `optimizer/`: `optimize({ items, catalogs, context, cards? })`, where
  `items` are a list's resolved items (MetricsService's), `catalogs` the catalog file of each region they're priced
  in, `context` today, the user's country, currency, rates, tax place and profile ranks, and `cards` a slot for M9.
  It returns `{ suggestions, bestSavings, bestEstimated, currency, next12, search }`. Nothing reads the clock.
- **Money:** every amount is the next 12 months (PROJECT-PLAN §3.1) from the schedule engine, sales tax included:
  each option's new item is resolved with `resolveItem` and charged with `itemCharges`. An item with a charge in
  another currency (no rate) stays as it is, and a card with a converted price is `estimated`.
- **When a change takes effect:** on the item's next charge, so what's paid for is used up first. A bundle or suite
  starts on the earliest next charge of the items it replaces. A change drops the item's price override (it was for
  the old plan) and keeps the add-ons the new plan allows, within its limit; `reperiod` keeps a billing day that
  still applies. Specific dates keep their windows and period: they're never moved to annual billing.
- **Candidates** (section 10.3), each kept only when it costs less over the 12 months than what it replaces:
  annual billing (an item that renews by itself, to a yearly price that does too); another plan of the provider,
  its free plan too (`downgrade` when it gives a subset, else `switch`), on the item's period or yearly; removal;
  an extra member (an add-on with `grantsPlan` on another item of the same provider, within the host plan's
  `addOnLimit`, up to 3 at once); a bundle whose plans' providers are the items' (one item per plan, at least two);
  and a suite plan whose `includes-subscription`, followed through, has the items' plans, with up to
  `account.users` copies of each. A bundle item the list has can move to annual billing only. The 7th action (a card)
  is a `card` action kind M9 fills in.
- **The rules, the user's choices:**
  - **Coverage is per item:** ranks are an item's own, so a plan change, an extra member, a bundle or a suite is
    judged on what replaces that item. Only a removed item's features can be kept by other items, of another
    provider: the overlap that's the reason to remove it. Netflix moving to ads loses Ad free even when Disney+ is
    ad-free.
  - **Another item of the same provider never counts:** it's someone's own account (two Netflix accounts for two
    family members), so a copy is never removed for overlap. It can become an extra member, or both move to a suite
    with enough users.
  - **Removing an item loses its service itself**, which no feature describes: yellow, or orange or red when every
    key it provides is ranked Unused or Unwanted. Removal is suggested **only with a reason**: another provider's
    item gives one of its keys in every month it would still have been active (two VPNs, never both), or every key
    it gives is Unused or Unwanted. A service nothing overlaps isn't suggested for removal, so a list with nothing
    ranked isn't told to cancel everything.
  - **Free savings lose nothing at all.** Losing a Not-ranked feature is red, as section 10.4 says; P14's "nothing
    you rank is lost" became "nothing is lost".
  - **Hard constraints** (section 10.2) are checked month by month: an item's Needed, Critical and Essential keys
    must be kept for it in every slot it's active in. Essential allows annual billing and a bundle with the same plan
    only; Critical allows the provider's plans that give its Critical keys, a bundle's or suite's that do, and never
    removal.
- **Cards** are per-level plans (the user's choice): for each severity (free, red, orange, yellow) the cheapest valid
  combination, its plan. A plan's changes are split into cards that can be applied on their own: two changes share a
  card when an item's key, in some month, is given neither by its own change nor by an item left as it is, and the
  other change gives it or takes away an item that gave it (removing both of two overlapping services, a bundle that
  brings what another change takes). Each section lists its own plan's cards of its severity, so a section's cards
  never conflict and their savings add up; a card in a looser section can be an alternative to one in a stricter
  section for the same item (Disney+ billed yearly in Free, Standard billed yearly in Red). "Save up to" is the
  yellow plan's savings.
- **The coverage map** (section 10.1) is 12 slots, a month each from today, with a bit per slot an item is active
  in (`optimizer/coverage.ts`): Ongoing from its start date until its end date, a window through its end, copied
  into each year when it repeats.
- **Search** (section 10.4): the list splits into parts whose items can't affect each other (no check depends on
  both, no option has both), each searched alone. A part with up to 10^5 combinations is searched exhaustively,
  depth first, the costliest items first, pruned by cost (a lower bound: each item's cheapest option, an option of
  several split evenly) and by checks that fail as soon as the items they depend on are decided. A bigger part gets
  greedy search, the change that saves the most each time, then pairs of changes that interact (local improvement),
  within 20,000 judged combinations per severity; a looser severity's plan is never worse than a stricter one's.
- **Fingerprints** are 16 hex digits, two FNV-1a hashes of the list's items as the optimizer read them (id, source,
  region, billing, price override and each provided key's rank) and the card's changes. The same list gives the same
  ones on every run and device; changing an item, re-anchoring it or a rank its keys have gives new ones. The item
  ids are random, so a fingerprint (the dismissal's key, plain under the app lock) can't be matched to plans by
  guessing.
- **Words** (`suggestion-text.ts`): "Switch Disney+ Premium to annual billing", "Downgrade Netflix Premium →
  Standard", "Remove Mullvad VPN", "Make Sam's (Netflix Standard) an extra member on Mine (Netflix Standard)",
  "Replace Proton Mail Plus and Proton VPN Plus with Proton Unlimited". Items keep their nicknames (`itemTitle`).
- **Fixtures** (`test/optimizer/`, a small catalog with fixed prices, Alberta's 5% GST): annual billing (and none
  for a plan renewed by hand), a bundle, a suite, red, orange and yellow downgrades, the two VPN cases, Essential,
  Critical, a Sep–Oct window keeping a Needed feature covered, duplicates across family members with extra members,
  three Netflix accounts onto Premium's two extra members, Mullvad's euros (estimated), a plan billed on the 31st,
  a window plan changed in place, a payment due today, a 16-item list that needs greedy search, and fingerprints.
  The cards and their colours are inline snapshots.
- **Speed** (Node, one run): under 10 ms up to 12 items, 14 ms at 15, 21 ms at 16 and 59 ms at 20 (greedy). M8.2
  runs it in a Web Worker for bigger lists.
- **Bundles:** the initial bundle didn't change (497.3 kB): nothing in the app imports the optimizer yet.

**Resolved (2026-10-28, M7.6)**
- **The budget warnings** (PROJECT-PLAN §3.1) are `ss-budget-warnings`, on core's checks (`ListMetrics.warnings`,
  M7.1):
  - "Your payments in January 2027 add up to ≈ $137.20, over your $50.00 monthly budget." names the first of the next
    12 months over the monthly budget ("this month" for this one), with "See January 2027 in the Calendar".
  - "Your payments this year, past and to come, add up to ≈ $610.64, over your $500.00 annual budget."
- **Home** checks every list together, above its calendar and totals, once every item is priced. **List view**
  checks the list alone ("This list's payments…", the user's choice), its link opening the Calendar on that month
  showing the list.
- **How it reads:** a card with the over colour's stripe and a warning icon, read "Warning: …" with "about" for ≈. Its
  status region is there before any warning, so one that appears as prices load is read out. On Home it shares a block
  with the calendar and totals, so the empty region adds no gap to Home's spaced column.
- **Bundles:** the initial bundle didn't change (497.3 kB). Home and List view grew 0.9 kB gzipped each.

**Resolved (2026-10-28, M7.5)**
- **The exports** (section 11.2) are laid out by core's `export/` (tables, calendar events, a list's text and its JSON
  file) and written by the libraries chosen for them, pinned to exact versions and loaded only for their format:
  papaparse for CSV, exceljs for the workbook and `ics` for calendars. Text and JSON need none. In the app,
  `shared/export/`'s `Exporter` reads the lists as their pages show them (MetricsService, live tags) and saves through
  `save-file` with "Saved <name>"; `export-files.ts` loads with the first export.
- **What each file holds** (the user's choices):
  - List view's CSV: a row per item with List, Service, Plan, Nickname, Cost, Tax, Currency, Converted, Billed,
    Renews, Next charge, Ends, Status and Tags. Cost is one charge of the item's own period today, as charged with tax
    (core's `periodCost`: the price override while it applies, else the price and the add-ons billed with it; an
    add-on on a period of its own isn't in it). An item that can't be priced is named by its source, with why in
    Status.
  - The Calendar's payment schedule (CSV): a row per charge in the next 12 months for the lists shown, in date order.
  - The workbook, from either page: Summary (each list's totals as its page shows them, then Total), a sheet per list
    of its items (the CSV's columns without List), then Payments.
  - Text (List view): the list's totals, then each item with its cost, renewal, next charge, end date, add-ons, own
    price, status, tags and note, then the items it can't price.
  - JSON (List view): the list, its items as stored, and the custom subscriptions and live tags they name. It has no
    `schemaVersion`, so Import refuses it ("This file isn't a Simply Sub backup").
  - Calendar (.ics): an all-day event per charge in the next 12 months (`DTSTART;VALUE=DATE`, ending the next day,
    shown as free), titled "Netflix: $19.94", or "Renew Mullvad VPN: ≈ $94.16" for a manual renewal, with the plan,
    list, tax, renewal and "Its last charge before it ends". A plan billed on the 31st has an event in every month.
    Each UID is the item, the date and the currency, the same in every export.
  - Amounts are numbers rounded to their currency's minor unit, beside its code, and dates are ISO (real dates in the
    workbook), so spreadsheets add and sort them. Only live tags are named (M6.11).
- **Spreadsheet safety:** a CSV cell of text that starts like a formula (=, +, -, @) gets a `'` first (papaparse's
  `escapeFormulae`), and the file starts with a byte order mark, so Excel reads it as UTF-8. exceljs writes text cells
  as text.
- **File names:** `simply-sub-work-related-2026-10-28.csv` from List view (the list's name in plain letters and
  digits) and `simply-sub-payments-2026-10-28.ics` from the Calendar.
- **List view:** Export ▾ beside Edit list, when the list has something in it: CSV, Excel, JSON, Text and Calendar
  (.ics).
- **The Calendar:** for the lists shown, over the next 12 months:
  - Sync calendar ▾ (Google, Apple and Proton Calendar): the .ics downloads, then a dialog gives that app's import
    steps (from each one's help pages), with focus on its heading, Download again and Done.
  - Export to file (`ss-split-button`): Calendar (.ics) as the main button, then Payment schedule (.csv) and Excel.
- **Under the production CSP with Trusted Types** (`wrangler dev`, csp-check.cjs): no library needed eval or
  innerHTML, and there were no violations. One fix: the production build's chunk optimizer gives a CommonJS library's
  dynamic import as `default` only, keeping just what the code reads, so named exports alone were undefined there
  (the dev server and the tests had them). `export-files.ts` reads `default` when there is one.
- **Offline,** a library not loaded yet can't load: "The file couldn't be made. Check your connection, then try
  again." The snack bar loads with the page so it can say so.
- **npm audit --audit-level=high** passes. exceljs 4.4.0, the latest, brings two moderate advisories (uuid < 11.1.1:
  a missing bounds check in v3, v5 and v6 when a buffer is given); exceljs only calls v4.
- **Core:** `planTitle`, `itemTitle`, `periodText`, `addOnText` and the words for an item that can't be resolved moved
  to `user/item-text.ts`, so the cards, the editor and the exports say the same.
- **Bundles:** the initial bundle grew 0.9 kB (497.3 kB of 500): the bundler's CommonJS helpers that exceljs and ics
  need, which it keeps with its other helpers in a chunk the initial bundle loads. Beyond it, gzipped: List view
  +1.6 kB; the Calendar +11.4 kB, mostly Material's menu (30.7 kB raw) for its two menus, which List view, Lists and
  Search load too. With the first export: export-files 3.9 kB, papaparse 7.0 kB, ics 23.9 kB (with yup) and exceljs
  270 kB (Excel only).

**Resolved (2026-10-28, M7.4)**
- **The Calendar** (PROJECT-PLAN P10) is "Calendar" with the month's bar, Showing, the month's navigation, the grid
  and Upcoming. Sync calendar and Export to file come with M7.5.
- **The bar** (section 8.1.1) is `ss-budget-bar` with the amount inside: what's been paid so far (charges up to today;
  all of a past month, none of a future one) out of the month's total, which is beside it, with the monthly budget's
  tick when the total reaches it. Its colour compares the total with the budget.
- **The URL** (core's `user/calendar-params.ts`): `?month=2026-10&lists=<id>,<id>`, with `lists` only when not every
  list is shown. A month that isn't one, a list that's gone or every list named is rewritten in place, as Search
  does; a month or list change adds a history entry.
- **Showing** is remembered on this device, as PROJECT-PLAN §3.5 has it: `settings.calendarHiddenLists` keeps the
  lists left out (an optional field, so stored settings stay valid with no new Dexie version), so a list made since
  shows. A URL with `lists` wins.
- **The grid** (core's `monthGrid`, which fills the weeks from the months on either side, shown muted):
  - Each day of the month is a button over its cell, named with its payments, "Monday, October 12, 1 payment,
    $19.94". It's one tab stop, moved like the mini calendar's, Page Down crossing into the next month.
  - Its chips (the icon and the amount, the name too where the cell is 140 px wide), "+2 more" and the total sit beside
    the button and are hidden from screen readers: inside it, axe's `label-content-name-mismatch` failed, as its name
    didn't hold what it showed (WCAG 2.5.3). A chip's own click opens the day on that charge.
  - Today is outlined; the day the panel shows has a border twice as thick in the accent colour. A tint failed
    contrast for the muted total in dark mode (4.2:1), and the faded other-month numbers did too, so they're the muted
    colour alone.
- **The day's panel** (`ss-day-panel`), on the grid's right from 960 px: the day, then each charge with what it is, its
  amount as charged, how it renews ("Renew manually" with ↻), "Ends Nov 3" on the last charge before an end date, its
  list as a link, and Wrong date? (M7.1's dialog) for a charge still to come of an Ongoing item. Focus starts on its
  heading, or on the charge a chip opened; ✕ and Escape close it, with focus back on the day.
- **Under 600 px** the month is an agenda: a card per day with payments, each payment a button that opens the day in a
  bottom sheet (Material's, loaded on first use), whose panel puts focus on that payment.
- **Upcoming:** the next five charges from today for the lists shown, as charged.
- **List view's mini calendar** (P4) follows the totals: the list's charges, with a day or the title opening the
  Calendar on that month, showing that list. Under 960 px it folds behind a Calendar button (`aria-expanded`). From
  960 px it's at the top of the side column, after the cards in the page too, so the Tab order goes from the cards to
  it as the columns read (fixed after M7.6: inside the totals' block, it came before the search box).
- **`ClockService.today` moves on at midnight** (a timer for a second past the next local midnight, so a 25-hour
  night is fine) and when a hidden tab is shown again, as timers there run late. Home's and List view's mini calendars
  and the Calendar follow it into a new month when their month isn't set.
- **Bundles:** the initial bundle grew by 0.8 kB (496.4 kB of 500): ClockService's timer (0.6 kB), and esbuild's names
  for the CDK code another page now shares. Beyond it, gzipped: the Calendar 124.7 kB, and its bottom sheet 7.4 kB
  more on a phone; List view 5.7 kB more, for its mini calendar.

**Resolved (2026-10-28, M7.3)**
- **Home** (PROJECT-PLAN P2) follows the wireframe: the mini calendar on a card, every list's totals beside it (M7.2's
  `ss-budget-totals`, with "Set a monthly budget →" where a budget isn't set), and the Subscription Lists pill under
  them, centred. Under 720 px they stack. Its "Home" heading is for screen readers only.
- **Next payments** (P2's optional strip): the next three charges from today, as charged, with ↻ and "renew manually"
  for a manual renewal. Its parts keep their spaces inside the spans, so a screen reader doesn't run "Nov 12Netflix"
  together.
- **The mini calendar** shows every list's charges in its month (`MetricsService.charges`, as the Calendar does). A day
  or the month's title opens the Calendar on that month. Its month follows today, so a tab left open past midnight
  into a new month shows it (M7.4's ClockService).
- **While prices load** (an item's catalog file not yet downloaded, `pending`), the calendar has no dots, a row of dots
  under it that pulse (they stay still with reduced motion), and "Loading your payments…" in a live region: P2's
  skeleton dots.
- **No lists:** an empty state, "Start with a list", with Create a list, Browse services and Import backup. Import opens
  Settings' dialog, with Material's dialog and snackbar loaded on the click, since Home rarely needs them.
- **Totals match:** Home's this month and this year are the sum of every list's at full precision (a unit test). Shown
  rounded, a list's cents can add up a cent away from Home's, which `check-home.cjs` allows.
- **Bundles:** the initial bundle didn't change (495.5 kB). Home loads 78.3 kB gzipped beyond it (53.2 kB with M7.2's
  totals): the mini calendar's tooltip brings the CDK overlay, which Search and List view load too.

**Resolved (2026-10-28, M7.2)**
- **Totals in `MetricsService`** (§3.4): `metrics(listId)` and `global` (every list's items together, Home's), both
  core's `listMetrics`, plus `metricsOf(items)` for a draft and `charges(range, listIds?)` for the calendars. They
  follow the settings' currency, tax place and budgets, the catalog and today.
- **A conversion flag for each total** (`ListMetrics.converted`): "≈" goes on the total that has a converted amount,
  not on every total once one has (Mullvad's euros in January put ≈ on this year, not on October).
- **`ss-budget-totals`** (`shared/budget-totals/`) shows this month and this year:
  - with a budget, a bar (`ss-budget-bar`, the percent inside) and "$100 of $200 this month" or "… in 2026" beside it,
    under a heading that names the bar ("Monthly budget");
  - without one, the amount alone ("$100 this month"), and on Home "Set a monthly budget →" to Settings;
  - on a Lists card (`compact`), no headings: bars named for their list ("Work Related, monthly budget") and "$50 this
    month", "$250 this year";
  - "1 subscription not counted" when one can't be priced or converted.
- **The Lists overview (P3):** the bars replace the average, as the wireframe has them, then the count. Rank counts and
  the global feature summary now come from the metrics.
- **List view (P4):** the header keeps its average, and the side column starts with the totals: bars with budgets,
  amounts without (the user chose both). From 960 px they're on the right above Types and Features (a grid with named
  areas, set only at that width: without a template the areas put the blocks in odd places); under it they come above
  the cards. Each card gives its share of the next 12 months, "31% of list".
- **The list editor (P5):** its footer says "This month $26.52" before the average, from the draft's charges.
- **Home (P2):** the totals for every list, with the prompts, until M7.3 builds the rest of the page.
- **Bundles:** the initial bundle's code didn't change (495.5 kB); esbuild split one of its chunks in two, which costs
  0.8 kB more gzipped. Beyond it, gzipped: List view 3.6 kB more (192.9 kB), the Lists overview 3.1 (83.5 kB), the
  list editor 1.7, the item dialog 1.7 and Search 0.7, for `ss-budget-totals`, the bar and `listMetrics`. Home went from
  a placeholder's 0.3 kB to 53.2 kB, as it now prices every list (MetricsService, the catalog and the schedule).

**Resolved (2026-10-28, M7.1)**
- **The schedule engine** is core's `schedule/`, on M4.6's resolved items:
  - **Dates** (`chargeDates`, `nextChargeDate`, `lastChargeDate`): each date is counted from a fixed point, never
    from the charge before. Ongoing billing is the anchor plus or minus whole periods, on or after `startDate` and
    before `endDate`. Months and years use `addMonths(anchor, n, billingDay)`, which now takes the day to land on;
    days and weeks are plain counts. Specific dates charge at each window's start, then every period before its end,
    with a yearly window copied into each later year.
  - **Charges** (`itemCharges`): §3.1's `Charge`, plus `ends` on the last charge before an end date (P10's "Ends").
    A date costs the price override while it's before the override's `until`, else the price plus each add-on ×
    its quantity. An add-on sold only for another period (Disney+'s monthly extra member on a yearly plan) is charged
    on that period's dates, from the same anchor. A charge of 0 isn't one, so a free plan has none. A date with a price
    in another currency, for want of a rate, gets a charge in each currency.
  - **Status** (`itemStatus`, on `itemActivity`): "Ends" when the end date is after today and within 30 days, and a
    manual renewal when the next charge is one: an Ongoing item that doesn't auto-renew, or Specific dates on a price
    renewed by hand.
  - **Totals** (`listMetrics`): this month, this year and the next 12 months; `approx`; `notCounted` (items that
    can't be priced, and items with a charge in another currency); each item's share of the next 12 months (a card's
    "31% of list", M7.2); rank counts and the feature summary; the budget shares; and `warnings`, the budget checks:
    the first of the next 12 calendar months, this one included, over the monthly budget, and this year's past and
    projected charges over the annual one.
- **Tax on charges** (`tax/charge-tax.ts`, `salesTaxOn`): each price in a charge gets the buyer's rate from
  `addedSalesTax`, where the item was bought (`buyerTaxPlace`). None on a price with `taxIncluded` (Mullvad), and
  none on a typed amount unless it's marked plus tax. The Canadian rates were checked on 2026-10-26
  (`canadianSalesTaxCheckedOn`), two days before, so they weren't checked again.
- **A future anchor is the next renewal:** the item dialog asks for the anchor as "Next renewal", one period from
  today by default. Counted back, that puts a charge on today, the payment made on subscribing. Decided here: an
  Ongoing item's next charge is on or after its anchor while that's still to come. Today's charge still counts in the
  totals, and the calendar shows it.
- **`ResolvedItem`** gains `overridePrice` (the override whatever the date, for the charges before its `until`),
  `status` and `nextCharge`. `resolveItem` takes the tax place, Settings' country, province and rate, which
  `MetricsService` passes. The item dialog resolves its form's item as it's typed: one with a date that isn't one yet
  has no next charge, rather than throwing.
- **"Wrong date?"** (P4; the Calendar's day panel comes with M7.4) follows a card's next charge, for an Ongoing item
  only (Specific dates have no anchor). Its dialog (`shared/wrong-date/`, loaded on first use) asks for the date,
  filled in, with the datepicker. Core's `reanchorIssue` wants today or later, within the item's start and end dates,
  and `reanchored` keeps the billing day while the new date allows it (Nov 30 for the 31st). It's saved straight to
  the item, with no draft. The field has no `[min]`: the datepicker's own check added an error with no message, ahead
  of core's.
- **Where it shows:**
  - **List view's cards:** the status with "Ends Nov 3" and ↻ "Renew by Nov 3", and the details start with "Next
    charge Nov 12, 2026: $19.94, with $0.95 tax" and Wrong date?.
  - **The list editor's rows:** "Renews Nov 12 · auto", "Renews Jan 20, 2027 · manual · ends …", "Specific dates · next
    charge Sep 2", and "Ended Oct 1, 2026" when nothing is left.
  - **The item dialog's footer:** "$18.99 / mo · next charge Nov 12".
  - **Search:** a provider's "Ends" and "Renew by" (core's `providerRenewals`; the user chose the rule): "Renew by"
    when its soonest next charge across its items is a manual renewal, and "Ends" only when every item still going on
    ends within 30 days, on the latest end.
- **Period helpers:** `Period`, `samePeriod` and `addPeriods` moved from `user/item-form.ts` to `dates/period.ts`, so
  the schedule doesn't load the item dialog's rules. That took 2.2 kB gzipped off the Lists overview and the list
  editor.
- **Bundles:** the initial bundle grew by 0.1 kB (495.5 kB), for the date helpers the startup code has. Beyond it,
  gzipped: Search from 192.8 to 198.4 kB, as it now resolves the user's items for its badges (MetricsService and the
  schedule); List view 5.3 kB more, the list editor 1.6, the Lists overview 1.0 and the item dialog 2.7. Wrong date's
  dialog is 1.5 kB of its own, on the item dialog's datepicker chunk.

**Resolved (2026-10-28, M6.11)**
- **Custom tags** (PROJECT-PLAN P13) is a card in Settings, after Budgets, near the top as the wireframe has it.
  - **A row per tag,** in the order they were made: its colour as a round button ("Colour of Family: Blue"), its name,
    ✎ ("Rename Family") and ✕ ("Delete Family"). With none, a line says what tags are for.
  - **✎ and the colour open one editor** in the row's place: Name, the 12 presets as radio buttons, and Hex colour.
    - The presets are `ss-tag-colours`, shared with the picker's Create tag.
    - Hex colour takes `#rrggbb` or `rrggbb` in any case, and stores lower case (core's `parseTagColor`). A colour
      that's no preset leaves none checked.
    - ✎ starts on the name, the colour button on the colour the tag has. Enter saves, Escape cancels, and focus goes
      back to what opened it.
  - **⊕ New tag** opens the same editor as a new row, with the first preset no tag has yet. Once it's saved, focus is
    on its ✎.
  - **✕** deletes at once when nothing uses the tag. When something does, it asks first: "Delete “Work”? Used by 5
    subscriptions. It comes off them in every list.", with focus on Cancel. A snackbar says "Deleted Work", and focus
    moves to the next row's ✕, else the previous one's, else ⊕. There's no Undo: P13 didn't ask for one.
- **Names** follow the picker's rules, now core's (`user/tag-rules.ts`, `tagNameIssue`): trimmed, not empty, and no
  two tags with the same name in any case ("There's a tag called “Work” already"). A tag can change its own name's
  case.
- **Deleting** (`TagsRepository.removeWithItems`) is one transaction on tags, items and drafts:
  - The tag is soft-deleted.
  - Core's `withoutTag` takes its id off every item that has it, with a new `updatedAt`. Soft-deleted items lose it
    too, so a list's Undo can't bring it back.
  - It comes off every draft's items too, as edited and as saved, so a draft doesn't look changed and its Save writes
    nothing for it. A draft's items keep their timestamps, which Save sets.
  - With the app lock on, every row it writes is sealed, as any write is. A test checks both.
- **"Used by 5 subscriptions"** (`tagUsage`) counts the items in lists and in lists' drafts, each once (the user chose
  this). It's read as stored when ✕ is pressed (`TagsRepository.usage`), so it's right before the repositories have
  loaded the items.
- **The item dialog's picker** (P6) has "Delete a tag" beside its field: a menu of the tags that deletes one
  everywhere through the same flow (`shared/tags/tag-deleter.ts`), then takes it off the item's chips. With no tag
  left, focus moves to the field. The user chose a menu over an ✕ in each suggestion: a button inside an
  autocomplete option fails axe's `nested-interactive`, and the arrow keys never reach it.
- **A deleted tag never shows:**
  - Chips, suggestions and List view's Tags filter use the repository's live tags.
  - A List view filter on a tag deleted meanwhile is dropped.
  - The item dialog saves only live tags, so an item open while its tag is deleted elsewhere doesn't get it back.
  - Exports list live tags only (M7.5).
- **Core without Zod:** the presets moved from `user/tag.ts` to `user/tag-rules.ts`, which imports no Zod, so Settings
  uses them without the record schemas (M6.10's lesson with Lock after).
- **Bundles:** the initial bundle didn't change (495.4 kB). What a page loads beyond it, gzipped:
  - **Settings:** from 93.5 to 98.7 kB, for the card, its editor and the delete flow with `ss-confirm`.
  - **The item dialog:** its chunks counted alone grew 6.7 kB, mostly Material's menu, which the list editor that
    opens it has loaded already.
  - **The list editor and List view:** 1.1 kB each, for the repository's delete.

**Resolved (2026-10-28, M6.10)**
- **Security** (PROJECT-PLAN P13) is a card in Settings, between Your data and Catalog.
  - "Lock with a passphrase" is a checkbox that opens a dialog. It shows what's so, not the click, until the dialog
    has done it.
  - **Turning on** asks for the passphrase twice (at least 8 characters, never trimmed: core's `passphraseIssues`, as
    Export's) and Lock after. It says nobody can recover a forgotten passphrase, and offers Export a backup first, in a
    dialog over it.
  - **Turning off** asks for the passphrase. A wrong one says so, keeps focus in the field and changes nothing.
  - **Lock after:** 5, 15 or 30 minutes, 1 hour, or Never, which locks only when the tab closes. The task asked for
    these; P13 had 5, 15 and 60 minutes. It starts on 15, shows on the card once the lock is on, and changes with no
    passphrase, since it's stored plain. Core's `user/lock-idle.ts` has the choices. It imports no Zod: taking them
    from the schema's file brought Zod into Settings, 31 kB gzipped.
  - In in-memory mode (P15) nothing is saved, so the checkbox is turned off there and says why.
- **What's stored** (core's `user/app-lock.ts`):
  - `settings.appLock` is `{ salt, iterations, check, idleMinutes? }`: a 16-byte salt, PBKDF2's iterations (600,000)
    and `check`, a known text sealed with the key, which tells a wrong passphrase. Nothing stored opens the data
    without the passphrase. The key is a non-extractable `CryptoKey`, held in memory only while unlocked.
  - The locked tables are every user table but the caches (`lockedTables`): settings, lists, items, customSubs,
    rankings, cards, tags and drafts. dismissedSuggestions joins with its schema (M8.2).
  - A sealed row keeps its key and indexes plain (`lockPlainFields`) and holds the whole record in
    `sealed: { iv, ciphertext }`. That's AES-256-GCM, bound to the row's table and key
    (`simply-sub:lock:<table>:<key>`), so a value moved to another row doesn't open.
  - The settings keep `key`, `theme` and `appLock` plain, so the theme and the lock are known before unlocking. Their
    budgets, country, province and tax rate are sealed: §11.5 had all the settings plain, but P13's acceptance
    counts amounts. `appLock` is never in the sealed value, so Lock after changes with no key.
  - Backups leave `appLock` out. It's this device's, and the file isn't sealed with it.
- **The storage engine** does the sealing (§11.1):
  - **Every write reads the lock** stored in the settings, in its own transaction.
    - It seals with the key in memory when the lock is on, and writes plain when it's off.
    - It throws an `AppLockedError` when the lock is on and this tab is locked, or holds a key for another salt. So a
      tab that hasn't yet heard of a change made in another tab never writes plain rows, or rows it can't seal.
    - A settings write keeps the stored `appLock`: only the lock's own methods change it.
  - **Reads open sealed rows.** The engine remembers each row's text by its table, key and value, so a table read
    again after one change decrypts one row. A row that doesn't open is hidden and reported like one that fails its
    schema (`sealed: unopened`), and left as it is.
  - **Turning on** seals every locked table in one transaction. **Turning off** opens them all in one and removes
    `appLock`. Together they give back every row exactly, which a test checks on every table, a deleted record and a
    draft included.
  - **WebCrypto in a transaction:** IndexedDB commits a transaction with nothing to do when a task ends, and WebCrypto
    answers in a later task. Sealing and opening go through the transaction's own `waitFor` (what `Dexie.waitFor`
    calls). Without it, a transaction committed half its writes (`PrematureCommitError`).
  - **Dexie's zone** loses the transaction a couple of native `await`s deep, and a write after that starts a
    transaction of its own. Inside a transaction, the engine takes every table from the transaction object
    (`transaction.table(name)`), which doesn't depend on the zone.
  - **Another tab** can turn the lock on or off, or change the passphrase. The engine follows the stored lock with a
    live query, and locks when it changes to one it has no key for.
  - **Rows read before the lock went off** can still arrive sealed from a live query. With the lock off, the engine
    reads them again before reporting any as unreadable: without that, turning the lock off showed "Some saved data
    couldn't be read".
- **While locked,** the user's repositories hold nothing:
  - `StorageService.access` is undefined until the database has said whether the lock is on, and while it's locked.
    The repositories' resources then go idle and drop their records. The caches load from `mode` and stay.
  - The database opens as soon as `StorageService` starts, so the lock is known before any repository reads.
  - A locked table's watch ends when the app locks. Angular's resource doesn't abort a load when its params turn
    undefined, so the subscription would have kept the last records in memory. A watch begun before the lock was known
    also held a pending task for good, and the app never became stable.
- **The lock screen** (P15, `layout/lock-screen.ts`) takes the app's place whenever it's locked:
  - On a visit, a `localStorage` hint (`ss-lock`) shows it before the database opens, so the shell doesn't flash up
    first. It's no secret: the stored settings say the same.
  - Focus starts in the passphrase field. A wrong passphrase says "That passphrase is wrong, so nothing was unlocked."
    in an alert, selects what was typed and keeps focus in the field. The right one opens the page the visit was on.
  - **"Forgot it?"** opens a section with Import a backup and Delete all data (the user chose both).
    - Import is one Replace, after asking. In one transaction it clears every table, the lock with it, and writes the
      backup plain (`BackupRepository.restore`).
    - Delete all data says the lock goes too, then the first-run dialog shows.
  - It's created from a dynamic import, not `@defer`. `@defer`'s runtime added 7.6 kB to the initial bundle and took
    it to 501.3 kB, over the 500 kB budget.
- **Locking again** (`core/lock/auto-lock.ts`, started at boot):
  - After Lock after's time with no key, click, tap or wheel; moving the pointer doesn't count. Timers in a hidden tab
    run late, so coming back to the tab checks the time too.
  - On `pagehide`, so the back-forward cache doesn't bring the app back unlocked. Closing the tab drops the key anyway.
  - It closes the dialogs and the snackbar, which could show the user's data.
- **Not done:**
  - **A tab from before M6.10,** still open when the lock is turned on, can't read the sealed records. It hides them
    and shows the first-run dialog. Completing that dialog there would write plain settings without `appLock`, and the
    data would no longer open. A new Dexie version doesn't prevent it: Dexie 4 closes the old tab's connection, then
    reopens it at the newer version and carries on (tried). It can happen only once, since every later version
    follows the stored lock.
  - Changing the passphrase means turning the lock off and on again.
- **Bundles:** the initial bundle went from 492.5 to 495.4 kB: the idle lock (1.6 kB), the lock's state in
  `StorageService` (1.0 kB) and the lock screen's host (0.5 kB). No crypto code is in it. Gzipped:
  - **The storage engine's chunk:** from 33.4 to 35.6 kB, with the crypto module, `RowCipher` and the lock.
  - **The lock screen:** 2.4 kB, and 62.2 kB with what it loads beyond the initial bundle (Material's form field and
    input, Signal Forms).
  - **Settings:** from 91.8 to 93.5 kB beyond the initial bundle. Its turn-on dialog is 2.3 kB, and turn-off 1.5 kB.


**Resolved (2026-10-27, feedback after M6.9)**
Asked for after M6.9:
- **Back buttons** on every page the sidebar doesn't list. `ss-page-header` puts one above the title, on a line of
  its own: a text button with an arrow, named for where it goes ("Lists"). It used to be a small "‹ Lists" link
  beside the title, on List view only.
  - List view and Custom subscriptions go back to Lists.
  - The list editor goes to its list, by its saved name, or to Lists for a new list. Leaving with changes still
    asks "Discard changes?".
  - Optimizations (a placeholder until M8.2) goes to its list.
  - Settings goes back where the user came from, since the sidebar opens it from any page, or Home when it was the
    first page opened (`backInHistory`). It replaces Settings' own ← icon button.
- **At the top too:** Edit list beside List view's title, and New list beside the Lists overview's Custom
  subscriptions. The ones further down stay.
- **Search's status names the lists.** "· 2 lists" is now a button (`ss-in-lists`). Its tooltip names the lists, on
  hover or keyboard focus ("In Work Related and Family"), and it opens a menu of links to them. Core's
  `ProviderActivity` gained `listIds`, in the order their items came.
- **Ranks on Search** (the user chose counts on the cards and a sort):
  - **Counts:** each card shows how many of its plan's features the user ranks each way, under the status ("1 Needed
    · 1 Unwanted"). It follows the plan chip picked, and shows nothing when no feature of the plan is ranked. Core's
    `planRankCounts` counts the rank keys a plan provides that the profile ranks (`rankCounts` with no overrides).
  - **Sort "Best for my ranks"** (`sort=ranks`) scores a plan by its counts: Essential 16, Critical 12, Needed 8,
    Wanted 4, Uses 2, Sometimes 1, Unused 0 and Unwanted −8 for each feature (core's `rankScore`).
    - Each card shows the user's own plan, as with every sort, else the provider's best-scoring plan. Of two that
      score the same, the cheaper one shows.
    - Cards go best score first, then by price. A provider that isn't offered goes last.
    - With nothing ranked, the order is Price: low to high's.
  - **The sort is the app's only.** Core's `catalogSorts` adds `ranks` to the API's `providerSorts`: GET /providers
    can't know the user's ranks.
- **One set of filter controls** (`shared/filters/`) for Search's panel and List view's Sort menu, which looked and
  behaved differently:
  - **Price** (`ss-price-range`): Search's dual slider, with "Unlimited" at the top. In List view it replaces the two
    amount boxes, and runs to the priciest item's monthly equivalent, rounded as Search rounds (core's `priceRange`).
  - **Features** (`ss-feature-filter`): Search's chip box, with suggestions grouped by feature category. In List view
    it replaces a multi-select and suggests only what the list's items provide. With nothing to suggest it's turned
    off and says so, as the select was.
  - **Chips** (`ss-chip-choices`): checkboxes drawn as chips, for Search's Activity, and List view's Status and Tags.
    - Status is Active and Inactive, with none chosen meaning both. It replaces a select of "Active only" and
      "Inactive only".
    - Tags show their colour dots.
  - Core's `ListViewQuery.activity` is now a list of kinds, as Search's is, and `listFilterOptions` gives a
    `PriceRange`.
- **Style budget:** the Search card's styles had been 58 bytes over Angular's 4 kB warning since the feedback after
  M6.8, and the rank counts added 53. The lists button's styles are now its own component's, and the card lost what
  did nothing: a declaration a later rule overrode, one that repeated the narrow layout's, and five that undid a
  shop's visually hidden "Cheaper at" from 600 px, which is now hidden only below it. Its three blocks for 600 px
  and up are two.
- **Bundles:** the initial bundle didn't change (492.5 kB). What a page loads beyond it, gzipped:
  - **Search:** 193.1 kB, 3.6 kB more, for the rank counts, the lists button and the scores. Its own chunk halved
    (108.6 to 53.8 kB): the filter controls are in chunks it shares with List view.
  - **List view:** 183.1 kB, 34.7 kB more, for the Material chips, slider and autocomplete that the shared filters
    use. They're the chunks Search loads, so after Search, List view adds 20.2 kB (21.1 kB before).

**Resolved (2026-10-27, M6.9)**
- **Your data** (PROJECT-PLAN P13) is a card in Settings with Export backup, Import backup and Delete all data. The
  first-run dialog has Import a backup instead (P1).
- **The file** (core's `user/backup.ts`):
  - It's `{ app: 'simply-sub', schemaVersion: 1, exportedAt, catalogVersion?, data }`. `data` holds settings, lists,
    items, customSubs, rankings, cards and tags, deleted ones included, so a restore gives back the data as it was.
  - It leaves out the caches, which download again, and the list drafts, which are unsaved edits.
  - It's checked whole against the records' own strict schemas, plus one rule: no record twice. As in storage
    (section 11.1), links between records aren't checked.
  - A newer `schemaVersion` is refused. An older one goes through `migrateBackupPayload`'s steps; version 1 is the
    first, so there are none yet.
- **Encrypted** (section 11.5):
  - The file is `{ app, schemaVersion, encrypted: { kdf: 'PBKDF2-SHA256', iterations: 600000, salt, iv, ciphertext }
    }`: AES-256-GCM, with a 16-byte salt and a 12-byte IV, both random, in base64.
  - The header is bound to the ciphertext as GCM's additional data (`simply-sub:1`), so changing it fails like a
    changed ciphertext.
  - The key is non-extractable, and nothing is stored.
  - **Where the crypto module lives:** it's the web app's `core/crypto/passphrase-crypto.ts`, not core. Core builds
    with ES2022 alone and no DOM types, so WebCrypto and base64 aren't there. The app lock (M6.10) and sync will use
    it from the app too.
  - **A wrong passphrase and a changed file** fail GCM's check alike, so one message says both: "That passphrase
    doesn't open this backup, or the file was changed."
- **Export:**
  - "Protect with a passphrase", typed twice: at least 8 characters, never trimmed. The dialog says nobody can
    recover a forgotten one.
  - It downloads `simply-sub-backup-YYYY-MM-DD.json` (today's local date) from a Blob URL on a link that's clicked.
    That works under the production CSP and Trusted Types, checked under `wrangler dev`.
  - A snackbar says "Saved simply-sub-backup-2026-10-27.json".
- **Import:**
  1. **Choose a file.** The control is the browser's own file input, focusable but out of sight, and its label is the
     button people see. Enter and Space open it, with no script in between.
  2. **Read it.** A file over 10 MB, or one that isn't a backup, says why without quoting it, and nothing is written.
  3. **Passphrase,** when the file is encrypted.
  4. **Preview:** the export day in the user's time zone, then "1 list · 12 subscriptions · … · your settings". The
     counts leave out deleted records.
  5. **Merge or Replace:**
     - **Merge** takes each record the backup has newer (`updatedAt`) or that isn't here (core's `mergedRecords`).
       A deletion merges like any change, and drafts stay. A snackbar says what it took: "Merged 4 records from the
       backup", or "Nothing in the backup was newer than what's here".
     - **Replace** asks first. It then clears the backed-up tables and the drafts (edits of lists that may be gone)
       and writes the backup's records.

  Both are one transaction (`BackupRepository`), with every record checked on the way in. From the first-run
  dialog it's one Import, with nothing to ask, and it ends the first run.
- **Delete all data:** typing DELETE (in capitals) clears every table in one transaction, the caches and drafts
  too, using the storage transaction's new `clear`. The page then goes Home, where the first-run dialog shows.
- **Not yet:** section 11.1's reminder to back up now and then.
- **Bundles:** the initial bundle didn't change (492.5 kB). The backup rules, the crypto module and the repository
  are a lazy chunk of 6.6 kB, and each dialog has its own: Import 8.8 kB, Export 4.1 kB and Delete 3.2 kB.

**Resolved (2026-10-27, feedback after M6.8)**
Reported from the running app, with screenshots, and fixed before M6.9:
- **Pages scrolled sideways on a phone** (the list editor, Search). This wasn't reproduced. Every page fit at 320,
  360 and 390 px, in each of these:
  - Edge, Brave and WebKit, with the browser's scrollbars shown;
  - an emulated iPhone, including one switched to from a desktop width without a reload;
  - a window narrowed from 1280 px;
  - a root font of 20 px.

  The screenshots show only one of the page's 16 px side gutters at a time, so the visible area was about 4% narrower
  than the page, which is what a slight pinch-zoom leaves (Ctrl+scroll in DevTools' device mode is one). To catch a
  real overflow, `check-overflow.cjs` now measures every page, with its dialogs and panels open, at those widths with
  scrollbars shown, since headless Chromium hides them and hid any width that counts on them. It also fails on
  anything inside the page that scrolls sideways.
- **The item dialog's boxes weren't the same size.** A field with a two-line hint made its row taller, and the other
  fields' boxes stretched to match. The dialog's rows now keep each field at its own height (`align-items:
  flex-start`), and a window row's checkbox and 🗑 sit level with its boxes. The custom subscription editor already
  did this.
- **A reseller's price wasn't on its shop's line at phone width**, and several shops stacked into a jumble. Under
  600 px "Cheaper at" now shows once, then a row per shop: its name on the left (it wraps) and its price pill on the
  right, with the tax note under it. Screen readers still hear "Cheaper at" in each row. From 600 px nothing changed.
- **The feature summary left out features a list has** ("doesn't need all, but some are missing"). Its keys now also
  include what each item has itself (core's `featureSummary`):
  - every boolean feature it has;
  - its own rung of a ladder (an enum's value, a number's tier), not the lower rungs that rung provides too. A 4K
    plan shows 4K, and counts toward 1080p when another item shows that.

  A set's values (DNS blocking's ads, malware and the rest) show only when ranked or marked headline: one set can
  have many. Within a rank, headlines come first, then names. `ss-feature-summary` takes a `limit`: the Lists
  overview and List view show 8 rows, then "Show all 28".
- **Types:** the side column of both Lists pages now starts with the types of subscriptions, "Streaming video: 2",
  "VPN: 1", with each type's icon (`ss-type-counts`). Core's `typeCounts` counts each item in each of its service
  categories (`ResolvedItem.categories`, from `planCategories`; a bundle's plans together), and a custom
  subscription as Custom. Most come first.
- **A nickname and a note** (both optional) on a list item:
  - The fields: `ListItem.nickname`, trimmed, at most 60 characters, and `note`, at most 1000. They're optional,
    so stored items stay valid and Dexie needed no new version.
  - The item dialog has Nickname under Plan ("to tell two of the same plan apart: Mom's") and Note at its end. Editing
    an item clears one that's emptied, as it does its own price.
  - A card shows the nickname as its heading, with "Netflix Standard" under it, and names its buttons "Pin Mom's
    (Netflix Standard)". The note is in its details, keeping its line breaks. The list editor's rows show the
    nickname too.
  - List view's search box finds an item by its nickname or note, and Name, A to Z puts two of the same plan in
    nickname order.
- **Tags in the Sort menu:** Features and Tags are always there now. With nothing to choose they're turned off and
  say why: "No subscription here has a tag yet: add them with ✎ Edit".
- **View in Search:** a card's details link to its provider in Search (`/search?q=Netflix`, which shows the user's
  plan), or for a bundle to its seller. A custom subscription isn't in Search, so it has no link. The link is named
  "View in Search, Netflix Standard".
- **Bundles:** the initial bundle didn't change (492.6 kB). The item dialog's chunk grew 1.5 kB, Search's 1 kB and
  List view's 2 kB.

**Resolved (2026-10-27, M6.8)**
- **List view** (PROJECT-PLAN P4, `/lists/:listId`): "‹ Lists", the list's name, and "≈ $48.84 / mo average · 3
  subscriptions" (the overview's `averageText`; M7.2 keeps it beside its totals). Then the search box with Sort beside it, the cards
  (pinned ones first, under Pinned and All, or a hidden "Subscriptions" heading when none is pinned), and Edit list at
  the foot. The list's feature summary is on the right from 960 px. Below that it goes under the cards, as on the Lists
  overview, where P4 puts it above: what goes above the cards there is M7.2's totals. When the list editor has changes
  not saved, a note says so with a link back to them. A draft with no changes, which opening the editor leaves, isn't
  one (`ListDraftService.hasChanges`).
- **The card is `ss-item-card`** (`shared/sub-card/`), the list variant of PROJECT-PLAN §4.3's `ss-sub-card`, as a
  component of its own. It shows a resolved item, not a search result, so it shares with Search's card only:
  - its look (`_card.scss`);
  - its details, which slide open and shut (`SlidingDetails`, moved out of `SubCard`).

  Collapsed, it has the icon, the name and plan (a plan named after its provider alone, as in the editor), the status
  (today's `itemActivity` until M7.1), its tags, 📌 and the price (the override while it applies). Its details list:
  - how it's billed, since when, its add-ons, its own price and where it was bought;
  - its features with this item's ranks (`ss-feature-list` now takes a plan's features rather than the plan);
  - Plan ↗, Cancel ↗ and Edit, which opens the editor's item dialog (`/lists/<id>/edit?item=<item id>`).

  M7.1 adds its next charge and "Wrong date?", and M7.2 its share of the list.
- **📌** is a toggle button (`aria-pressed`), saved to the item at once (`ItemsRepository.update`), with no draft. A
  draft saved later keeps it, since Save writes only the fields the draft changed (`savedItem`). The card moves between
  Pinned and All, and focus follows its 📌.
- **Search and Sort** are core's `listView`, `listFilterOptions`, `listFilterCount` and `listPriceRange`
  (`user/list-view.ts`):
  - **Text** matches a word of the item's name, plan, a tag or a provided key's name (`nameMatcher`).
  - **Sort** opens a panel under the search box. It sorts by Highest price first (the default), Name, A to Z, Active
    first or Shortest period first, with ties A–Z.
  - **Filters:** Status (Active only, Inactive only), Lowest and Highest price per month, Features (an item needs every
    one) and Tags (one of them). Each offers only what the list's items have. The prices compare monthly equivalents in
    the user's currency, before tax, as the average does (`monthlyIn`, split out of `monthlyAverage`). An item priced
    in another currency, for want of a rate, is left out by a price filter and sorted last by price.
  - **Clear all** keeps the sort.
  - **What it says:** the button's name says how many filters are on ("Sort and filter, 2 on"), with the count beside
    it, and "2 of 12 shown" says what's hidden.
  - The choices live in the page, not the URL, so a reload drops them.
- **An item it can't price or name** gets a row after the cards, saying why, with Edit, while no text or filter is set:
  it has nothing to match on.
- **An empty list** says "No subscriptions yet", with two ways to add:
  - Add from catalog opens Search's pick mode for the list.
  - Add custom subscription opens the editor's menu: a custom subscription opens the editor with `?addCustom=`, and
    Create new… opens the custom subscription editor first.

  A list there isn't says P15's "This list doesn't exist".
- **Not yet:**
  - Export (M7.5);
  - the bars and each card's share (M7.2);
  - the mini calendar (M7.4);
  - View optimizations (M8).
- **Browser checks:** a Material select's panel is in the browser's top layer, next to its field in the page, not in
  `.cdk-overlay-container`. axe measured a field label hidden under the open panel against the panel's colour, so
  `check-list-view.cjs` sets aside contrast hits on text under a `.cdk-overlay-pane`.
- **Bundles:** the initial bundle didn't change (492.6 kB). The page's chunk is 30 kB. Search's is 6 kB smaller: the
  parts its card shares with List view's load in a chunk both pages use.

**Resolved (2026-10-27, feedback after M6.7)**
Reported from the running app, with screenshots, and fixed before M6.8:
- **The item dialog's renewal hint ran into Auto-renews** (360 and 1280 px): "Check your account page for the exact
  date" wrapped to two lines under Next renewal and over the checkbox. The dialog's fields now take the room their
  hint or error needs (`subscriptSizing="dynamic"`), as the custom subscription editor's do, and the browser check
  measures that the hint ends above the checkbox.
- **Feature ranks were a long list to scroll past to Tags.** Each group now folds, as the Features page's cards do: the
  heading line is the button ("Streaming 1 of 3 ranked here"), and a group starts open only when this subscription
  ranked a key in it when the dialog opened.
- **Tag chips:** a click anywhere on a chip removes it, as Search's Features chips do (M5.9), and the ✕ sits in the
  middle. The chip's colour dot showed as a thin bar: the dot is an inline span, whose size a chip's label ignored, so
  `_tag-dot.scss` makes it an inline block (every tag dot gets it).
- **Dates had no calendar, and typing one was awkward** (the browser's date field, whose year took 6 digits before
  moving on, and whose picker button was dark on dark). The dialog's six dates are Material's datepicker now: a text
  field that takes 2027-02-28 (also 2027/2/28 and 20270228), shows YYYY-MM-DD, and has a calendar button whose pop-up
  works by keyboard. `IsoDateAdapter` (`shared/`) keeps dates as ISO strings with core's `dates/` helpers and
  ClockService's today, so no Date object or time zone touches them. A date it can't read is null in the form, which
  core takes as none (`ItemForm`'s dates are `string | null`). Its header (`CalendarHeader`) names the month and year
  button by what it shows, "Oct 2026 (choose month and year)": Material's failed axe's
  `label-content-name-mismatch`, and its text failed contrast in dark mode.
- **Search's prices were small to tap on a phone.** Under 600 px (the card's container) a price is a pill at least
  36 px high, growing to 44 px as the screen widens (`clamp`), and a plan's prices wrap side by side, so Mullvad's five
  don't make the card longer. `ss-price` takes `--ss-price-target`, `--ss-price-padding`, `--ss-price-radius` and
  `--ss-price-border` for this: an outline, since a tinted pill took the dark theme's price text below 4.5:1. From 600 px nothing changed.
- **A reseller's price adds the plan at that price** (asked in the same feedback): "Cheaper at Amazon $87.00 / 12 mo"
  opens Add to list like a plan's price, named "…, add to a list at Amazon's price". The editor's URL carries it
  (`&price=87&currency=CAD&plusTax=1`, core's `addRequestParams` and `readAddRequest`), and the item dialog opens
  with "I pay a different price" filled in: the shop's price in its own currency, plus tax unless it includes it. A
  period the plan isn't priced for but is as long as one it is opens on that one (`sameLength`: Amazon's 12 months
  is Mullvad's year).
- **Bundles:** the initial bundle grew by 2.2 kB (492.6 kB), with no new code of ours in it: the datepicker uses
  more of the CDK's focus code (`_a11y-module`, `_focus-monitor`), whose files the shell already loads, so esbuild
  keeps it there. The item dialog's chunk grew from 46 to 145 kB (12.5 to 30.4 kB to transfer): 110 kB of it is
  Material's datepicker, which loads only with the dialog.

**Resolved (2026-10-27, M6.7)**
- **The Lists overview** (PROJECT-PLAN P3, `/lists`): "Subscription Lists" with [Custom subscriptions] beside it, a
  card for each list in the order they were made, then the New Subscription List tile, and the Features column on the
  right from 960 px (under the cards below that). With no lists there's a one-line hint and the tile, and no Features
  column.
- **A card:** the name (a link to the list), 🗑, then what it costs and how many subscriptions it has, "≈ $26.84 / mo
  average · 2 subscriptions", read "about $26.84 a month on average", and its rank counts (`ss-rank-counts`, core's
  `rankCounts` over the list's resolved items), then View. An empty list says "No subscriptions yet". The average is
  the list editor's footer's (`averageText`, now shared), until M7.2's bars show this month and this year; the bars
  replace it there, as the wireframe has them.
- **The Features column** is core's `featureSummary` over every list's items, "VPN: 2 / 3" read "2 of 3 active", with
  a line saying what the numbers are. A list whose items provide no summary key points to the Features page.
- **🗑** asks "Delete “Work Related”? Its 12 subscriptions will be removed." ("It has no subscriptions." when empty),
  then deletes the list, its items and its draft in one transaction (`DraftsRepository.deleteList`, which now says
  which items it deleted). "Deleted Work Related" stays for 10 s with Undo, which brings back the list and just
  those items in one transaction (`restoreList`, core's `restored`); items deleted before stay deleted, and the
  draft doesn't come back. Focus moves to the next card's 🗑 (else the previous one's, else the tile), and Undo puts
  it on the list's own.
- **Names:** each View link is "View Work Related" and each 🗑 "Delete Work Related", since every card has one; the
  card's name is a link to the same page, as P3 has it.
- **The heading** is P3's and the wireframe's "Subscription Lists"; the tab and the sidebar still say Lists, as the
  Features page's do (M6.2).
- **The gallery** keeps its hand-made feature summary and rank counts: they show every rank's colour, which a real
  list rarely does.
- **Bundles:** the initial bundle grew by 0.1 kB (490.4 kB), for `DraftsRepository`'s Undo. The page's chunk
  is 13 kB.

**Resolved (2026-10-27, M6.6)**
- **The page** (PROJECT-PLAN P12, `/custom`): "Custom subscriptions" with [+ New custom subscription], and a row for
  each, as the list editor has them: its icon (GET /icon for its website's domain through core's `customIconUrl`, now
  shared with `resolveItem`; else its first letter), its name, "2 plans · used in 1 list" (or "not used"), ✎ and 🗑.
  With none, an empty state says what they're for. Search's empty state already links here; P3's header link comes
  with the Lists overview (M6.7).
- **The editor** (`features/custom-subs/custom-sub-dialog.ts`) is a wide dialog like the item dialog: 720 px, the whole
  screen under 600 px. Both now open through `shared/wide-dialog.ts`, and the panel class is `ss-wide-dialog`. It has
  Name, Website and Cancel link, then each plan in a box of its own: Plan name, Cost, Currency, Billed every and Unit,
  Plus tax (where tax is added), Auto-renew available and its features, with Remove plan when there's more than one,
  and [New plan] under them. Fields take the room their hint or error needs (`subscriptSizing="dynamic"`).
- **Its rules are core's** (`user/custom-sub-form.ts`): `customSubFormIssues` (a name, links that are full https://
  addresses, at least one plan, each with a name of its own, a cost of 0 or more, a currency and 1 to 120 intervals),
  `customSubFromForm` (trimmed, a link left out when empty), `customSubFormFor`, `newCustomSubForm` and
  `parseAmount`. Signal Forms takes the issues through `issueErrors` (`shared/form-issues.ts`), which the item dialog
  uses too.
- **Features** (`ss-feature-picker`): the plan's features as pills with ✕, then "Add a feature", which finds the
  registry's rankable features as Search's Features box does (`customFeatureChoices`, `featureMatches`;
  `includes-subscription`, a set of provider ids, isn't one). A yes-or-no feature is added at once; any other asks for
  its value in a box under the field: one of an enum's, a number with its unit or Unlimited, or one or more of a set's
  (`isFeatureValue`). Escape closes the box, not the dialog.
- **A change that reaches lists asks first** (P12), counting the items it reaches (`customSubChange`): "Save changes to
  Local Gym? 1 subscription in your lists uses a plan you changed, and changes with it." Items follow a changed plan
  (its name, price, renewal or features) by its id. Decided here: a removed plan's items are removed from their lists
  with it, as a deleted subscription's are, in the save's own transaction (`CustomSubsRepository.save`), so no item is
  left naming a plan that's gone; that question has the danger button.
- **Delete** soft-deletes the subscription and its items together (`removeWithItems`). It asks every time: "Also remove
  it from 1 list.", or "It isn't in any of your lists." (P12 asked only when it's in use). List drafts aren't changed:
  a draft's item of a deleted subscription shows "Its custom subscription was deleted".
- **The list editor (P5, flow F3):** [+ Add custom subscription] is a menu of the user's custom subscriptions, then
  Create new…, which opens the editor, then the item dialog for what it made.
- **Typed costs are text fields** (`inputmode="decimal"`, so phones show a number pad), found by the browser check: in
  the list of plans a number field lost a decimal point typed quickly, and "49.99" became 9949. Signal Forms binds the
  field again whenever its plan changes, and writing the number back drops a trailing "." and moves the caret to the
  start. Number fields outside a list (budgets, an own price, a feature's count) keep what's typed.
- **Autocompletes close when focus moves on**, also found by the browser check (the item dialog's Escape, now and
  then, closed nothing): Material starts closing its suggestions on Tab only after their panel's first render, which in
  a zoneless app may not come until later, so Tabbing quickly past the tag picker left its empty panel open, and it took
  the dialog's next Escape. `ss-tag-picker` and `ss-feature-picker` close theirs when focus moves to another control;
  a click on a suggestion moves focus to the dialog around the field, and stays Material's to handle.
- **Not yet:** custom plans in the calendar and exports come with M7. In lists and ranks they behave like catalog
  plans already (`resolveItem` since M4.6).
- **Bundles:** the initial bundle grew by 0.7 kB (490.3 kB), for `CustomSubsRepository`'s save and
  `removeWithItems` and core's `customIconUrl`. The page's chunk is 5 kB, the editor's with the feature picker 18 kB,
  and the list editor's grew to 22 kB with its menu.

**Resolved (2026-10-27, M6.5)**
- **The item dialog** (PROJECT-PLAN P6, `features/lists/item-dialog.ts`): "Add subscription" or "Edit subscription"
  with ✕, the provider's icon and name, then Plan, Add-ons, Billing, "I pay a different price", Advanced's Bought in,
  Feature ranks and Tags, and in its foot the monthly price, Cancel and Add to list (Save when changing). Each plan in
  the menu shows its price for the period chosen ("Standard — $18.99 / mo", read "Standard, $18.99 a month"); the menu
  has the provider's plans sold where it's bought, and the one chosen. It's a MatDialog up to 720 px wide, since
  Material's 560 px is too narrow for fields side by side, and under 600 px it fills the screen
  (`ss-dialog-full-screen`, set through BreakpointObserver). Focus starts on its heading. It loads with the first one,
  with Material's dialog, outside the editor's chunk.
- **Its rules are core's** (`user/item-form.ts`): `periodChoices`, and `afterPlanChange` with `periodAfterPlanChange`
  (a change of plan, or of Bought in, keeps the period if the plan is priced for it, else takes its first);
  `defaultRenewal` (one period from today, keeping today's day: Jan 31 gives Feb 28 with billingDay 31) and
  `renewalAfterPeriodChange` (the suggested date follows the period, and one the user entered stays);
  `billingDayChoices`; `windowIssues` and `sortedWindows`; `itemFormIssues`; `itemFromForm`, `newItemForm` and
  `itemFormFor`; and `isDuplicate`. The dialog's Signal Form takes core's issues through one `validateTree`, each at
  the field it names, and `filterRanking` gained `keys`, the keys an item provides.
- **Decided while building it:**
  - **Dates** are the browser's date inputs in outline fields: they give ISO dates with no DateAdapter and work from the
    keyboard. No Material datepicker.
  - **The billing day** is asked as "Billed on: the 28th / the 31st (the last day in shorter months)", only for the
    days a later charge's month has (Feb 28 billed yearly offers the 29th, once a leap year comes round; every two
    years from 2027 never does). A date that no longer allows the day chosen drops it.
  - **Windows** that share a day overlap, since a window is active through its end (§3.1), and one that repeats yearly
    must be shorter than a year. An overlap is reported at the later window's start, and windows are saved in date
    order. The only window has no 🗑, so there's always one.
  - **A free plan** hides the Ongoing / Specific dates choice too, as it's saved as Ongoing; Subscribed since and Ends
    on stay. Its anchor is today, or for an item being changed the one it had, so opening and saving it changes
    nothing.
  - **Add-ons** rather than P6's "Extra members", since Crave's Starz is one too. One takes a Quantity menu when the
    plan's `addOnLimit` is 2 or more; the limit counts them all, and going past it is reported at the last one ticked.
  - **Ranks** are saved only for the keys the item provides, so a change of plan drops the others. Profile default
    removes the override.
  - **The footer** has ≈ only for a converted price, as the editor's average does (P6's sketch put it on Netflix's
    native price). Its "next charge Nov 12" comes with the charges (M7.1).
  - **Plus tax** shows only where tax is added (Canada, the US). An own price's currencies are the ones prices can be
    shown in (`displayCurrencies`).
  - **"Already in this list — add another?"** asks on Add when another item has the same plan (whatever its add-ons),
    bundle or custom plan, and on Save when an item's plan is changed to one; not for an item whose plan was in the
    list twice already.
  - **A period the plan isn't priced for** (a bundle sold monthly asked for with `count=3`) opens on its first period.
  - **A custom plan** can be billed any way ("Billed every [2] [Weeks]"), starting on its own price's period.
  - **An item whose plan has left the catalog** can still be changed: there are no periods to check it against.
- **Bought in** another country needs that country's prices, which weren't downloaded until an item bought there was
  saved. `CatalogStore.need(regions)` now keeps the files a page's unsaved items need while the page lives: the
  dialog's Bought in and the editor's draft (section 6.3). Settings' country and currency menus moved to
  `shared/place-choices.ts` for the dialog.
- **The editor (P5):** `?add=`, `?addBundle=`, `?addCustom=` and `?item=` open the dialog once, when the catalog (and
  for a custom subscription, the custom subscriptions) have loaded, and then drop out of the URL, replacing its history
  entry. One that names nothing there is says so in a status line ("There's no plan netflix.basic in the catalog.", "That subscription isn't in
  this list."), opening nothing. ✎ is now a button that opens the dialog itself, so Back has no entry to undo. After
  Add or Save a snackbar says "Added Netflix Standard" or "Saved Netflix Standard" for 5 s, and focus moves to the
  item's ✎. M6.4's "will open here" notes are gone; [+ Add custom subscription] still comes with M6.6.
- **Found by the browser check:**
  - Core's date helpers took the years 0 to 99 for 1900 to 1999 (`Date.UTC` does), and a date input passes through
    them while a year is typed (0002, 0020), so `addDays` threw. `iso-date.ts` sets the year itself now, and
    `billingDayChoices` has none for a value that isn't a date (a 6-digit year).
  - `ss-tag-picker`'s input sat in its chip grid, which may hold only rows: axe's `aria-required-children` failed once a
    tag was chosen. The input has a row and cell of its own while the chips make a grid (Material drops the grid's role
    when it has no chips and nothing is typed).
  - At 360 px a field's hint or error met the next field's label in a wrapped row, so rows have a gap. The heading
    focus starts on has no ring: it isn't a control.
- **Not yet:** P6's acceptance "Limited windows produce the expected charges (checked on the calendar)" waits for the
  charges (M7.1) and the Calendar (M7.4), and Payment's card select for M9.4.
- **Bundles:** the initial bundle grew by 0.5 kB (489.6 kB), for `CatalogStore.need` and the dialog's panel styles.
  The item dialog's chunk is 46 kB, and the editor's 20 kB.

**Resolved (2026-10-27, M6.4)**
- **The editor** (PROJECT-PLAN P5): the heading "Edit list" ("New list" for a new list, and its tab title), the List
  name field with Cancel, Save and ⋮ (Delete list, for a saved list only) beside it, then a card with [+ Add from
  catalog] and a row per item, and the footer. P5's sketch had "Editing [name]" as one line; a heading of its own
  says what the page is.
- **The name** is stored in the draft as it's typed, once it's one a list can have (not empty once trimmed, at most
  60 characters). Save checks it with Signal Forms: "Give the list a name" at the field, with focus on it.
  `focusFirstError` moved to `shared/`, since Settings and the editor both use it.
- **A row:** the icon, "Netflix · Standard" (a plan named after its provider alone: "Mullvad VPN"), how it's billed
  ("Monthly · auto-renews", "ends Nov 3, 2027", "Specific dates, billed monthly"), its add-ons, "Your own price",
  its custom ranks, its tags, its price (the override while it applies), ✎ and 🗑. The draft's items are priced as
  saved ones are, through `MetricsService.resolve`. One that can't be priced says why ("This plan is no longer in the
  catalog"). "Renews Nov 12" comes with the charges (M7.1).
- **🗑** removes the item from the draft (it stays there, marked) and says "Removed Netflix Standard" with Undo in a
  snackbar, which stays until it's dismissed, the next removal replaces it, or the page closes. Focus moves to the
  next row's 🗑 (else the previous one's, else [+ Add from catalog]), and Undo puts it back on the row's own.
- **The footer** says "Unsaved changes" or "No unsaved changes", then "≈ $26.84 / mo average", read "about $26.84 a
  month on average". Core's new `monthlyAverage` adds the items' monthly equivalents, before tax as §3.1 defines
  them, with ≈ when a price was converted. An item it can't price, or one priced in another currency for want of a
  rate, is "not counted". "This month" comes with M7.2.
- **Changes** are the draft's (`draftChanged`) or a name typed and not stored yet. The editor says "Resumed unsaved
  changes" when it opens on a draft that has some.
- **Save** stores the name, saves the draft in one transaction and opens the list view in the editor's place, so
  Back doesn't open the editor again. **Cancel** asks "Discard changes?" (focus on Cancel) when there's anything to
  lose, drops the draft, and goes to the list view, or `/lists` for a new list, in place too. **Delete list** asks
  "Delete Work Related?", then `DraftsRepository.deleteList` soft-deletes the list and its items and deletes the
  draft in one transaction, so totals drop the items.
- **Leaving:** `leaveGuard` (the routes' canDeactivate, which knows the page only by its type, so its code stays
  lazy) asks "Discard changes?" before going anywhere but Search in pick mode for this list. Leaving drops the draft,
  so a new list nobody changed isn't kept (M6.3's follow-up). A refused Back keeps the history as it was: the router
  now uses `canceledNavigationResolution: 'computed'`, since the default replaced the entry Back had gone to. A reload
  or a closed tab keeps the draft, so there's no `beforeunload` question.
- **Another tab's Save or Cancel** removes the draft under the editor, which starts again from what's stored.
- **A list there isn't**, or a deleted one with no new list's draft, shows P15's "This list doesn't exist" with
  [Back to lists], under the "Edit list" heading.
- **Until M6.5,** `?add=`, `?addBundle=` and `?item=` (✎ links to it, as P4's [Edit] will) say what the item dialog
  will open: "Netflix Standard will open here once the item dialog is ready." [+ Add custom subscription] comes with
  M6.6, where P12's editor gives its "Create new…" somewhere to go (flow F3). (Done in M6.5: they open the dialog, and
  ✎ opens it without the URL.)
- **Bundles:** the initial bundle grew by 0.18 kB (489.1 kB), for the guard and the router option. The editor's chunk
  is 18 kB, with Material's menu and snackbar in shared chunks.

**Resolved (2026-10-27, M6.3)**
- **The draft record** (`user/list-draft.ts`, section 4.6): one per list, keyed by `listId`, with `isNew`, the name now
  and when it started (`startName`), `startedAt`, and its items, each as edited (`item`), as saved when the draft
  started (`saved`, absent for one the draft added) and `removed` (kept in the draft, so Undo puts it back). Items are
  whole `ListItem`s, so the editor can resolve them as it does saved ones. The schema checks that every item belongs
  to the list, none is listed twice or has `deletedAt`, a saved copy is the same item, and a new list has none.
- **No new Dexie version:** `drafts` was declared in v1 with its key, and nothing wrote to it before, so its schema
  needs no upgrade; v2 stays the latest. Drafts are deleted outright on Save or Cancel, not soft-deleted: they're
  edits not saved yet, with no deletion for a sync to pass on.
- **`DraftsRepository`** (`core/storage/`) is the only way into the table. `start` resumes a list's draft (`resumed`),
  or copies the list and its items that aren't deleted into a new one, in one transaction; there's none for an unknown
  or deleted list (P15). A draft that fails its schema is replaced by a fresh copy, as settings and rankings are. Each
  edit is a transaction on the draft, so two tabs don't overwrite each other, and every tab's signals follow it.
- **`ListDraftService`** (`core/lists/`): `start`, `startNew`, `rename`, `addItem`, `updateItem`, `removeItem`,
  `restoreItem`, `hasChanges`, `save` and `cancel`. `resumed` is true whenever a draft was there; the editor (M6.4)
  says "Resumed unsaved changes" when it also has changes. Changes are counted against the start (core's
  `draftChanged`): a new name, an item added, removed, or with a field that differs from its saved copy, in any key
  order and leaving out timestamps. An item added and removed again is no change.
- **A new list's name** is "Subscription List", then "Subscription List 2", 3… while a saved list has it (any case).
  Deleted lists don't count, nor do other new lists' drafts, which nothing shows until they're saved.
- **Save** writes the list, its items and the draft's deletion in one transaction (`StorageEngine.transaction`), or
  nothing: a failure part way rolls back what was written, and the draft stays. P5's rule for `pinned` and `cardId`
  holds for every field: a changed item gets only the top-level fields the draft changed (core's `savedItem`), so
  what was changed elsewhere since stays, P4's "Wrong date?" too (it's in `billing`, which the draft replaces whole
  only when it changed it). Added items are created with Save's time, removed ones soft-deleted, and one deleted
  since stays deleted. A list deleted since can't be saved; a new list is created.
- **Search's pick mode** adds to `listsWithDrafts`: the saved lists, named as their drafts name them, and the new
  lists, which have only a draft until Save. Search waits for the drafts as it does for the lists, so a reload keeps
  `/search?addTo=<new id>` and its banner, and a draft cancelled in another tab drops it in place.
- **`/lists/new`:** the placeholder editor makes the draft, then replaces its URL with `/lists/<id>/edit`, keeping
  the query (Search's New list…), so Back skips it and [+ Add from catalog] has an id. It's done in the lazy page,
  not a route guard, which would put the storage code in the initial bundle.
- **Bundles:** the initial bundle grew by 0.12 kB (488.9 kB), with no new code in it: esbuild split a shared storage
  chunk in two now that the drafts share it. The storage engine's chunk grew by 0.4 kB (99.2 kB) and Search's by
  0.2 kB (235.7 kB).
- **Next (M6.4):** the editor builds on the service. Leaving a new list with no changes should drop its draft, which
  nothing else would (done in M6.4: leaving drops the draft).

**Resolved (2026-10-27, M6.2)**
- **The Features page** (PROJECT-PLAN P9), "Your feature ranks": a card per feature category in `categories.yaml`'s
  order (core's `rankingSections`), its features in registry order with a parent's children under it (VPN, Password
  manager), and a row per rank key: a boolean's one row, and a row for each value of an enum or a set and each tier
  of a number. Decided 2026-10-27: the categories the lists use start open, and all of them while no list has
  anything in it, and each row says how many list items provide its key ("in 3 subscriptions", `keyUsage` over
  `MetricsService`'s items). A feature with more than four rows folds ("Storable item types (22)") until one of them
  is ranked.
- **Ranking:** a change saves at once, and Not ranked deletes the record. A ranked row has its rank's colour down its
  left edge, beside the dropdown that names it. A parent's Set all ranks all its children's keys, whatever a filter
  shows, and Reset all (after asking, with focus on Cancel) clears every profile rank; subscriptions' own ranks stay.
  Both write once, all or nothing: `RankingsRepository.setMany` on a new `StorageEngine.modifyMany`, one transaction
  for several records, so lists recount once. Both say what they did to screen readers.
- **Find a feature** matches as Search's Features box does: core's `nameMatcher`, moved out of `featureSuggestions`
  (a word that starts with the text, a plural its singular). Text that names a feature keeps all of it, a parent's
  children too ("vpn" keeps the kill switch), and a child that matches keeps its parent as a heading. Ranked only
  keeps the ranked keys. While either is on, every card is open with its title as plain text, and a status line
  counts the features shown.
- **Names and headings:** each card's toggle is "Streaming 1 of 16 ranked" (a space inside the count's span: Angular
  drops the whitespace between spans); each dropdown is named alone, "Video quality: 4K (Ultra HD)"; Set all is
  "Set all in VPN", beside a heading rather than in it. Every feature heading is level 3, a child's too: a parent's
  own line is a row, so level 4 would skip one (axe's heading-order).
- **The heading** is P9's "Your feature ranks"; the tab and the sidebar still say Features.
- **Bundles:** the initial bundle grew by 0.65 kB (488.8 kB). The Features page's chunk is 27 kB: Material's menu,
  checkbox and form field, which it and Search both use, moved into shared chunks, so Search's own fell from 268 kB
  to 235 kB.

**Resolved (2026-10-27, M5.10)**
- **A stray space in names:** a browser names a button or link from its content by joining its parts, and puts a
  space around a part that's out of the flow, as `.visually-hidden` is. So a price was named "$7.99 a month , add to
  a list", a list in the Add to list menu "Work Related , 12 subscriptions" and a card's link "Plan : Netflix
  Standard". Checked in Edge: a hidden box that's inline-block, or absolute with `display: inline`, does the same;
  only plain inline text doesn't, and hiding text with `font-size: 0` isn't reliable with every screen reader.
- **One `aria-label` instead** for each list in the menu ("Work Related, 12 subscriptions"), a card's Plan or
  Website link, its resellers' links, Hide details and the Terms and policies page links. Each name starts with its
  visible words, so speech input still finds it (WCAG 2.5.3, axe's `label-content-name-mismatch`).
- **A price can't take one:** it shows "$7.99 / mo" and is read "$7.99 a month", so an `aria-label` wouldn't contain
  what it shows, and axe failed it. Its action ends the hidden words it already had (" a month, add to a list") rather
  than taking a box of its own, so its name still comes from its content. Free has no hidden words to end, so a
  button's Free is read from a hidden copy, "Free, add to a list", with the visible word `aria-hidden`.
- **What stays:** hidden words that start with a space ("Cancel Netflix", a citation's "[2] Terms of service") read
  the same with the browser's space, so they're unchanged.
- **Tests read names:** the specs read `aria-label`, and `check-search.cjs` reads names from the accessibility tree,
  with a sweep for a space before a comma or colon across Search with cards expanded, in both themes at both widths.
  The specs had read `textContent`, which joins the parts without the space, so they couldn't see it.

**Resolved (2026-10-27, M6.1)**
- **Rank resolution** (`ranking/resolve-rank.ts`): `resolveRank` takes an item's override, then the profile's rank,
  then Not ranked. An override of Not ranked counts as one and hides the profile's rank for that item (the item
  dialog's Not ranked choice, M4.5). Nothing cascades from a group to its children. `effectiveRanks` ranks each key an
  item provides, Not ranked ones included, so the item dialog can list them all (P6).
- **`ResolvedItem.effectiveRanks`:** `resolveItem` takes the profile's ranks (`ResolveContext.profileRanks`), and
  `MetricsService` passes `RankingsRepository.ranks`, so a rank changed on the Features page re-ranks every item. Only
  the keys an item provides are ranked: an override left on a key its plan no longer provides changes nothing.
- **Rank counts** (`rankCounts`): each item counts each key it provides at its effective rank there, so the enum and
  tier ladders count every rung a plan reaches (a 4K plan counts its 1080p rank too; 6 streams count both the 2 to 4
  tier and More than 4), and a plan listed twice counts twice. All eight ranks are there, zeros included; Not ranked
  isn't counted.
- **Feature summary** (`featureSummary`): the summary keys are the registry's headlines and any key an item ranks
  Essential, Critical, Needed or Wanted, by its override or the profile, so a profile's Wanted that every item
  providing the key overrides lower drops out. Active is today's `itemActivity` (PROJECT-PLAN §3.3), which M7.1's
  status builds on, and a key no item provides isn't shown.
- **Its order and names:** a key can have a different rank on each item, so rows go by its highest rank among the
  items that provide it, in `Rank`'s order (Not ranked after Sometimes), then by name. Rows are named as Search's
  Features chips are (`rankKeyLabel`), "Video quality: 4K (Ultra HD)" rather than the wireframe's "4k": a value's or
  tier's name alone ("2 to 4 devices") doesn't say what it's of. The gallery keeps its hand-made rows until a page
  shows real ones (M6.7).
- **Next:** the Lists pages show them (M6.7, M6.8), and M7.1 puts them in `ListMetrics`. No UI changed here, and the
  bundles didn't change.

**Resolved (2026-10-27, M5.5)**
- **Pick mode** (PROJECT-PLAN P7's flow F2, P8): `/search?addTo=<list id>` shows "Adding to Work Related" and a ✕ at
  the top of the pinned bar, above the search box at both widths, so it stays on screen while the results scroll and
  comes before the box in the Tab order. The ✕ is a link back to `/lists/<id>/edit`, named "Stop adding to Work
  Related", and adds nothing. A long list name wraps.
- **A price adds at once:** in pick mode a card's prices, and its bundles' prices in the details, are plain buttons
  named "…, add to Work Related", with no menu. A click opens the list's editor with core's `addRequestParams`
  (`add` or `addBundle`, `interval`, and `count` above 1), as picking a list in the menu does in F1. The card's
  `ss-add-to-list-menu` takes the list (`list`), so the card's prices and its details' switch together. Add-on and
  reseller prices stay text.
- **The URL keeps it** (core's `SearchQuery`): `readSearchParams` keeps an `addTo` that names one of the user's lists,
  which it's given, and `writeSearchParams` writes it last, after `sold`. It isn't a filter: `filterCount` leaves it
  out, and Clear all keeps it. Every URL the page writes carries it, so it survives typing, filters, Clear all, a
  reload and Back/Forward; only the ✕ leaves pick mode. Search reads its URL once the lists have loaded too, so an
  `addTo` isn't dropped before they're read. One that names no list, or a deleted one (in this tab or another), is
  dropped and the URL rewritten in place, with no banner.
- **Until the editor exists,** F2 ends on the placeholder's "… will be added here once the list editor is ready.", as
  F1 does, and an existing list's placeholder has [+ Add from catalog]. `/lists/new` has none yet: its list gets an id
  with its draft (M6.3) and isn't in the lists table until Save, so M6.3 has to give Search a draft's list among the
  lists an `addTo` can name.
- **The initial bundle didn't grow** (488.2 kB; 488.4 kB before). The Search chunk grew by 1.5 kB (267.6 kB).

**Resolved (2026-10-27, M5.9)**
- **The grade in words:** each rating reads "Disputes (Good): …", the grade muted beside the bold topic, so it's on
  screen without a hover (WCAG 1.4.1: colour isn't the only sign). The dot is decorative again, as the rank dots
  are, and M1.14's tooltip button is gone.
- **A click on a Features chip removes it,** as its X does (the X stays, as the sign that it can be removed). The
  X's own click doesn't reach the chip (MatChipRemove stops it), so a click on the X removes it once.
- **The filter panel has no scrollbar of its own:** it's pinned below the bar while it fits the window. Taller (a
  short window, or long Features chips), it scrolls with the page until its foot is in view and stays there: its
  `top` is the smaller of the bar's foot and the window's height less its own, which the page measures
  (`--ss-panel-height`). Its hints are one line each ("Hides prices in other currencies", "Only plans priced for
  Canada").

**Resolved (2026-10-27, M1.15)**
- **Proton has official resellers,** named only in Proton VPN's blog: its post on its spring and summer 2025 updates
  says "We’ve also partnered with ProxyStore … and CoinGate" and "We’re using resellers to handle these
  cryptocurrency payments". M1.12 read proton.me's pages, not protonvpn.com's blog, and missed them.
- **A provider's `domains`:** the post is on protonvpn.com, not proton.me, so a provider can list its other sites,
  and an approval page may be on any of them (section 4.9).
- **ProxyStore's Proton vouchers** (12 months of VPN Plus, Unlimited, Mail Plus, Drive Plus and Pass Plus) cost
  Proton's own yearly EUR prices, VAT included. Proton's CAD and USD prices cost less even with sales tax, so Search
  doesn't show them: core's `resellerDeals` finds none in Alberta, Nova Scotia, Germany or the US at 10%, and only a
  US user who sets their own rate to 15% would see them. dys2p, which runs ProxyStore, wrote in March 2026 that only
  Pass vouchers were left; all five were in stock on 2026-10-27.
- **CoinGate isn't listed:** its shop page answered Forbidden from its firewall, and a page behind a bot check stays
  unread.
- **Research reads blogs too:** the price-research skill and section 6.5 search every site's blog and news for
  resellers. Mullvad's blog has one more, Smartech in Selfridges (2021), which its partnerships page no longer
  names, so it isn't listed.

**Resolved (2026-10-27, M1.14)**
- **The grades are Great, Good, Neutral, Poor and Bad** (they were good, leaning good, neutral, leaning bad and
  bad), in core's `policyTiers`, every rubric and every rating.
- **A dot, not a pill** (section 4.10): each rating's grade is a dot in its colour, like the rank dots, whose
  tooltip names it on hover, keyboard focus or a tap. A click while hovering keeps it open (`show()`, not
  `toggle()`), and a tap elsewhere closes it.
- **Reasons in plain words,** a sentence or two (240 characters at most, from 100): all 66 rewritten for someone who
  has never read a contract ("a private referee called an arbitrator decides … instead of a court"), saying only
  what their quotes say. The reason is muted and its topic bold.
- **Inline citations:** each reason ends with a numbered link to each page it quotes, opening it at the quote where
  the browser supports text fragments, with the quotes as its tooltip; the numbered pages follow under Sources.

**Resolved (2026-10-27, M5.8)**
- **A long Features chip wraps inside its field:** Material keeps a chip one line high and its label on one line,
  and its label didn't shrink with its chip, so "Download devices: Downloads on 6+ devices" ran past the field and
  scrolled the filter panel (which scrolls on its own since M5.7) and the drawer sideways. A global
  `.ss-wrapping-chips` (styles.scss, since the parts are Material's) lets the label wrap and the chip grow taller.
- **Its remove button is centred:** a rule for every button in the panel (meant for Clear all) lifted it to the top
  of its chip. The rule is Clear all's alone now.

**Resolved (2026-10-27, M1.13)**
- **Terms and policies on every card** (section 4.10): 13 topics in four groups (privacy, billing, legal, service),
  each with a five-tier rubric in `data/policy-topics.yaml`, its own commit. Data collection's rubric is the one asked
  for; the others follow it. Every rating has a one-line reason and the provider's words, and the card links the
  pages they come from.
- **Ten providers rated, 111 quotes,** each checked against the page's saved text word for word (the
  policy-research skill's `quote-check.cjs`), read 2026-10-27:
  - Mullvad (9 ratings) and Proton (11) from their terms, privacy policies, no-logs policies and audit posts.
    Proton's US disputes rating (arbitration, a class-action waiver, a 30-day postal opt-out) sits over its general
    one (Geneva's courts).
  - Netflix (13) from Canada's terms of use (so those ratings are for Canada only), its privacy statement and its
    household and download help; its ad plan has its own ratings for tracking, sharing (no extra members) and
    downloads (15 a month).
  - ICI TOU.TV (6) from its subscription conditions and CBC/Radio-Canada's cookie notice, in French.
  - Crave (7), TSN (4) and RDS (4) from the Bell Media terms, TSN's and RDS's own conditions and Bell's page on how
    it uses data. Bell Media's terms allow closing an account "for any reason" without notice and require
    arbitration in Toronto with no class actions: both bad.
  - Disney+, Hulu and ESPN (4 each), only the privacy topics, from The Walt Disney Company's privacy policy.
- **Left unrated, and why:** Disney+'s subscriber agreement renders only its footer here, hulu.com sends this
  machine to Disney+, and plus.espn.com is Access Denied, so their billing and legal topics wait. CBC/Radio-Canada's
  privacy notice shows only its contents and cookie notice. TSN's and RDS's conditions say nothing on price or terms
  changes or closing accounts. No provider here offers a free trial on its personal plans.
- **The catalog files grew** from 61 to 104 kB a region (18 kB compressed), mostly quotes, which the card doesn't
  show but reviewers need. The initial bundle grew by 0.2 kB (the tokens, 488.1 kB) and the Search chunk by 3 kB.

**Resolved (2026-10-27, M1.12)**
- **Every provider's research checks bundles, official resellers and its terms, every time**, not only when they're
  the task: the price-research skill's rules and the pipeline's URL step (section 6.5). The terms of service, privacy
  policy and other policies hold what pricing pages leave out (where it's sold, billing periods, auto-renewal,
  refunds, price-change notice, limits). A provider file's header comment says what each check found, "none"
  included, so a reviewer can tell a check that found nothing from one that wasn't done.
- **Mullvad was missing a reseller:** its page names Laptop with Linux ("Since October 2022, we’ve partnered with
  Laptop with Linux"), left out in M1.8 because its price with VAT follows the buyer's country. Its €48.76 a year
  before VAT is stored (`taxExcluded`, as SerialCart's are), with free delivery anywhere. For an Albertan it's the
  cheapest way to buy Mullvad, about CA$6.70 a month with GST, ahead of ProxyStore's and Amazon.ca's.
- **Amazon's other 12 stores can't be read:** each shows Mullvad's price only in the basket ("To see the product
  details, add this item to your basket"), on amazon.com and amazon.co.uk among them, and amazon.de answered with an
  error. They stay out until a page shows the price.
- **The other providers name no resellers:** Proton sells its gift cards in its own store only (wrong: a Proton VPN
  blog post names two, found in M1.15). The streaming
  services are also billed through app stores and phone or TV providers (Netflix's partner billing, Disney+ through
  Apple, Google, Amazon, Roku and carriers, ICI TOU.TV EXTRA in some TELUS and Koodo plans, Crave and TSN as TV
  channels), which are partners under section 4.9, not shops selling the subscription.
- **No getting past bot checks:** the skill's tip that a Cloudflare check passes in a visible Edge window is gone. A
  page behind one is left out and reported.

**Resolved (2026-10-27, M5.7)**
- **Nothing paints over the top bar:** Material raises its buttons' labels and icons (`z-index: 1`, as high as the
  sticky top bar), so under 960 px Search's Filters label drew over the bar as it scrolled beneath. `<main>` is now
  a stacking context of its own (`isolation: isolate`), below the bar, and Search's results are one too, below its
  pinned bar.
- **The search bar and the filter panel stay pinned** while only the results scroll, with the window still the
  scroller (phones hide their address bar, the router restores positions). The bar is outside the results' grid,
  since a sticky grid item can't leave its row, so it spans the panel's column too; the panel sticks below it
  (the page measures the bar, `--ss-pinned-height`) and scrolls on its own when it's taller than the window
  (`cdkScrollable`, so its Features and Category popups follow it; M5.9 replaced this with no scroll of its own). Under 960 px the bar sticks below the top bar
  (`--ss-top-bar-height`, set by the shell) and is one row: the box ("Search services") and a Filters icon button
  with a badge, named "Filters, 2 applied". Sort moves to the top of the drawer, since three rows would pin about a
  third of a phone screen.
- **Plan chips stay put when switching plans:** a chip is as wide checked as not (unchecked, the check's room is
  padding), the chips sit right below the names, above everything that changes with the plan, and from 600 px the
  card keeps room for its plans' longest list of prices (`--price-rows`). The chips come before the links and prices
  in the Tab order too: pick a plan, then act on it. A card with one plan (RDS, Mullvad) shows its chip as well, as
  text (`aria-hidden`, since its name is read above, and no extra tab stop).
- **Plans are ordered by their shortest billing period's price per month** (`searchProviders`, so GET /providers
  too), then by their lowest monthly equivalent. TSN Premium's $249.99 a year is less per month than Standard's
  $24.99 a month, which put Premium first and showed it; now Standard comes first, as the prices read. Provider
  sorts still compare the shown plan's lowest monthly equivalent (P8).
- **The expanded section slides open and shut:** its grid row animates from 0fr to 1fr and fades, with the
  browser's Web Animations; Angular's `animate.enter` and `animate.leave` would have added 8.7 kB to the initial
  bundle (488 to 497 kB of the 500 kB warning budget). Nothing moves with reduced motion. The details button says
  closed at once while the section slides shut. "Hide details", a tinted bar at its foot, closes it too and puts
  focus back on the details button. Once it has opened or closed, the card scrolls into view if part of it went off
  screen (`scrollIntoView` with `block: 'nearest'`, below the pinned bar by `scroll-margin`): as much of the open
  section as fits, or the top of a card closed from its foot.
- **The initial bundle didn't change** (487.9 kB). The Search chunk grew by 5 kB (260.6 kB).

**Resolved (2026-10-26, M5.4)**
- **A price opens Add to list** (PROJECT-PLAN P7, flows F1 and F4): each Search card has one
  `ss-add-to-list-menu`, which its plan's prices and, in the details, its bundles' prices open after saying what
  they add. Each is a menu button named by its words and ", add to a list". Add-on and reseller prices stay text: an
  add-on is added with its plan in the item dialog, and a reseller's price is a price override (section 4.9).
- **The menu** lists the user's lists in the order they were made, each with its number of subscriptions, "Work
  Related (12)" ("12 subscriptions" to a screen reader), then New list…. Its title and counts use the body text
  colour: the muted shade is 4.3:1 on dark mode's menu surface.
- **The request is in the URL** (core's `addRequestParams` and `readAddRequest`):
  `/lists/<id>/edit?add=<plan id>&interval=month`, or `addBundle=<bundle id>`, with `count` only for a period of
  more than one interval (`interval=month&count=3`), so the item dialog (M6.5) can preselect any price's period,
  not only monthly and yearly. Reading takes the first of a repeated parameter and rejects both `add` and
  `addBundle`, neither, an unknown interval, a count outside 1–120 and a malformed id; a missing interval is
  monthly. New list… opens `/lists/new` with the same parameters, where the editor makes the draft list first
  (M6.3, M6.4).
- **Until the editor exists**, the placeholder says what it will add: "Netflix Standard with ads, billed monthly,
  will be added here once the list editor is ready.", named from the catalog (the id while it loads).
- **The initial bundle didn't change** (487.7 kB). Material's menu loads with the Search page, whose chunk grew by
  30 kB to 255 kB.

**Resolved (2026-10-26, M1.11)**
- **Disney+'s and Crave's bundles, and the providers they need:** TSN, RDS and ICI TOU.TV (Canada), Hulu and ESPN
  (the US), each from its own pages: plans, prices, features, cancel page and, for the ones sold in one country,
  `availableIn` with its words quoted. 20 new bundle files: Crave's ten with Disney+, TSN, RDS and EXTRA but
  one, Disney+'s Canadian five with TSN and Crave, TSN's with RDS, and Disney+'s US six with Hulu and ESPN. A
  bundle's `soldBy` is the provider whose page sells it at that price: TSN and RDS sell some Crave bundles
  that crave.ca lists without a price.
- **Left out, and why:** HBO Max and NFL+ (and Disney+'s four US bundles with them): hbomax.com answers this
  machine, in Canada, with Access Denied, and nfl.com/plus redirects to DAZN's international NFL Game Pass, so
  their US prices can't be read here. Crave Standard With Ads, TSN and RDS: Crave's FAQ lists it, but no page
  gives its price. Disney+'s "Legacy" bundle: it can't be bought any more. Hulu's Live TV plans (suites with
  Disney+ and ESPN) and add-ons wait for a task of their own; bundles have no add-ons in the schema, so Disney+'s
  Extra Member on a bundle and ESPN Unlimited on the HBO Max bundle aren't here either.
- **ESPN has no `availableIn`:** plus.espn.com, which says who can subscribe, is Access Denied from here, and the
  support centre names no countries. Outside the US it's unknown, "No price for Canada yet", which Sold in hides.
- **Other countries, surveyed on Disney+'s price article:** no bundles in the UK, Ireland, France, Germany, Italy,
  Spain, Australia, New Zealand, Japan, Hong Kong, Singapore, Brazil, Mexico or Argentina. South Korea sells
  Disney+ with TVING (18,000 KRW a month with Disney+ Standard and TVING Standard), and with TVING and Wavve:
  those need TVING, Wavve and Korean prices, so they're a follow-up.
- **Bundle prices follow the country, not the language:** Disney+'s Canadian article in English and French, and
  Crave's subscribe page in each, list the same bundles at the same prices.

**Resolved (2026-10-26, M5.6)**
- **"Sold in <country>" filter** (below Native pricing only, named after Settings' country): core's
  `CatalogQuery.soldOnly` keeps only plans whose availability is `offered` there. It hides the plans with only a
  fallback price ("No price for Canada yet"), and a provider not sold there, even when the text names it, as a
  price filter does. A provider priced in a country has no unknown plans there (a plan it doesn't price is not
  offered), so in practice it hides providers with no price there at all: for a UK user today, Netflix and
  Disney+.
- **A Settings default:** Settings' new Search card, "Show only what's sold in Canada", saves
  `settings.searchSoldOnly` (kept only when it's on; an optional field needs no migration). The URL carries
  `sold` only when it differs from that default: `sold=1` on, `sold=0` off. Core's `SearchDefaults` goes to
  `readSearchParams`, `writeSearchParams` and `filterCount`, so the Filters count leaves a default out, and Clear
  all puts it back. Search reads the URL once the settings have loaded, so a `sold=0` isn't read against the
  wrong default.
- **`availableIn` follows from M1.9:** providers sold in certain countries only (Crave) are not offered
  elsewhere, with or without the filter; the filter is for the multi-country ones with no price there yet.

**Resolved (2026-10-26, M1.10)**
- **A plan can be in several service categories:** an optional `categories` list on a plan, else its provider's
  `category`, which stays the provider's main one (`planCategories`, `providerCategories` in core). Proton is a
  privacy suite; VPN Plus is `[vpn]`, Drive Plus `[storage]`, and Free, Unlimited, Duo and Family
  `[privacy-suite, vpn, storage]`. Mail Plus and Pass Plus stay `privacy-suite` until there are Email and
  Password-manager categories. A list of the provider's category alone is reported: leave it out.
- **Search's Category filter keeps the plans in the category:** under VPN, Proton shows Free, VPN Plus and the
  suites as chips, and its `matchedOn` says `category:vpn`. The panel offers a category when a plan sold in the
  user's country is in it. A category the text names brings the plans in it too, ahead of the plans with a key
  it names, so "vpn" brings Proton's VPN plans, not Mail Plus, which only comes with Proton VPN Free.
- **GET /providers?category=** finds a provider by any category its plans are in, through D1's new
  `provider_categories` table (migration 0003), read by its key, and keeps only those plans. `seedFormat` is 2,
  so the next deploy reseeds in full and fills the table: 7 more rows at 5 providers. `GET /plans/:id` shows a
  plan's `categories`, and the contract examples show Proton's.
- **Over a provider-level list:** a provider-level `categories` would put all of Proton's plans under VPN, Mail
  Plus included. Deriving categories from features (VPN from `vpn.included`) would do the same, since every
  Proton plan includes Proton VPN Free, and would only repeat the Features filter.

**Resolved (2026-10-26, M1.9)**
- **Every plan and bundle has a sign-up `link`, and every provider a `cancelUrl`:** the schema requires them, so a
  provider without them fails validation, the pipeline's drafts included (section 6.5). Search's cards always
  show Plan ↗ and Cancel ↗; a provider not sold in the user's country still shows only Website ↗. A list item gets
  its plan's link and its provider's cancel page; a bundle item its bundle's cancel page, else its seller's. A
  bundle's own `cancelUrl` stays optional.
- **The cancel pages:** Disney+'s help article (`help.disneyplus.com/article/disneyplus-cancel`, the same steps in
  Canada and the US), Crave's FAQ article, and Mullvad's refunds guide: Mullvad ended subscriptions in 2022 and
  its terms "expire at the end of the period purchased", so there's nothing to cancel, only unused time to get
  back. The API examples' made-up cancel URLs became the real ones.
- **`availableIn` for providers sold in certain countries only:** Crave is `[CA]` (its terms: "The Service is
  intended for use in Canada."), so outside Canada it's not offered and its bundle with Disney+ isn't listed. The
  multi-country providers (Netflix, Disney+, Proton, Mullvad) don't get one: a country with no price stays unknown
  and shows "No price for … yet". Providers added later follow the same rule (section 13.4).

**Resolved (2026-10-26, M5.3)**
- **The URL is Search's state** (PROJECT-PLAN P8): core's `readSearchParams` and `writeSearchParams` read and write
  `?q=&sort=&min=&max=&cat=&f=&act=&native=1`, in that order, leaving defaults out. Only the search box keeps text of
  its own, while typing. Reading keeps what the catalog file has: a sort, a service category, rank keys,
  Active/Inactive/Not listed (`act=none`), amounts of 0 or more with the minimum at most the maximum, and Best match
  only with text. The page rewrites a URL with anything else once the catalog has loaded, replacing its entry.
- **History:** typing replaces the current entry once it pauses; a run of price changes (a drag, or arrow keys) makes
  one entry, marked in the history state; anything else adds one, so Back undoes the last filter. Search's URL writes
  don't scroll (the router's per-navigation `scroll: 'manual'`).
- **The price slider** goes from 0 to the highest lowest-monthly-equivalent of the plans sold in the user's country,
  rounded up to five steps of 1, 2 or 5 × 10ⁿ, about 40 steps in all (`searchFilterOptions`: CA$28.19 is $0 to $30 by
  $1; ¥3,600 is ¥0 to ¥4,000 by ¥100). A fixed $50 would be almost nothing in yen or forints. The right end is
  Unlimited, with no `max` in the URL, and a `max` past the top shows as Unlimited, since it keeps every plan. The
  amounts are in Settings' currency with no code: after a change of currency, or in a link shared across currencies,
  they're read in the reader's currency.
- **Features box** (`featureSuggestions`): only keys some plan sold there provides, matched from the start of a word
  in their names and aliases or their feature's ("ad" isn't "download"), a plural matching its singular (the rule
  search uses, now shared in `search/plurals.ts`); then the rest of their feature category, "More in Streaming".
  Streaming features have no parent in the registry, so grouping by parent would offer nothing related to Video
  quality. With no text it lists every key by category. Chips are named by `rankKeyLabel`, "Video quality: 4K (Ultra
  HD)" and a boolean by its own name: `featureLabels` are one plan's wording, so they can't name a filter across
  providers. Category lists the service categories something sold in the user's country is in, and the chosen one.
- **Under 960 px** a "Filters" button (Material's tune icon) in the search bar, "Filters · 2" with the count (named
  "Filters, 2 applied"), opens a MatDialog on the right as a drawer. Not ☰, which the top bar uses for the navigation.
  The CDK traps focus and hides the page from screen readers; Escape and the backdrop close it, focus goes back to the
  button, Back closes it, and it announces the count itself, since the page's is hidden behind it. "Show results"
  closes it too.
- **The panel follows the search bar in the Tab order**, before the results it changes. Activity is three native
  checkboxes drawn as chips, like the card's plan chips (a shared mixin), because Material's chip listbox draws its
  selection in an unmapped palette colour.
- **The Features suggestions are kept out of the Tab order:** Chromium makes a scrolling element a tab stop when
  nothing in it is, and Material renders the list just after the box, so Tab landed on the list and left it open, and
  the drawer's Escape closed the list before the drawer. The list gets `tabindex="-1"` when it opens; the arrow keys
  move through it from the box.
- **Option group labels** take the body text colour app-wide (section 8.1): Material draws them in the muted shade,
  which is 4.3:1 on dark mode's raised overlay surface.
- **The initial bundle didn't change** (487.7 kB). Material's slider, autocomplete, chips, checkbox and dialog load with
  the Search page.

**Resolved (2026-10-26, M5.2)**
- **The Search page:** a search box (results follow a 150 ms pause), Sort (Best match only with text), a polite count
  line, and one `ss-sub-card` per `searchCatalog` result. The text and the sort live in the page until M5.3 puts them
  in the URL with the filter panel; prices are plain text until M5.4 makes them buttons for the add menu.
- **The card:** the provider's icon, name, the plan shown and its status across lists ("Active · 2 lists"), Plan ↗ and
  Cancel ↗ (a not-offered provider's Website ↗), every interval's price, then "Cheaper at" each reseller's page. Plan
  chips are native radio buttons styled as chips: one tab stop, arrow keys, and never none chosen, which Material's
  chip listbox allows. A picked chip stays while it still matches a new search. The head lays out by the card's own
  width (a container query), so it fits beside M5.3's filter panel.
- **Expanded** (`ss-plan-details`, priced by core's `planExtras`): the features with the user's profile ranks, add-ons,
  bundles that include the plan with their savings, a suite's plans with its savings against them, perks, the plan's
  and provider's notes, and "Price checked …" with "May be out of date" after 90 days. Nothing availability calls not
  offered is listed.
- **Wording:** "No price for Canada yet" and "Not offered in Canada" use the country's name: English has no demonym
  table to say "Canadian" for every country.
- **Logos on a white tile** (`--ss-icon-tile`) in both themes, since sites draw their icons for white: ProxyStore's
  black logo vanished on dark cards. The letter fallback keeps the app background.
- **The initial bundle grew by 10 kB** (476 to 487 kB, 5.6 kB gzipped; the warning budget is 500 kB). esbuild places code
  by file, and `@angular/common` and the CDK's a11y files are already loaded at start, so `NgOptimizedImage` and
  `NgTemplateOutlet`, used in production for the first time by Search's cards (`ss-provider-icon`, `ss-price`), load
  with them. No search code is in the initial chunks.

**Resolved (2026-10-26, M5.1)**
- **One search engine:** the app's `searchCatalog` runs M2.3's `searchProviders` on the catalog file for the user's
  country, so Search and `GET /providers` match, filter and sort alike. D1 never narrows by text, so a change to
  matching reaches both; the API's answers keep their shape.
- **Matching** (P8): term by term, and every term must match ("netflix 4k" is Netflix's 4k plans). A term is the
  longest run of words that a rank key's, feature's or category's name or alias contains ("ultra hd"), so the
  registry alone decides and a provider matches the same whatever is searched with it. A plural also matches its
  singular ("vpns"; not words in -ss, -us or -is, like plus). A feature's own name and aliases match ("video
  quality", "streams") when the term names no rank key, with the highest value or tier each plan provides: every VPN
  feature is named "VPN …", and "vpn" means `vpn.included`. A category the text names brings all its providers'
  plans; a name or alias brings every plan unless a key the term names narrows them to the plans that provide it
  (when any does). Relevance is the best term's. Case, accents and spaces were already folded (M2.3).
- **Results:** one per provider, with its matching plans priced (every interval; offered, or unknown with the
  fallback price), the plan shown (the user's own when it matches, an active one first, else the cheapest; price
  sorts use it) and each plan's reseller deals. A provider that sells nothing in the user's country gets a "not
  offered" result only when the text names it (its name or an alias), and not with a price filter or Native pricing
  only, since it has no price. Add-ons, bundles and a suite's savings are worked out for the plan on screen (M5.2).
- **Activity now, not in M7.1:** core's `itemActivity` gives PROJECT-PLAN §3.3's Active or Inactive, and "Active
  from", from the billing dates alone; `providerActivity` groups the items by provider across lists, a bundle counting
  for each provider whose plan it includes. A window that repeats yearly is copied into each later year, never earlier
  ones. M7.1 builds `ItemStatus` on it, adding what needs the charges (ending soon, manual renewal).

**Resolved (2026-10-26, M1.8 resellers and Mullvad's prices)**
- **Mullvad's conversion was right.** With the ECB's rates of 2026-10-26, €5 is CA$7.85 and US$5.59, as Mullvad's
  own "€5 is equivalent to" figures say (CA$7.84, $5.59). The CA$7.53 and US$5.45 seen in the component gallery were
  its fixed cases, converted with the API contract's example rates on purpose; the gallery now says so, and which
  rates its catalog section used. The CA$98.04 a year seen at Mullvad's checkout is about 4% above the ECB conversion
  (CA$94.17), most likely the card processor's conversion, which paying in euros trades for the card's FX fee: M9's
  open question (below).
- **Mullvad's periods:** 2, 3 and 6 months join 1 month and 1 year, at the same €5 a month. Its pricing page lists
  only 1 month and 1 year; the others are its checkout's, which needs an account (seen by the project owner).
- **Resellers** (section 4.9): `data/resellers.yaml` lists each shop once, and a provider's `resellers` list the
  shops its own site names as official, quoting that page, with one offer per plan and the shops' regular prices.
  Partners that use a provider's service in their own product are never listed. Search shows a reseller next to a
  plan's prices when it's cheaper per month after the buyer's sales tax (`resellerDeals`, M5.2). A list item bought
  from one uses its price override until an item can name its shop. The pipeline finds resellers (M3.7) and the
  nightly check rereads them (M8.3).
- **Regular prices only,** as for every catalog price: a reseller's sale isn't stored. SerialCart's regular prices
  are above Mullvad's own, so it shows nowhere today; ProxyStore's standing "(10% discount)" is its regular price.
- **Tax:** a reseller price can leave VAT to be added everywhere (`taxExcluded`, SerialCart's "excl. VAT"); it's
  compared only in Canada and the US, where the app knows the tax.
- **The contract:** `GET /catalog`'s data gains the `resellers` list, and `GET /providers/:id` shows a provider's
  resellers as written; the examples show Amazon.ca's offer. The D1 tables don't change, so `seedFormat` stays.
- **Still open:** Amazon's other 12 stores (prices depend on the delivery address) and Laptop with Linux (price follows
  the delivery country's VAT). Logos on transparent backgrounds (ProxyStore's is black) were faint on dark cards:
  settled in M5.2 with a white tile behind every logo.

**Resolved (2026-10-26, M4.6)**
- **A skeleton of what exists:** core's `resolveItem` joins an item to its catalog plan, bundle or custom plan, prices
  it and lists the keys it provides; `MetricsService` keeps every item's resolution as signals, grouped by list.
  Status and the next charge come with the schedule engine (M7.1), effective ranks with `resolveRank` (M6.1), and
  `ListMetrics` with both (PROJECT-PLAN §3.4).
- **Items that can't be resolved** come back apart, with a reason: a plan, bundle, add-on or custom subscription no
  longer there, or no price for the item's billing period. While the catalog file for the item's region or the custom
  subscriptions haven't loaded, the reason is `pending`, not gone. Items store no names, so a page names a gone plan by
  its id. Totals (M7.1) leave them out and say how many.
- **Prices in parts:** `price` is the plan's picked price for the item's period, as price tags show it; each add-on is
  priced on its own, for the item's period when it's sold that way and else its shortest (Disney+ sells extra members
  monthly only); `override` is the price override while it applies. `monthlyEquivalent` is today's cost: the override,
  else the plan and add-ons. A custom plan's price and an override become picked prices (`typedPrice`), converted like
  any other, and marked tax-included unless typed "plus tax" (section 4.8).
- **Priced where bought:** each item uses the catalog file of its own region, and a plan no longer sold there is still
  priced (pickPrice's fallbacks): the user has it.

**Resolved (2026-10-26, M4.5)**
- **Shared components before their data:** every PROJECT-PLAN §4.3 component but `ss-sub-card` was built in M4.5, as
  display components shown in the gallery with hand-made inputs. Their inputs are §3.4's shapes, typed in core now
  (`ItemStatus`, `RankCounts`, `FeatureSummaryRow`) for M4.6, M6.1 and M7.1 to fill; the mini calendar takes a
  display shape of its own that M7.1's charges map to. `ss-sub-card` is built with its pages (M5.2, M6.8), where its
  two view models exist.
- **Rank dropdown:** a Material select (keyboard, typeahead and ARIA come with it) with each rank's dot and name.
  Core's `rankChoices` orders it: a profile offers Not ranked first, an item Essential and Critical (with their hints)
  and Not ranked in its place. "Profile default (Wanted)" comes first when there's a rank to inherit, muted, and
  choosing it clears the override; Not ranked is an override of its own.
- **Budget bars:** the thresholds stay as in section 8.1, in core's `budgetBar`, and one label colour reads on every
  fill and on the track, so a short fill needs no measuring (section 8.1). The Calendar's bar is coloured by the
  month's total against the budget, and has no tick when the budget is past the month's total (section 8.1.1).
- **ss-confirm** is a service that resolves to true only from its confirm button; Escape and the backdrop are false.
  It's an alert dialog described by its message, and a destructive question starts on Cancel.
- **Tags:** the picker creates tags inline through `TagsRepository`, from a name and one of 12 preset colours. The
  presets live in core (`tagColorPresets`) as stored values rather than theme colours: a tag chip shows the colour as
  a dot beside the name, so the name's contrast never depends on it. Settings' tag section (renaming, any hex colour,
  deleting) came with M6.11.

**Resolved (2026-10-26, M4.4)**
- **Exchange rates are kept in Dexie,** in a new `fxRates` table (Dexie v2), so converted prices show at once and
  offline. They're fetched like the catalog is checked: on start, a change of currency, `online` and a tab shown
  again, with the browser's cache answering until `/fx`'s max-age runs out (section 4.7).
- **Price tags:** amounts in the user's country's English format; "+ tax" only where a rate is added; "incl. tax"
  only in Canada and the US; the tooltip on the price's button when it's clickable, otherwise on a focusable icon
  (sections 4.7, 4.8).
- **The `/dev/components` gallery** started with `ss-price`, in development builds only, so the price tag could be
  checked in a browser before any page shows prices (section 8.2). M4.5 adds the other components.

**Resolved (2026-10-26, M4.3)**
- **Offline:** M4.3 keeps the catalog working when the network drops while the app is open; starting the app with no
  network moves to M10, with a service worker. Without one the browser revalidates `index.html` on every visit
  (section 7.6). Found while deciding: Angular 22.2.3's `provideServiceWorker` registers with a plain string, which
  our Trusted Types CSP blocks (`register` needs a `TrustedScriptURL`; tried in Edge), so M10 registers the worker
  itself through a policy of its own added to `_headers`. Cloudflare adds the Web Analytics beacon only to browser
  page loads, not to a worker's fetch of `index.html`, so M10 uses `navigationRequestStrategy: 'freshness'`, or
  repeat visits served from the worker's copy would go uncounted. An update prompt comes with it.
- **The cache:** one `catalogCache` record per downloaded file, never merged, with no ETag of its own (the browser's
  HTTP cache revalidates), checked against core's schemas on every read (sections 6.3, 11.1).
- **Checks:** index.json's version on start, on `online`, when a tab is shown after an hour and from Settings, with a
  Web Lock across tabs; no timer. Before the first run, only index.json. Settings gained the Catalog line (P13).

**Resolved (2026-10-26, prices that include tax)**
- **Mullvad's €5 includes VAT for everyone** ("Including VAT." on its pricing page), so adding Canadian sales tax
  overstated it by up to 15%. Its CA$7.84 is only "€5 is equivalent to", which the ECB conversion matches.
- **Per price:** `taxIncluded: { quote }` on a catalog price, with the source page's words, and `taxIncluded: true`
  on the API's picked prices. Left out, the buyer's region decides as before (section 4.8). The D1 tables don't
  change (it travels in each provider's JSON), so `seedFormat` stays.
- **Checked automatically:** price research and the extraction record the wording (section 6.5), and the nightly
  check confirms the quote is still there and flags contrary wording (section 6.4).

**Resolved (2026-10-26, M4.2)**
- **Canadian sales-tax rates** are built now, not in M7.1: the first-run and 📍 dialogs show "Sales tax 13%
  (Ontario)". Checked on 2026-10-26 against the CRA and the provinces' own pages (section 4.8). M7.1 builds the tax
  on charges. Subdivision lists live in core for CA and US only.
- **Theme:** `settings.theme` wins over the `localStorage` cache, live across tabs and imports; the inline script
  and its hash are unchanged (section 8.1).
- **First run:** the dialog opens only once the settings have loaded and none are saved, so it never flashes, and it
  can't be dismissed without saving: everything is prefilled from the browser's languages except a Canadian's
  province, which no locale or time zone can tell (Ontario and Quebec share America/Toronto). "Import a backup
  instead" comes with M6.9. The defaults: the first country a language names (`en-CA`), else the one it implies
  (`fr` → France), else the US; the currency follows `GET /providers`' rule.
- **Currencies offered** are the ones the ECB has rates for (`displayCurrencies`, 30 of them), since a price can
  only be converted into those. A country whose own currency isn't one of them defaults to US dollars.
- **IndexedDB blocked:** [Continue anyway] runs every repository in memory, on `fake-indexeddb` loaded only then
  (section 11.1), so later tasks have nothing to add for it.
- **Settings page (P13) in M4.2:** budgets, Appearance and the 📍 dialog. Tags have no task yet; backups (M6.9), the
  app lock (M6.10) and the catalog line come with their tasks.

**Resolved (2026-10-25, M4.1)**
- **User records** are strict Zod schemas in `packages/core/src/user/`, one file per record, with types from `z.infer`
  (section 4.6). Tags gained `createdAt`, `updatedAt` and `deletedAt`; rankings stay keyed by rank key and gained
  `createdAt` and `deletedAt`, and clearing one soft-deletes it; settings are one record under the key `settings`,
  with `updatedAt`. Timestamps are `toISOString()`'s form with milliseconds, so they sort as strings.
- **Ids:** UUID v7 from the `uuid` package, with the time from `ClockService.now()`, counting up within a millisecond.
- **Repositories** stream Dexie `liveQuery` through `rxResource`; a stored record that fails its schema is skipped,
  logged without its values and announced once per session, never deleted (section 11.1).
- **Dexie v1** declares all ten tables; the record schemas of `catalogCache`, `drafts` and `dismissedSuggestions` come
  with their tasks, which needs no new version. Card names reject 12+ digits in the schema (section 9.2).
- **Persistent storage** is requested after the first write. The P15 notice for blocked IndexedDB moved to M4.2.

**Resolved (2026-10-25, after M2)**
- **VPN features** (#25): twelve under `vpn.included` (server countries, protocols, kill switch, split tunneling,
  multi-hop, DNS content blocking, P2P, port forwarding, Tor over VPN, no-logs policy, independent audits, anonymous
  signup), filled in for Mullvad and Proton from their own pages. A stated no-logs policy and an audit of it are
  separate features. New features follow `.claude/skills/feature-discovery/SKILL.md`.
- **Temporary previews stay off `main`:** the progress preview lived on its own branch with a Workers Builds link
  (`.claude/skills/progress-preview/SKILL.md`) and was removed after M2. What it turned up that's permanent, the Zod
  `jitless` setting (section 7.6), went to `main` on its own (#26).

**Resolved (2026-10-25, M2.8)**
- **Rate limits:** 60 requests a minute per IP on `/api/*` and 10 on `/icon`, keyed by `CF-Connecting-IP` (section
  5.4). The Rate Limiting binding is GA, at no extra cost.
- **Edge cache:** the public answers of the routes that read D1 or KV, keyed by URL, for their own max-age (section
  5.1).
- **Theme script:** stays inline, hashed in the CSP, with a test that keeps the hash right (section 7.6).
- **API headers:** the CORS header, nosniff, `Cross-Origin-Resource-Policy: same-origin` and `default-src 'none'`
  on every `/api/*` response, errors included. The examples show the CORS header on every response now.

**Resolved (2026-10-25, M2.7)**
- **Response schemas** live in core next to each body builder, strict, and the builders' types come from them, so
  TypeScript catches the code drifting and the contract tests catch the examples drifting (section 13.3).
  `PickedPrice`, `ProvidersQuery` and `BundleSaving` became schemas too. The Worker never parses its own answers.
- **Phase 5's examples** (reports, calendar feeds): their errors are checked against the envelope now, and their
  success bodies get schemas when they're built (M10).
- **One table-driven test** replays every example; a few need a state (Frankfurter down, rates kept, an icon
  service's answer), set up by the example's title.
- **Headers:** compared as the examples show them, except the CORS header (M2.8) and `Content-Encoding`. The
  GET /catalog 400 example gained the `no-store` every 400 has had since M2.3, and GET /categories the CORS header
  the other catalog responses show.

**Resolved (2026-10-25, catalog icons)**
- **Catalog icons stay static files.** `npm run data:icons` fetches each one once from the provider's own site
  (its declared icons, then `/favicon.ico`, then the icon services: what a password manager uses) and the logo is
  committed. Static files are free, don't count against the Worker's quota and allow about 19,000 providers per
  deploy (section 7.1). Fetching icons per view would use Worker requests and KV, or tell Google or each provider
  what a user looks at, and wouldn't work offline. Only custom subscriptions, an open-ended list, use `GET /icon`.
- **Published as WebP:** `data:build` turns each logo into a WebP of at most 96 px (section 6.3), with `sharp`,
  which miniflare already depended on. `GET /icon` stays PNG: the Worker can't encode WebP within its CPU limit.
- **Logo fetching gets automated:** the discovery pipeline's PRs include each new provider's logo (M3.5), and the
  nightly bot proposes a new one after a rebrand (M8.3), so nobody needs to run `data:icons` by hand.

**Resolved (2026-10-25, M2.6)**
- **No usable icon** (a square PNG of at least 32 pixels, core's rule for catalog logos too) gets `404 not_found`,
  cacheable for a day, and the app shows the subscription's first letter. There's no Simply Sub fallback image.
- **No `size` parameter:** the Worker has no image library to resize with, so it returns the best icon (usually 64
  to 128 pixels) and the app scales it. One KV entry per domain keeps writes to one per new domain.
- **Privacy:** automatic request logs are off from M2.6 rather than M2.8, since `?domain=` names what a user
  subscribes to, and KV keys are a SHA-256 of the domain (section 5.4).

**Resolved (2026-10-24, M2.4)**
- **404 suggestions** come from a static `data/catalog/ids.json` that `data:build` writes (every provider id with its
  plan ids), so a typo reads no D1 rows; `SELECT id FROM providers` would read every provider's row on each 404.
  `features.json` and `categories.json` hold no provider ids (section 6.3).
- **Region and currency** follow `GET /providers`' rules on all three routes: the same 400s, defaults and 502. The
  detail routes keep every plan and add-on, but one not offered in the region gets no `pricing`; `GET /bundles`
  leaves out a bundle not offered there.
- **`GET /bundles?plans=`** takes 1 to 20 plan ids, and a malformed or unknown one gets 400 with a suggestion (one
  primary-key lookup per id). Region is optional: without it there are no prices or savings. Savings follow the
  rules in section 4.4. The contract gained `intervalCount` on `standalone` and `savings` entries, and `fxDate` in
  the meta.
- **`GET /plans/:id`** reads `bundleIds` from the `bundle_plans (plan_id)` index, in any region, and
  `providedRankKeys` from core's `providedKeys` (registry order), which M6.1 builds on.

**Resolved (2026-10-24, M2.3)**
- **`GET /providers`** runs core's `searchProviders` (`packages/core/src/search/`), so the app's Search page (M5.1)
  can use the same matching. Text matches provider names and aliases, plan names, service category names and
  rank-key names; relevance goes provider name (starts with, then contains), alias, plan name, then feature or
  category. The full rules, defaults and 400s are the query descriptions in the examples file.
- **No migration:** D1 narrows by rank key through the existing index, and by provider id. The registry and the
  categories come from the static files (M2.2), which keep `features.yaml`'s order, so a request reads only the
  `catalog` row and the providers that can match (section 7.1 has the numbers and the ~200-provider trigger).
- **Without a region** there are no prices: the default sort is then `name`, and the price parameters get 400.
  The default `currency` is the region's own (`regionCurrency` in core), or USD when the ECB has no rate for it.

**Resolved (2026-10-24, M2.5)**
- **Order:** M2.5 comes before M2.3, because `GET /providers` converts prices with the same rates and reports their
  date (`meta.fxDate`).
- **Exchange rates** come from Frankfurter's ECB-only v2 route, in euros: v1 is deprecated, and v2's default blends
  in other sources. KV keeps one copy under `fx:ecb`, fresh for 12 hours, and core rebases it to the requested
  currency, rounded to 6 significant digits, which never drops a digit Frankfurter's own rebased rates show
  (section 5.2).
- **Caching:** fresh rates have an ETag of the base and the ECB's date, and a `max-age` of the time left until
  they're due again (43,200 seconds right after a fetch). Stale rates have no ETag and `max-age=900`.

**Resolved (2026-10-24, M2.2)**
- **`GET /features` and `GET /categories`** are static files that `data:build` writes
  (`data/catalog/features.json` and `categories.json`), streamed like `/catalog` with `index.json`'s version as the
  ETag. D1 doesn't change: no position column, no categories table, no reseed, and neither route reads a D1 row
  (sections 5.2, 6.3).
- **Order:** `/features` keeps `features.yaml`'s order, and validation requires each group to be listed before its
  features (section 6.2).
- **No query parameters** on either route: any parameter gets `400 bad_request` (section 5.4).

**Resolved (2026-10-24, M2.1)**
- **Region files** keep the prices pickPrice can pick there in any currency: the region's own, else its group's,
  else every price. They agree with pickPrice exactly, which the documented "own + group + GLOBAL + US/GB/EU" rule
  didn't. `other.json` was dropped: a country without prices needs every price, so it gets `catalog.json`
  (section 6.3).
- **The ETag** comes from the static `data/catalog/index.json`, never from D1, which is seeded before the files
  are deployed (section 5.1).
- **The seed** reads what D1 holds in the deploy step (`scripts/seed-d1.ts`) and writes only what changed. A full
  reseed happens only without a `catalog` row, on a new `seedFormat`, or by hand. An enum's moved values update
  `rank_value` in place (section 5.3).
- **The deploy command** is `npm run deploy`, so its steps live in Git (section 7.6).
- **Left as it is:** the files' `generatedAt` is the build time, so a code-only deploy changes their bytes, and it
  is then newer than `/health`'s `catalogUpdatedAt`. The app (M4.3) checks `index.json`'s version before
  downloading a region file.

**Resolved (2026-10-23, security review)**
- **Domain:** the app and the API moved to `sub.simplely.ca`, an origin of their own, because browser storage is
  shared by everything on one origin (sections 7.3, 11.5).
- **Device data:** strict CSP with Trusted Types (M2.8), Zod validation of imports and stored records, optional
  encrypted backups (M6.9) and an optional passphrase lock that encrypts data at rest (M6.10). A key the app keeps
  itself would protect nothing (section 11.5).
- **Dependencies:** CI fails on high or critical `npm audit` advisories, and Dependabot alerts are on.

**Resolved (2026-10-23, pre-M2 review)**
- **Sales tax:** added for buyers in Canada and the US, by the buyer's province or state (a menu of the chosen
  country's subdivisions). Canada has a built-in rate table; US users enter their own rate. Typed amounts include
  tax unless marked "plus tax". Totals include tax; price tags show the listed price with "+ tax" (section 4.8).
- **Storage roles:** static files for the catalog and icons, D1 for the search API, KV for small values that must
  survive (M2.5, M2.6), and R2 only when one of its triggers is reached (section 7.1).
- **Regions:** ISO 3166-1 codes only (`GB`, not `UK`), checked by `validateCatalog`; `EU` is a group priced once for
  its 27 members, which pickPrice tries right after the user's own region (section 4.7).
- **Availability:** offered, not offered or unknown, with an optional `availableIn` taken from the provider's own
  country list (section 4.7).
- **Free prices** are native in pickPrice, so nothing shows ≈ next to Free.
- **Billing dates:** counted from a known charge date, with `billingDay` for month-end dates, 30-day cycles as
  `day` × 30, and an edited date becoming the new anchor (PROJECT-PLAN §3.1). No date library (section 13.2).
- **Prices** are regular prices; first-term offers are the user's `priceOverride` with an `until` date (section
  4.3). `ListItem` gains `region`, add-on quantities and a `bundle` kind (section 4.6).
- **Catalog delivery and D1:** per-region static snapshot files, and from M2.1 the seed writes only what changed
  (sections 5.3, 6.3). Storage itself isn't a constraint; rows written per day is.
- **ICS export:** one all-day event per charge, not `RRULE`s (section 11.2).
- **Icon services:** Google, then DuckDuckGo, as the code already does (section 5.4).

**Resolved (2026-10-23)**
- All-in-one plans such as Proton Unlimited, Duo and Family are **suite plans**, not bundles. They state their
  own features, and `includes-subscription` drives overlap warnings, savings and the optimizer (section 4.4).
- **Free plans** are plans with a $0 price (section 4.3).
- **Plans for several people** list the `account.users` feature (section 4.2).
- **Business and per-seat plans** are out of scope for v1 (section 1.3).

**Resolved (2026-10-22, later)**
- Network FX: **no network API**. Stick with ECB rate + the user's FX fee %, labelled "estimated" (section 9.3).
- Hosting platform: Cloudflare for the app, API and bot. GitHub for the repo and PR checks. Fly.io not used (section 7.8).

**Resolved (2026-10-22)**
- Domain: **simplely.ca** (bought through Cloudflare Registrar) → `/simply/sub/` and `/api/sub/v1/`. Replaced on
  2026-10-23 by `sub.simplely.ca`, so the app has an origin of its own (section 7.3).
- Colours: go with the suggested palette (section 8.1), all as CSS variables so changes are easy.
- Payment page: kept, manual entry, flat cash-back, FX fee, network, optional monthly limit (section 9).
- Duplicates: every item counts, so lists can be per family member (section 8.1.1).
- Automation: Cloudflare-first, Git stays the source of truth (section 7.7).
- Regions: every region a service supports, defaulting to the user's own; non-native prices are converted and marked (section 4.7).
- Ranks: one dropdown with Not ranked as the default and no × button. Profile level: Not ranked, Needed, Wanted,
  Uses, Sometimes, Unused, Unwanted. Subscription level adds Essential, Critical (added 2026-10-23) and
  "Profile default" (sections 8.3, 4.6, 10.2).
- Budget bars: defined per location (section 8.1.1).
- Feature depth: detailed canonical taxonomy with aliases and groups. Password-manager item types are a
  shared `set` (section 4.2).
- Catalog filling: an automated discovery pipeline, with no hand-picked URLs (section 6.5).

---

## 15. Reference links
- Cloudflare Workers static assets: https://developers.cloudflare.com/workers/static-assets/
- Static assets billing and limits: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations
- Workers limits / pricing: https://developers.cloudflare.com/workers/platform/limits/
- D1: https://developers.cloudflare.com/d1/
- Wrangler config: https://developers.cloudflare.com/workers/wrangler/configuration/
- GitHub Action for Wrangler: https://github.com/cloudflare/wrangler-action
- Hono: https://hono.dev
- Angular: https://angular.dev
- Angular Material: https://material.angular.dev
- Dexie: https://dexie.org
- Frankfurter FX API: https://frankfurter.dev
- Proton: subscribe to an external calendar: https://proton.me/support/subscribe-to-external-calendar
- Ratehub: how credit card categories are classified: https://www.ratehub.ca/blog/how-are-credit-card-categories-classified-2/
- Free hosting tiers comparison (Sep 2026): https://flaviocopes.com/hosting-free-tiers/
- Workers Builds limits: https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- Browser Rendering limits: https://developers.cloudflare.com/browser-rendering/limits/
- Visa Foreign Exchange Rates API: https://developer.visa.com/capabilities/foreign_exchange
- Mastercard Currency Conversion Calculator (issuer-only): https://developer.mastercard.com/currency-conversion-calculator/documentation/
