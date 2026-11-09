---
name: price-research
description: Read a subscription provider's real plans, prices, add-ons, bundles and official resellers from its official site, and its terms of service and privacy policy, for the catalog (data/providers/*.yaml, data/bundles/*.yaml), including JavaScript pages, country and language pickers, currency menus, annual-vs-monthly toggles, bundles sold on partner pages and prepaid services. Use when adding a provider, adding a region, or re-verifying prices.
---

# Price research (official sites, system Edge)

> **New providers come from the discovery pipeline first** (BLUEPRINT §6.5): `npm run data:batch` on a computer, or
> the nightly bot on its cadence, finds the pages, has them extracted with every quote checked word for word, and
> opens a batch pull request. This skill is for what the pipeline leaves to a person: a service it couldn't read, a
> draft to fix, a region or price it didn't settle, and the weekly digest's price items (the catalog-review skill).
> Its rules are the pipeline's rules too (core's `extractionRules`): change both together.

Every catalog price needs a `lastVerified` date (the day you read it) and a `sourceUrl` you actually opened. The
API contract's prices are illustrative and never a source. This skill is how to read the real ones.

## Rules

- **Official pages only.** Use the provider's site, its help centre, or the seller's own page for a bundle or
  add-on (starz.ca for the STARZ add-on to Crave). Use web search and third-party articles only to *find* pages
  or to flag a question. Never copy a price from them. When an official page won't give an answer, say so and
  leave the field out rather than guess.
- **Regular prices, not offers.** Store the price a subscription renews at. "Billed at $53.88 for the first 12
  months, then renews at $83.88 every 12 months" means `amount: 83.88`. Struck-through prices are usually the
  monthly price, shown next to the yearly per-month rate (see Proton). A first-term offer can go in `notes`; users
  who got it enter it as their own price (BLUEPRINT §4.3).
- **The billing period as the provider states it.** "Monthly" is `interval: month`, but "every 30 days" is
  `interval: day, intervalCount: 30` and "every 4 weeks" is `interval: week, intervalCount: 4`. Prepaid phone plans
  and gyms often bill by days, so read the terms or the checkout, not just the "/mo" on the price card.
- **Does the price include tax?** Canadian and US prices are taken as before tax, and the app adds sales tax. When
  the provider says its price includes tax for every buyer ("Including VAT.", "taxes included", one flat price
  everywhere), add `taxIncluded: { quote: <its exact words> }` to each such price, quoted from `sourceUrl`'s page so
  the nightly check can find it. Wording like "+ tax", "excl. VAT" or "taxes calculated at checkout" means leave it
  out. A converted figure on the page ("€5 is equivalent to CA$7.84") is not a price in that currency.
- **Region codes:** ISO 3166-1 alpha-2 (`GB` for the United Kingdom, never `UK`), `EU` when one price covers the
  whole EU, and `GLOBAL` for one price wherever the provider sells.
- **`availableIn` only from an official list.** When the provider says where it sells ("only in the US", a country
  list in its help centre, terms that say the service "is intended for use in Canada"), set `availableIn` to that
  full list and quote it in a comment. Every provider sold in certain countries only gets one. Otherwise leave it
  out: a region without prices is then shown as unknown, not as "not offered" (BLUEPRINT §4.7).
- **Accepted card networks, per region, only from the provider's own words** (M9.2). Find its payment methods page
  (the help centre's "payment methods" or "payment options", a pricing FAQ such as Proton's "What payment methods can
  I use?", the checkout when it opens without an account). For each region the page covers, set
  `acceptedNetworks.<region>` (`GLOBAL` when it's for every buyer) with its `networks`, the page's `url` and `quotes`:
  its words, word for word, naming every network (list items such as `American Express`, or a sentence), which the
  nightly check looks for. A page whose list follows the reader's country (Disney+'s help centre) is read once per
  country with the driver's `country:` step; a country URL (Netflix's `/ca`, `/us`) is better. Diners Club and other
  networks the schema lacks are `other`. "All major credit cards" or "credit card" names none, and neither do logos
  without words: leave the region out, and say in a comment what the pages said.
