# Simply Sub — AI context

**Read [BLUEPRINT.md](BLUEPRINT.md) before planning or writing code.** It is the source of truth for architecture and decisions.
- **[PROJECT-PLAN.md](PROJECT-PLAN.md)** has the build order (task IDs M0.1 …) and a spec with acceptance criteria for every page. Work one task ID at a time.
- **[docs/api-output-examples.json](docs/api-output-examples.json)** is the API contract. Don't change response shapes without updating it.
- **[docs/wireframes/](docs/wireframes/)** has the Figma screenshots (local only, not in git; may be missing in a fresh clone). PROJECT-PLAN.md §8 lists where the spec intentionally differs from them.

The older notes (`plan.txt`, `pages.txt`, `subscriptions.txt`, `api-*-example.json`) are superseded drafts.

## Angular rules (always loaded)
@docs/angular-best-practices.md

## Stack (pinned)
- Angular 22.2.3 (CLI/build 22.2.4), exact versions with no `^` · TypeScript · Angular Material 3 (material/cdk 22.2.4) · standalone + signals + zoneless
- The root `package.json` `overrides` pins `vite` to 8.3.5 because `@angular/build` 22.2.4 ships a vulnerable vite 8.3.0. Remove the override once a newer `@angular/build` is out.
- Node 24.19.0 / npm 12.0.2 via Volta 2.0.2 (`"volta"` field in root package.json)
- Cloudflare Worker (Hono) + D1 for the read-only catalog API; the same Worker serves the SPA as static assets
- npm workspaces: `apps/web`, `apps/api`, `packages/core`, plus `data/` (YAML catalog) and `scripts/`

## Decisions already made (don't re-litigate)
- Local-first: all user data lives in IndexedDB (Dexie). No accounts or server-side user data in v1.
- The catalog source of truth is `data/**/*.yaml` in Git. CI validates it and reseeds D1. Price updates arrive as PRs, never auto-merged.
- Domain **simplely.ca**: app `https://simplely.ca/simply/sub/`, API `https://simplely.ca/api/sub/v1/`.
- Multi-region prices; the user's region is the default; non-native prices are FX-converted and marked with an icon.
- Catalog growth is automated (discover → find URLs → AI extract → validate → PR). Humans only review PRs.
- Business logic (optimizer, schedules, rewards, exporters) lives in `packages/core` as pure, tested functions.
- Feature ids come from `data/features.yaml`. Never invent feature keys inline.
- Payment page (Phase 4): manual cards with network, credit/debit, flat cash-back %, FX fee %, optional monthly limit. Never store card numbers. Cards are filtered by the provider's `acceptedNetworks`.
- Automation is Cloudflare-first (Workers Builds, a Cron Worker bot, Workflows, Workers AI). The catalog stays in Git and the bot only opens PRs.
- Every list item counts toward totals, including duplicate plans (lists can be per family member).
- All colours are CSS custom properties. Never hard-code hex values in components.
- Ranking uses rank keys (`video.quality=4k`, `streaming.concurrent-streams=2-4`), and group ranks never cascade (PROJECT-PLAN.md §3.2).
- Money and time terms ("this month", "this year", "next 12 months", monthly equivalent) are defined in PROJECT-PLAN.md §3.1. Compute them only in `packages/core`.
- List editing works on a draft saved in Dexie: Save commits atomically, Cancel discards.
- `packages/core` functions never read the clock. They take `today` as a parameter, and the app passes it in from a single `ClockService`, so tests can fix the date.
- The app reads the catalog from the static `data/catalog.json` and icons from static files. It only calls the Worker for `/fx` and custom-subscription icons.

## Conventions
- `inject()`, signals, `@if`/`@for`, lazy feature routes, thin components.
- Components keep their template and styles in separate `.html` and `.scss` files (`templateUrl`, `styleUrl`),
  even small ones. This overrides "prefer inline templates" in angular-best-practices.md.
- Colour tokens: a colour that is a version of another (hover, text shade, alias) is derived from it in
  `_tokens.scss` (`var()`, `oklch(from …)`), so changing the base updates the family. Recheck contrast after.
- Money = amount + ISO currency, formatted only in the UI. Dates are ISO strings.
- Vitest for unit tests, Playwright for end-to-end tests.
- Open questions are listed in BLUEPRINT.md section 14. Ask the user rather than guessing.
