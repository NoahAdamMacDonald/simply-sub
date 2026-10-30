# Simply Sub — AI context

**Read [BLUEPRINT.md](BLUEPRINT.md) before planning or writing code.** It is the source of truth for architecture and decisions.
- **[PROJECT-PLAN.md](PROJECT-PLAN.md)** has the build order (task IDs M0.1 …) and a spec with acceptance criteria for every page. Work one task ID at a time.
- **[docs/api-output-examples.json](docs/api-output-examples.json)** is the API contract. Don't change response shapes without updating it:
  the contract tests hold the examples and the Worker to core's response schemas (`successBodySchemas`, `errorBodySchema`).
- **[docs/wireframes/](docs/wireframes/)** has the Figma screenshots (local only, not in git; may be missing in a fresh clone). PROJECT-PLAN.md §8 lists where the spec intentionally differs from them.

The older notes (`plan.txt`, `pages.txt`, `subscriptions.txt`, `api-*-example.json`) are superseded drafts.

## Angular rules (always loaded)
@docs/angular-best-practices.md

## Stack (pinned)
- Angular 22.2.3 (CLI/build 22.2.4), exact versions with no `^` · TypeScript · Angular Material 3 (material/cdk 22.2.4) · standalone + signals + zoneless
- The root `package.json` `overrides` pins patched versions of three dependencies with known advisories:
  - `vite` 8.3.5: `@angular/build` 22.2.4 ships a vulnerable vite 8.3.0.
  - `undici` 7.30.1: wrangler's and the vitest plugin's miniflare pin 7.29.1.
  - `zod` 4.6.6: the vitest plugin pins 4.6.5.
  Remove each one once the package that pulls it in ships a fixed version. CI runs `npm audit --audit-level=high`,
  so a new advisory with no fix gets an override like these.
- Node 24.22.1 / npm 12.0.2 via Volta 2.0.2 (`"volta"` field in root package.json). Workers Builds pins Node
  with its `NODE_VERSION` build variable (BLUEPRINT §7.6), so change both together.
- Cloudflare Worker (Hono) + D1 for the read-only catalog API; the same Worker serves the SPA as static assets
- npm workspaces: `apps/web`, `apps/api`, `apps/bot` (the nightly price check, M8.3), `packages/core`, plus `data/`
  (YAML catalog) and `scripts/`

## Decisions already made (don't re-litigate)
- Local-first: all user data lives in IndexedDB (Dexie). No accounts or server-side user data in v1.
- The catalog source of truth is `data/**/*.yaml` in Git. CI validates it, and each deploy writes what changed to D1. Price updates arrive as PRs, never auto-merged.
- Domain **sub.simplely.ca**, an origin of its own: app `https://sub.simplely.ca/`, API `https://sub.simplely.ca/api/v1/`.
  Browser storage is shared per origin, so no other app may live on it (BLUEPRINT §7.3, §11.5).