- **Links are required.** Every plan and bundle needs its sign-up `link` on the provider's own site, and every
  provider a `cancelUrl`: its cancel page, or its help article on cancelling (Disney+'s help centre has one for
  every country), or for a prepaid service with nothing to cancel, its page on getting unused time back
  (Mullvad's refunds guide). Say in a comment where it came from.
- **Ids are permanent once published** (M10.27, BLUEPRINT §4.3). A plan the provider renamed is the same plan: keep
  its `id`, change its `name`, add `formerNames: [{ name: <old name>, until: <the last day it had it> }]`, and put a
  YAML comment with the old name beside the id (`# was "Max 20x" until 2026-10-29`). Never add a plan for the new name
  and delete the old one: every user's item on it would drop out of their totals. A plan no longer sold gets
  `retired: <date>` with its last prices kept, and `endsOn` when it ends for its subscribers too; one whose
  subscribers move to another plan gets a dated entry in `data/redirects.yaml`. Ask the user before retiring or
  redirecting anything. `npm run data:validate` fails when a published id disappears.
- **Every interval and every price list the provider sells.** That means every billing period it sells (a month, 3
  months, 6 months, a year, a week, as each is stated), each priced only in the regions that sell it (ZEE5's 3-month
  plans are the UK's and the euro countries': the owner's rule of 2026-11-09), every region in scope (the catalog's
  regions, or GLOBAL), and every currency the buyer can pick. The app offers an item only the periods priced where
  it's bought (`pickPrice`'s one source region), so a period one country sells never shows in another.
- **Read the features from the same pages:** quality, streams, downloads, devices, users, storage and limits. Map them
  to `data/features.yaml` ids; anything else is a perk (M11.6): listed once in the provider's `perks` with an id and
  its words as the name (`{ id: fortnite-crew, name: Fortnite Crew }`), and by id on the plans that have it. A perk's
  id is as permanent as a feature's (its rank key, `perk:<provider>/<perk>`, is in users' ranks): keep it when the
  wording changes, and ask before retiring or redirecting one. If the registry needs a new feature, stop and ask, then follow the feature-discovery skill.
- **Features that compare** (BLUEPRINT §4.2 rules 7–10, M11.4):
  - **Required features:** every plan in a category states each feature whose `requiredIn` names it (`video.quality`,
    `streaming.concurrent-streams` and `ad-free` in streaming, the VPN basics in vpn, each category's own feature),
    `false` and `0` included. A required boolean no official page states is `false`, with a comment naming the pages
    that were silent; a required enum or number no page states is never guessed. When a page gives a reason for a
    value (a speed article's "HD content", an app's highest quality setting), record it with the plan's `inferred`
    (the reason and that page), which the card marks for the user to judge (BLUEPRINT §4.2 rule 11, the owner's choice
    of 2026-11-03); when none does, ask the user, who may add the plan to core's `awaitingRequiredFeatures`.
  - **Provider-wide facts once:** platforms, sign-in methods, open source, audio and subtitle languages and support
    channels (`providerWide: true` in the registry) go in the provider's own `features` when every plan has them, and
    a plan states one only where it differs. Category features stay on each plan, even when all are the same.
  - **A dearer plan needs a difference:** `npm run data:validate` warns when two plans cost differently for the same
    region and period with the same features. Read the provider's comparison table again for what the price pays
    for, and record it as a feature value (or ask for a new feature), else a perk, which counts too (M11.6).
  - **Reuse first:** an existing id; a new value or alias of one; a cross-category feature; a new feature through
    the feature-discovery skill; then a perk. A capability from another category uses that category's feature.
- **Every category a plan fits** (`data/categories.yaml`, M11.3). The provider's `category` is where a buyer would
  look first; a plan that's more than that lists every service category it fits in `categories` (YouTube Premium:
  `[streaming, music]`; Proton Unlimited: `[privacy-suite, vpn, storage, email, passwords, calendar, ai]`). When its
  features name a category it isn't sold as, a free tier that comes with it (Proton Mail Plus has Proton VPN Free),
  list it in `notIn` and say why in a comment. `npm run data:validate` warns about the rest: `vpn.included`,
  `antivirus.included`, `password-manager`, `email.addresses`, `calendar.included`, `storage.cloud` and
  `ai.assistant` each name one. A new category puts the provider under that category's policy topics, so rate them
  too (the policy-research skill).
