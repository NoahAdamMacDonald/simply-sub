# Simply Sub

Track, budget and optimize your subscriptions. Simply Sub is a local-first Angular app: your lists, rankings
and settings stay in your browser (IndexedDB). A small read-only catalog API on Cloudflare supplies plan prices
and features.

It will run at **https://simplely.ca/simply/sub/**.

## Docs

| File | What it covers |
|---|---|
| [BLUEPRINT.md](BLUEPRINT.md) | Architecture, data model, hosting and decisions (the source of truth) |
| [PROJECT-PLAN.md](PROJECT-PLAN.md) | Build order (task IDs M0.1 …), page specs and acceptance criteria |
| [docs/api-output-examples.json](docs/api-output-examples.json) | An example request and response for every API endpoint (the API contract) |
| [CLAUDE.md](CLAUDE.md) | Short context for AI coding assistants |

The Figma wireframes and early drafts (`docs/wireframes/`, `docs/drafts/`) are kept locally and aren't in this repo.

## Requirements

[Volta](https://volta.sh) 2.0.2. The root `package.json` pins Node 24.19.0 and npm 12.0.2, and Volta switches
to them automatically inside the repo.

## Repository layout

An npm-workspaces monorepo (see [BLUEPRINT.md §3](BLUEPRINT.md#3-repository-structure)):

| Path | What |
|---|---|
| `apps/web` | The Angular 22 app |
| `apps/api` | The Cloudflare Worker (Hono): serves the app's static files and the API at `/api/sub/v1` |
| `packages/core` | Business logic as pure TypeScript functions, shared by the app, the Worker and the scripts |
| `tsconfig.base.json` | TypeScript settings shared by every workspace, and the `@simply-sub/core` path alias |

Apps import `packages/core` as TypeScript source through the `@simply-sub/core` alias, so it has no build step.
The catalog (`data/`) and the scripts are added by later tasks in the project plan.

## Commands

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs every workspace |
| `npm run dev:web` | Starts the dev server at http://localhost:4200/, with `/api` proxied to `dev:api` |
| `npm run dev:api` | Runs the Worker locally (`wrangler dev`): the API at http://localhost:8787/api/sub/v1/health, and the last production build of the app at http://localhost:8787/simply/sub/ |
| `npm run build` | Type-checks `packages/core`, builds the app for production, copies it into `apps/api/public/simply/sub/`, then type-checks and bundles the Worker (`wrangler deploy --dry-run`: nothing is deployed) |
| `npm test` | Unit tests (Vitest) in every workspace, `packages/core` first; the Worker's run inside workerd |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Formats with / checks against Prettier |
