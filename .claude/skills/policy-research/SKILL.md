---
name: policy-research
description: Rate a subscription provider's terms of service, privacy policy and other policies on the topics in data/policy-topics.yaml (five grades, great to bad), quoting its own pages word for word, for a card's Terms and policies (data/providers/<id>.yaml, policies). Use when adding a provider, re-reading its terms, or when the price-research skill reads its policies.
---

# Policy research (official pages, quoted word for word)

> **The discovery pipeline drafts ratings first** (BLUEPRINT §6.5): its extraction rates each topic from the terms and
> privacy pages with the same rubric, and core drops any quote that isn't on the page word for word. This skill is
> for grading by hand: a rating to check before a batch merges, a policy page the weekly digest says changed (the
> catalog-review skill), or a provider the pipeline couldn't read. Its rules are the pipeline's rules too (core's
> `extractionRules`): change both together.

A card's Terms and policies (BLUEPRINT §4.10) grades a provider on the topics in `data/policy-topics.yaml`. Each
rating is a grade (Great, Good, Neutral, Poor or Bad: its `tier`), a reason in plain words, and the provider's own
words with the page they're on, which the card cites. The rubric decides the grade; the quotes have to support it on
their own.

## Rules

- **Official pages only:** the provider's terms of service (or subscriber agreement), privacy policy, its apps'
  licence, the agreements those include, cookie notice, refund or cancellation help, household or sharing rules,
  download limits, sign-up form, and its own posts on audits.
  Search and third-party summaries only to *find* a page. A page behind a bot check is left out and reported: never
  try to get past one.
- **Shared documents first** (M11.1): one company's policy often covers several providers (Disney's privacy policy:
  Disney+, Hulu and ESPN). Before reading a provider's policies, look in `data/policies/` for a document that covers
  it, and name it in `policies.shared`. A new one is rated once in `data/policies/<id>.yaml` (`id`, `name`, `links`,
  `ratings`, no `plans`), and each provider adds ratings from its own terms. For a topic both rate, the worse grade
  wins on the card; the provider's own wins only when its document says it applies instead: give that rating
  `replacesShared: true`, with the words that say so in its sources.
- **The grade the quotes fit,** reading the topic's rubric, `note` and `silent` in `data/policy-topics.yaml`, by the
  procedure below. When a page doesn't settle it (a privacy policy that collects analytics but doesn't say whether
  you can turn it off), look for the provider's page that does (Proton's usage-statistics help) before rating. Never
  rate from what you believe the provider does.
- **Every topic that applies gets a rating or a status** (validation names the missing ones): `status: not-stated`
  with the pages read in `pages` and no tier or sources, when nothing read addresses it (the topic's `silent` says
  whether the card shows that as a grade); `status: not-applicable` when it can't apply (no free trial). Either way a
  reason ("Its terms and privacy policy don't say whether it tells you before raising the price").
