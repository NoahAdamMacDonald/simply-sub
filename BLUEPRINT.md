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
│  │  │  ├─ shared/ui/       # sub-card, rank-select, budget-bar, price-tag, mini-calendar…
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
│     │  ├─ user/            # user-data types (lists, items, cards…)
│     │  ├─ dates/           # ISO calendar dates in UTC: IsoDate, toIsoDate, addDays, addMonths (M7.1)
│     │  ├─ icons/           # PNG and ICO reading, a page's icon links, the icon services, picking the best icon,
│     │  │                   # GET /icon's query (M2.6)
│     │  ├─ schedule/        # recurrence: next payment dates, monthly/annual totals
│     │  ├─ tax/             # sales tax: tax-added regions, the Canadian rate table, subdivisions (section 4.8)
│     │  ├─ ranking/         # rank keys, providesKey (M2.3) and providedKeys (M2.4); rank resolution (item override >
│     │  │                   # profile > not ranked)
│     │  ├─ search/          # searchProviders, readProvidersQuery, providersBody: GET /providers now, Search (P8) in M5
│     │  ├─ lookup/          # readPricingQuery, readBundlesQuery and the GET /providers/:id, /plans/:id and /bundles
│     │  │                   # bodies (M2.4)
│     │  ├─ optimizer/       # suggestion engine (section 10)
│     │  ├─ rewards/         # card reward maths (section 9)
│     │  └─ export/          # csv, json, txt, xlsx, ics serializers
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

`headline: true` on a feature, value or tier puts it in feature summaries ("VPN 2 / 3", "4k 2 / 5").
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
acceptedNetworks: [visa, mastercard, amex, discover]   # omit = unknown → all cards allowed, with a warning
billingCurrency: { CA: CAD }        # currency actually charged per region (drives FX-fee maths)
cancelUrl: https://www.netflix.com/cancelplan
sources: { pricing: https://help.netflix.com/en/node/24926 }
# Optional and left out here: aliases, availableIn (section 4.7), cancelFee (text), notes. Optional fields are
# omitted, never empty or null.

plans:
  - id: netflix.standard-ads
    name: Standard with ads
    link: https://www.netflix.com/signup
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
| `formats.ts` | `slugSchema`, `dottedSlugSchema`, `planIdSchema`, `bundleIdSchema`, `tierIdSchema`, `rankKeySchema`, `regionSchema`, `currencySchema`, `isoDateSchema`, `httpsUrlSchema`, `iconNameSchema`, `textSchema`, `aliasesSchema` |
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
  category: string;          // service category
  spendCategory: string;
  acceptedNetworks?: CardNetwork[];          // left out = unknown
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
  updatedAt: string;
  // M6.10 adds appLock?: { salt; iterations; check; idleMinutes }: the optional passphrase lock (11.5). No secret
  // is stored, only the salt and an encrypted check value. Per-device preferences (PROJECT-PLAN §3.5) come with
  // their tasks too. Optional fields added later need no migration: stored records without them still pass.
}
```
`Settings.country` and `ListItem.region` are countries (ISO 3166-1 alpha-2), never `EU` or `GLOBAL`, and a
subdivision must belong to the country.

**Rank resolution:** `item.rankOverrides[key]` → `profileRanking[key]` → `'not-ranked'`. Group ranks never cascade to children.

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

v1 declares every table, so it's the full list the app lock (M6.10) encrypts. `catalogCache`, `drafts` and
`dismissedSuggestions` get their record schemas with M4.3, M6.3 and M8.2, and `cards` its repository with M9.1 (its
schema is in core already, since backups carry cards).
```ts
db.version(1).stores({
  lists: 'id, updatedAt',
  items: 'id, listId, updatedAt',
  customSubs: 'id, updatedAt',
  rankings: 'rankKey',
  cards: 'id',
  tags: 'id',
  settings: 'key',
  catalogCache: 'key',         // last catalog snapshot + ETag
  drafts: 'listId',            // unsaved list edits (PROJECT-PLAN.md P5)
  dismissedSuggestions: 'fingerprint'
});
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
  added as a custom subscription), and shows an `unknown` item's fallback price with "No Canadian price yet".
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
- Shown with a **≈ prefix plus a small currency-exchange icon** (Material Symbols `currency_exchange`). The tooltip
  reads "Converted from 9.99 USD at 1.38 on 2026-10-22. You'll be charged in USD."
