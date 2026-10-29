---
name: catalog-review
description: Work through the weekly Catalog digest pull request's review list (review/README.md on the bot/catalog-digest branch) from the page text committed there: prices first, then policies, then features, committing and pushing after each item so a usage limit loses nothing. Use when the weekly scheduled task runs (reviewer scheduled-claude in data/automation.yaml), or when the user asks to review the digest.
---

# Catalog review (the weekly digest, from committed text)

The nightly bot (`apps/bot`, BLUEPRINT §6.4) compares each cited page with its baseline and, once a week, opens one
pull request, **Catalog digest <date>**, on the branch `bot/catalog-digest`. The clear changes are already edits on
that branch. What it couldn't settle is listed in `review/README.md` on the same branch, with each changed page's new
text committed as its baseline (`data/baselines/<host>/<slug>-<hash>.txt`). This skill works through that list. It's
what the `scheduled-claude` reviewer runs each week (setup below), and it works the same from a local session.

## Rules

- **Committed text only.** An item's page is its baseline on the branch: the page's text as the bot read it this
  week. `git diff origin/main -- <baseline>` shows what changed. Never fetch a provider's site: the scheduled task's
  network reaches GitHub and package registries only, and a fetch from elsewhere can read another country's page. An
  item the committed text can't settle is left for the owner, with the reason.
- **The page's words, word for word.** A change needs words on the page that show it, quoted exactly as the baseline
  has them. Regular (renewal) prices only, never a sale, introductory or first-term price; the billing period as the
  page states it (price-research skill). Policies follow the policy-research skill's rules; features use existing ids
  in `data/features.yaml` only (a new one is proposed through the feature-discovery skill, never added here).
- **In order:** Prices, then Policies, then Features, then Unreadable: the list's own order. A note by Workers AI
  under an item ("Workers AI read …") is a lead to check, never a reason to skip the check.
- **Save progress after every item:** make the edit, tick the item, run `npm run data:validate`, commit and push. A run
  cut short (a usage limit, a timeout) loses at most the item it was on, and the next run starts at the first
  unticked item.
- **Only the digest's branch.** Push to `bot/catalog-digest` only. Never merge, never push to `main`, never force-push,
  never open another pull request. The owner merges. While the pull request has your commits, the bot holds the next
  digest rather than overwrite them (it says so on the pull request).
- **Ask nothing.** The scheduled run is unattended: what needs the owner stays unticked, with a line saying why.

## Steps

1. **Check out the branch:** `git fetch origin bot/catalog-digest` and `git switch bot/catalog-digest` (tracking the
   remote). No branch, "Nothing to review this week." in `review/README.md`, or every item ticked: stop, changing
   nothing.
2. **Install:** `npm ci`, for `data:validate` (Node and npm from the root `package.json`'s `volta` field, or what the
   environment has).
3. **For each unticked item, in order:**
   - **Read** the item, its baseline (the path is in the item) and that baseline's diff against `origin/main`, and the
     provider file it's about (`data/providers/<id>.yaml`; a bundle's in `data/bundles/`).
   - **Prices.** Find the plan's regular price for the item's region, currency and billing period in the page's text.
     If it's there, set `amount` and `lastVerified` (today) and keep `sourceUrl`. An edit the bot already made (a
     change over ±30%, a price Workers AI read) is confirmed or corrected the same way. A `taxIncluded` whose words are
     gone, a reseller no longer named, a card network gone: check the new text and keep or correct the bot's edit.
     Only a sale price, another currency or no price on the page: leave it for the owner.
   - **Policies.** For each rating the item names, read the rubric in `data/policy-topics.yaml` and the page's new
     text: replace each lost quote with the page's words that now say it (up to three, word for word), grade again
     if another tier's description fits better, and rewrite the reason in plain words (240 characters at most). A
     topic the new text no longer settles: leave it for the owner.
   - **Features.** Update a value with the page's words for it; a capability with no id in `data/features.yaml`
     stays for the owner (feature-discovery skill).
   - **Unreadable.** There's no text to read: note it for the owner.
   - **Tick it** in `review/README.md`: `- [x]`, and under it a line `  - Done: …` (what changed, with the quote) or
     `  - For the owner: …` (why not), leaving the item unticked in that case.
   - **Save:** `npm run data:validate` (fix or undo an edit that fails), then commit only that item's files (`git add`
     each one by name) with the message `Review: <the item's subject>` and its quote, and `git push origin
     bot/catalog-digest`.
4. **When the list is done**, if the `gh` CLI is available, comment a short summary on the pull request (`gh pr comment
   --body …`: what was changed, what's left for the owner). The ticked list is the record either way.

## Setting up the weekly scheduled task (once, by the owner)

- `data/automation.yaml` has `reviewer: scheduled-claude` (the default).
- At [claude.ai/code/routines](https://claude.ai/code/routines) (or `/schedule` in Claude Code), a new scheduled task:
  - **Repository:** `NoahAdamMacDonald/simply-sub`.
  - **Environment:** **Default**, whose network access is **Trusted** (GitHub and package registries): all it needs.
  - **Trigger:** weekly, on Mondays, at 9:07 in your time zone: the digest is built on Monday's 03:00 UTC run
    (`digest.day`), so it's ready by then. A few minutes past the hour starts on time.
  - **Instructions:** `Run the catalog-review skill (.claude/skills/catalog-review/SKILL.md) on the open Catalog digest
    pull request. Work on the branch bot/catalog-digest and push your commits to that branch only; never merge, never
    push to main, and never open a pull request.`
- Its commits appear as you. Each run counts against your Claude plan's usage; one stopped by a limit picks up where
  it left off the next week. Changing `digest.day` means moving the task's day too.