- **Every agreement a user accepts** (the owner's rule, 2026-11-03): not only the terms and the privacy policy. Find
  each of these from the provider's own pages, and read every one whole by the procedure below:
  - its apps' licence (EULA, end user licence agreement, software licence terms): on the download page, in the
    installer's first screen (the page it links), or in the legal centre. Open-source apps have no other: their own
    page saying so is the licence (Proton's "All Proton apps are open source"). Terms that are the licence too
    (Bitdefender's subscription agreement) say so in the link's name ("Licence and terms of service");
  - a subscription or subscriber agreement, when it's a document of its own;
  - what the sign-up form's checkbox or "By continuing, you agree to…" line names: open the sign-up page and read the
    line, typing nothing. A line that shows only after an email address is entered stays unread;
  - what any of them includes by reference ("These Terms incorporate…", "they include our Acceptable Use Policy",
    "Your use is also subject to…"): an acceptable-use or usage policy, community standards or a code of conduct,
    content or technical requirements, the account's terms (Disney's Terms of Use for a MyDisney account), another
    company's terms (an app store's, a parent company's services agreement).
  A benefit another company runs (Game Pass Ultimate's EA Play, Fortnite Crew and Ubisoft+ Classics) or an optional
  feature with terms of its own (Proton Wallet) is read too, with the general terms, privacy policy and game licence
  those include in turn (EA's user agreement, Ubisoft's licence for its games: the owner's choice, 2026-11-03), in
  this machine's country's versions: a clause worse than the provider's own is a rating for the plans that include it
  (every plan when every plan can use it), its reason naming the benefit and what the provider's own terms say. Each
  document a rating quotes or lists in `pages` goes in `policies.links`; name the rest in the comment above
  `policies:`, with what they held ("the same grades", "no topic"), and any not read, with why (it shows only after
  signing in, it blocked this machine).
- **Notable** (`other.notable`): up to three, for something that stands out and no topic covers (a VPN that takes
  cash, a VPN built on another company's network), each with a short `title` and a grade on the scale at the top of
  `data/policy-topics.yaml`. Read every agreement whole for them: a notable term is never left out because no topic
  fits.
- **Audits for providers with deep access** (VPN, DNS, antivirus, email, password managers, browsers: anything that
  sees your traffic, messages, files or passwords, or runs deep in your device): read its audits page
  (mullvad.net/en/blog/tag/audits is the model), its bug bounty or disclosure policy and its security advisories
  (Bitdefender's, Proton's), for `security.practices`, and for `vpn.independent-audits` an audit that tested the
  no-logs claim (Radically Open Security's of Mullvad). A page that renders with JavaScript (Bitdefender's) is read
  with the price-research skill's `read-page.cjs`.
- **Quotes word for word,** from the page as it reads: curly quotes, dashes and accents included. Up to three per
  rating. Quote sentences, not pop-up definitions that a page's text runs into (Disney's policy).
- **The reason is in plain words anyone can follow** (a sentence or two, 240 characters at most): what signing up
  means, explained like you would to a five-year-old. "If you cancel, you can keep watching until the end of the time you paid
  for, but you get no money back." Use everyday words, explain a term a reader may not know (an arbitrator is "a
  private referee"), and say only what the quotes say. In English, even for a page in French.
- **The quotes are its citations:** the card cites each page a rating quotes ("[2]") and links it to the quotes
  with a text fragment, which finds them by their words, so quote the page exactly as it reads.
- **Plans and regions:** a rating for some plans (`plans: [netflix.standard-ads]`, an ad tier's tracking) sits over
  the provider-wide one for those plans. Terms read from this machine are often a country's own (Netflix's mention
  Quebec's Consumer Protection Act): give those ratings `regions: [CA]`, and a rating from another country's terms
  its region (`regions: [US]`, Proton's US arbitration clause). The provider-wide rating is still needed: validation
  counts a topic as rated only with a rating for everywhere and every plan.
- **Topics for some categories or paid plans** (activity logging for VPNs; account sharing and device limits for
  streaming, music, gaming and software; the billing topics for providers with a paid plan, switching plans with
  two) are only for providers they apply to; validation says so.
- **Links:** every page a rating quotes or lists in `pages` goes in `policies.links`, named as the card shows it
  ("Terms of use", "Conditions d'utilisation (in French)"), and every link is quoted or listed somewhere.
- **Where to change it (M5.12):** when a reason says the user has to do something themselves (turn a setting off, ask
  for their data to be deleted), give the rating an `action`; validation requires one on the grades the topic's
  `actionFor` lists (an opt-out's Neutral and Poor, deletion's Good to Poor): what the link does, in a few words ("How to turn off
  Behavioral Advertising", 60 characters at most), and the page the provider's own policy or help pages link for it
  (Netflix's statement links help.netflix.com/node/100637 for its choices). Copy the link from the page, never guess
  an account URL. It has to be on the provider's own sites or the site its quoted policies are on (Disney's privacy
  center, bell.ca); validation says so. A form on another company's domain (a OneTrust web form) isn't linked: link
  the provider's page that explains it instead. When the change is the browser's or device's own setting (ICI
  TOU.TV), link the provider's page that explains how; none when there's nothing to change (a refund to ask for).
- **The owner** (M11.2): the company behind the provider, in `owner` (`name`, `page` with its `name` and `url`, one
  to three `quotes`, `lastVerified`, and `website` when the page is on the owner's site). Who owns a service is basic
  and easy to verify: use what you know to know where to look, then quote it from an official page, in this order:
  1. the provider's about page, or its own press site's (Disney+'s "the flagship direct-to-consumer streaming
     service from The Walt Disney Company", ESPN's press room);
  2. the parent company's own page about it, with the parent's site in `website`: its about or brands page, or its
     annual report (Microsoft's, whose Gaming business includes "Xbox Game Pass and other subscriptions");
  3. the provider's terms naming the company that runs it ("made available to you by Bell Media Inc.").
  Quote the sentence that says who owns or runs it ("Mullvad VPN AB is owned by parent company Amagicom AB."), never
  a copyright line or a payment line alone, and give the shares in `name` when the page does ("ESPN is 72 percent
  owned by The Walt Disney Company, 18 percent by Hearst and 10 percent by the National Football League"). Never
  Wikipedia or the press as the source. Every provider needs one (a public company is its own: "Netflix, Inc., a
  public company (NASDAQ: NFLX)").
- **Where it's from** (the owner's choice, 2026-11-03): `owner.country`, the company's ISO 3166-1 code. When the
  owner's quotes say it ("a Swiss corporation"), the code alone; else a `page` of its own with one to three `quotes`
  and `lastVerified`, in the same order of pages, or an address in its terms or corporate information ("Los Gatos, CA
  95032, USA"). Its words name the country, its people, or in an address a state or province ("Bristol,
  Connecticut"): validation checks it (core's `namesCountry`), and a code alone ("CA") names none.
- **Outside ratings** (M11.2): only from raters in `data/raters.yaml`, whose terms were read before they were added
  (its header lists those read and left out, and why: Ad Fontes, Media Bias/Fact Check, AllSides, AV-Comparatives,
  SE Labs). A new rater is read for its terms first and added only when they plainly allow showing its label with a
  link; ask the owner about any other. A provider's `ratings`: the `rater`, the `subject`, its `label` word for word
  from the rater's scale, the rater's `date` (the day it published it, or a lab test's month: `2026-08`), the `url`
  of the rater's own page for it, and `tested` when the rater tested a named product rather than the provider (Total
  Security 27.0, Windows 11). Never the rater's text and never our own view. A news outlet's bias and reliability
  need two raters at least; an antivirus gets the latest result of each lab listed. Validation warns once a rating is
  a year old: look for the rater's newer one.
- **Say what wasn't read, and why,** in the comment above `policies:` (the agreement didn't render, Access Denied),
  with the date the pages were read.

### How to grade (core's `policyProcedure`, word for word)

The pipeline's `extractionRules` state these steps and the routing below in the same words, and a test in core holds
this file to them: change both together.

1. Find the clauses for the topic in every document a user agrees to: the terms (or subscriber agreement), the
   privacy policy, its apps' licence (EULA), what the sign-up form's checkbox names, and what any of them includes by
   reference (an acceptable-use policy, community rules, another company's terms); then the help centre's billing and
   privacy pages. Quote up to three, word for word. A grade read from a form or a sign-up flow quotes the page that
   hosts it, and the reason says so. Read each of those documents whole, not only the clauses a topic names: step 12
   is for what no topic covers.
2. The default: what happens if you do nothing? Protective is Great or Good. Not protective is Neutral or worse.
3. The control, when the default isn't protective. Self-serve (a setting in the account or app, a one-click link, a
   form that takes effect at once, for the account on every device) is Neutral. Partial (some data, apps, products or
   devices; one use of the data while collecting it goes on; set per device or browser, or reset, like cookie choices)
   is Poor. On request (an email, a letter, a ticket, a form that promises a reply or a review) is Poor for an
   opt-out; deletion and export have their own rubrics. None is Bad. A topic's own rubric beats this step where both
   name the same thing.
4. Necessary exceptions never count against a grade, and the list is closed: a legal duty, preventing fraud and abuse
   (enforcing its terms, protecting its rights), a safety review, security, and processing a payment. Anything else
   is a business purpose and counts: analytics, "improving our services", marketing, training, personalisation,
   "legitimate interests". An exception is judged by what the data is used for, not by what selects it: chats flagged
   for a safety review and then used to improve models count. De-identified or aggregated data doesn't count, unless
   the policy says it may re-identify it, or de-identifying is the only opt-out offered.
5. Scope: the rating for the whole provider covers every region and plan without a rating of its own, at the worst
   clause that applies to any of them. A clause for only some countries or plans is a rating with "regions" or
   "plans", better or worse. A right only some countries have (California's "Do Not Sell") is a rating for them, and
   the provider-wide rating is graded as if it didn't exist. A province's law never changes a grade: a CA rating is
   graded for the rest of Canada, and its reason mentions Quebec.
6. Broad wording is read broadly: "may", "such as" and "including but not limited to" reserve the right, so grade as
   if it's used. Service providers and processors acting for it run the service; affiliates are its own group;
   partners with no stated purpose are other companies using the data for their own ends. A denial that names the act
   ("we do not sell your data") beats a generic reservation; otherwise the reservation wins.
7. One fact, one topic: a fact lowers the grade of the one topic whose question it answers (the routing below). It may
   be quoted under another topic only when that grade is the same without it. What data is used for is graded under
   that use's topic.
8. Silence: when nothing read addresses the topic, the topic's "silent" rule says whether it gets a grade or the
   status not-stated, with the pages read. A topic that can't apply (no free trial) has the status not-applicable.
   Every topic that applies gets a rating or a status, never nothing.
9. A topic and a feature on the same fact both stay, and must agree: activity logging is Great only when the plans'
   vpn.independent-audits includes no-logs. A topic grades only what the feature doesn't say: device limits grade
   registration caps and download expiry, never the number of devices.
10. A rating that depends on the user acting (an opt-out, a deletion request, an export: the grades its topic's
    "actionFor" lists, which validation checks) has an "action": the provider's own page for it, so the user gets
    there in one click. When the change is the browser's or the device's own setting, link the provider's page that
    explains it.
11. Calibrate: grade the same fact the same way for every provider. Before grading one, read the same topics for two
    providers already graded in its category.
12. Notable: a term that stands out and that no topic covers (a VPN that takes cash, a VPN built on another company's
    network) is an other.notable rating with a short "title", graded on the scale, up to three. Never leave a notable
    term out because no topic fits.
13. Security: a provider that sees your traffic, messages, files or passwords, or runs with deep access to your
    device (VPN, DNS, antivirus, email, password managers, browsers), is read for its audits page (Mullvad's
    "External audits" posts), its bug bounty or vulnerability disclosure policy and its security advisories. They
    grade security.practices, and an audit that tested a no-logs claim is vpn.independent-audits' no-logs.
14. The reason explains it like you would to a five-year-old: short sentences, everyday words, what it means for you,
    and only what the quotes say.

### Which topic a fact belongs to (core's `policyRouting`)

- Trains AI on your chats, files or photos: privacy.ai-training.
- Recommends from what you watch or listen to; analytics, telemetry, crash reports; a spam filter or recommendations
  trained on your content: privacy.data-collection.
- Shows you ads chosen from your activity, in its apps or anywhere else, and data collected only for ads:
  privacy.ads-tracking (privacy.data-collection grades what's left).
- Data that reaches another company (a Meta or Google pixel, ad networks), even to show its own ads; selling to data
  brokers: privacy.data-sharing.
- A licence over your content that includes training AI: privacy.ai-training (legal.content-rights grades the rest).
- Staff reading your messages for support or quality: privacy.content-access.
- How you ask for deletion, and whether it happens: privacy.data-deletion.
- How long anything stays, deleted data included ("chats are kept 30 days"): privacy.data-retention.
- An inactive account closed and its data deleted: legal.inactivity.
- An account closed for a breach, with no refund: legal.account-closure.
- A free trial or an introductory price ending: billing.free-trials.
- A renewal into a dearer plan, with no trial before it: billing.renewal-notice.
- A fee to cancel: billing.cancellation (Bad), and the provider's cancelFee.
- A currency markup at checkout: billing.fees.
- A game removed from your purchased library: legal.service-changes.
- What its apps' licence lets you do (personal or non-commercial use only, one person per copy, no reviews or
  benchmarks): legal.licence.
- Apps that update themselves, change your settings or remove other software: service.software-control.
- Throttling or network management: a plan feature, not a policy.

## How

1. Save each page and turn it into text, one block per line:

   ```bash
   curl -s -L --max-time 30 -o "<scratchpad>/policy/pages/<name>.html" "<url>"
   python -I -X utf8 .claude/skills/policy-research/page-text.py "<scratchpad>/policy/pages/<name>.html" "<scratchpad>/policy/text/<name>.txt"
   ```

   A page that comes back nearly empty is rendered by JavaScript: open it with the price-research skill's
   `read-page.cjs` (`snap:<name>` saves its text). In Git Bash, `python -I` ignores `PYTHONIOENCODING`, so print
   accented text with `-X utf8`.
2. Search the text topic by topic (`grep -n -i` with the rubric's words: refund, cancel, price, arbitrat, class
   action, terminate, sell, advertis, opt out, delete, log), and read the clause around each hit.
3. Write the ratings in the provider file, under a `policies` section after everything else.
4. Check every quote against the saved text. List each page in a JSON file, `{ "<url>": "<text file>" }`, then:

   ```bash
   node .claude/skills/policy-research/quote-check.cjs . "<scratchpad>/policy/pages.json"
   ```

   It prints any quote that isn't on its page word for word, and the page's own wording when only quotes, dashes
   or spaces differ. It checks the provider facts' quotes too (owner, ways to pay, currencies, renewal day, source
   code, accepted cards) when their pages are in the file, and only those with a third argument, `facts` (M11.5).
5. `npx prettier --write data/providers data/policies`, `npm run data:validate` and `npm test`.

## Gotchas

- Disney+'s subscriber agreement (`disneyplus.com/en-ca/legal/subscriber-agreement`) renders only its footer in
  headless Edge, and CBC/Radio-Canada's privacy notice only its contents and cookie notice: their other topics
  stay unrated until a page shows them.
- The Walt Disney Company's privacy policy covers Disney+, Hulu and ESPN: it's `data/policies/disney-privacy.yaml`.
  Bell's "How we collect and use data" covers Crave, TSN and RDS, which can share a document of their own the same
  way. Rate each provider's own terms for the rest.
- Google's Terms of Service and Privacy Policy cover every Google service: `data/policies/google-terms.yaml` and
  `google-privacy.yaml` (M11.15, Google AI first). Rate each service's own notices and additional terms beside them
  (Google AI's Gemini Apps Privacy Hub and Google One Additional Terms). Their pages and Google's help centres read
  with a plain fetch; the bug bounty's rules (bughunters.google.com) and Alphabet's founders' letter (abc.xyz, under
  "more") need Edge.
- Netflix's help articles ask for a country; their text still loads.
- CBC/Radio-Canada's general terms for its digital services (which ICI TOU.TV's subscription includes) load each
  answer only when its question is clicked: open each in Edge (`read-page.cjs`, `click:` by the question's text).
- Microsoft's Standard Application License Terms (games and apps from its store) are at the end of the services
  agreement's own page; Xbox's Community Standards are on xbox.com/en-US/legal/community-standards.
- IdentityForce's terms (Bitdefender's identity theft protection, US plans) block this machine: unread, as a block is.
