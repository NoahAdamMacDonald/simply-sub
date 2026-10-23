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
| Toolchain | **Volta 2.0.2** pins **Node 24.19.0** and **npm 12.0.2** through the root `package.json` |
| Repo layout | npm-workspaces monorepo (section 3) |
| User data | **Local-first**: IndexedDB through Dexie. No accounts in v1 |
| Catalog API | Our own read-only API on a **Cloudflare Worker (Hono) + D1**, because no free API exists (section 5) |
| Catalog source of truth | **YAML files in Git**, validated in CI and seeded into D1 automatically |
| Domain & URLs | **simplely.ca**: app at `https://simplely.ca/simply/sub/`, API at `https://simplely.ca/api/sub/v1/` |
| Regions | **Every region a service supports** is stored. The user's own region and currency are the default. Prices without a native price in the user's currency are converted and marked with a "converted" icon (section 4.7). Canadian data is filled first |
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
                        https://simplely.ca
                               │
                     ┌─────────┴──────────────────────────┐
                     │      Cloudflare Worker "simply-sub" │
                     │                                     │
   /simply/sub/*  ──►│  Static assets (Angular build)      │  free, no request cap
                     │                                     │
   /api/sub/v1/*  ──►│  Hono router  ──►  D1 (catalog)     │  counts against Worker quota
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
2. **The app downloads a catalog snapshot** (the static file `/simply/sub/data/catalog.json`, the same JSON as
   `GET /api/sub/v1/catalog`), caches it, and does search, filtering and optimization locally. This makes the UI fast, lets it work offline, and keeps API calls far below the free limit.
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
│  │  │  │  ├─ storage/      # Dexie database, repositories, migrations
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
│  │  ├─ public/             # favicon, logo
│  │  └─ proxy.conf.json     # dev: /api → wrangler dev
│  │
│  └─ api/                   # Cloudflare Worker
│     ├─ src/
│     │  ├─ index.ts         # Hono app, routes mounted at /api/sub/v1
│     │  ├─ routes/          # providers.ts, plans.ts, features.ts, bundles.ts, catalog.ts, icons.ts
│     │  └─ db/              # SQL queries (D1)
│     ├─ migrations/         # D1 schema migrations (0001_init.sql …)
│     ├─ public/             # ← Angular build is copied here at build time (gitignored; `_headers` stays tracked)
│     └─ wrangler.jsonc
│
├─ packages/
│  └─ core/                  # pure TypeScript with no Angular or Worker dependencies
│     ├─ src/
│     │  ├─ index.ts         # the public API, imported as `@simply-sub/core`
│     │  ├─ catalog/         # catalog types + Zod schemas (shared by web, api, scripts)
│     │  ├─ user/            # user-data types (lists, items, cards…)
│     │  ├─ dates/           # ISO calendar dates: IsoDate, toIsoDate, addDays
│     │  ├─ schedule/        # recurrence: next payment dates, monthly/annual totals
│     │  ├─ ranking/         # rank resolution (item override > profile > not ranked)
│     │  ├─ optimizer/       # suggestion engine (section 10)
│     │  ├─ rewards/         # card reward maths (section 9)
│     │  └─ export/          # csv, json, txt, xlsx, ics serializers
│     └─ test/               # Vitest specs, mirroring src/ (run in the America/Vancouver time zone)
│
├─ data/                     # catalog source of truth (human-edited)
│  ├─ features.yaml          # feature registry
│  ├─ categories.yaml        # service categories + spend categories
│  ├─ providers/
│  │  ├─ netflix.yaml
│  │  ├─ proton.yaml
│  │  └─ …
│  ├─ bundles/
│  │  └─ crave-disney.yaml
│  └─ logos/                 # optional manual logo overrides (svg/png)
│
├─ scripts/
│  ├─ validate-data.ts       # Zod/JSON-schema validation + cross-reference checks
│  ├─ build-catalog.ts       # YAML → catalog.json + seed.sql
│  ├─ fetch-icons.ts         # catalog favicons → static icon files at build time
│  ├─ price-check.ts         # nightly price monitor (section 6.4)
│  └─ draft-provider.ts      # AI-assisted: pricing page URL → draft YAML
│
├─ apps/bot/                # Cron Worker: nightly price check (Workflows + Workers AI) → GitHub PRs
│
└─ .github/workflows/
   └─ ci.yml                 # required PR checks: lint, test, validate data, build
                             # (deploys run on Cloudflare Workers Builds, section 7.6)
```

**Why this layout**
- `packages/core` holds the business logic (optimizer, schedules, rewards, exporters) as plain functions. It can be
  unit-tested without Angular and reused by the API and scripts.
- Apps import core as TypeScript source through the `@simply-sub/core` path alias in `tsconfig.base.json`, so core
  has no build step. Angular's build, Wrangler and tsx read the alias themselves. A Vitest config that imports core
  sets `resolve.tsconfigPaths: true`. Core's `package.json` `exports` points at the same file, so the npm workspace
  link resolves it too. Workspace tsconfigs extend the base with a relative path, because Vite can't follow an
  absolute Windows `extends`.
- `data/` makes catalog edits plain Git diffs: easy to review, revert and automate.
- One Worker serves both the app and the API: one deploy, one domain, no CORS problems in production.

### Root `package.json` (sketch)
```jsonc
{
  "name": "simply-sub",
  "private": true,
  // packages/* first, so `npm test` runs core's tests before `ng test` (which watches in a terminal)
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev:web": "npm -w apps/web run start",
    "dev:api": "npm -w apps/api run dev",
    // core has nothing to emit; its tsc check runs first because Vitest strips types without checking them
    "build": "npm -w packages/core run typecheck && npm -w apps/web run build && npm -w apps/api run build",
    "test": "npm run test --workspaces --if-present",
    "data:validate": "tsx scripts/validate-data.ts",
    "data:build": "tsx scripts/build-catalog.ts"
  },
  "volta": { "node": "24.19.0", "npm": "12.0.2" }
}
```
Set this up with `volta pin node@24.19.0 npm@12.0.2` in the repo root. That command writes the `volta` block.
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
   `password-manager.sharing` …). A group's own rank means "I want this kind of thing at all" (for example *any*
   password manager). Children start as Not ranked, so detailed options only matter once you rank them, and a
   "Set all in this group" action makes bulk ranking quick. Ranks deliberately **don't cascade**. Otherwise
   ranking "Password manager: Needed" would make all 22 item types Needed, and the optimizer could never suggest a
   simpler password manager.
3. **Reusable or nothing.** A feature goes in the registry if it is comparable and either exists at **two or more
   providers** or matters for ranking. Anything else that is truly provider-specific (the Fortnite Crew passes in
   Game Pass Ultimate) goes in a plan's `perks` list (free text, shown but not compared).
4. **Prefer structured types:** `boolean`, `number` (with `unlimited`), `enum` (ordered) and `set` (a
   multi-select of canonical values, for example the item types a password manager can store).
5. **Plans can show provider wording.** `featureLabels: { password-manager.item-types.identity: "Personal info" }`
   on a plan overrides the displayed name without breaking comparison.

```yaml
# data/features.yaml
- id: video.quality
  name: Video quality
  category: streaming
  type: enum
  values: [480p, 720p, 1080p, 4k]     # ordered low → high, so "at least 1080p" queries work
- id: video.hdr
  name: HDR
  category: streaming
  type: boolean
- id: streaming.ad-free
  name: Ad free
  category: streaming
  type: boolean
- id: streaming.concurrent-streams
  name: Simultaneous streams
  category: streaming
  type: number
  unit: devices
  tiers:                         # rankable buckets (the Features page rows); "provided" when value ≥ min
    - { id: "1", name: Single device, min: 1, max: 1 }
    - { id: "2-4", name: 2 to 4 devices, min: 2, max: 4 }
    - { id: "5+", name: More than 4 devices, min: 5 }
- id: streaming.download-devices
  name: Download devices
  category: streaming
  type: number
  unit: devices
- id: vpn.included
  name: VPN
  category: vpn
  type: boolean
- id: vpn.devices
  name: VPN devices
  category: vpn
  type: number
  unit: devices
- id: vpn.unlimited-traffic
  name: Unlimited VPN traffic
  category: vpn
  type: boolean
- id: storage.cloud
  name: Cloud storage
  category: storage
  type: number
  unit: GB
- id: password-manager.included
  name: Password manager
  category: security
  type: boolean
- id: security.dark-web-monitoring
  name: Dark web monitoring
  category: security
  type: boolean
- id: email.custom-domains
  name: Custom email domains
  category: email
  type: number
- id: ai.assistant
  name: AI assistant
  category: ai
  type: boolean

# ── Detailed, shared password-manager taxonomy ─────────────────────────────
- id: password-manager
  name: Password manager
  category: security
  type: boolean
  aliases: [password vault, pass]
- id: password-manager.item-types
  parent: password-manager
  name: Storable item types
  type: set
  values:
    - { id: login, name: Logins, aliases: [account logins, passwords] }
    - { id: totp, name: 2FA codes, aliases: [authenticator, one-time codes, otp] }
    - { id: passkey, name: Passkeys }
    - { id: credit-card, name: Credit cards, aliases: [payment cards] }
    - { id: identity, name: Identity, aliases: [personal information, personal info, identities] }
    - { id: secure-note, name: Secure notes, aliases: [notes] }
    - { id: email-alias, name: Email aliases, aliases: [hide-my-email, forwarding addresses] }
    - { id: bank-account, name: Bank accounts }
    - { id: crypto-wallet, name: Crypto wallets }
    - { id: api-credential, name: API credentials }
    - { id: ssh-key, name: SSH keys }
    - { id: wifi, name: Wi-Fi networks, aliases: [wifi network] }
    - { id: database, name: Database credentials }
    - { id: server, name: Server credentials }
    - { id: software-license, name: Software licenses }
    - { id: drivers-license, name: Driver's licenses }
    - { id: passport, name: Passports }
    - { id: medical-record, name: Medical records }
    - { id: membership, name: Memberships }
    - { id: reward-program, name: Reward programs }
    - { id: government-id, name: Government IDs, aliases: [social security, SIN] }
    - { id: custom, name: Custom item types }
- id: password-manager.health
  parent: password-manager
  name: Password health monitoring
  type: set
  values: [breached, weak, reused, old, suspicious]
- id: password-manager.sharing
  parent: password-manager
  name: Password sharing
  type: set
  values:
    - { id: share-to-user, name: Share with other users }
    - { id: share-vault, name: Share folders/vaults, aliases: [share folders] }
    - { id: share-link, name: Share by link }
    - { id: link-expiry, name: Expiring links }
    - { id: link-view-limit, name: Link view limits, aliases: [usage limits] }
    - { id: role-permissions, name: Access roles, aliases: [viewer/editor/admin, read/write/admin] }
- id: password-manager.generator.max-length
  parent: password-manager
  name: Max generated password length
  type: number
  unit: characters
- id: password-manager.generator.passphrase
  parent: password-manager
  name: Memorable passphrases
  type: boolean

# ── Services that include other services (overlap detection) ───────────────
- id: includes-subscription
  name: Includes another subscription
  category: bundle
  type: set
  valuesFrom: providers        # values are provider/plan ids, e.g. ea-play, ubisoft-plus.classics
```

`number` features support `unlimited` as a value. Booleans that aren't listed on a plan are treated as `false`,
and `set` features that aren't listed are treated as empty. Other categories (VPN, storage, email, gaming,
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
cancelFee: null
notes: ""

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
    addOns: [netflix.extra-member-ads, netflix.extra-member]
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
    addOns: [netflix.extra-member-ads, netflix.extra-member]
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

**Money-back features** (for example a savings-account plan paying 3.5% interest, or Xbox Rewards) use a `returns` block on the plan:
```yaml
    returns:
      - type: interest           # interest | cashback | store-credit | points
        description: 3.5% savings interest
        rate: 0.035
        estimate: user-input     # the user enters a balance to estimate value
```

### 4.4 Bundle file (`data/bundles/crave-disney.yaml`)
```yaml
id: crave-disney-premium
name: Crave + Disney+ Premium
provider: bell                       # who sells the bundle
includes: [crave.premium, disney-plus.premium]
link: https://example.com/bundle
cancelUrl: https://example.com/cancel
prices:
  - { region: CA, currency: CAD, amount: 29.99, interval: month, intervalCount: 1, autoRenew: true, lastVerified: 2026-10-21 }
# Features = union of the included plans' features (computed)
# Savings  = sum of the included plans' prices − bundle price (computed per region/interval)
```

### 4.5 Catalog TypeScript types (`packages/core/src/catalog/types.ts`)
```ts
export type Interval = 'day' | 'week' | 'month' | 'year';
export type FeatureValue = boolean | number | 'unlimited' | string;

export interface Price {
  region: string;            // ISO 3166-1 alpha-2, e.g. 'CA'
  currency: string;          // ISO 4217, e.g. 'CAD'
  amount: number;
  interval: Interval;
  intervalCount: number;
  autoRenew: boolean;
  lastVerified: string;      // ISO date
  sourceUrl?: string;
}

export interface FeatureValueDef { id: string; name: string; aliases?: string[]; headline?: boolean }
export interface FeatureTier { id: string; name: string; min: number; max?: number; headline?: boolean }

export interface FeatureDef {
  id: string;
  parent?: string;           // group feature id
  name: string;
  category: string;          // feature category (how the Features page groups features)
  type: 'boolean' | 'number' | 'enum' | 'set';
  values?: FeatureValueDef[];  // enum: ordered low → high; set: canonical options
  tiers?: FeatureTier[];       // number features: rankable buckets
  valuesFrom?: 'providers';
  aliases?: string[];
  unit?: string;
  headline?: boolean;        // show in feature summaries
  rankable?: boolean;        // default true
}
// Plan.features values: boolean | number | 'unlimited' | enum value id | string[] (set)
export type RankKey = string;  // 'streaming.ad-free' | 'video.quality=4k' | 'streaming.concurrent-streams=2-4' …

export interface Plan {
  id: string;
  providerId: string;
  name: string;
  link?: string;
  features: Record<string, FeatureValue>;
  prices: Price[];
  addOns?: string[];
  addOnLimit?: number;
  returns?: PlanReturn[];
  notes?: string;
}

export interface Provider {
  id: string;
  name: string;
  website: string;
  category: string;
  spendCategory: string;
  acceptedNetworks?: CardNetwork[];  // undefined = unknown
  cancelUrl?: string;
  cancelFee?: string | null;
  plans: Plan[];
  addOns: AddOn[];
}

export interface Bundle {
  id: string;
  name: string;
  includes: string[];        // plan ids
  prices: Price[];
  link?: string;
  cancelUrl?: string;
}
```
The **Zod schemas** next to these types are the single validation source. They are used by `validate-data.ts`,
by the API, and by the app when it parses cached snapshots. JSON Schema is generated from Zod so YAML files get
editor autocomplete through the VS Code YAML extension.

### 4.6 User data model (IndexedDB, `packages/core/src/user/types.ts`)
Every record has `id` (UUID v7), `createdAt`, `updatedAt` and `deletedAt?` (a soft delete, so future sync can merge changes).

```ts
export type Rank =
  | 'essential' | 'needed' | 'wanted' | 'uses'
  | 'sometimes' | 'not-ranked' | 'unused' | 'unwanted';

export interface SubscriptionList {
  id: string; name: string;          // default "Subscription List"
  createdAt: string; updatedAt: string; deletedAt?: string;
}

export interface ListItem {
  id: string; listId: string;
  source:
    | { kind: 'catalog'; planId: string; addOnIds?: string[]; bundleId?: string }
    | { kind: 'custom'; customSubId: string; customPlanId: string };
  billing:
    | { mode: 'recurring'; interval: Interval; intervalCount: number;
        anchorDate: string;          // a known renewal date; other dates are calculated from it
        startDate?: string;          // subscribed since (no charges before it)
        endDate?: string;            // planned cancellation (no charges from this date on)
        autoRenew: boolean }         // false = charges still projected, marked "renew manually"
    | { mode: 'limited'; windows: { start: string; end: string; repeatYearly: boolean }[];
        interval: Interval };        // e.g. Netflix Premium every Sep–Oct
  priceOverride?: { amount: number; currency: string };  // promos, grandfathered prices
  cardId?: string;
  tagIds: string[];
  rankOverrides: Record<RankKey, Rank>;  // subscription-level ranks (PROJECT-PLAN.md §3.2)
  pinned: boolean;
  createdAt: string; updatedAt: string; deletedAt?: string;
}

export interface ProfileRanking {     // global ranks; 'essential' isn't allowed; 'not-ranked' is never stored
  rankKey: RankKey; rank: Exclude<Rank, 'essential' | 'not-ranked'>; updatedAt: string;
}

export interface CustomSubscription {
  id: string; name: string; link?: string; cancelUrl?: string;
  plans: { id: string; name: string; features: Record<string, FeatureValue>;
           price: { amount: number; currency: string; interval: Interval; intervalCount: number };
           autoRenewAvailable: boolean }[];
  createdAt: string; updatedAt: string; deletedAt?: string;
}

export interface PaymentCard { /* see section 9 */ }

