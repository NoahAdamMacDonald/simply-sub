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

- **Official pages only:** the provider's terms of service (or subscriber agreement), privacy policy, cookie notice,
  refund or cancellation help, household or sharing rules, download limits, sign-up form, and its own posts on audits.
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
- **Notable** (`other.notable`): up to three, for something that stands out and no topic covers (a VPN that takes
  cash), each with a short `title` and a grade on the scale at the top of `data/policy-topics.yaml`.
- **Quotes word for word,** from the page as it reads: curly quotes, dashes and accents included. Up to three per
  rating. Quote sentences, not pop-up definitions that a page's text runs into (Disney's policy).
- **The reason is in plain words anyone can follow** (a sentence or two, 240 characters at most): what signing up
  means, as you'd explain it to a child. "If you cancel, you can keep watching until the end of the time you paid
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
  for their data to be deleted), give the rating an `action`: what the link does, in a few words ("How to turn off
  Behavioral Advertising", 60 characters at most), and the page the provider's own policy or help pages link for it
  (Netflix's statement links help.netflix.com/node/100637 for its choices). Copy the link from the page, never guess
  an account URL. It has to be on the provider's own sites or the site its quoted policies are on (Disney's privacy
  center, bell.ca); validation says so. A form on another company's domain (a OneTrust web form) isn't linked: link
  the provider's page that explains it instead. None when the change is the browser's or device's own setting (ICI
  TOU.TV) or there's nothing to change (a refund to ask for).
- **Say what wasn't read, and why,** in the comment above `policies:` (the agreement didn't render, Access Denied),
  with the date the pages were read.

### How to grade (core's `policyProcedure`, word for word)

The pipeline's `extractionRules` state these steps and the routing below in the same words, and a test in core holds
this file to them: change both together.

1. Find the clauses for the topic in the terms, the privacy policy, and the help centre's billing and privacy pages,
   and quote up to three, word for word. A grade read from a form or a sign-up flow quotes the page that hosts it,
   and the reason says so.
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
10. A rating that depends on the user changing something (Neutral or Poor through an opt-out) has an "action": the
    provider's own page for it.
11. Calibrate: grade the same fact the same way for every provider. Before grading one, read the same topics for two
    providers already graded in its category.

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
   or spaces differ.
5. `npx prettier --write data/providers data/policies`, `npm run data:validate` and `npm test`.

## Gotchas

- Disney+'s subscriber agreement (`disneyplus.com/en-ca/legal/subscriber-agreement`) renders only its footer in
  headless Edge, and CBC/Radio-Canada's privacy notice only its contents and cookie notice: their other topics
  stay unrated until a page shows them.
- The Walt Disney Company's privacy policy covers Disney+, Hulu and ESPN: it's `data/policies/disney-privacy.yaml`.
  Bell's "How we collect and use data" covers Crave, TSN and RDS, which can share a document of their own the same
  way. Rate each provider's own terms for the rest.
- Netflix's help articles ask for a country; their text still loads.
