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
| `tsconfig.base.json` | TypeScript settings shared by every workspace |

The Cloudflare Worker (`apps/api`), shared logic (`packages/core`), the catalog (`data/`) and the scripts are
added by later tasks in the project plan.

## Commands

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs every workspace |
| `npm run dev:web` | Starts the dev server at http://localhost:4200/ |
| `npm run build` | Production build to `apps/web/dist/web/browser` |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run format` / `npm run format:check` | Formats with / checks against Prettier |
