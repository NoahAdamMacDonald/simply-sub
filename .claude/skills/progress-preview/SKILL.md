---
name: progress-preview
description: Show the user the project's current progress in the running app, with a live link: the temporary progress preview on Home (the catalog priced in the browser, the live API: health, search, bundles, icons) on its own branch that never merges into main. Use when the user asks to see progress, to add or refresh the preview, to merge feature work into it, for its link, or to remove it.
---

# Progress preview (a branch, never main)

The preview is a temporary section on Home that shows what's built so far: the catalog file the app downloads for a
region, priced by core's `pickPrice` with the live `/fx` rates (≈ for converted prices, availability per plan, feature
names from the registry), the API's health, `GET /bundles` with savings, `GET /providers` search, and `GET /icon` with
the letter fallback.

It lives only on the branch **`chore/progress-preview`**, which is never merged into `main` (its PR #24 was closed on
purpose). Workers Builds deploys every push to a branch as a preview, so the branch is the live link:

**https://chore-progress-preview-simply-sub.nmacdonald2113.workers.dev**

The pattern is `https://<branch with / as ->-simply-sub.nmacdonald2113.workers.dev`. Cloudflare's bot also posts it on
the branch's PR, if there is one: `gh pr view <n> --json comments --jq '.comments[].body' | grep -o 'https://[^ )'"'"']*workers.dev'`.
Preview builds share production's D1 and KV (reads only; they never seed D1).

The code: `apps/web/src/app/features/home/progress-preview/` (component, view logic and its spec) and two lines in
`home-page.ts` and `home-page.html`, all marked TEMPORARY. Anything permanent the preview turns up (like the Zod
`jitless` fix, #26) goes to `main` in its own PR, never through this branch.

## Show the latest progress (refresh the preview)

1. `git fetch --prune`, then `git checkout chore/progress-preview` and `git merge --no-edit origin/main`. Fix any
   conflict in the preview's files; outside them, `main` wins.
2. To show work that isn't on `main` yet, merge its branch too: `git merge --no-edit <feature-branch>`. Say so in the
   reply, since the preview then shows unmerged work.
3. If the app changed under the preview (renamed schemas, new routes, new core functions), update the preview's files
   so it shows the new work: it should cover every milestone built so far. Keep it on its own branch and in its own
   folder.
4. Run what CI runs: `npm run lint`, `npm run format:check`, `npm test` and `npm run build`.
5. `git push`. Wait for the deploy: `gh run list` doesn't cover Workers Builds, so poll the link until it serves the new
   `main-*.js` (`curl -s <link>/ | grep -o 'main-[A-Z0-9]*\.js'` against `apps/api/public/index.html`).
6. Check it in Edge (below), then give the user the link and what's new on it.

## Add the preview (if the branch is gone)

Recreate the branch from the last version of the preview, then refresh it as above:

```bash
git fetch origin
git checkout -b chore/progress-preview origin/main
git checkout <last preview commit> -- apps/web/src/app/features/home/progress-preview \
  apps/web/src/app/features/home/home-page.ts apps/web/src/app/features/home/home-page.html
```

Find the last preview commit with `git log --all --oneline -- apps/web/src/app/features/home/progress-preview`
(the closed PR #24's branch keeps it while it exists). Push the branch; don't open a PR to `main`. A draft PR is fine
for the bot's link comment, marked "do not merge".

## Remove the preview

Nothing on `main` holds it, so removing it means deleting the branch: `git push origin --delete chore/progress-preview`
and `git branch -D chore/progress-preview`. The workers.dev link stops getting updates (Cloudflare keeps the last
version). If the preview ever reached `main` by mistake, delete its folder and its two TEMPORARY lines in a PR.

## Check it in Edge

Run the production build under `wrangler dev`, so `public/_headers` (the CSP) applies, on a port other than 8787 and
4200: `npm run build`, then `cd apps/api && npx wrangler dev --port 8791 --ip 127.0.0.1` in the background (seed the
local D1 first if the catalog changed: `npm -w apps/api run db:seed:local`). Install the browser deps as the
browser-check skill says, then:

```bash
node .claude/skills/progress-preview/check-preview.cjs "$DEPS" "<scratchpad>/shots" http://127.0.0.1:8791
node .claude/skills/progress-preview/csp-check.cjs "$DEPS" "<scratchpad>/shots" http://127.0.0.1:8791
```

`check-preview.cjs`: full-page screenshots in both themes at 1280 px and at 360 px, axe, no horizontal scroll, no
console errors, and the icon lookup (proton.me's icon, gooooogle.com's letter). `csp-check.cjs`: every page,
in-app navigation, the theme toggle, the drawer and the snackbar with no CSP or Trusted Types violations, and
Cloudflare's beacon (inserted as the edge does, its reports aborted) loading. Against the live link or production,
`csp-check.cjs` uses the beacon already in the page. **Look at the screenshots.** Stop `wrangler dev` afterwards
(kill its node parent: the user's memory notes say how).

## Gotchas

- Reading `.value()` of an Angular `resource()` in an error state throws: check `hasValue()` (or `error()`) first.
  Tests that render Home have no server, so every resource errors there.
- Paths in the preview are root-relative (`/data/...`, `/api/v1/...`) so they work from any route and on `ng serve`
  (whose proxy sends `/api` to `wrangler dev` on 8787).
- The preview's own spec (`progress-preview-view.spec.ts`) runs with the web tests on the branch only.