export interface Tag { id: string; name: string; color: string; }

export interface Settings {
  country: string; currency: string;            // e.g. 'CA', 'CAD'
  monthlyBudget?: number; annualBudget?: number;
  theme: 'light' | 'dark' | 'system';
}
```

**Rank resolution:** `item.rankOverrides[key]` → `profileRanking[key]` → `'not-ranked'`. Group ranks never cascade to children.

**Dexie schema** (`apps/web/src/app/core/storage/db.ts`). Bump the version number and add an upgrade function
whenever the shape changes. Export files carry a `schemaVersion` so old backups can still be imported.
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
Every price row carries its `region` and `currency`. A service priced in a single worldwide currency uses `region: GLOBAL`.
A provider's **availability** is the set of regions it has prices for, plus an optional `availableIn` list for
services that sell in a region without publishing a local price.

**Choosing which price to show** (`packages/core/src/catalog/pick-price.ts`), given the user's region and currency
from Settings:
1. A price for the user's **region**: shown as native.
2. A price in the user's **currency** from another region (for example CAD from `GLOBAL`): shown as native.
3. A `GLOBAL` price in another currency, converted.
4. A price for the closest fallback region (US → GB → EU → first available), converted.

**Converted prices**
- Converted using daily ECB rates (Frankfurter, through `/api/sub/v1/fx`, cached in the browser with the rate date).
- Shown with a **≈ prefix plus a small currency-exchange icon** (Material Symbols `currency_exchange`). The tooltip
  reads "Converted from 9.99 USD at 1.38 on 2026-10-22. You'll be charged in USD."
- Native prices show no icon. The search filters offer a **"Native pricing only"** toggle.
- **Not available in your region:** if the provider has an `availableIn` list that excludes the user's region,
  the card shows a "Not offered in Canada" badge instead of a price, but can still be added manually.
- The optimizer uses converted amounts but labels the resulting savings "estimated". In Phase 4, card **FX fees**
  apply automatically when the charged currency differs from the card's currency.
- Users can view prices for any region by changing the region in Settings, or pick a region per list item
  (useful for services bought abroad).

---

## 5. Catalog API

### 5.1 Stack
- **Hono**: a tiny router built for Workers, with typed routes and middleware for CORS, caching and ETags.
- **D1**: Cloudflare's SQLite database. Normalized tables, plus each provider's full JSON stored for fast reads.
- **Cache API** with `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`. Catalog responses
  carry a `catalogVersion` (the Git commit SHA) as the ETag.

### 5.2 Endpoints (all under `/api/sub/v1`)
| Method & path | Purpose |
|---|---|
| `GET /catalog` | Full snapshot (providers, plans, add-ons, bundles, features, **all regions' prices**) for the app. Small when gzipped, ETag-cached. `?region=CA` trims it to the prices `pick-price` could use for that region. The app reads the identical static copy `/simply/sub/data/catalog.json` instead, which doesn't use any Worker quota |
| `GET /providers?q=&category=&feature=<rankKey,…>&minPrice=&maxPrice=&interval=&region=&currency=&nativeOnly=&sort=&cursor=&limit=` | Search and filter (for deep links and other consumers) |
| `GET /providers/:id` | One provider with its plans and add-ons |
| `GET /plans/:id` | One plan |
| `GET /features` | Feature registry |
| `GET /categories` | Service and spend categories |
| `GET /bundles?plans=netflix.standard,crave.premium` | Bundles that include any of the given plans |
| `GET /icon?domain=example.com` | Favicon proxy for **custom subscriptions** (DuckDuckGo → Google → fallback), cached for 30 days. Catalog icons are downloaded at build time (`scripts/fetch-icons.ts`) and served as static files at `/simply/sub/icons/<id>.png` |
| `GET /fx?base=CAD` | Proxied and cached Frankfurter rates (daily) |
| `GET /health` | Returns the version and catalog SHA |
| *(Phase 5)* `POST /reports` | "This price looks wrong" reports (Turnstile-protected, rate-limited) |
| *(Phase 5)* `GET /cal/:token.ics` | Opt-in live calendar feed (section 11.3) |

Example requests and responses for every endpoint are in [docs/api-output-examples.json](docs/api-output-examples.json).
Successful responses use `{ "data": …, "meta": … }`, and errors use `{ "error": { "code": "not_found", "message": "…" } }`.
Responses are JSON and versioned through the `/v1` path. Breaking changes go under `/v2`.

### 5.3 D1 schema (`apps/api/migrations/0001_init.sql`, simplified)
```sql
CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, spend_category TEXT, json TEXT NOT NULL);
CREATE TABLE plans     (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id), name TEXT NOT NULL, json TEXT NOT NULL);
CREATE TABLE prices    (plan_id TEXT NOT NULL, region TEXT NOT NULL, currency TEXT NOT NULL, amount REAL NOT NULL,
                        interval TEXT NOT NULL, interval_count INTEGER NOT NULL, monthly_equiv REAL NOT NULL);