- Native prices show no icon. The search filters offer a **"Native pricing only"** toggle.
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
`subdivisionsOf`), and the maths on charges in M7.1:
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
- **Where it shows:**
  - Charges, totals, budgets, the calendar and exports include tax, because that's what leaves the account. Each
    charge keeps its tax part (`Charge.tax`, PROJECT-PLAN §3.1).
  - Price tags (`ss-price`: Search, plan pickers, cards) show the listed price, with a small "+ tax" in tax-added
    regions, the way Canadian prices are normally shown, or "incl. tax" for a price that includes it. The monthly
    equivalent is before tax too.
  - An item's billing details show the amount charged, tax included.
- **Payment cards** (section 9.3): cash back and FX fees apply to the amount charged, tax included.
- **Settings:** the first-run dialog and the 📍 dialog ask for the province or state, in a menu that lists the
  chosen country's subdivisions (ISO 3166-2 codes with English names, kept in core for CA and US only: the 13
  provinces and territories, the 50 states and DC; Puerto Rico and the other territories are countries of their
  own), shown only for tax-added countries. A Canadian province is required, since it sets the rate; a US state is
  optional. Under it the form shows "Sales tax 13% (Ontario)" and a "Use my own rate" checkbox (a US user always
  gives their own rate). Changing it re-prices every total.

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
(`0002_seed_what_changed.sql` has the full SQL). Every table is `STRICT`, so SQLite enforces the column types, and
`WITHOUT ROWID` (since M2.1), so its primary key is the table itself rather than a second index next to a rowid:
```sql
providers     (id PK, name, category, spend_category, hash, json)
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
- Every `→` is a foreign key with `ON DELETE CASCADE`, so deleting a provider removes its plans, prices, plan
  features and bundle links, and emptying the parent tables leaves no orphans. D1 always enforces foreign keys.
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
  `data/categories.yaml`, `data/providers/<id>.yaml` or `data/bundles/<slug>.yaml` (always `.yaml`), or
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
- ids are duplicated: across files (provider, plan, add-on and bundle ids share one namespace), in
  `features.yaml`, or within one category list
- a reference doesn't exist: a bundle's `soldBy` (a provider) and `includes` (plans), a plan's `addOnIds`
  (add-ons in the same file), an add-on's `grantsPlan` (a plan in the same file)
- an add-on isn't listed in any plan's `addOnIds`
- a file in `data/logos/` isn't a PNG named after a provider id (`netflix.png`), or the image isn't square, is under
  32 pixels or is over 100 KB
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
the oldest price. It also warns about a provider without a logo in `data/logos/`, which the app shows as a letter.

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
     `iconUrl` when the provider has a logo; without one, the app shows its first letter) and bundles sorted by id. Bundles stay in their source shape: the app computes feature unions and
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
4. Convert each logo in `data/logos/` to `apps/web/public/icons/<id>.webp`, published as `/icons/<id>.webp`: at
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

**Which file a buyer gets** (`regionFileFor`): their country's, else their group's (a Swede gets `EU.json` when
Sweden has no prices of its own), else the full `catalog.json`. A country with no prices and no group needs every
price, since any region's can be its fallback, so there is no separate file for "other" countries. A missing
static file is answered with the app's `index.html` (the SPA fallback), so the Worker and the app look the region
up in `index.json` instead of trying a file. The app loads its country's file, plus the file of any other region a
list item was bought in (`ListItem.region`), so it never downloads every region's prices.

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
     on no change → bump lastVerified (batched into the same PR, or skipped to avoid noise)
     on failure  → list it in the PR body as "needs manual check"
```
**Logos** ride along (M8.3): the run fetches each provider's best icon the way `npm run data:icons` does, and when
it differs from the committed `data/logos/<id>.png` (a rebrand), the same PR proposes the new one.

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
- **accepted card networks** (from the checkout or help page, for example "We accept Visa, Mastercard, Amex")
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
| Browser Rendering | ~10 browser-minutes/day, 3 concurrent | Only JS-heavy pricing pages in the nightly check |
| Workers AI | Daily free allowance | Price extraction when no selector matches |
| Cron Triggers / Workflows | Included in Workers free (verify Workflows limits) | One nightly run |
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
    must show up. `index.html` and the catalog files keep the default, revalidated on every visit.
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
  }
  [data-theme='dark'] {
    --ss-accent-text: oklch(from var(--ss-accent) 0.76 calc(c * 1.15) h);  /* ≈ #FF83A0: readable on dark, follows the accent hue */
    --ss-text: #F2F2F2;  --ss-text-muted: #A8A8A8;
    --ss-sidebar-bg: #000000;  --ss-app-bg: #2B2B2B;  --ss-card-bg: #3A3A3A;  --ss-divider: #393939;
    /* text shades = vivid fills on dark, lightened where needed to reach 4.5:1 on dark cards */
    --rank-essential-text: #DF7DFF;  --rank-critical-text: #93A6FF;  --rank-needed-text: #00EAFF;  --rank-wanted-text: #5CFF5C;
    --rank-uses-text: #FFF000;  --rank-sometimes-text: var(--rank-sometimes);  --rank-unused-text: #FF8C33;
    --rank-unwanted-text: #FF7E7E;  --rank-none-text: #A5A5A5;
    /* the accent fill, --ss-on-accent, the vivid rank fills and the budget colours are inherited from :root on purpose */
  }
  ```
  **Contrast (checked in M0.4, WCAG 2 ratios).** Body, muted and accent text pass AA on every background in both
  themes, as do white on the accent and the `#111` label on every budget fill. Three dark rank text shades failed
  on dark cards (essential 3.95, unwanted 3.76, none 4.25) and were lightened to the values above (about 4.6:1).
  Critical was added later (2026-10-23): its text shades are 6.7:1 on white and 4.95:1 on dark cards.
  The derived accent shades were rechecked when they replaced the hex values: the dark accent text is 4.9:1 on
  dark cards and 9:1 on the sidebar, and the hover keeps the old value's 9.6:1 on white.
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
  75–100%, red over 100%.

