---
name: price-research
description: Read a subscription provider's real plans, prices, add-ons, bundles and official resellers from its official site, and its terms of service and privacy policy, for the catalog (data/providers/*.yaml, data/bundles/*.yaml), including JavaScript pages, country and language pickers, currency menus, annual-vs-monthly toggles, bundles sold on partner pages and prepaid services. Use when adding a provider, adding a region, or re-verifying prices.
---

# Price research (official sites, system Edge)

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
- **Links are required.** Every plan and bundle needs its sign-up `link` on the provider's own site, and every
  provider a `cancelUrl`: its cancel page, or its help article on cancelling (Disney+'s help centre has one for
  every country), or for a prepaid service with nothing to cancel, its page on getting unused time back
  (Mullvad's refunds guide). Say in a comment where it came from.
- **Every interval and every price list the provider sells.** That means monthly and yearly (other periods only when the user
  asks), every region in scope (ask: usually CA and US, or GLOBAL), and every currency the buyer can pick.
- **Read the features from the same pages:** quality, streams, downloads, devices, users, storage and limits. Map them
  to `data/features.yaml` ids; anything else goes in `perks`. If the registry needs a new feature, stop and ask, then follow the feature-discovery skill.
- **Every time, for every provider, check three more things** (M1.12), even when only re-verifying prices, and say
  in the provider file's header comment what each turned up ("none" counts):
  - **Bundles:** the subscribe and pricing pages (page through carousels), the help centre's bundle articles, the
    partners' landing pages, and a search for "<provider> bundle". Each one the provider or a partner sells.
  - **Official resellers:** the provider's own "resellers", "partners", "where to buy", "retail" and "gift cards"
    pages. Only shops it names as selling its subscription count (BLUEPRINT §4.9). App stores, phone and TV
    providers that bill its plans or bundle them into their own packages are partners: note them, don't list them.
  - **Terms of service, privacy policy and the other policies** (refunds, cookies, household or sharing rules): they
    hold what pricing pages leave out, such as where it's sold (`availableIn`), the billing period and auto-renewal,
    refunds, notice of price changes, limits on streams, devices and downloads, bundles and partner billing. Use
    them for those fields, and list the pages read in the provider file's header comment.
- **Report what you couldn't verify**, each with the reason (geo-blocked, not stated, conflicting).

## Which tool

| Tool | Use it for | Watch out |
|---|---|---|
| WebFetch | Static pages (help articles, FAQs) | It fetches from this machine, so geo-located pages show **Canada**. Its summary can misread tables, so confirm the numbers in Edge when they matter. JS-rendered pages come back empty. |
| `read-page.cjs` (Edge) | JS pages, tabs, currency menus, country pickers, accordions, carousels, image-only labels (screenshots) | Needs the deps below. Look at the screenshots when text is missing. |
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
`click?:` (optional, for cookie banners), `tab:`, `select:<aria-label>=<value>`, `country:` (Disney+ help
centre), `goto:`, `wait:` and `snap:<name>`, which saves `<name>.txt` (visible text) and `<name>.png` (full page).
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
| **Language/country picker** (Disney+) | `disneyplus.com` and the help centre redirect by IP. Open `help.disneyplus.com/article/disneyplus-price?redirect=false`, then `click?:Reject All` and `country:United States (English)`. Check each language too (US English and Español, Canada English and Français): prices follow the country, not the language. | Plans can differ by country. A plan sold in one country only has prices there, and the app hides it in the other countries the provider is priced in. If the same name means different features (US With Ads is 4K, Canada's Standard With Ads is 1080p), make separate plans (`disney-plus.with-ads`, US only). Say in a file comment where the other country's prices come from. |
| **Buyer picks the currency** (Proton: USD, CAD, EUR, CHF) | Use the currency `<select>` (`select:Change currency=CAD`), and check every product tab and both Monthly and Yearly. The Yearly view shows the monthly price struck through, a lower per-month rate and "Billed at X every 12 months": store X as the yearly price and the struck price as the monthly one. Family and Duo plans can sit on another page (`proton.me/family`). | A `GLOBAL` price in each currency. BLUEPRINT §4.7 shows a price in the user's own currency as native. `billingCurrency: { GLOBAL: USD }` covers everyone else. A free plan keeps one `$0` price. |
| **Prepaid time** (Mullvad) | A flat €5/month for any period. The card checkout offers about 20 currencies at a converted "≈" amount, which isn't a fixed price. Crypto is 10% off, and there are no subscriptions. | `autoRenew: false`, every period it sells (1, 2, 3 and 6 months and a year) in the one fixed currency (`GLOBAL EUR`). The local-currency payment options and discounts go in `notes`. BLUEPRINT §14 has the open question on FX fees for this. |
| **Resellers** (Mullvad's vouchers on Amazon, at Inet, Webhallen, ProxyStore, SerialCart, Laptop with Linux) | Start from the provider's own reseller page (`mullvad.net/en/help/partnerships-and-resellers`). Take only the shops it names as selling the provider's subscription; its partners that run their own product on the provider's service (Mozilla VPN) aren't resellers. Read each shop's own product page. Amazon shows Mullvad's price on amazon.ca only: its other 12 stores show it only in the basket ("To see the product details, add this item to your basket"), so they're left out. A shop whose price with VAT follows the buyer's country gives its price excluding VAT (Laptop with Linux). WooCommerce shops keep each period's regular and sale price in the variation data of `form.variations_form`. A page behind a bot check is left out and reported. | One `reseller` in `data/resellers.yaml` (add a shop's other domains to `domains`), and a `resellers` listing in the provider file: `approvedBy` with the provider page's words naming it, word for word (`Amazon - CA`), and one offer per plan with the regular prices, each `sourceUrl` the shop's page for it. Never a sale price. "excl. VAT" is `taxExcluded: { quote }`; a price that's the same wherever the buyer lives is `taxIncluded`. Then `npm run data:icons` for its logo (BLUEPRINT §4.9). |
| **Bundles on the seller's or partner's pages** (Crave × Disney+) | The bundle can be on the provider's subscribe page (a carousel: page through it), on a partner landing page (`crave.ca/en/disneypluscravebundle`, where the card labels are images, so read the screenshot), on the other partner's help centre, and in an FAQ listing every bundle (`plus.crave.ca/en/faq/...`). Check them all before deciding who sells it. | A bundle file only when its features are exactly the sum of its plans. `soldBy` is the provider whose own site sells it. Every included plan must exist in the catalog. Bundles with services not in the catalog wait until they are. |
| **Add-ons priced by a third party** (STARZ on Crave) | "Starting at $7.99" on the seller's page isn't enough. Find the add-on's own page (`starz.ca` FAQ: `click:How much does STARZ cost?`, one question at a time, because the accordion closes the others). Check which plans allow it. | An add-on with no `grantsPlan` when it doesn't grant a plan, listed in the `addOnIds` of the plans that allow it. |
| **Extra members** (Netflix, Disney+) | The price usually depends on the account holder's plan. Read the limit from the help article ("can have one Extra Member"). | One add-on per price and plan, with `grantsPlan` set to the plan whose features the member gets, and `addOnLimit`. |
| **Suites** (Proton Unlimited, Duo, Family) | Read their own limits (storage, addresses, users). Don't add up the parts. | Normal plans with their own features, `includes-subscription` and `account.users` (BLUEPRINT §4.4). |

## After writing the files

1. `npx prettier --write data/providers data/bundles`. For a new provider, `npm run data:icons` fetches its logo
   into `data/logos/<id>.png`: look at it before committing. Then `npm run data:validate` and `npm test`.
2. List the sources and everything unverified in the PR.

## Gotchas

- **Some US sites block this machine (in Canada):** hbomax.com and plus.espn.com answer Access Denied, and
  nfl.com/plus redirects to DAZN's international NFL Game Pass. Their US prices can't be read here: report them,
  and read what their help centres show (support.espn.com does). help.hulu.com works.
- **Bot checks:** support.nfl.com and assistance.radio-canada.ca show a Cloudflare check the driver doesn't pass.
  Never try to get past one (another browser mode, other headers, another tool): use the provider's other official
  pages (ICI TOU.TV's subscription terms have its cancel steps, and its pages' footer says where it's sold), or
  report the page as unread.
- **Plan tabs** (TSN, RDS): Monthly, 3 Months, Annual and Bundles are tabs (`click:3 Months`); a plan missing
  from a tab isn't sold for that period. Their terms renew every period except in Quebec, monthly there: a note.

- **Element-screenshot overlap:** sticky headers and skip links can overlap an element screenshot. Trust the
  full-page snap.
- **Tab names:** Proton's tab buttons have accessible names that don't match their text. `tab:` matches the
  visible text.
- **Cookie banners** can intercept clicks: start with `click?:Reject All` (or `click?:Accept All Cookies`).
- **Accordions** often close the others: open one question per `click:`.
- **Image-only labels** don't appear in `innerText` (Crave's bundle cards): look at the `.png`.
- **Git Bash quirks:** `node -e` prints nothing in this Git Bash, so write a script file instead. Heredocs keep
  backslashes, but `sed` replacements mangle them.
- **WebFetch on JS pages** returns "the page appears to be empty". Switch to the driver rather than retrying.
