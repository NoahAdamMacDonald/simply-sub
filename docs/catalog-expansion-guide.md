# Catalog expansion guide (draft, 2026-10-30)

The rules for growing the catalog from the owner's research list (finance, social, streaming, AI, music, software,
DNS, jobs, VPN, antivirus, browsers, search, email, storage, gaming, password managers, news, telecom, shopping,
developer tools, file sharing, calendars, maps, creative tools and more). Read this with BLUEPRINT.md §4.2 (features),
§4.10 (terms and policies) and §6.5 (the pipeline), and the skills it changes: policy-research, feature-discovery,
price-research.

Nothing here is built yet. PROJECT-PLAN's M11 builds it, a task at a time: M11.1–M11.9 are this guide's Phase 0,
M11.10–M11.14 finance (BLUEPRINT §4.11, §10.6), M11.15 the research. The owner's decisions so far are in BLUEPRINT §14
("Resolved (2026-10-30, catalog expansion)") and §9 below.

---

## 1. Terms and policies: what every provider is rated on

### 1.1 Why grades feel random today

The rubric in `data/policy-topics.yaml` is sound; the trouble is what it leaves undefined. Three examples from the
catalog:

| Rating | Grade | What decided it | The gap |
|---|---|---|---|
| Claude, data collection | poor | Chats train its AI unless you turn it off, "and even then it uses chats flagged for a safety review" | The safety exception made the opt-out "partial". Nothing says whether an exception for safety or the law counts against an opt-out |
| Proton, data collection | neutral | VPN apps send usage statistics until you switch them off | Same kind of fact as Claude (a default with a self-serve opt-out), a different grade |
| Netflix, data collection | poor | You can stop it *using* the data for ads, not stop it *collecting* | Correct under the rubric, but only if "opting out of a use isn't opting out of collection" is written down |

Also: AI training sits under data collection for Claude, while ads for its own products sit under data sharing.
With no rule for which topic a fact belongs to, the same fact can lower two grades, or land in different topics for
different providers.

### 1.2 The scale every topic follows

Each topic's five rungs are this scale, worded for that topic. When a topic's rubric doesn't settle something, go
back to this scale:

| Grade | Means |
|---|---|
| **Great** | Protects you by design. You have nothing to do, and the fine print has no catch. |
| **Good** | Protects you by default, with minor stated limits, or does more only if you opt in. |
| **Neutral** | Typical for the industry. Works against you by default, but a full, self-serve setting or right fixes it. |
| **Poor** | Works against you by default, and the fix is partial, hard (a letter, an email, a ticket), only in some places, or only for some data. |
| **Bad** | Works against you, with no way out. |

### 1.3 How to grade (in this order, every time)

1. **Find the clause(s)** for the topic and quote them (as today: word for word, up to three).
2. **Default:** what happens if you do nothing? Protective → Great or Good. Not protective → Neutral or worse.
3. **Control:** if the default isn't protective, how do you change it?
   - **Self-serve:** a setting in the account or app, a one-click link, or a browser signal it says it honours
     (Global Privacy Control). Neutral.
   - **Partial:** the setting covers some data, some apps or devices, or one *use* of the data while collection goes
     on (Netflix). Poor.
   - **On request:** an email, a form, a letter or a support ticket. Poor for opt-outs. Deletion and export have their
     own rubrics, where "on request within a stated time" can be Good or Neutral.
   - **None:** Bad.
4. **Necessary exceptions don't count against a grade:** keeping or using data to meet a law, to prevent fraud or
   abuse, for a safety review, for security, or to process a payment. Exceptions for business purposes do count:
   analytics, "improving our services", marketing, training, personalisation. *Under this rule Claude's AI training
   is Neutral (self-serve opt-out; the safety-review exception is necessary).*