CREATE TABLE plan_features (plan_id TEXT NOT NULL, feature_id TEXT NOT NULL, value TEXT NOT NULL, rank_value REAL);
CREATE TABLE features  (id TEXT PRIMARY KEY, category TEXT, json TEXT NOT NULL);
CREATE TABLE bundles   (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE bundle_plans (bundle_id TEXT NOT NULL, plan_id TEXT NOT NULL);
CREATE TABLE snapshots (region TEXT PRIMARY KEY, sha TEXT NOT NULL, json TEXT NOT NULL);  -- prebuilt /catalog payloads
CREATE INDEX idx_prices_region ON prices(region, monthly_equiv);
CREATE INDEX idx_pf_feature ON plan_features(feature_id, rank_value);
```
`rank_value` stores an enum's position (1080p = 2, 4k = 3) or the number itself, so rank-key filters like
`feature=video.quality=1080p` ("1080p or better") become plain numeric comparisons.

### 5.4 Minimal Worker entry (sketch)
```ts
// apps/api/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { providers } from './routes/providers';
import { catalog } from './routes/catalog';

type Env = { Bindings: { DB: D1Database; ASSETS: Fetcher; APP_ORIGIN: string } };

const api = new Hono<Env>().basePath('/api/sub/v1');
api.use('*', (c, next) => cors({ origin: c.env.APP_ORIGIN })(c, next));
api.route('/catalog', catalog);
api.route('/providers', providers);
api.get('/health', (c) => c.json({ ok: true }));

export default api;   // non-API paths never reach the Worker (see run_worker_first)
```

---

## 6. Populating & maintaining the catalog

### 6.1 Principle: Git is the database, D1 is a cache
People (and bots) edit `data/**/*.yaml` through pull requests. CI validates every change. Merging to `main`
rebuilds D1 from scratch. This gives you:
- full history and easy rollback (`git revert`)
- reviewable diffs ("Netflix Premium 23.99 → 24.99")
- no admin UI to build or secure

### 6.2 Validation (`scripts/validate-data.ts`, runs in CI on every PR)
Validation fails if:
- a file doesn't match the Zod schema
- a plan uses a feature id that isn't in `features.yaml`, or an enum value that isn't listed
- ids are duplicated, or a bundle or add-on references a plan that doesn't exist
- a currency isn't ISO 4217, or an amount is ≤ 0
- `lastVerified` is in the future

Validation warns (but passes) when `lastVerified` is older than 90 days.

### 6.3 Build & seed (`scripts/build-catalog.ts`, runs in `deploy.yml`)
1. Load and validate all YAML.
2. Compute the derived data: `monthly_equiv` (native currency), enum `rank_value`, bundle feature unions and
   native-currency savings. The cheapest price per feature (what `api-all-example.json` tried to store) is computed
   on demand with today's exchange rates instead, so it's never stale.
3. Write `catalog.<region>.json` snapshots and `seed.sql`. The seed starts with `DELETE FROM` for every table,
   then inserts everything.
4. `wrangler d1 migrations apply simply-sub-catalog --remote`, then `wrangler d1 execute simply-sub-catalog --remote --file seed.sql`.

The catalog will be small (hundreds of plans), so a full reseed takes seconds and stays far inside D1's free write limits.

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
     on no change → bump lastVerified (batched into the same PR, or skipped to avoid noise)
     on failure  → list it in the PR body as "needs manual check"
```
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
- plans, prices (amount, currency, interval), add-ons, perks
- **accepted card networks** (from the checkout or help page, for example "We accept Visa, Mastercard, Amex")
  and the billing currency
- an **evidence quote** for every price and feature (shown in the PR, so review is fast)
- `proposedFeatures`: capabilities that don't match the registry, for you to approve. Once approved they're
  added to `features.yaml` and reused for every later provider.

Model choice: the Workers AI free daily allowance, or a small Claude model (`claude-haiku-5-5`), which costs
cents per provider. Check current pricing. One run fills hundreds of providers.

**⑤ Validate:** the same `validate-data.ts` rules (section 6.2), plus checks for missing prices, implausible
amounts and duplicate plans.

**⑥ Review:** a PR per batch with a table (provider, plans, prices, evidence links, screenshots, warnings).
You merge, fix or close. Rejected items are marked in `queue.yaml` so they aren't retried every night.

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
- Proton (Free, Mail Plus, Pass Plus, VPN Plus, Unlimited, Family)
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
| D1 | ~5 GB storage, ~5M rows read per day, ~100k rows written per day | Under 10 MB, cached reads, reseeded on deploy |
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
   volta install node@24.19.0 npm@12.0.2
   npm i -g @angular/cli@22.2.4        # or use npx
   npm i -D wrangler -w apps/api       # Wrangler stays per-project
   npx wrangler login
   ```
4. **Scaffold:**
   ```bash
   mkdir simply-sub && cd simply-sub && npm init -y
   volta pin node@24.19.0 npm@12.0.2
   npx @angular/cli@22.2.4 new web --directory apps/web --style=scss --routing --ssr=false
   npm create cloudflare@latest apps/api -- --type=hello-world --lang=ts   # then add hono
   mkdir -p packages/core/src data/providers data/bundles scripts
   ```
5. **D1:**
   ```bash
   npx wrangler d1 create simply-sub-catalog      # copy the database_id into wrangler.jsonc
   npx wrangler d1 migrations create simply-sub-catalog init
   ```
6. **API token for CI:** in the Cloudflare dashboard go to *My Profile → API Tokens*. Create a token with
   *Workers Scripts: Edit*, *D1: Edit* and *Workers Routes: Edit* permissions. In GitHub, save it as the repo
   secret `CLOUDFLARE_API_TOKEN`, and save your account id as `CLOUDFLARE_ACCOUNT_ID`.

### 7.3 Serving the app under `/simply/sub/`
Static assets are matched by **path**, so the build must sit at `public/simply/sub/` inside the Worker's asset folder:
- Build Angular with `ng build --base-href /simply/sub/`.
- A post-build step copies `apps/web/dist/web/browser/*` to `apps/api/public/simply/sub/`.
- It also copies `index.html` to `apps/api/public/index.html`, because SPA fallback serves the root
  `index.html` for unknown routes. Thanks to `<base href="/simply/sub/">`, that copy still loads the right files.
  (Alternatively, add a tiny root `index.html` that redirects to `/simply/sub/` and handle the SPA fallback in the
  Worker. Pick whichever behaves better when you test it.)

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
  "routes": [
    { "pattern": "simplely.ca/simply/sub*", "zone_name": "simplely.ca" },
    { "pattern": "simplely.ca/api/sub*",   "zone_name": "simplely.ca" }
  ],
  "vars": { "APP_ORIGIN": "https://simplely.ca" },
  "observability": { "enabled": true }
}
```
Until `simplely.ca` is active in Cloudflare, delete `routes` and use the free `simply-sub.<account>.workers.dev`
URL. The rest of `simplely.ca` (root page, other future apps) stays free for other Workers or Pages projects,
since these routes only claim `/simply/sub*` and `/api/sub*`.

### 7.5 Local development
- Terminal 1: `npm run dev:api` (`wrangler dev`, port 8787, with a local D1). Seed it with
  `wrangler d1 execute simply-sub-catalog --local --file seed.sql`.
- Terminal 2: `npm run dev:web` (`ng serve` with `proxy.conf.json`):
  ```json
  { "/api": { "target": "http://localhost:8787", "secure": false } }
  ```

### 7.6 CI/CD (Workers Builds)
Connect the GitHub repo in *Workers & Pages → simply-sub → Settings → Builds*:
- **Build command:** `npm ci && npm run build && npm run data:build`
- **Deploy command:** `npx wrangler d1 migrations apply simply-sub-catalog --remote && npx wrangler d1 execute simply-sub-catalog --remote --file dist/seed.sql && npx wrangler deploy`
- **Root directory:** `apps/api`, or the repo root with `--config apps/api/wrangler.jsonc`
- Non-`main` branches get **preview builds** (`wrangler versions upload`) with their own preview URL.
- A small GitHub Actions `ci.yml` still runs lint, tests and `data:validate` as required **PR checks**, because
  that's what blocks merging a bad catalog change. Actions are free for public repos.
- **Security headers:** add a `_headers` file in `public/` with a strict Content-Security-Policy,
  `Referrer-Policy` and `X-Content-Type-Options`.

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
| Domain fit | ✅ `simplely.ca` is already on Cloudflare; path routes `/api/sub*` are one config line | Needs DNS records + certificate on Fly, and can't share `simplely.ca` paths with the app without a proxy | Pages wants its own (sub)domain; path sharing needs a Cloudflare proxy anyway |
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
(for example `/simply/sub/data/catalog.json`, which is free and has no request cap) instead of going through the
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
    --rank-essential-text: #DF7DFF;  --rank-needed-text: #00EAFF;  --rank-wanted-text: #5CFF5C;
    --rank-uses-text: #FFF000;  --rank-sometimes-text: var(--rank-sometimes);  --rank-unused-text: #FF8C33;
    --rank-unwanted-text: #FF7E7E;  --rank-none-text: #A5A5A5;
    /* the accent fill, --ss-on-accent, the vivid rank fills and the budget colours are inherited from :root on purpose */
  }
  ```
  **Contrast (checked in M0.4, WCAG 2 ratios).** Body, muted and accent text pass AA on every background in both
  themes, as do white on the accent and the `#111` label on every budget fill. Three dark rank text shades failed
  on dark cards (essential 3.95, unwanted 3.76, none 4.25) and were lightened to the values above (about 4.6:1).
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

  Always show the rank **name** next to its colour, for colour-blind users.