- **Every time, for every provider, check three more things** (M1.12), even when only re-verifying prices, and say
  in the provider file's header comment what each turned up ("none" counts):
  - **Bundles:** the subscribe and pricing pages (page through carousels), the help centre's bundle articles, the
    partners' landing pages, and a search for "<provider> bundle". Each one the provider or a partner sells.
  - **Official resellers:** the provider's own "resellers", "partners", "where to buy", "retail" and "gift cards"
    pages, and its blog and news posts on every site it runs (a search such as `site:protonvpn.com/blog reseller`,
    and "partnered", "voucher"): Proton names its resellers only in a Proton VPN blog post. A post can be out of
    date, so a reseller page that no longer names a shop wins (Mullvad's 2021 post on Smartech). A provider's
    other site goes in its `domains` (`domains: [protonvpn.com]`), so its approval page validates. Only shops it names as selling its subscription count (BLUEPRINT §4.9). App stores, phone and TV
    providers that bill its plans or bundle them into their own packages are partners: note them, don't list them.
  - **Terms of service, privacy policy and the other policies** (refunds, cookies, household or sharing rules): they
    hold what pricing pages leave out, such as where it's sold (`availableIn`), the billing period and auto-renewal,
    refunds, notice of price changes, limits on streams, devices and downloads, bundles and partner billing. Use
    them for those fields, and rate them on the policy topics with the policy-research skill (M1.13).
  - **The owner and outside ratings** (M11.2), by the policy-research skill's rules: the company behind it (every
    provider needs one), and for an antivirus or a news outlet the raters in `data/raters.yaml`.
  - **Every way to pay** (`paymentMethods`, required of every provider): its payment methods help article, pricing
    page or terms, for cards, PayPal, Apple and Google Pay, Klarna, Satispay, Cash App, Alipay, app stores and platforms that
    bill for it (Amazon's Prime Video channels), gift cards, a bank transfer or direct debit (iDEAL | Wero, Swish,
    Bancontact, GoCardless), cash, crypto and a TV, internet or phone provider's bill, each named in a quote. Read
    every country's own page when they can differ (Netflix's eleven, Disney+'s with the help centre's country picked):
    an entry per page and country. Entries for the same place add up, so a second page (Crave's gift cards) is a second
    entry, and a region's own entries replace everywhere's, so they list all its ways (Xbox Game Pass's mobile
    billing, only where Microsoft's operators are). Look for the alternatives (cash by post, crypto, vouchers): a
    provider that takes them says so. A wallet or processor no id names is `other`, quoted, and asked about as a new
    id. Its card's networks go in `acceptedNetworks` (above); with none named, the card says "Card (networks not
    verified)".
  - **Currencies beyond its prices** (`currencies`, M11.5): when a page says it takes currencies its price lists
    don't show (Mullvad's cash by post in nine, a checkout that charges in the buyer's own), each code named in a
    quote (its code, name or sign: `€`, `CA$`; a bare `$` names none), with the ways to pay that take them. Leave it
    out when it takes only its prices' currencies. A dated post a newer checkout contradicts isn't used.
  - **The day it renews on** (`renewalAnchor`, M11.5), for a provider whose paid plans renew by the month or year:
    its terms and billing help (a "billing date" article), quoted: `same-date` (the date you signed up, a shorter
    month's last day when it has no such date), `every-30-days` (then its months are priced `day` × 30),
    `first-of-month` or `end-of-month`; `kind: not-stated` with the `pages` read when none says. Terms often say the
    date you signed up by what it implies: a charge whose timing changes only "if your subscription began on a date
    not contained in a given month" (Disney's and Bell Media's terms) is billed on that date each month, and core reads
    that wording as `same-date`, as it does a billing date you can move only to today (Viaplay's Dutch "Je kunt de
    betaaldatum alleen wijzigen naar de huidige datum"); "renews at the end of the billing period" alone says no day.
    Another language's wording is added to core's `renewalWrittenAs` with a test. The item dialog
    suggests a new item's renewal from it and asks "Billed on…" only when it doesn't settle that.
  - **Source code** (`sourceRepo`, M11.5): when its own pages say its code is open (an "Open source" page, its
    downloads' "Source code" link), the repository that page links, quoted, with `software.open-source` provider-wide
    (open-source apps when the apps are; fully open only when the servers' code is published too).
- **Report what you couldn't verify**, each with the reason (geo-blocked, not stated, conflicting).

## Which tool

| Tool | Use it for | Watch out |
|---|---|---|
| WebFetch | Static pages (help articles, FAQs) | It fetches from this machine, so geo-located pages show **Canada**. Its summary can misread tables, so confirm the numbers in Edge when they matter. JS-rendered pages come back empty. |
| `read-page.cjs` (Edge) | JS pages, tabs, currency menus, country pickers, accordions, carousels, image-only labels (screenshots) | Needs the deps below. Look at the screenshots when text is missing. |
| `read-page-mullvad.cjs` (Mullvad Browser, M11.7) | A page Edge and curl can't read (the owner's DNS filter blocks it, a script fails), and policy pages | The same steps but `country:`, and the same `snap:` files. It tells every site it's en-US in UTC: a price it shows counts only once the page's currency is the region's. |
| WebSearch | Finding the right official URL | Runs from the US, server side. Results are often stale or third-party: never a source. |
| curl | Rarely | Server-rendered HTML can hold **placeholder** prices filled in later by JS (Proton's do). Don't trust them. |

Don't create sessions on, or call, a provider's private APIs (Proton's plans API needs a session: off limits).

## Setup

Install `playwright-core` into its own scratchpad folder (never the repo), with install scripts off:

```bash
DEPS="<scratchpad>/browser-deps"
mkdir -p "$DEPS" && cd "$DEPS"
printf '{ "name": "browser-deps", "private": true }\n' > package.json
npm install --ignore-scripts --no-audit --no-fund playwright-core@1.64.1
```

## The driver

`read-page.cjs` (next to this file) opens one tab in the system Edge and runs steps in order: `click:`,
`click?:` (optional, for cookie banners), `nth:<n>:<text>` (the nth element showing the text: one card's own tab
where each card has one), `tab:`, `select:<aria-label>=<value>`, `country:` (Disney+ help centre), `goto:`, `wait:`
and `snap:<name>`, which saves `<name>.txt` (visible text) and `<name>.png` (full page).
The header comment documents each step.

```bash
node .claude/skills/price-research/read-page.cjs "$DEPS" "<scratchpad>/pages/<provider>" <url> [step ...]
grep -h "Billed at" "<scratchpad>/pages/<provider>"/*.txt
```

To sweep a matrix (currencies × products × intervals), build the step list in a shell loop and run it once, so
every view comes from one browser session:

```bash
steps=()
for cur in USD CAD EUR CHF; do
  steps+=("select:Change currency=$cur")
  for product in Mail VPN Pass Drive Bundles; do
    steps+=("tab:$product" "tab:Monthly" "snap:$cur-$product-month" "tab:Yearly" "snap:$cur-$product-year")
  done
done
node .claude/skills/price-research/read-page.cjs "$DEPS" "$OUT" https://proton.me/pricing "${steps[@]}"
```

## Site patterns and how to record them

| Pattern (example) | How to read it | How it goes in the YAML |
|---|---|---|
| **Price set by your location** (Netflix, Disney+, most streamers) | This machine is in Canada. Find the per-country URL or picker. Netflix help: append the country code, `help.netflix.com/en/node/24926/us` (and `/ca`). | One price per region (`region: US, currency: USD`). `billingCurrency: { CA: CAD, US: USD }`. `sourceUrl` is the country URL. |
| **Language/country picker** (Disney+) | `disneyplus.com` and the help centre redirect by IP. Open `help.disneyplus.com`, then `click?:Accept All` and `country:United States (English)` (the picker's button, named "Change country or language", shows the flag and the language since 2026-10-28), then `goto:` the article (`/article/disneyplus-price`): since 2026-11-03 a country picked on the article goes to a page not found. Check each language too (US English and Español, Canada English and Français): prices follow the country, not the language. | Plans can differ by country. A plan sold in one country only has prices there, and the app hides it in the other countries the provider is priced in. If the same name means different features (US With Ads is 4K, Canada's Standard With Ads is 1080p), make separate plans (`disney-plus.with-ads`, US only). Say in a file comment where the other country's prices come from. Other countries (M11.9): pick each on the help centre's home page ("United Kingdom (English)", "Germany (English)"…), then `goto:` the article, which is `/en-GB/article/disneyplus-price` for all of them: each country's prices, in its currency. The nightly check can't pick a country, so it sends the prices it doesn't find there to a person. |
| **Prices filled in by a script** (Bitdefender) | Its store script fills the prices after a request the owner's DNS filter blocks, so Edge shows none (2026-11-03): read with `read-page-mullvad.cjs`. Each locale's pages (`/en-gb/`, `/de-de/`…) price in that region's currency whoever reads them, so they count. Each suite's page has an Individual and a Family card, each with its own Monthly (Ultimate only), Yearly and 2 Years tabs: `nth:1:2 Years` then `nth:2:2 Years`, in the page's language (`2 Jahre`, `2 ans`). The struck-through price ("£104.99 Save 33%") is the regular one; the one under it is the first term's. | One price per region and period, `sourceUrl` the region's page. The tax words beside the price ("Sales tax included.", "Inklusive MwSt.") are `taxIncluded`; the US's "Plus applicable sales tax." isn't. |
| **Buyer picks the currency** (Proton: USD, CAD, EUR, CHF) | Use the currency `<select>` (`select:Change currency=CAD`), and check every product tab and both Monthly and Yearly. The Yearly view shows the monthly price struck through, a lower per-month rate and "Billed at X every 12 months": store X as the yearly price and the struck price as the monthly one. Family and Duo plans can sit on another page (`proton.me/family`). | A `GLOBAL` price in each currency. BLUEPRINT §4.7 shows a price in the user's own currency as native. `billingCurrency: { GLOBAL: USD }` covers everyone else. A free plan keeps one `$0` price. Several currencies in one region mean the buyer can pick any of them: Optimizations suggests the cheapest on the user's card (M9.6), so list them only when the checkout lets the buyer choose. |
| **Prepaid time** (Mullvad) | A flat €5/month for any period. The card checkout offers about 20 currencies at a converted "≈" amount, which isn't a fixed price. Crypto is 10% off, and there are no subscriptions. | `autoRenew: false`, every period it sells (1, 2, 3 and 6 months and a year) in the one fixed currency (`GLOBAL EUR`). The local-currency payment options and discounts go in `notes`. BLUEPRINT §14 has the open question on FX fees for this. |
| **Resellers** (Mullvad's vouchers on Amazon, at Inet, Webhallen, ProxyStore, SerialCart, Laptop with Linux) | Start from the provider's own reseller page (`mullvad.net/en/help/partnerships-and-resellers`). Take only the shops it names as selling the provider's subscription; its partners that run their own product on the provider's service (Mozilla VPN) aren't resellers. Read each shop's own product page. Amazon shows Mullvad's price on amazon.ca only: its other 12 stores show it only in the basket ("To see the product details, add this item to your basket"), so they're left out. A shop whose price with VAT follows the buyer's country gives its price excluding VAT (Laptop with Linux). WooCommerce shops keep each period's regular and sale price in the variation data of `form.variations_form`. A page behind a bot check is left out and reported. | One `reseller` in `data/resellers.yaml` (add a shop's other domains to `domains`), and a `resellers` listing in the provider file: `approvedBy` with the provider page's words naming it, word for word (`Amazon - CA`), and one offer per plan with the regular prices, each `sourceUrl` the shop's page for it. Never a sale price. "excl. VAT" is `taxExcluded: { quote }`; a price that's the same wherever the buyer lives is `taxIncluded`. Then `npm run data:icons` for its logo (BLUEPRINT §4.9). A company that bills the subscription on its own service (TV and mobility providers, app stores, Prime Video's channels, a telecom plan that includes it) is noted in the provider's file with its page's words, never listed (the owner's choice of 2026-11-03). |
| **Bundles on the seller's or partner's pages** (Crave × Disney+) | The bundle can be on the provider's subscribe page (a carousel: page through it), on a partner landing page (`crave.ca/en/disneypluscravebundle`, where the card labels are images, so read the screenshot), on the other partner's help centre, and in an FAQ listing every bundle (`plus.crave.ca/en/faq/...`). Check them all before deciding who sells it. | A bundle file only when its features are exactly the sum of its plans. `soldBy` is the provider whose own site sells it. Every included plan must exist in the catalog. Bundles with services not in the catalog wait until they are. |
| **Add-ons priced by a third party** (STARZ on Crave) | "Starting at $7.99" on the seller's page isn't enough. Find the add-on's own page (`starz.ca` FAQ: `click:How much does STARZ cost?`, one question at a time, because the accordion closes the others). Check which plans allow it. | An add-on with no `grantsPlan` when it doesn't grant a plan, listed in the `addOnIds` of the plans that allow it. |
| **Extra members** (Netflix, Disney+) | The price usually depends on the account holder's plan. Read the limit from the help article ("can have one Extra Member"). | One add-on per price and plan, with `grantsPlan` set to the plan whose features the member gets, and `addOnLimit`. |
| **Suites** (Proton Unlimited, Duo, Family) | Read their own limits (storage, addresses, users). Don't add up the parts. | Normal plans with their own features, `includes-subscription` and `account.users` (BLUEPRINT §4.4). |

## Every region, and the browser that read it (M11.7)

**The coverage report** (`npm run data:coverage`) lists each region a provider is sold in where a paid plan of it has
no price: plans priced in some of its regions and not others, plans with no price where its `availableIn` sells, and,
for a provider with a plan priced for everywhere (GLOBAL), Canada and the US. Claude's paid plans had US prices only
until M10.17, so a Canadian saw only Free: the report flags that now. Run it after every provider and every batch.

**Before writing "none found" for a region,** go through the checklist, and put each step's result in the provider
file's header ("# Region checklist for CA, 2026-11-03: 1. … 7. …", "none" counts):
1. locale URLs and `hreflang` links (`/en-ca/`, `/ca/`, `?country=CA`), as M10.12's pipeline does;
2. the page's country, language and currency pickers;
3. pricing data in the page's code (Next.js `__NEXT_DATA__`, JSON in script tags: Claude's named CAD);
4. the checkout or plan picker, up to the payment form and never into it;
5. the help centre's "prices in your country" and tax articles;
6. each browser, in order: Edge (`read-page.cjs`, its real user agent, `en-CA`), a plain fetch (curl), then Mullvad
   Browser (`read-page-mullvad.cjs`, below);
7. the owner's own bill or account page, only when the owner offers it.

**Another country's pages** (a site that prices by where the visitor is, and shows this machine only Canada's): ask the
owner. Collect those countries over a batch and ask once, at its end, listing them; the owner says when they can be
read, or says skip. Never switch the owner's VPN yourself. A region skipped stays unread, with why, and a site's bot
check or block still means stop.

**A gap that stays** (a plan the provider doesn't sell somewhere, a region not read yet) is explained in the provider
file by a comment block of its own, which the report reads: it names the plan's id, or `<provider>.*` for every plan,
and each region's code:
```yaml
# Coverage: netflix.standard-ads isn't sold in NZ, IE or NL: each country's page lists no ads plan
# (help.netflix.com/en/node/24926/nz, read 2026-11-03).
```
A gap no note explains fails the report.

**Record the browser that read each page** in the header beside its date ("read 2026-11-03 with Mullvad Browser"):
Edge unless it says otherwise. The pipeline's page records name theirs (`browser`), and its drafts' header says it.

**Mullvad Browser** (`read-page-mullvad.cjs`): `node .claude/skills/price-research/read-page-mullvad.cjs <out dir> <url>
[step ...]`, with no deps: it speaks WebDriver BiDi to the browser's own debugging port on Node's WebSocket, headless,
with a throwaway profile it deletes after, never the owner's (whose uBlock Origin and history stay theirs). It's at
`%LOCALAPPDATA%\Mullvad\MullvadBrowser\Release\mullvadbrowser.exe` (`MULLVAD_BROWSER` to change it). Use it for pages
Edge can't reach and for policy pages; for a price, only once the page's currency is the region's.

## Reading a region (M10.12)

A region the catalog doesn't price a provider in yet, for a provider it has, goes through the discovery pipeline,
which reads each page as a visitor there would, before any hand reading:

1. `npm run data:urls -- <id> --region GB`: the pages the provider's prices cite are read first for their `hreflang`
   links and the links under the region's locale (`/en-gb/`, `/uk/`: core's `regionalPages`), then its common paths,
   sitemaps and links score the region's locale first (pricing only, unless `--kinds` says otherwise). Written to
   `.pipeline/<id>/regions/GB/`.
2. `npm run data:render -- <id> --region GB`: the page in the system Edge in the region's English and time zone. A page
   that went to another country's (`/en-us/` from `/en-gb/`) or shows only another currency's prices is kept as
   unread, never extracted: a site that prices by where the visitor is shows this machine Canada's. Read that one
   here only with the region's prices on screen (a country picker, or the computer's VPN if the owner wants).
3. `npm run data:extract -- <id> --region GB --prepare`, answer `extraction.md` in `answer.json` beside it, then
   `npm run data:extract -- <id> --region GB`: core's `regionalPrices` keeps only prices for the provider's plans, in
   the region's currency, each quoted on its page with its amount, and adds them to the provider file beside the
   others (the plan's price for that region and period replaced).
4. `npm run data:batch -- --region GB` does all of it for the catalog's providers and opens one pull request for the
   region (`--dry-run` stops before the branch): the prices with a link to each quote, and the providers left out with
   why. `EU` is the region for a provider that charges every euro country the same; otherwise each country's own.

## After writing the files

1. `npx prettier --write data/providers data/bundles`. For a new provider, `npm run data:icons` fetches its logo
   into `data/logos/<id>.png`: look at it before committing. Then `npm run data:validate` and `npm test`.
2. List the sources and everything unverified in the PR.

## Gotchas

- **A headless user agent can get another country's prices:** claude.com/pricing showed this machine the US prices
  ($20) when its user agent said `HeadlessChrome`, and Canada's ($28, a bare `$`) with the browser's own, which
  `read-page.cjs` and the pipeline's browser send. Its own pricing data, which the page loads
  (`claude.ai/api/billing/subscription_pricing`), names the country and currency (`"country":"CA","currency":"CAD"`):
  read it as part of the page, never call it yourself (the feedback after M10, 2026-10-30).
- **Some US sites block this machine (in Canada):** hbomax.com and plus.espn.com answer Access Denied, and
  nfl.com/plus redirects to DAZN's international NFL Game Pass. Their US prices can't be read here: report them,
  and read what their help centres show (support.espn.com does). help.hulu.com works.
- **Bot checks:** support.nfl.com and assistance.radio-canada.ca show a Cloudflare check the driver doesn't pass.
  Never try to get past one (another browser mode, other headers, another tool): use the provider's other official
  pages (ICI TOU.TV's subscription terms have its cancel steps, and its pages' footer says where it's sold), or
  report the page as unread.
- **Plan tabs** (TSN, RDS): Monthly, 3 Months, Annual and Bundles are tabs (`click:3 Months`); a plan missing
  from a tab isn't sold for that period. Their terms renew every period except in Quebec, monthly there: a note.
- **Google's plans** (Google AI, M11.15): each country's Gemini page (`gemini.google/<country>/subscriptions/?hl=<lang>`)
  shows that country's monthly prices to anyone. Google One's plans page (`one.google.com/about/plans`), the only one
  with Plus (2 TB) and the Annual tab (`click:Annual`, not a role="tab"), prices by where the visitor is, whatever its
  address says (`gl=US` still showed CA$): another country's prices there are another country's pages, so ask the
  owner. A page in the wrong country's currency doesn't count.
- **OpenAI's pages** (ChatGPT, M11.15): chatgpt.com, openai.com and help.openai.com answer a plain fetch (curl,
  WebFetch) with 403, and read in Edge with no bot check. The bot, which names itself in its user agent, meets a bot
  check on most of them, so they're in `data/automation.yaml`'s `archived` (the owner's choice of 2026-11-04): the bot
  and `data:baselines` read the Internet Archive's newest copy instead, for a change only, never as a source. chatgpt.com/pricing prices by where the visitor is, and its
  Pro card shows only the cheapest tier's local price ("From"); its comparison table's ticks are images (read the
  screenshot). Its help articles' links come from the page, not its text.
- **Amazon's pages** (Prime Video, M11.15): each store's Prime page (`amazon.<tld>/amazonprime`, Australia's and the
  Netherlands' `/prime`) shows its monthly and annual cards through that country's exit. primevideo.com/offers prices
  by where the visitor is: it prices Prime (or Prime Video alone, in New Zealand) only where there's no Amazon store,
  and elsewhere hands off to the store. The US's `amazon.com/gp/video/offers` answered with Amazon's "continue
  shopping" page, a bot check: never click past it. Help articles belong to one store: an amazon.com `nodeId` can be
  missing on amazon.ca ("We can't find the page"), so quote the store's own article.
- **discovery+'s pages** (M11.15): its European help centre uses the same article number in every country
  (`support.discoveryplus.com/<country>/Answer/Detail/000004067` is each one's plans and prices), and from Canada those
  pages and `discoveryplus.com/<country>` show North America's instead: read them through the country's exit and delete
  the baselines that saved the wrong page, as for HBO Max. Its terms for each country are listed on
  wbd.com/discoveryplus/legal/terms-of-use, Europe's as PDFs: read them with `pdftotext -enc UTF-8 -layout` (curly
  apostrophes and accents come through), check quotes against that text, and delete the empty baselines the baseline
  run saves for them. Canada's discovery+ is Rogers Sports & Media's (discoveryplus.ca), its own provider: its plan cards
  are on secure.discoveryplus.ca/pricing (a crossed-out line is one the plan lacks: read the screenshot), and its help
  centre (support.discoveryplus.ca) answers a plain fetch with 403 and reads in Edge.
- **ZEE5's plans** (M11.15): zee5.com/global/myaccount/subscription prices by where the visitor is, and the same card
  can have another device count in another country (All Access's 4, 3 or 2), so each country's cards are read through
  its exit and a plan's features checked there too. Each card shows its own periods only once clicked (`click:` its
  description, "Tamil Movies, Series, TV Shows, Live TV"); the pack names are images. Its help centre is India's.
- **iQIYI's order page** (M11.15, iq.com/vip/order): some countries' cards show only one plan's, behind Standard and
  Premium tabs (`nth:1:Standard`). Ireland and the Netherlands price in a bare "$", which the page's own data names
  (`"currencyUnit":"USD"`); read it as part of the page. Its help centre's answers and its Security Response Center's
  English (`#oversea`) are in the page but shown only when opened.
- **SkyShowtime's plans** (M11.15): skyshowtime.com/<country> and its help centre price by country: read each through
  its exit. The Netherlands' "6-maandendeal" and Spain's "6 meses" renew monthly, and Spain's "Mensual superahorro"
  plans commit you to 6 or 12 months at a lower monthly price: first-term offers, left out. Spain's help article lists
  yearly Estándar and Prémium prices its plan picker doesn't sell; the picker's periods count.
- **Viaplay's Dutch cards** (M11.15, viaplay.com/nl-nl, through a Dutch exit): a year is "Eenmalige betaling, 12
  maanden vast", one payment for 12 fixed months, stored as renewed by hand (`autoRenew: false`, the owner's choice), as
  YouTube's prepaid years are. The card doesn't say what follows; its terms continue a fixed term monthly, or for
  another term, as the offer says, and the plans' notes say so. Its help article "Informatie over onze pakketten" still
  lists a 12-month contract paid monthly that the cards no longer sell. Its account form
  (viaplay.com/checkout/register/<package>, after "Koop nu") loads without signing in; read its fields only.
- **Odysee's Premium** (M11.15): odysee.com/$/premium asks you to sign up first, so its help centre's Premium article
  (help.odysee.tv/premium) is the page that prices it, in a bare "$" (its terms count in "USD"). The help centre's
  sitemap.xml lists every article (account deletion, memberships, the payments chart).

- **Element-screenshot overlap:** sticky headers and skip links can overlap an element screenshot. Trust the
  full-page snap.
- **Tab names:** Proton's tab buttons have accessible names that don't match their text. `tab:` matches the
  visible text.
- **Cookie banners** can intercept clicks: start with `click?:Reject All` (or `click?:Accept All Cookies`).
- **Accordions** often close the others: open one question per `click:`.
- **Pages that price by where the visitor is** (youtube.com/premium, mubi.com/<country>/memberships, Google One):
  a country path or `gl=` changes the country a page names, not its prices. Read each region through its exit, and
  keep a page only in that region's currency: Google's pages placed New Zealand's exits in Australia, Ireland's in the
  UK and the Netherlands' nowhere (2026-11-04). Their baselines, read from Canada, show Canada's prices, so the bot
  sends the other regions' to a person.
- **"Every 30 days"** (MUBI's help centre): store `interval: day, intervalCount: 30` (and 360 for its yearly plan),
  with a renewalAnchor of `every-30-days`.
- **Help centres that turn Canada away** (HBO Max's sends a Canadian visitor to its geo-availability page): read
  them through a country's exit; YouTube TV's additional terms appear only in the US version of YouTube's Paid
  Service Terms, which `gl=US` doesn't change from Canada, so its ratings quote YouTube TV Help where it can.
- **robots.txt can disallow a terms page** (YouTube's `/t/terms`, which also covers `/t/terms_paidservice`): the
  baseline run skips it and the bot checks it by its facts alone; check its quotes against the saved page instead.
- **Image-only labels** don't appear in `innerText` (Crave's bundle cards): look at the `.png`.
- **Git Bash quirks:** `node -e` prints nothing in this Git Bash, so write a script file instead. Heredocs keep
  backslashes, but `sed` replacements mangle them.
- **WebFetch on JS pages** returns "the page appears to be empty". Switch to the driver rather than retrying.
