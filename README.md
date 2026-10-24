# Simply Sub

Track, budget and optimize your subscriptions. Simply Sub is a local-first Angular app: your lists, rankings
and settings stay in your browser (IndexedDB). A small read-only catalog API on Cloudflare supplies plan prices
and features.

It runs at **https://sub.simplely.ca/** (the app is still being built; see the project plan).

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

To edit the catalog YAML in VS Code, install the recommended
[Red Hat YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
(`redhat.vscode-yaml`). With it, `data/**/*.yaml` gets autocomplete, hover docs and validation as you type.

## Repository layout

An npm-workspaces monorepo (see [BLUEPRINT.md §3](BLUEPRINT.md#3-repository-structure)):

| Path | What |
|---|---|
| `apps/web` | The Angular 22 app |
| `apps/api` | The Cloudflare Worker (Hono): serves the app's static files and the API at `/api/v1` |
| `packages/core` | Business logic as pure TypeScript functions, shared by the app, the Worker and the scripts, including the catalog's Zod schemas |
| `data/` | The catalog source: `features.yaml`, `categories.yaml`, `providers/` and `bundles/` in YAML, provider logos in `logos/`, and in `schema/` the JSON Schema generated from the Zod schemas, for editor autocomplete |
| `scripts/` | Repo scripts, run with tsx: catalog validation, the catalog build, icon fetching and the JSON Schema generator |
| `tsconfig.base.json` | TypeScript settings shared by every workspace, and the `@simply-sub/core` path alias |

Apps import `packages/core` as TypeScript source through the `@simply-sub/core` alias, so it has no build step.
[BLUEPRINT.md §13.4](BLUEPRINT.md#134-how-to-add-a-provider-checklist) has the checklist for adding a provider.

## Commands

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm install` | Installs every workspace |
| `npm run dev:web` | Starts the dev server at http://localhost:4200/, with `/api` proxied to `dev:api` |
| `npm run dev:api` | Runs the Worker locally (`wrangler dev`): the API at http://localhost:8787/api/v1/health, and the last production build of the app at http://localhost:8787/ |
| `npm run build` | Type-checks `packages/core` and `scripts/`, builds the catalog (`data:build`), builds the app for production, copies it into `apps/api/public/`, then type-checks and bundles the Worker (`wrangler deploy --dry-run`: nothing is deployed) |
| `npm test` | Unit tests (Vitest) in every workspace, `packages/core` first; the Worker's run inside workerd |
| `npm -w apps/api run db:migrate:local` / `db:migrate:remote` | Applies new D1 migrations (`apps/api/migrations/`) to the local or the Cloudflare database |
| `npm run lint` | ESLint and Stylelint |
| `npm run format` / `npm run format:check` | Formats with / checks against Prettier |
| `npm run data:schema` | Regenerates `data/schema/*.schema.json` from the catalog's Zod schemas. Run it after changing a schema and commit the result. `npm run data:schema -- --check` only checks that they're up to date (CI) |
| `npm run data:validate` | Checks every catalog file: the schemas, then the cross-file rules (feature ids, references, regions, prices, logos), as `file:line` messages |
| `npm run data:build` | Builds the catalog snapshot (`apps/web/public/data/catalog.json`), copies the logos to `apps/web/public/icons/`, and writes the D1 seed (`apps/api/dist/seed.sql`). `npm run build` runs it first |
| `npm run data:icons` | Fetches the best icon of every provider without a logo into `data/logos/<id>.png`. `-- netflix` fetches one again; `-- hulu=https://hulu.com` works for any site |

## Contributing

`main` is protected: every change goes through a pull request, and the `ci` check (a dependency audit, lint,
Prettier, the `data/schema` check, the catalog checks, tests and the build, from
[.github/workflows/ci.yml](.github/workflows/ci.yml)) must pass before it can be squash-merged.

Your data never leaves your browser. [BLUEPRINT.md §11.5](BLUEPRINT.md#115-security-of-data-on-the-device)
describes how it's protected there, including the optional encrypted backups and passphrase lock.
Merges to `main` deploy to sub.simplely.ca through Cloudflare Workers Builds. See
[PROJECT-PLAN.md §1.2](PROJECT-PLAN.md#12-day-to-day-workflow) for the branch and commit conventions.