- **Theme mode:** System (follows `prefers-color-scheme` live), Light or Dark. `ThemeService` sets
  `data-theme` on `<html>` and `color-scheme` follows it. The mode is saved in `localStorage` (`ss-theme`), which an
  inline script in `index.html` reads before the first paint. From M4.2, `settings.theme` in Dexie is the source of
  truth and `localStorage` stays as the startup cache. The production build doesn't inline critical CSS, because
  the inliner would drop the `[data-theme='dark']` rules and flash the light theme.
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
- feature rank overrides: the same single dropdown, with Essential added and a first option
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
Sometimes, Unused and Unwanted. Essential is only available per subscription. Resetting means choosing
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
The favicon comes from the link through `/icon`, and falls back to the Simply Sub logo.

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
**Never** store card numbers, expiry dates or CVVs. The add-card dialog says so.

### 9.3 Calculations (`packages/core/src/rewards/`)
**Which cards can pay for a subscription:**
- A card is eligible if `provider.acceptedNetworks` includes its network.
- If the provider's networks are **unknown**, every card is allowed and shown with an "acceptance not confirmed" hint.
- Ineligible cards are hidden from the item's card dropdown, and the optimizer never assigns them.

**Effective monthly cost of an item on a card:**
```
charged        = price in the provider's billing currency for the user's region
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
- **Essential:** an item with any Essential feature can't be removed, and can only move to a plan of the same
  provider that keeps that feature at the same or a higher level.
- **Needed:** after any change, every Needed feature must still be provided by at least one item **in every
  month it was provided before**.

### 10.3 Candidate actions per item
1. Keep.
2. Change interval (monthly → annual if cheaper over 12 months and the item renews automatically).
3. Downgrade or switch plans within the same provider.
4. Convert to an **add-on** of another item's plan (for example a second Netflix account becomes an extra member).
5. Replace with a **bundle** that covers two or more items.
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
"Essential feature blocks removal" and "a limited Sep–Oct window keeps a Needed feature covered".

---

## 11. User data, export, calendar & sync

### 11.1 Local storage
IndexedDB through Dexie, with repositories exposed as Angular services that return signals or observables.
Request persistent storage with `navigator.storage.persist()`, and remind users to back up (they can be
prompted after each big change, or weekly).

### 11.2 Export & import
| Format | Library | Notes |
|---|---|---|
| JSON | native | **Full backup**: all tables plus `schemaVersion`. The only format that can be re-imported |
| CSV | papaparse | One row per item (list, service, plan, cost, interval, next date, tags) |
| XLSX | exceljs (lazy-loaded) | One sheet per list plus a summary sheet |
| TXT | native | A readable summary |
| ICS | `ics` npm package | Recurring events (`RRULE`) for each item's payment dates |

### 11.3 Calendar integration
- **Phase 3, download `.ics`:** works with Google, Apple and Proton through their import features. This is
  offline and private, but a snapshot, so it doesn't update when the list changes.
- **Phase 5, live subscription URL:** Google, Apple and **Proton Calendar ("Add calendar from URL")** all
  support subscribing to an `.ics` URL. This needs the payment schedule stored on the server, so it's
  **opt-in**: the app uploads a **minimal schedule** (titles and amounts only, or event titles alone if
  the user prefers) under a random 128-bit token. The Worker then serves `/api/sub/v1/cal/<token>.ics`. Users can
  revoke the token at any time. Subscribed calendars are read-only in Proton, which is fine for this.

### 11.4 Device sync and future accounts
- **Phase 5, encrypted sync ("sync chain", like Brave's):** generate a sync code (a passphrase). The browser
  encrypts the whole user database with a key derived from the code (WebCrypto: PBKDF2/Argon2 → AES-GCM) and
  stores the blob in D1 or R2, keyed by a hash of the code. Other devices enter the code to pull and merge.
  The server can't read the data. Merging works per record using `updatedAt` and `deletedAt`
  (last write wins), which is why every record has those fields.
- **Accounts later:** add Cloudflare Access or an auth library on top. An account just owns sync blobs, so
  the data model doesn't change.

---

## 12. Roadmap

> The task-level breakdown (milestones M0–M10, each task with a "done when" check) is in **PROJECT-PLAN.md §2**.

### Phase 0: Setup
- [x] Register `simplely.ca` (bought through Cloudflare Registrar)
- [ ] Monorepo scaffold, Volta pin, workspaces, `tsconfig.base.json`
- [ ] Angular app with Material 3, theme tokens, sidebar shell, empty routes
- [ ] Worker with Hono, D1 created, `/health`
- [ ] Asset copy step + `wrangler.jsonc`; first deploy works on `simplely.ca/simply/sub/`
- [ ] Workers Builds connected to the repo; GitHub `ci.yml` as required PR checks

### Phase 1: Catalog
- [ ] `packages/core` catalog types + Zod schemas, generated JSON Schema
- [ ] `features.yaml`, `categories.yaml`
- [ ] `validate-data`, `build-catalog`, migrations, seed in deploy
- [ ] Discovery pipeline: `discover-services` (Wikidata), `find-urls`, `extract-plans`, PR batching (section 6.5)
- [ ] Seed providers with the pipeline (section 6.6)
- [ ] `pick-price` + FX conversion (section 4.7)
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
- Dates: ISO strings (`YYYY-MM-DD`) in storage, date-fns for recurrence maths.
- Lint and format with ESLint (angular-eslint) and Prettier.

### 13.3 Testing
- `packages/core`: high unit-test coverage, especially schedule, ranking, optimizer and rewards.
- `apps/api`: route tests with Vitest + `@cloudflare/vitest-pool-workers`.
- `apps/web`: component tests for key dialogs, plus a few Playwright end-to-end flows
  (create list → add from search → see totals).

### 13.4 How to add a provider (checklist)
1. Create `data/providers/<id>.yaml` (copy `netflix.yaml`, or run `npm run data:draft -- <pricing-url>`).
2. Use only feature ids from `features.yaml`. Add new features there first, in a separate commit.
3. Fill in `lastVerified` and `sourceUrl` for every price.
4. Run `npm run data:validate`, then open a PR.

### 13.5 Glossary
| Term | Meaning |
|---|---|
| Provider | The company or service (Netflix) |
| Plan | A purchasable tier (Netflix Standard) |
| Price | A plan's cost for one region and interval |
| Add-on | An extra purchasable on top of a plan (extra member) |
| Bundle | Several plans sold together for one price |
| List / item | A user's subscription list / one subscription in it |
| Rank | How much the user cares about a feature: Essential > Needed > Wanted > Uses > Sometimes > Not ranked > Unused > Unwanted |
| Spend category | The category used for card rewards (streaming, software…) |
| Snapshot | The full catalog JSON for one region, served by `/catalog` |

---

## 14. Open questions

**Still open**
1. **Workflows free-tier limits**: confirm at setup time (section 7.1).

**Resolved (2026-10-22, later)**
- Network FX: **no network API**. Stick with ECB rate + the user's FX fee %, labelled "estimated" (section 9.3).
- Hosting platform: Cloudflare for the app, API and bot. GitHub for the repo and PR checks. Fly.io not used (section 7.8).

**Resolved (2026-10-22)**
- Domain: **simplely.ca** (bought through Cloudflare Registrar) → `/simply/sub/` and `/api/sub/v1/`.
- Colours: go with the suggested palette (section 8.1), all as CSS variables so changes are easy.
- Payment page: kept, manual entry, flat cash-back, FX fee, network, optional monthly limit (section 9).
- Duplicates: every item counts, so lists can be per family member (section 8.1.1).
- Automation: Cloudflare-first, Git stays the source of truth (section 7.7).
- Regions: every region a service supports, defaulting to the user's own; non-native prices are converted and marked (section 4.7).
- Ranks: one dropdown with Not ranked as the default and no × button. Profile level: Not ranked, Needed, Wanted,
  Uses, Sometimes, Unused, Unwanted. Subscription level adds Essential plus "Profile default" (sections 8.3, 4.6).
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