- Securing data on the device (BLUEPRINT §11.5):
  - a strict CSP with Trusted Types, and no `innerHTML` of user or catalog text;
  - repositories are the only way into Dexie, with only non-sensitive fields indexed;
  - imports and stored records are validated with Zod;
  - backups can be encrypted, and an optional passphrase lock encrypts data at rest (PBKDF2-SHA256 600k →
    AES-256-GCM).
  Never encrypt with a key the app stores itself. Sync (M10.7–M10.9) is the one kind that differs: its copy is sealed
  with keys derived from the sync code, which the device keeps (sealed by the app lock when it's on), so the copy is
  safe from the server, not from the device.
- Multi-region prices; the user's region is the default; non-native prices are FX-converted and marked with an icon.
  Regions are ISO 3166-1 codes (`GB`, not `UK`), the `EU` group or `GLOBAL`. Whether something is sold in a region
  is `availability` in core: offered, not offered or unknown (BLUEPRINT §4.7).
- Catalog prices are the regular (renewal) price, never a first-term offer, with the billing period the provider
  states ("every 30 days" is `interval: day, intervalCount: 30`).
- Resellers (BLUEPRINT §4.9): only shops a provider's own site names as official resellers, quoted from that page,
  never partners that use its service in their own product. They're listed once in `data/resellers.yaml`, with
  offers in the provider's file at regular prices only. They're shown when cheaper per month after the buyer's sales tax, or all of them with Settings' "Show every reseller" (off by default).
- Sales tax is added for buyers in Canada and the US (built-in Canadian rates by province, the user's own rate
  otherwise). Totals include it; price tags show the listed price with "+ tax" (BLUEPRINT §4.8).
- Catalog icons are static files: fetched once from each provider's site and committed, never fetched per view
  (cost, privacy, offline). Only custom subscriptions use `GET /icon` (BLUEPRINT §14).
- Storage, all on Cloudflare: static files for the catalog and icons, D1 for the API's searches, KV for small values
  that must survive (M2.5), R2 only when a trigger in BLUEPRINT §7.1 is reached. What users choose to send (M10's live
  calendar feeds, sealed sync copies, price reports) goes in a D1 database of its own, `simply-sub-user`, through
  `apps/api/src/writes.ts`' rules (BLUEPRINT §5.4): kept 180 days unused at most, secrets only as hashes, writes capped
  under half of D1's daily quota.
- Catalog growth is automated (discover → find URLs → AI extract → validate → PR). Humans only review PRs.
- Business logic (optimizer, schedules, rewards, exporters) lives in `packages/core` as pure, tested functions.
- Feature ids come from `data/features.yaml`. Never invent feature keys inline: new ones follow the feature-discovery
  skill (propose first, registry in its own commit, every provider's value sourced).
- Temporary previews (the progress-preview skill) live on their own branch with a Workers Builds link, never on main.
- Payment page (Phase 4): manual cards with network, credit/debit, flat cash-back %, FX fee %, optional monthly limit. Never store card numbers. Cards are filtered by the provider's `acceptedNetworks`.
- Automation is Cloudflare-first (Workers Builds, a Cron Worker bot, Workflows, Workers AI). The catalog stays in Git and the bot only opens PRs.
- Every list item counts toward totals, including duplicate plans (lists can be per family member).
- Catalog scope: personal and family plans. A free plan has one price with amount 0 and creates no charges.
  Business and per-seat plans are out of scope for v1.
- A provider's all-in-one plans (Proton Unlimited, Duo, Family) are suite plans: normal plans with their own
  features and `includes-subscription`, not bundles. Bundle files are only for deals whose features are exactly
  the sum of their plans (BLUEPRINT §4.4).
- All colours are CSS custom properties. Never hard-code hex values in components.
- Ranking uses rank keys (`video.quality=4k`, `streaming.concurrent-streams=2-4`), and group ranks never cascade (PROJECT-PLAN.md §3.2).
- Money and time terms ("this month", "this year", "next 12 months", monthly equivalent) are defined in PROJECT-PLAN.md §3.1. Compute them only in `packages/core`.
- List editing works on a draft saved in Dexie: Save commits atomically, Cancel discards.
- `packages/core` functions never read the clock. They take `today` as a parameter, and the app passes it in from a single `ClockService`, so tests can fix the date.
  Date maths uses core's UTC helpers in `dates/`; no date library.
- The app reads the catalog from static files built by `npm run data:build` (`data/catalog/index.json`, then its
  region's `data/catalog/<region>.json` or the full `data/catalog.json`, BLUEPRINT §6.3) and icons from static
  files. It keeps the files it downloaded in Dexie (`catalogCache`, one record per file, never merged) and checks
  `index.json`'s version on start (M4.3). The service worker (M10.5, production builds only) keeps the app's own
  files so it starts offline, never `/api/` or `/data/`; the app registers it through its `simply-sub#service-worker`
  Trusted Types policy, since Angular's registration passes a plain string the CSP refuses (BLUEPRINT §14). It only calls the Worker for `/fx` and custom-subscription icons (and, from M10, what the user
  opts in to send). The catalog's D1 serves only the public API, and a deploy writes only what changed (free plan:
  100k rows written a day for the account, BLUEPRINT §5.3). A change to the catalog
  tables or the derived columns bumps `seedFormat` in core, which makes the next deploy reseed in full.

## Git workflow
- `main` is protected (no bypass): never push to it. Work on a task branch (`feat/m5-3-search-filters`), push it,
  open a PR with `gh pr create`, and wait for the required check `ci` to pass. Squash-merge
  (`gh pr merge --squash`) only when the user asks.
- Every push to `main` deploys to sub.simplely.ca (Workers Builds); branch pushes get a preview link.

## Conventions
- `inject()`, signals, `@if`/`@for`, lazy feature routes, thin components.
- Import shared logic as `@simply-sub/core` (TypeScript source via the `tsconfig.base.json` path alias; no build
  step). Vitest configs that import it set `resolve.tsconfigPaths: true`. Get `today` from `ClockService`
  (`apps/web/src/app/core/clock/`).
- Components keep their template and styles in separate `.html` and `.scss` files (`templateUrl`, `styleUrl`),
  even small ones. This overrides "prefer inline templates" in angular-best-practices.md.
- The static files' CSP (`apps/api/public/_headers`) hashes `apps/web/src/index.html`'s inline theme script: change
  the script and put the new hash in `_headers` (`apps/api/test/static-headers.spec.ts` prints it). The API's own
  headers, rate limits and JSON errors live in `apps/api/src/middleware.ts`.
- Colour tokens: a colour that is a version of another (hover, text shade, alias) is derived from it in
  `_tokens.scss` (`var()`, `oklch(from …)`), so changing the base updates the family. Recheck contrast after.
- Form fields are `<mat-form-field appearance="outline">`, set on each one: filled fields fail contrast in dark mode,
  and a global default in `app.config.ts` would put Material's form field in the initial bundle (BLUEPRINT §8.1).
- Money = amount + ISO currency, formatted only in the UI. Dates are ISO strings.
- Catalog YAML is validated by the Zod schemas in `packages/core/src/catalog/` (BLUEPRINT §4.5). They're strict,
  and the types come from `z.infer`, so don't hand-write catalog interfaces. Import Zod as
  `import * as z from 'zod'` (ESLint enforces it): `import { z }` bundles all of Zod into the app. After changing a schema, run
  `npm run data:schema` and commit `data/schema/`, because CI fails if it's stale. After editing `data/`, run
  `npm run data:validate`: the schemas plus the cross-file checks of `validateCatalog` (BLUEPRINT §6.2). A new
  provider's logo comes from `npm run data:icons` into `data/logos/<id>.png` (committed), and `data:build`
  publishes it as a 96 px WebP at `/icons/<id>.webp`; builds never fetch icons. The app's own icon
  (`apps/web/public/app-icons/`, `favicon.ico`) comes from `npm run app:icons`, drawn in `_tokens.scss`'s accent:
  rerun it when the accent changes.
- User records (lists, items, settings…) are strict Zod schemas in `packages/core/src/user/`, with `z.infer` types
  too (BLUEPRINT §4.6). The repositories in `apps/web/src/app/core/storage/` are the only code that imports `dexie`
  (ESLint enforces it). They load Dexie lazily, outside the initial bundle, and check every record on the way in and
  out (§11.1). A change to a stored record's shape needs a new Dexie version with an upgrade function. Specs that
  use storage take `testStorage()` from `storage.testing.ts`: a fresh fake IndexedDB and a clock the test sets.
- Vitest for unit tests, Playwright for end-to-end tests.
- Open questions are listed in BLUEPRINT.md section 14. Ask the user rather than guessing.
