---
name: policy-research
description: Rate a subscription provider's terms of service, privacy policy and other policies on the topics in data/policy-topics.yaml (five grades, great to bad), quoting its own pages word for word, for a card's Terms and policies (data/providers/<id>.yaml, policies). Use when adding a provider, re-reading its terms, or when the price-research skill reads its policies.
---

# Policy research (official pages, quoted word for word)

A card's Terms and policies (BLUEPRINT §4.10) grades a provider on the topics in `data/policy-topics.yaml`. Each
rating is a grade (Great, Good, Neutral, Poor or Bad: its `tier`), a reason in plain words, and the provider's own
words with the page they're on, which the card cites. The rubric decides the grade; the quotes have to support it on
their own.

## Rules

- **Official pages only:** the provider's terms of service (or subscriber agreement), privacy policy, cookie notice,
  refund or cancellation help, household or sharing rules, download limits, and its own posts on audits. Search and
  third-party summaries only to *find* a page. A page behind a bot check is left out and reported: never try to get
  past one.
- **The grade the quotes fit,** reading the topic's rubric in `data/policy-topics.yaml`. When a page doesn't settle
  it (a privacy policy that collects analytics but doesn't say whether you can turn it off), look for the
  provider's page that does (Proton's usage-statistics help) before rating; otherwise leave the topic out. Never
  rate from what you believe the provider does.
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
  its region (`regions: [US]`, Proton's US arbitration clause).
- **Topics for some categories** (VPN logging for VPNs; account sharing and device limits for streaming) are only
  for providers with a plan in one of them; validation says so.
- **Links:** every page a rating quotes goes in `policies.links`, named as the card shows it ("Terms of use",
  "Conditions d'utilisation (in French)"), and every link is quoted somewhere.
- **Where to change it (M5.12):** when a reason says the user has to do something themselves (turn a setting off, ask
  for their data to be deleted), give the rating an `action`: what the link does, in a few words ("How to turn off
  Behavioral Advertising", 60 characters at most), and the page the provider's own policy or help pages link for it
  (Netflix's statement links help.netflix.com/node/100637 for its choices). Copy the link from the page, never guess
  an account URL. It has to be on the provider's own sites or the site its quoted policies are on (Disney's privacy
  center, bell.ca); validation says so. A form on another company's domain (a OneTrust web form) isn't linked: link
  the provider's page that explains it instead. None when the change is the browser's or device's own setting (ICI
  TOU.TV) or there's nothing to change (a refund to ask for).
- **Say what wasn't rated, and why,** in the comment above `policies:` (no free trial, the agreement didn't render,
  Access Denied), with the date the pages were read.

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
5. `npx prettier --write data/providers`, `npm run data:validate` and `npm test`.

## Gotchas

- Disney+'s subscriber agreement (`disneyplus.com/en-ca/legal/subscriber-agreement`) renders only its footer in
  headless Edge, and CBC/Radio-Canada's privacy notice only its contents and cookie notice: their other topics
  stay unrated until a page shows them.
- The Walt Disney Company's privacy policy covers Disney+, Hulu and ESPN; Bell's "How we collect and use data"
  covers Crave, TSN and RDS. Rate each provider from the shared page, and its own terms for the rest.
- Netflix's help articles ask for a country; their text still loads.