5. **Worst clause wins** within a rating's scope. When a country's terms are better (Quebec's consumer law, the EU),
   that's a rating with `regions`, never a reason to lift the provider-wide one. The same goes for plans
   (`plans: [netflix.standard-ads]`).
6. **Broad wording is read broadly.** "May", "such as", "including but not limited to", "partners": the provider has
   reserved that right, so grade as if it uses it.
7. **One fact, one topic.** Use the routing table (§1.5). A fact that seems to fit two topics goes to the more
   specific one.
8. **Silence:** see the "If the policy says nothing" column (§1.4). A topic the provider's pages don't address is
   either graded by that rule or recorded as *not stated*, never left out without a word.
9. **An `action` is required** when a grade depends on the user changing something (Neutral or Poor through an
   opt-out): the provider's own page for it, as M5.12 does today.
10. **Calibrate:** before grading a provider, read the same topics for two providers already graded in its category.
    After each batch, print a table of topic × provider × grade × the deciding fact in five words, and look for the
    same fact with different grades. Fix those before the pull request.

### 1.4 The topics

**Every provider** gets a rating or an explicit *not applicable* / *not stated* for each topic marked "all" (that's how
cards stay comparable: each one has a Refunds line). Topics with categories apply only to providers with a plan in one
of them, as today.

`id` · status · applies to · if the policy says nothing

#### Privacy

| Topic | Status | Applies to | If silent |
|---|---|---|---|
| `privacy.data-collection`: what it collects beyond what the service needs | changed: AI training moves out; "needed to work" defined (account, payment, delivering the service, security, legal duties) | all | not stated |
| `privacy.data-sharing`: selling or sharing it with other companies for their own use | kept; "selling" includes US-law "sharing" for cross-context ads | all | not stated |
| `privacy.ads-tracking`: tracking you for ads, in its apps or across sites | kept | all | not stated |
| `privacy.ai-training`: whether what you write, upload or say trains AI models | **new** | all | not stated (an AI provider that's silent: Poor, since training is the default in that industry) |
| `privacy.content-access`: who can read what you store or send | **new** | storage, email, calendar, password managers, AI, social, notes, file sharing | not stated |
| `privacy.data-retention`: how long it keeps your data, while you use it and after you leave | **new** (split from deletion) | all | Poor ("as long as necessary" only) |
| `privacy.data-deletion`: deleting your data | changed: the "how long afterwards" part moves to retention | all | not stated |
| `privacy.data-portability`: getting your data out in a usable form | **new** | all | not stated |
| `privacy.government-requests`: what it does when police or governments ask | **new** | all | Neutral ("required by law" is the floor everywhere) |
| `privacy.data-location`: where your data is stored and processed | **new** | all | Poor |
| `privacy.sign-up-data`: what you must give to sign up | **new** | all | read it from the sign-up form, not the policy |
| `privacy.children`: minimum age and children's data | **new** | streaming, music, gaming, social, education | not stated |

Rubrics for the new privacy topics:

- **ai-training.** Great: never trains on your content. Good: only if you opt in, or only on what you send as
  feedback. Neutral: trains by default, with a self-serve opt-out that applies from then on. Poor: the opt-out is
  partial (some content, some regions, by request, or past data stays in trained models with no stated end).
  Bad: no opt-out, or it licenses your content to others to train on. *"Your content" is what you write, upload or
  say: prompts, messages, files, photos, voice. What you watch, used for recommendations, is data collection.*
- **content-access.** Great: end-to-end or zero-access encryption by default for the main content. Good: E2EE you can
  turn on for the main content. Neutral: encrypted in transit and at rest; staff read it only for support with your
  permission, or for legal or safety reasons. Poor: people or automated systems read it for other purposes (human
  review to improve the product), with an opt-out. Bad: read or scanned for other purposes, with no opt-out.
- **data-retention.** Great: stated short periods, and deleted within 30 days of closing the account. Good: stated
  periods for the main kinds of data; deleted within 90 days of closing. Neutral: "as long as necessary", with some
  stated periods. Poor: no stated periods. Bad: keeps it indefinitely, or keeps what you deleted for its own use.
  Records a law requires (tax, banking: often seven years) don't count against it.
- **data-portability.** Great: self-serve export of everything in open, documented formats (CSV, JSON, ICS, VCF,
  mbox, KDBX, otpauth) and import from rivals. Good: self-serve export of the main content in a usable format.
  Neutral: export on request, within the legal time limit. Poor: a partial export, or only in its own format.
  Bad: no way to get it.
- **government-requests.** Great: requires valid legal process, tells you unless a law forbids it, publishes a
  transparency report, and holds little to hand over. Good: two of those three. Neutral: discloses "when required by
  law", nothing more. Poor: may disclose without legal process when it thinks it right (beyond emergencies). Bad:
  shares with authorities voluntarily or routinely, or sells to them.
- **data-location.** Great: in a stated country with strong privacy law (Canada, EU/EEA, UK, Switzerland), staying
  there, or your choice of region. Good: a stated region; transfers only under recognised safeguards (adequacy, EU
  standard contractual clauses). Neutral: the US or several countries, with stated safeguards. Poor: anywhere, with
  safeguards it doesn't describe. Bad: anywhere, to parties it doesn't name, with no safeguards.
- **sign-up-data.** Great: no personal information (an account number; Mullvad). Good: an email address only, an alias
  accepted. Neutral: email plus a name and payment details for paid plans; phone optional. Poor: a phone number, or
  a real name or ID no law requires. Bad: government ID or a face scan no law requires. *Identity checks a law
  requires (Canadian banks' know-your-client rules) are Neutral.*
- **children.** Great: kids' profiles collect the minimum, with no ads or tracking for minors and parental controls.
  Good: no targeted ads to minors, and parental consent. Neutral: a stated minimum age, and it deletes children's data
  it finds. Poor: minors get the same ads and tracking as adults. Bad: targets minors with ads or tracking.

#### Billing

| Topic | Status | Applies to | If silent |
|---|---|---|---|
| `billing.cancellation`: how you cancel | **split** from cancel-refunds | all paid | read the cancel page |
| `billing.refunds`: money back | **split** from cancel-refunds | all paid | Neutral if access runs to the end of the period, else not stated |
| `billing.price-changes` | kept | all paid | Poor ("only posts the new price") |
| `billing.free-trials` | kept | paid plans with a trial | not applicable when there's no trial |
| `billing.renewal-notice`: warning before an automatic renewal | **new** | all paid | Poor |
| `billing.fees`: fees beyond the price | **new** | all paid | not stated |
| `billing.plan-changes`: switching plans | **new** | providers with two or more paid plans | not stated |

- **cancellation.** Great: online in a couple of clicks, no retention maze, and you keep what you paid for. Good:
  online at any time, through retention offers. Neutral: online, but only through the store or partner you bought
  from, or a set time before renewal. Poor: you must contact someone, or there's a minimum term. Bad: a fee to leave,
  or only by post or in person.
- **refunds.** Great: a refund of unused time whenever you cancel. Good: a full refund within a stated window after
  buying or renewing. Neutral: no refunds, but access to the end of the period. Poor: no refunds and access ends at
  once, or refunds only as credit. Bad: no refund even for its own errors or charges after you cancelled.
- **renewal-notice.** Great: no automatic renewal unless you turn it on, or a reminder before every renewal with a
  stated lead. Good: a reminder before yearly renewals with a stated lead. Neutral: "may" remind, no lead. Poor: no
  reminder stated. Bad: renews into a longer or dearer plan (monthly to yearly, offer to full price) without a clear
  warning.
- **fees.** Great: none beyond the price. Good: only small, listed, avoidable fees (a paper bill). Neutral: listed
  fees for optional things. Poor: fees for ordinary use (inactivity, payment-method fees, an unstated currency
  markup). Bad: fees it doesn't disclose, or sets at its discretion.
- **plan-changes.** Great: switch any time, prorated both ways. Good: upgrades at once and prorated; downgrades at
  renewal. Neutral: changes only at renewal. Poor: switching forfeits time paid for. Bad: switching means cancelling,
  or a downgrade deletes data without warning.

#### Legal

| Topic | Status | Applies to | If silent |
|---|---|---|---|
| `legal.disputes` | kept | all | Good (courts by default, no arbitration) |
| `legal.terms-changes` | kept | all | Bad (no notice promised) |
| `legal.account-closure` | kept | all | not stated |
| `legal.content-rights`: rights it takes over what you upload | **new** | services holding user content | not stated |
| `legal.service-changes`: whether what you paid for can be taken away | **new** | all | Neutral |
| `legal.inactivity`: closing inactive accounts | **new** | all | Great (it doesn't) |
| `legal.output-rights`: who owns what an AI or creative tool makes | **new** | ai, creative | not stated |

- **content-rights.** Great: no rights beyond running the service, ending when you delete. Good: a limited licence to
  run and improve the service, ending on deletion (bar backups and what others were sent). Neutral: a broad,
  worldwide, royalty-free licence limited to running or promoting the service, ending on deletion. Poor: perpetual or
  irrevocable, or surviving deletion. Bad: it may sublicense or sell it, or use your name or likeness in ads with no
  opt-out.
- **service-changes.** Great: purchases are yours (DRM-free downloads), or kept even if the service ends. Good:
  purchases stay; a removal is rare and refunded. Neutral: a licence only; content and features may change, as a
  subscription's catalogue does. Poor: it may remove purchased items or your plan's features with no refund. Bad: it
  may revoke purchases or close libraries at will.
- **inactivity.** Great: never closes inactive accounts. Good: only free accounts, after a year or more, with
  warnings. Neutral: after a stated period, with a warning. Poor: no stated period, under a year, or no warning.
  Bad: deletes balances, credit or wallet funds for inactivity.
- **output-rights.** Great: you own the outputs, and it defends you against copyright claims over them. Good: you own
  them. Neutral: you own them, but it may reuse them. Poor: it keeps broad rights over them. Bad: it owns them and
  limits your use.

#### Security (new group)

| Topic | Applies to | If silent |
|---|---|---|
| `security.practices`: independent checks of its security | all | Poor ("industry-standard security" only) |

Great: regular independent audits with published reports, a bug bounty, and published past incidents. Good: an
independent audit or certification (SOC 2, ISO 27001) and a disclosure programme. Neutral: one of those. Poor: only
generic claims. Bad: no stated measures and no way to report a vulnerability.

#### Service (category topics)

| Topic | Status | Applies to |
|---|---|---|
| `service.activity-logging` | renamed from `vpn-logging`, same rubric worded for "what you do (sites, searches, queries) or when and where you connect" | vpn, dns, search, browsers |
| `service.account-sharing` | kept, wider | streaming, music, gaming, software, storage, ai (family plans) |
| `service.device-limits` | kept, wider | streaming, music, gaming, software, vpn |
| `finance.money-protection`: what protects your money | **new** | finance |
| `finance.holds`: when it can hold or freeze your money | **new** | finance |

- **money-protection.** Great: in an account in your name at a member institution, fully covered by CDIC or a
  provincial deposit insurer (some provinces cover credit-union deposits without limit), or spread over several
  partners to raise the cover. Good: held in trust at member institutions with you as beneficiary, covered to stated
  limits. Neutral: covered, but sharing the limit with your other deposits at the same partner bank, or investor
  protection only (CIPF covers a dealer's failure, not losses). Poor: prepaid or e-money held in trust with no deposit
  insurance. Bad: no stated protection, or your money is lent or invested by the company.
- **holds.** Great: stated reasons, notice, and a way to appeal, with a time limit on holds. Good: stated reasons and
  notice. Neutral: stated reasons. Poor: at its discretion, with notice. Bad: at its discretion, without notice or
  time limit.

#### Shared policy documents

One company's policy often covers several providers: Disney's privacy policy covers Disney+, Hulu and ESPN; Bell's,
Crave, TSN and RDS; Microsoft's, Xbox, Microsoft 365 and Copilot; and Google's, Amazon's and Proton's likewise. Rate
such a document once, in `data/policies/<set>.yaml` (M11.1), and have each provider name it and add ratings from its
own terms (its own wins for a topic both rate). Before reading a provider's policies, check whether a set already
covers them.

#### Notable (anything else)

`other.notable`: up to three per provider, for something that stands out and no topic covers (a VPN that accepts
cash; a service that sells your data on closing). Graded on the scale in §1.2, with a short title. Needs a schema
change: a `title` on ratings of this topic.

### 1.5 Routing: which topic a fact belongs to

| The fact | Topic |
|---|---|
| Trains AI on your chats, files, photos | ai-training |
| Recommends from what you watch or listen to | data-collection |
| Shows ads chosen from your activity, in its own apps | ads-tracking |
| Gives data to ad networks (Meta, Google) to target its own ads to you elsewhere | data-sharing |
| Sells to data brokers | data-sharing |
| Staff read your messages for support or quality | content-access |
| Keeps chats 30 days after you delete them | data-retention |
| "Contact us to delete" | data-deletion |
| Throttling or network management (telecom) | a plan feature, not a policy |
| A fee to cancel | cancellation (Bad), and `cancelFee` |
| A currency markup at checkout | fees |
| A game removed from your purchased library | service-changes |

### 1.6 What changes outside the topic file

- `data/policy-topics.yaml` (topics and rubrics) and the policy-research skill (the rules in §1.3) change **together
  with core's `extractionRules`**, which the skill says hold the same rules for the pipeline.
- A *not stated* / *not applicable* record per rating (schema), shown on the card as a grey "Not stated" line, so
  every card has the same lines.
- Existing ratings: `billing.cancel-refunds` splits into two; `service.vpn-logging` is renamed. Policy topics aren't
  in users' data, so neither needs a Dexie migration.

---

## 2. Features: compare everything, across providers

### 2.1 The problem

The optimizer compares **features** only. Perks are display text. So when the reason to pay more lives in perks,
the optimizer always picks the cheapest tier:

- **Xbox Game Pass:** `features: {}` on every plan; the library, cloud gaming hours and day-one games are perks.
- **Claude:** every plan is `ai.assistant: true`, so Free, Pro, Max 5x and Max 20x are identical.
- **Proton:** Lumo isn't listed, so plans that include an AI assistant don't show one.
- **Bitdefender:** the higher tiers don't list real-time protection and the rest of their security features.

### 2.2 Rules

1. **Price differences need feature differences.** Two plans of one provider at different prices (same region and
   period) must differ in at least one feature value. A new validation *warning* catches the case. Everything a
   provider's own comparison table shows as a difference between tiers becomes a feature value. A perk is only for
   what no other provider has *and* nobody would rank on.
2. **Reuse before creating**, in this order:
   1. an existing id, as it is;
   2. an existing id with a new enum or set value, or an alias for the provider's wording;
   3. a cross-category feature (§2.3);
   4. a new feature in the category's group, through the feature-discovery skill (propose, registry commit, every
      provider sourced);
   5. a perk.
   Never a provider-named id (`xbox.ea-play`): a subscription inside a plan is `includes-subscription`.
3. **A capability from another category uses that category's feature**, and the plan joins that category
   (`categories`): Proton Unlimited gets `ai.assistant` for Lumo and `categories: [privacy-suite, vpn, storage, ai]`;
   Bitdefender Ultimate gets `vpn.included` and `password-manager`; a phone plan with Crave gets
   `includes-subscription`.
4. **Required features per category.** Each category lists the features every plan in it must state, `false` and
   `0` included (a `requiredIn: [categories]` field on a feature, which validation enforces). This ends the
   "unlisted means no" ambiguity for the features that matter most: `video.quality` is required in streaming.
5. **Quantities are numbers with tiers**, in normalised units: GB, hours a month, devices, MB per file, messages a
   day. "5 hours of cloud play a month" is a number, not a perk.
6. **Values that change monthly aren't features.** Model names (an AI's "GPT-x"), a show, a promotion: plan notes.
   The capability behind them is the feature (reasoning model, video generation).
7. **Every value is sourced**: the provider-file comment names the page for each fact, as feature-discovery
   requires.
8. **Provider-wide features:** what every plan of a provider has (platforms, sign-in, open source, languages,
   support) goes once in the provider's own `features` (M11.4); a plan states a value only where it differs.
9. **Rename or remove early.** Feature ids are rank keys in users' data, so any rename needs a migration. Do the
   renames in §2.3 once, in Phase 0, before the catalog grows.

### 2.3 Cross-category features (proposed)

| Id | Type | Records |
|---|---|---|
| `platforms` | set | windows, macos, linux, android, ios, web, browser-extension, tv, console |
| `software.open-source` | enum, worst to best | proprietary, source-available, open clients, fully open. With a new provider field `sourceRepo` (URL) for the repository icon and link |
| `account.sign-in` | set | password, passkey, totp, security-key, sms, email-code, push-approval, trusted-device-or-location, sso |
| `ad-free` | boolean | **rename of `streaming.ad-free`** (a migration), to reuse it for music, social, search and news |
| `languages.audio`, `languages.subtitles` | set | a fixed list (en, fr, es, de, it, pt, ja, ko, zh, hi, ar): what the service offers across its catalogue. Streaming and music. `streaming.french-content` stays: it's about French content, not dubs |
| `support.channels` | set | email, chat, phone, 24-7, community-only |

### 2.4 Starter feature profiles per category

Candidates for feature-discovery to verify and propose. **Bold** = existing.

- **Streaming:** **video.quality** (required), **video.hdr**, **audio.dolby-atmos**, ad-free, **concurrent-streams**,
  **download-devices**, **kids-profiles**, **live**, languages, content focus (set: films, series, anime, sports,
  kids, reality, documentaries), profiles (number), paid extra members.
- **Music:** audio quality (enum: standard, high, lossless, hi-res), spatial audio (**audio.dolby-atmos** alias),
  ad-free, offline, on-demand vs shuffle-only, audiobook hours a month, podcasts, lyrics, **account.users**.
- **AI:** **ai.assistant** (parent), usage level (enum: limited, standard, extended, highest, from the provider's
  own multiples), reasoning models, image generation, video generation, voice conversation, deep research, web
  search, file uploads, context size (tiers), memory, projects, coding agent, computer or browser agent,
  integrations (set: mcp, connectors, api-access, browser-extension, ide), model choice (several providers' models:
  OpenRouter, Perplexity, Kagi, Brave Leo), runs on device (Ollama), chat storage (enum: cloud, zero-access cloud,
  device only). Training and retention are policy topics.
- **VPN:** the existing `vpn.*` group.
- **Antivirus and security:** real-time protection, behavioural detection, ransomware protection and remediation, web
  and phishing protection, firewall, scheduled and manual scans, email protection, vulnerability scan, parental
  controls, anti-theft, webcam and microphone protection, **security.dark-web-monitoring**, **vpn.included**,
  **password-manager**, devices (tiers), platforms. Lab results: §3.3.
- **Password managers and authenticators:** **password-manager.\***, built-in authenticator (TOTP), passkey storage,
  emergency access, import formats (set), export formats (set), TOTP import and export (otpauth URIs, Aegis, 2FAS,
  encrypted backups), local-only or self-hosted vault, offline access, autofill, cloud sync (E2EE), biometric lock.
- **Storage:** **storage.cloud**, E2EE, version history (days), link sharing with password or expiry, photo backup,
  desktop sync, maximum file size.
- **Email:** **email.addresses**, **email.custom-domains**, **email.aliases**, mailbox storage, attachment size (MB),
  sending limit (a day), E2EE, IMAP/SMTP access, catch-all, forwarding, **calendar.included**.
- **Calendar:** **calendar.included**, ICS import, ICS subscriptions (live feeds) and their refresh, CalDAV, sharing,
  E2EE.
- **Gaming:** library size (tiers), day-one releases, cloud gaming (hours a month, or unlimited), online play
  (required for online play: console subscriptions), platforms, store discount (%), monthly games, cloud saves,
  `includes-subscription` (EA Play, Ubisoft+). For game subscriptions (MMOs, battle passes): required to play or not.
- **Office and creative:** platforms, apps (set: documents, spreadsheets, slides, notes, forms, email, video calls,
  photo, video, design), offline, real-time collaboration, **storage.cloud**, **ai.assistant**, generative credits
  (a month), fonts and stock assets.
- **Browsers:** engine (enum: chromium, gecko, webkit, own), platforms, built-in ad blocking, tracker protection,
  **vpn.included**, E2EE sync, extension store, vertical tabs, workspaces, split view, **ai.assistant**, open source.
- **Search:** index (set: own, bing, google, mixed: Brave and Mojeek have their own; Startpage uses Google;
  DuckDuckGo mostly Bing plus its own; SearXNG is a metasearch engine; to verify), ad-free, personalisation (blocking
  and boosting sites), AI answers, API access (free queries a month).
- **DNS:** filtering (set: ads, malware, trackers, adult, custom lists), protocols (set: DoH, DoT, DoQ, DNSCrypt),
  queries a month (NextDNS's free limit), analytics, parental controls, Canadian servers.
- **Social:** ad-free, open protocol (ActivityPub, AT Protocol), E2EE messages, longer posts, editing, verification.
- **File sharing:** transfer (enum: local network, peer-to-peer, cloud), maximum file size, retention (days), no
  account needed, E2EE, platforms.
- **Maps and transit:** offline maps, transit, live arrivals, ad-free, platforms.
- **News:** article limit, ad-free, apps, e-paper, extras (puzzles, cooking). Bias and reliability: §3.3.
- **Telecom and finance:** §4.

### 2.5 Ranked perks (the owner's request, 2026-10-30)

Features stay the general list of what a plan gives. A perk is what's left: something one provider has that no feature
describes. Today perks are text "shown but never compared"; from now on the user can rank them and the optimizer
counts them.

- **In the catalog:** a provider lists its perks once, each with a stable id and a name
  (`perks: [{ id: cloud-play, name: Cloud play, 5 hours a month }]`), and each plan lists the ids it has, as plans list
  add-ons. Perk ids are kept as carefully as feature ids, since users' ranks point at them.
- **Rank keys:** `perk:<provider>/<perk>` (`perk:xbox-game-pass/day-one`). A plan provides the key when it lists the
  perk.
- **Where they're ranked:** on the plan, never on the Features page, because a perk means nothing to another provider.
  The rank is an item override like any other (`ListItem` ranks, §3.2's resolution order). M6.14's shared ranks carry
  it to the same provider's other plans in the list, so ranking "Day-one games" on Ultimate covers the provider's
  plans in that list, which is what "provider level" needs. Essential and Critical work on perks as on features.
- **In the optimizer:** a perk is a rank key, so §10.2's constraints and §10.4's severities apply unchanged: a Needed
  perk must stay provided, which in practice means keeping a plan of that provider that has it; losing a Wanted perk
  makes a suggestion yellow. An unranked perk counts as Not ranked, as features do.
- **Counts and summaries:** ranked perks count in rank counts and the feature summary ("Day-one games 1 / 1").
- **A perk that becomes a feature:** when a second provider offers the same thing, it becomes a feature, and the
  catalog says so (`movedTo: <rank key>` on the perk). The app then moves users' perk ranks to the feature's key
  once, in a Dexie upgrade, so nobody loses a rank.
- **Data rule:** §2.2 still comes first. A perk is never a way around modelling a comparable capability, and the
  price-differences warning counts perk differences only after features.

---

## 3. What every provider must record

### 3.1 The checklist

| Requirement | Where it goes | Exists? |
|---|---|---|
| Every personal and family plan, free tiers included | `plans` | yes |
| Every feature (§2) | `features` | yes, profiles new |
| Terms and policies, explained simply, with inline citations and opt-out links | `policies` | yes, topics new |
| Bundles, including ones only sold in some countries, and telecom or credit-card bundles | `data/bundles/` | yes |
| Official resellers, from the provider's own reseller, partner, blog and announcement pages | `resellers` | yes. A shop calling itself official (serialcart.com for Bitdefender) counts only if Bitdefender's own pages name it |
| Card networks accepted | `acceptedNetworks` | yes |
| Currency charged per region | `billingCurrency` | yes |
| Every currency it accepts, and other ways to pay (cash, crypto, PayPal, gift cards, app stores) | **new** `paymentMethods` and `currencies` | no |
| How a month is counted: every 30 days, the same date each month (the 31st moved to the month's last day?), the 1st, or the end of the month | **new** `renewalAnchor`; "every 30 days" stays `day` × 30 | no |
| Where it's sold | `availableIn` | yes |
| Categories it fits | `category` (main) and each plan's `categories` | yes (§5) |
| Open source, with repository link | `software.open-source` and **new** `sourceRepo` | no |
| Sign-in security | `account.sign-in` | no |
| Who owns it (news, finance, telecom, VPNs) | **new** `owner`, quoted from its own about page | no |

### 3.2 Regional prices: never miss them again

Claude's paid plans had only US prices, so a Canadian with "Sold in" on saw only Free (fixed in M10.17: a headless
browser wasn't shown Canadian prices, the browser's own user agent was). To catch that kind of gap:

1. **A coverage report** (`npm run data:coverage`, new): provider × plan × region, warning when a plan has prices in
   some of the provider's regions and not others, or a provider sold in a region (`availableIn`) has paid plans with
   no price there. Claude would have shown "Pro, Max 5x, Max 20x: no CA". Run it on the existing catalog first.
2. **A region checklist** before writing "none found" for a region. The header comment records each step's result:
   1. locale URLs and `hreflang` links (`/en-ca/`, `/ca/`, `?country=CA`), as M10.12 does;
   2. the page's country, language and currency pickers;
   3. pricing data in the page's code (Next.js `__NEXT_DATA__`, JSON in script tags: Claude's named CAD);
   4. the checkout or plan-picker page, up to the payment form and never into it;
   5. the help centre's "prices in your country" or tax articles;
   6. each browser in step 3, below;
   7. the owner's own bill or account page, only when the owner offers it.
3. **Several browsers, in order, each page.** Record which one read it.
   1. Edge (the current driver) with its real user agent, `en-CA` and `America/Toronto`.
   2. A plain fetch (curl).
   3. **Mullvad Browser** (tested in this session; see below).
   4. When the region is the problem rather than the browser: the owner turns on Mullvad VPN with an exit in that
      country. That changes the whole machine's connection, so ask the owner each time and never switch it yourself.
   A page every browser fails on stays unread and is reported. The rule against getting past bot checks still holds.
   A page blocked by the owner's own DNS filter (NextDNS) isn't a site's defence, so reading it another way is fine.
   A site's own paywall or ad-blocker wall is a defence; leave it.

**Mullvad Browser, as tested (2026-10-30).** Playwright can't drive it: its Firefox support needs Playwright's own
build, and its experimental BiDi Firefox isn't exported. But Mullvad Browser itself opens a WebDriver BiDi port
(`--remote-debugging-port`), and a 40-line client on Node's built-in WebSocket drove it headless with a throwaway
profile. It read Bitdefender's Canadian Premium Security page, claude.com/pricing and snopes.com, all past NextDNS.
Two cautions for prices:

- It tells every site it's `en-US` in UTC (it reported `Atlantic/Reykjavik`). That's its anti-fingerprinting by
  design, and many sites choose the country and currency from those signals. In the test, neither pricing page showed
  any prices within 3 seconds. Whether that was the wait or the spoofing wasn't checked. So: use it for pages Edge
  can't reach and for policy pages, and for prices only after confirming the currency on the page matches the region.
- Its uBlock Origin is in the user's profile, not the throwaway one, and loading the real profile would mix research
  into the owner's browsing. Run the throwaway profile; add uBlock Origin to it only if a page needs it.

Phase 0 turns the test script into `.claude/skills/price-research/read-page-mullvad.cjs` with the same `snap:` output
as `read-page.cjs`, and adds this order to the price-research skill.

### 3.3 Facts from outside the provider

Today's rule is official pages only. Some of the requested facts can only come from elsewhere:

| Fact | Source | How |
|---|---|---|
| News bias and reliability | at least two named raters (Media Bias/Fact Check, Ad Fontes, AllSides) | a new `ratings` block: rater, label, date, link. Never our own judgement of bias, and never their text: the label and a link. Check each rater's terms on reuse first |
| Antivirus detection quality | independent labs (AV-TEST, AV-Comparatives, SE Labs) | the same `ratings` block, with the test's date |
| Deposit insurance, regulators | regulators' own registers (CDIC member list, CIRO, FCAC, provincial deposit insurers and regulators) | count as official sources for finance |
| Savings-rate rankings | highinterestsavings.ca and similar | to *find* banks only; every rate comes from the bank's own page |

### 3.4 Requests to settle before research

- **YouTube ad blocking and SponsorBlock as an "optimization",** and **Morphe** (a patched YouTube client, if it's
  the app I think it is): YouTube's terms forbid blocking its ads and modified clients. Suggesting them as a way
  around Premium is likely to draw complaints and could put the project at risk. Safer: list them neutrally as free
  tools, with the terms' wording, not as an optimization.
- **Nebula creator links:** a creator discount counts as a price only if it applies at renewal too. Otherwise it's a
  promotion, which the catalog doesn't store.

---

## 4. Categories that need a design first: finance and telecom

These aren't subscriptions with a price list. Researching them before the model exists would mean redoing it.

**Finance** (banks, credit unions, fintechs, brokerages) needs its own BLUEPRINT section and PROJECT-PLAN tasks:

- **Accounts** per provider (chequing, savings, USD, registered: TFSA, RRSP, FHSA, RESP, RDSP, RRIF, LIRA; DPSP is an
  employer plan) with **rate schedules** (tiered by balance; the posted rate, never a promotional one, like the
  regular-price rule), **monthly fees and waiver conditions** (minimum balance, direct deposit, a bundle), **limits**
  (Interac e-Transfer daily, weekly, monthly, count; spending), **cards** (Interac, Visa Debit, Mastercard, prepaid),
  **ATMs** (network, fee refunds, deposits), **cash deposits** (branch, Canada Post), **online or branch**.
- **How money is held** (in your name, in trust for you, in the company's name) and **regulators**: the
  `finance.money-protection` topic plus a `regulators` list from the registers in §3.3.
- **Investing:** self-directed or managed, order types (set: market, limit, stop-loss, stop-limit), fractional
  shares, markets (set: TSX, TSXV, NYSE, NASDAQ, Cboe Canada…), products (set: stocks, ETFs, GICs, mutual funds,
  options, short selling, margin, crypto).
- **Rate tracking:** whether a rate follows the Bank of Canada's (prime-linked), and how fast it moved after past
  changes. That second part needs history, so the nightly bot starts recording rates and their dates.
- **The optimizer** needs the user's balance per account (a new user record) and core functions:
  - the break-even balance for paying a fee to earn a better rate: `B = 12F / (r₁ − r₀)` (with F the monthly fee and
    r₁ − r₀ the extra rate; a $10 fee for 1.5 points more breaks even at $8,000);
  - the cost of a waiver's minimum balance: `M × (r_best − r_here)` a year, against `12F`;
  - optionally after tax.
- **Wording:** information, not financial advice, said on the page.

**Telecom** (Bell, Rogers, Fido, Telus, Freedom, Fizz, US carriers): prices differ by province and change with
promotions weekly, and most advertised prices are promotional, which the catalog refuses. It needs rules for what a
"regular" price is (the price after the promotion, if stated), a feature group (`mobile.data`, speeds, speed after the
cap, rollover, roaming, 5G, hotspot, eSIM; `internet.speed-down`, `speed-up`, `data-cap`) and its bundles (Crave with
Bell, Rogers' StreamSaver). Start with each carrier's main plans only.

---

## 5. Several categories per provider

The schema already allows it: a provider has one main `category`, and each plan's `categories` lists every service
category it's in (M1.10; the API's `provider_categories` table). The rule from now on:

- A plan lists **every** category it fits: YouTube Premium is streaming and music; Proton Unlimited is
  privacy-suite, vpn, storage, email and ai; LinkedIn Premium is social and jobs; Amazon Prime is shopping,
  streaming and music.
- `category` is where a buyer would look first.
- New service categories (each its own commit, `categories.yaml` asks for it), with Wikidata classes in
  `wikidataClasses` so the queue fills: `finance`, `social`, `browsers`, `search`, `email`, `passwords` (password
  managers and authenticators), `security` (antivirus), `dns`, `telecom`, `shopping`, `developer`, `file-sharing`,
  `calendar`, `maps`, `creative`, `cloud`, `delivery` (rides and food), `jobs`. Matching spend categories where
  rewards differ (`telecom` exists).

---

## 6. Scope: what fits the current decisions

- **Free-only software** (browsers, LibreOffice, VSCodium, KeePass, Aegis, LocalSend, public DNS): fits as a single
  $0 plan, and makes the optimizer's "switch to a free alternative" possible. They add many providers, though, so they
  come after the paid categories.
- **Out of scope as decided** (business and per-seat): Flinks and Plaid (sold to businesses), and usage-billed
  developer APIs (OpenRouter credits, Tavily, Exa, Firecrawl, AWS, Azure, Google Cloud, Cloudflare) except their
  flat personal plans and free tiers.
- **Personal developer plans fit:** GitHub Pro, Copilot, JetBrains, Boot.dev, LeetCode.

---

## 7. How to work through the list

### 7.1 Phases

**Phase 0: foundations** (one task each, before any new provider):

1. Policy topics v2 (§1): topics and rubrics, the policy-research skill's rules, core's `extractionRules`, the
   *not stated* record and `other.notable`.
2. Schema additions (§3.1): `paymentMethods`, `currencies`, `renewalAnchor`, `sourceRepo`, `owner`, `ratings`,
   `requiredIn` on features, and the price-differences warning (§2.2).
3. Ranked perks (§2.5): perk ids in the catalog, `perk:` rank keys, the item dialog's perk ranks, the optimizer and
   summaries, and `movedTo`.
4. Categories (§5) and cross-category features (§2.3), including the `ad-free` rename and its migration.
5. Tooling: `data:coverage` (§3.2), the Mullvad Browser reader, the region checklist in price-research.
6. Limits work that has to come first (§8): the rows-written check, the full-reseed plan, and search's FTS5 table.
7. **Re-check the 13 existing providers** under all of the above: regrade every topic, fill the category profiles
   (Claude's, Xbox's, Bitdefender's and Proton's features first), run the coverage report and the region checklist
   for every region, payment methods and renewal anchors. This is the test of the rules: anything unclear here gets
   fixed before 300 more providers follow them.

**Phase 1: paid subscriptions**, one category per session: AI, streaming, music, VPN, password managers and
authenticators, antivirus, storage, email, gaming, office and creative, news.

**Phase 2: free and mixed tools:** browsers, search, DNS, file sharing, calendars, maps, social, jobs, developer.

**Phase 3: finance and telecom**, after their designs (§4).

### 7.2 A category session

1. feature-discovery for the category: profile, proposal, the owner's answer, the registry commit.
2. Providers in batches of about 10 (one pull request each, as now), from `data/queue.yaml`. Its `status` is the
   tracker, so a new session picks up where the last one stopped.
3. Per provider: price-research (with §3.2's checklist), policy-research (§1.3), features, then commit. One commit per
   provider, so a usage limit loses nothing.
4. Before the pull request: calibration table (§1.3, step 10), `data:coverage`, `data:validate`, apps/api's tests
   (a batch can move the contract test's results).
5. A review session (§7.3) on the pull request, then the owner merges.

- **Push once per batch.** Commit after each provider (a local commit survives a usage limit), but push when the
  batch is done: each push builds a Workers Builds preview, from about 3,000 build minutes a month.
- **Search last.** Web searches share Tavily's and Brave's monthly budgets with the bot (`data/automation.yaml`:
  500 and 450 for local work). Try the provider's sitemaps and known paths first, then SearXNG (no limit), then the
  paid engines.
- **Group by parent company** (Disney, Bell, Microsoft, Google, Amazon, Proton): their shared policies are read once.

Keep each page's text in `.pipeline/<id>/` (gitignored, on disk) so the review session reads the same text without
fetching it again.

### 7.3 Models

On API prices, Fable 5.1 costs 2.5 times what Opus 5.5 does per token ($10/$50 against $4/$20 per million). It's
likely to use a Max plan's allowance at about that rate too; `/usage` shows the real figure.

- **Research (the volume): Opus 5.5 at high effort.** It's mostly reading pages, quoting and filling a schema, which
  the scripts check (quote-check, validation, coverage). Use xhigh for the Phase 0 design tasks.
- **Review: Fable 5.1 at high effort, second.** The stronger model should be the checker. A checker weaker than the
  author misses what the author missed. Reviewing costs far fewer tokens than researching, so the dearer model is
  spent where its judgement counts. It reviews, against the saved page text:
  - every policy grade (the fact, the rule, the grade);
  - every feature mapping and new-feature proposal;
  - every "none found" and "not stated";
  - a sample of prices (one region per provider; the scripts already checked the quotes).
  It writes its findings as review comments or a fix-up commit on the batch's branch.
- **Before Phase 0:** have Fable read this guide and say where its rules would still let two people grade one clause
  differently. That's one short document, and it's the cheapest place to find gaps.
- **Not** two full independent passes: that doubles the cost to find what a targeted review finds.
- **No parallel subagents for research:** each starts cold and multiplies usage. One session, one category, in order.

---

## 8. Limits to fix before the catalog grows (all free)

| Limit | When it bites | Fix |
|---|---|---|
| **D1: 100,000 rows written a day** (the seed fails and the deploy stops until 00:00 UTC) | A Proton-sized provider writes about 880 rows when it changes. Once feature profiles make most providers that size, a pull request touching 100 of them (a regrade, a feature backfill) can pass the day's limit, and a `seedFormat` bump at 300+ providers can't reseed in one day | Write only the rows that changed (a price change: its price row, not 880); count the writes first and stop at the catalog's share (50,000 a day: 100,000 less the user database's 41,000 cap and a margin), whole providers at a time, the rest by the next deploy or the bot's night; tables of a new shape filled over days beside the old (PROJECT-PLAN M11.8) |
| **Workers CPU on search** (10 ms on the free plan) | Text search reads every provider: about 10 ms at about 200 providers (BLUEPRINT §7.1) | An FTS5 table finds text matches in D1, a slim search column (no policies) is parsed instead of the full JSON, and price sorting and paging run in SQL, before about 150 providers (M11.8) |
| **Static file size** (25 MiB each) | Measured: 9.6 KB a provider, 41% of it policy quotes, which are also in every region file users download. With v2's topics, 20–30 KB a provider: the cap at about 1,000 | Policies (the bulk) in a file per provider, `/data/policies/<id>.json`, loaded when a card's Terms and policies opens. That also keeps the region file the app downloads small |
| **The nightly price check** (Workflows: 1,024 steps; Browser Rendering: 10 minutes a day; Workers AI: 10,000 Neurons a day) | Hundreds of providers can't all be checked each night | Check a rotating slice each night (every provider weekly) |
| **Policy rereads** | Validation warns when a rating is a year old: 20+ topics × hundreds of providers is a lot of rereading | Reread only pages whose text changed (the weekly digest's page hashes), not by age |
| **The weekly digest review** (`scheduled-claude`, on the Max plan) | Its list grows with the catalog | Cap items per week; prices first, as now |
| **Tests tied to the catalog** | A batch moved the API contract test's VPN results more than once | Tests on a fixed catalog of their own (M11.8) |
| **D1 rows for provider-wide facts** | Platforms, sign-in and languages repeated on every plan: about 150 rows a provider | Stated and stored once per provider (M11.4) |
| **Policies read many times** | One company's policy rated for each of its providers | Shared policy documents (M11.1) |
| **Search, the optimizer and long lists in the app** (watch, don't build yet) | Hundreds of providers: search on each keystroke, many more optimizer choices, hundreds of cards | Measure during M11.15; if slow, a prebuilt search index and a Web Worker, pruning the optimizer's choices to plans that keep Needed and Wanted keys, and results in pages |
| **Claude usage** (the real cost) | The full list is several hundred providers | The scripts do the checking; page text saved and reused; Phase 1 before Phase 2; free tools last |

---

## 9. Decisions for the owner

Decided on 2026-10-30:
- Silence: graded where it means a missing protection, *Not stated* where it proves nothing (the "If silent" columns).
- Outside raters: allowed, as labels with dates and links, at least two raters for news (§3.3); which raters is
  M11.2's.
- Ranked perks: on the plan, shared with the provider's other plans in a list (§2.5).
- Finance designed now (BLUEPRINT §4.11, §10.6); telecom later.

Still open (each one blocks only the task named):
1. The rubrics' wording (§1.4), final in M11.1's pull request.
2. Renaming `streaming.ad-free` to `ad-free`, with its migration (§2.3, M11.4).
3. Ad blocking and Morphe: list neutrally, or leave out (§3.4, M11.15).
4. Free-only software, and when (§6, M11.15).
5. Mullvad VPN exits for regional prices: whether the owner wants to be asked during research (§3.2, M11.7).