### 8.1.1 What each budget bar measures
| Where | Bar shows |
|---|---|
| **Home** | **All lists combined** against the monthly and annual budgets |
| **Lists overview: each list card** | **That list's share** of the total budget (its own cost ÷ budget) |
| **View list** | Only **that list's** cost against the budgets |
| **Calendar** | **The displayed month only**: spent so far (payments dated up to today) against the month's total, for the lists currently shown, with a tick mark at the monthly budget |

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

### 8.3 Page notes
**Home.** Shows the current-month mini calendar with payment days highlighted, plus the monthly and annual budget
bars for **all lists combined** (section 8.1.1). The bars appear only if a budget is set. The big CTA opens `/lists`.

**Lists overview.** Each card shows the name, a monthly bar (**this list's share** of the monthly budget), a yearly bar, rank
counts in rank colours (zero counts in grey), a View button and delete (with confirmation). Below the cards is a
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

**Search.** Free text matches provider names, plan names and feature names. Filters:
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
as it does for a catalog provider without a logo.

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
- A card is eligible if `provider.acceptedNetworks` includes its network.
- If the provider's networks are **unknown**, every card is allowed and shown with an "acceptance not confirmed" hint.
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

---

## 10. Optimizer engine

Lives in `packages/core/src/optimizer/`. It's a **pure function**:
`optimize(list, catalog, rankings, cards?, settings) → Suggestion[]`, and it runs in the browser
(in a Web Worker if it's slow).

### 10.1 Inputs, prepared first
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
7. (Phase 4) Move to a better card (an eligible network, within limits; section 9.3).

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
Fixture-based Vitest tests, for example: "2 VPNs, VPN ranked Needed → suggest removing the cheaper one",
"Essential feature blocks a downgrade", "Critical feature allows a same-provider downgrade that keeps it but
blocks removal" and "a limited Sep–Oct window keeps a Needed feature covered".

---

## 11. User data, export, calendar & sync

### 11.1 Local storage
IndexedDB through Dexie, with repositories exposed as Angular services that return signals or observables.
Request persistent storage with `navigator.storage.persist()`, and remind users to back up (they can be
prompted after each big change, or weekly).
- **Repositories are the only way in.** Nothing else touches Dexie, so the app lock (section 11.5) can wrap them
  later without changing a page.
- **Only non-sensitive fields are indexed:** ids, `listId`, `updatedAt` and keys, as in the Dexie schema in section
  4.6. Everything else can then be stored encrypted.
- **Records are validated on the way in and out** with the same Zod schemas as backups. Treat stored data as
  untrusted: script on the origin, or a bad import, could have written it.

**As built (M4.1)**, in `apps/web/src/app/core/storage/`:
- **Repositories** (`ListsRepository`, `ItemsRepository`, `CustomSubsRepository`, `TagsRepository`,
  `RankingsRepository`, `SettingsRepository`; cards come with M9.1) are `@Service()`s. Each streams a Dexie
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
  (M6.10) wraps `StorageEngine`, the one class that reads and writes rows.
- **Loaded on first use:** Dexie, Zod and the record schemas (216 kB minified, 60 kB compressed) load as a chunk of
  their own when a repository first needs them. Since M4.2 the settings load at startup (the theme and the first-run
  check need them), which brought `rxResource`, the storage service and the settings store into the initial bundle:
  466 kB of its 500 kB budget, from 426 kB. The first-run dialog, its form and the locale defaults stay lazy. Core imports Zod as `import * as z from 'zod'`, which ESLint enforces: `import { z }`
  brings all of Zod, every locale's messages included, and made the chunk 541 kB.
- **Persistent storage** is requested after the first write, not on load: Firefox asks the user, and the question
  only makes sense once there's something to keep.
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
| CSV | papaparse | One row per item (list, service, plan, cost, interval, next date, tags) |
| XLSX | exceljs (lazy-loaded) | One sheet per list plus a summary sheet |
| TXT | native | A readable summary |
| ICS | `ics` npm package | One all-day event (`VALUE=DATE`, so no time zone can move it) per charge in the next 12 months, from the schedule engine. Not `RRULE`s: a monthly rule starting on the 31st skips every shorter month (RFC 5545 drops dates that don't exist), and separate events also follow windows, end dates and price changes |

### 11.3 Calendar integration
- **Phase 3, download `.ics`:** works with Google, Apple and Proton through their import features. This is
  offline and private, but a snapshot, so it doesn't update when the list changes.
- **Phase 5, live subscription URL:** Google, Apple and **Proton Calendar ("Add calendar from URL")** all
  support subscribing to an `.ics` URL. This needs the payment schedule stored on the server, so it's
  **opt-in**: the app uploads a **minimal schedule** (titles and amounts only, or event titles alone if
  the user prefers) under a random 128-bit token. The Worker then serves `/api/v1/cal/<token>.ics`. Users can
  revoke the token at any time. Subscribed calendars are read-only in Proton, which is fine for this.

### 11.4 Device sync and future accounts
- **Phase 5, encrypted sync ("sync chain", like Brave's):** generate a sync code (a passphrase). The browser
  encrypts the whole user database with a key derived from the code (the same crypto module as encrypted backups
  and the app lock, section 11.5) and stores the blob in R2 (section 7.1), keyed by a hash of the code. Other devices enter the code to pull and merge.
  The server can't read the data. Merging works per record using `updatedAt` and `deletedAt`
  (last write wins), which is why every record has those fields.
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
- **What's encrypted:** each record of `lists`, `items`, `customSubs`, `rankings`, `cards`, `tags`, `drafts` and
  `dismissedSuggestions` keeps its indexed fields in plain text and stores the rest as one encrypted value. The
  settings needed before unlocking (theme, whether the lock is on) and the catalog cache stay plain, since they're
  public or harmless.
- **Locking:** the lock screen asks for the passphrase on each visit. The app locks again after a chosen idle time
  (15 minutes by default) and when the tab closes.
- **Turning it on** encrypts everything in one transaction; turning it off decrypts it.
- **A forgotten passphrase** leaves two ways out: restore a backup, or delete all data. The dialog that turns the
  lock on says so, and offers an encrypted backup first.

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
  `dates/` helpers (`addDays`, and `addMonths` in M7.1), which work in UTC so a time zone or a daylight-saving
  change can't shift a date. No date library: date-fns works in local time.
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
2. Use only feature ids from `features.yaml`. Add new features there first, in a separate commit.
3. Fill in `lastVerified` and `sourceUrl` for every price. Store regular prices, not first-term offers, and the
   billing period the provider states (`day` × 30 for "every 30 days"), with ISO region codes (`GB`, not `UK`). Add
   `availableIn` only when the provider lists the countries it sells in (sections 4.3, 4.7).
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
1. **Workflows free-tier limits**: confirm at setup time (section 7.1).
2. **Buyer-chosen charge currency** (decide in M9): some providers let the buyer pick the currency they're charged
   in. Proton sells fixed price lists in USD, CAD, EUR and CHF (stored as `GLOBAL` prices in each currency, with
   `billingCurrency: { GLOBAL: USD }` for everyone else). Mullvad has one fixed price in EUR but takes cards in
   about 20 currencies at a converted amount, so `billingCurrency: { GLOBAL: EUR }` overstates its card FX fee.
   M9's FX-fee maths has to decide how to treat both cases (section 9.3).

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
