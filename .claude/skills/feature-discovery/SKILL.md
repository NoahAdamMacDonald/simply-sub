---
name: feature-discovery
description: Discover the features a category of subscriptions is compared on (VPN, streaming, password managers, storage…) from the providers' official pages, model them as feature-registry entries (data/features.yaml), and fill them in for every provider. Use when a category's features are thin, when a provider page shows a capability the registry lacks (price research stops and asks), or when the user wants features expanded.
---

# Feature discovery (registry entries from official pages)

Features are what users rank and what the optimizer compares (BLUEPRINT §4.2). Their ids become **rank keys stored in
users' data**, so a feature is cheap to add and expensive to rename or remove. Discover deliberately, propose, then
add. The VPN group (`vpn.*`, PR #25) is the worked example of everything below.

## 1. Survey the category

- List the category's providers in `data/providers/` and the features they already use
  (`grep -n "<group>\." data/providers/*.yaml`), and read the group in `data/features.yaml`.
- Read the official feature and comparison pages of the providers in the catalog, plus one or two leaders of the
  category that aren't yet. Tools and rules as in the **price-research** skill: official pages only (help centre,
  pricing table, free-vs-paid page, blog announcements by the provider), WebFetch for static pages, its Edge driver
  for JavaScript pages and tabs, WebSearch only to find pages.
- Note every capability buyers compare, and which plan has it (free vs paid tiers often differ: Proton VPN Free has
  no split tunneling, P2P or port forwarding).

## 2. Keep what earns a place

A feature belongs in the registry when it is (BLUEPRINT §4.2 rule 3):
- **comparable:** it exists at two or more providers, or matters for ranking;
- **verifiable** on official pages for every provider in the category (see the "unlisted means no" trap below);
- **stable:** a capability, not a promotion or a number that changes weekly (use tiers for counts);
- **objective:** "unblocks streaming" is marketing; leave it out;
- **in scope:** personal and family plans, not business features (dedicated IPs, admin consoles).

Anything provider-specific goes in a plan's `perks` instead.

## 3. Model each feature

| Capability | Type | Example |
|---|---|---|
| Has it or not | `boolean` | `vpn.kill-switch` |
| An ordered quality ladder | `enum` (values in order, lowest first) | `video.quality`: 480p … 4k |
| A count with thresholds that matter | `number` with `unit` and `tiers` (`min`, optional `max`; tier ids like `1-10`, `51+`) | `vpn.server-countries` |
| Several independent options | `set` with `values` (each is its own rank key) | `vpn.protocols`, `vpn.content-blocking` |

- **Ids:** `<group>.<kebab-name>`, under the group's boolean as `parent` (`vpn.included`), listed after it.
  `category` comes from `categories.yaml`'s feature categories (add one only if none fits).
- **Names** are short and user-facing ("Kill switch", "Tor over VPN"); value names likewise ("Obfuscated
  connections"). Every value is an object with `id` and `name` (rule 6).
- **Aliases** cover provider wording and search terms ("Secure Core" and "double vpn" for multi-hop, "NetShield" for
  DNS blocking). Text search matches rank keys by name and alias, so an alias with a common word ("vpn") makes a
  search for that word match the feature: tests that pin `matchedOn` can change.
- **Split claims from proof:** a stated policy and an audit of it are different facts (`vpn.no-logs-policy` vs
  `vpn.independent-audits: [no-logs]`). Recording only the audit made Mullvad look like it had no no-logs policy.
- `headline: true` only for the few keys worth a place in the feature summary (BLUEPRINT §3.2).

## 4. The "unlisted means no" trap

A plan that doesn't list a boolean has it as **false**, and an unlisted set is **empty**. So leaving a value out is
a claim. For every provider in the category, either source the value or say what you inferred and from what (in the
YAML comment and the PR). Mullvad's P2P was inferred from its terms, because leaving it out would have said "no P2P".
If a provider's value can't be found or inferred, raise it with the user before adding the feature.

## 5. Propose before editing

Show the user a table of the proposed features (id, type, what it records) and what you'd leave out and why, then
ask (AskUserQuestion: full list, a core set, or later). Renaming after merge means a migration of stored ranks.

## 6. Add them

1. **Registry first, in its own commit** (`features.yaml` asks for it): run `npx prettier --write data/features.yaml`
   and `npm run data:validate`.
2. **Data:** fill in every plan of every provider in the category. Above each provider's `plans:`, a comment lists the
   date read and the page for each fact (`sources` only holds the pricing page). Flag inferences and conflicts
   between official pages there ("/pricing says 10, /free-vs-paid still says 5").
3. **Checks:** `npm run data:validate`, `npm test` (search tests can move), `npm run lint`, `npm run format:check`,
   `npm run build` (the catalog version changes).
4. **PR:** a table of every value per provider or tier, a "verify these" list (inferences, conflicts, removed
   capabilities), the sources, and the rollout: new features are upserted and changed providers rewritten in D1 on
   the next deploy (about a thousand rows for Proton-sized providers, of 100,000 a day).

## When price research finds a new capability

The price-research skill says to stop and ask when a page shows something the registry lacks. Use this skill for
that one capability: check it against the other providers of the category (step 2), model it (step 3), propose it,
and add it in its own commit before the provider file that uses it.
