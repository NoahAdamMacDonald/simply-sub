import type { CurrenciesEntry, Provider, RenewalAnchor, RenewalAnchorKind } from './provider';
import { globalRegion, groupsOf } from './regions';

// A provider's facts beside its ways to pay (M11.5, the guide's §3.1): the day it renews on, the currencies it takes
// beyond its price lists, and where its source code is. Their names on the card, how a provider's page writes them, so
// validation can check that the quotes say what the entry does, and the ones that apply to a buyer in a region. This
// file imports no Zod, so the card and the item dialog can use it without loading the schemas.

/** The days a provider renews on, in the order the card and the guide list them. */
export const renewalAnchorKinds = [
  'same-date',
  'every-30-days',
  'first-of-month',
  'end-of-month',
] as const;

/** Each kind as the card says it, after "Billing day". */
export const renewalAnchorNames: Readonly<Record<RenewalAnchorKind, string>> = {
  'same-date': 'The date you signed up',
  'every-30-days': 'Every 30 days',
  'first-of-month': 'The 1st of each month',
  'end-of-month': 'The last day of each month',
};

/**
 * How a page writes each kind, in English and French. The date you signed up is also written by what it implies (M11.9):
 * a subscription that "began on a date not contained in a given month" (Disney's and Bell Media's terms, and their
 * French) is billed on the same date each month but in shorter months, and you "subscribe on your preferred billing
 * date" when the day you subscribe sets it (Claude's billing help).
 */
const renewalWrittenAs: Readonly<Record<RenewalAnchorKind, RegExp>> = {
  'same-date':
    /\b(?:date|day) (?:that |when )?you (?:sign(?:ed)? up|subscribed?|joined|purchased|started|bought)\b|\bsame (?:day|date)\b|\banniversary\b|\bmême (?:jour|date)\b|\bdate (?:de|d['’]) ?(?:votre )?(?:abonnement|inscription|achat)\b|\bbegan on a (?:day|date) not contained in a given month\b|\bcommencé à une date non comprise dans un mois donné|\b(?:re)?subscribe on your preferred billing date\b|\bthis charge will become your monthly billing date\b|\bpurchased\b[^.]{0,60}\bon the (\d{1,2})(?:st|nd|rd|th)\b[^.]{0,80}\bbilled on the \1(?:st|nd|rd|th) of each month\b/i,
  'every-30-days': /\b(?:30|thirty)[- ]days?\b|\b30 jours\b/i,
  'first-of-month':
    /\b(?:1st|first(?: day)?) of (?:each|every|the|the following|the next) (?:calendar )?month\b|\bpremier (?:jour )?(?:de|du) (?:chaque )?mois\b|\b1er (?:de|du) (?:chaque )?mois\b/i,
  'end-of-month':
    /\b(?:last day|end) of (?:each|every|the) (?:calendar )?month\b|\bdernier jour (?:de|du) (?:chaque )?mois\b|\bfin (?:de|du) (?:chaque )?mois\b/i,
};

/** Whether `text` says a provider renews on the days `kind` names. */
export function namesRenewalAnchor(text: string, kind: RenewalAnchorKind): boolean {
  return renewalWrittenAs[kind].test(text);
}

/** The kind of day a provider renews on, when its pages say: undefined when they don't, or it isn't known yet. */
export function renewalAnchorKind(
  provider: Pick<Provider, 'renewalAnchor'> | undefined,
): RenewalAnchorKind | undefined {
  const anchor = provider?.renewalAnchor;
  return anchor && anchor.kind !== 'not-stated' ? anchor.kind : undefined;
}

/** A renewal anchor its pages state: one with its page and quotes. */
export type StatedRenewalAnchor = Exclude<RenewalAnchor, { kind: 'not-stated' }>;

/**
 * How a page writes a currency besides its ISO code: names in English and French, and signs only it uses. "$" and
 * "kr" alone name no one currency, so they're not here.
 */
const currencyWrittenAs: Readonly<Record<string, RegExp>> = {
  AUD: /\bA\$|\bAU\$|\bAustralian dollars?\b|\bdollars? australiens?\b/i,
  BRL: /\bR\$|\bBrazilian reals?\b/i,
  CAD: /\bCA\$|\bC\$|\bCanadian dollars?\b|\bdollars? canadiens?\b/i,
  CHF: /\bSwiss francs?\b|\bfrancs? suisses?\b/i,
  DKK: /\bDanish kron(?:e|er)\b|\bcouronnes? danoises?\b/i,
  EUR: /€|\beuros?\b/i,
  GBP: /£|\bpounds? sterling\b|\bBritish pounds?\b|\blivres? sterling\b/i,
  INR: /₹|\bIndian rupees?\b/i,
  JPY: /\bJapanese yen\b|\byens? japonais\b/i,
  MXN: /\bMX\$|\bMexican pesos?\b|\bpesos? mexicains?\b/i,
  NOK: /\bNorwegian kron(?:e|er)\b|\bcouronnes? norvégiennes?\b/i,
  NZD: /\bNZ\$|\bNew Zealand dollars?\b|\bdollars? néo-zélandais\b/i,
  PLN: /\bzł|\bPolish zloty\b/i,
  SEK: /\bSwedish kron(?:a|or)\b|\bcouronnes? suédoises?\b/i,
  USD: /\bUS\$|\bU\.?S\.? dollars?\b|\bdollars? américains?\b/i,
};

/** Whether `text` names `code`: the code itself, or a name or sign only that currency has. */
export function namesCurrency(text: string, code: string): boolean {
  return new RegExp(`\\b${code}\\b`).test(text) || (currencyWrittenAs[code]?.test(text) ?? false);
}

/**
 * The currencies a buyer in `region` can pay `provider` in beyond its price lists: every entry for the region, a group
 * it belongs to (EU), or everywhere (no `regions`, or GLOBAL), in the file's order.
 */
export function currenciesIn(
  provider: Pick<Provider, 'currencies'>,
  region: string,
): CurrenciesEntry[] {
  const places = new Set([region, ...groupsOf(region), globalRegion]);
  return (provider.currencies ?? []).filter(
    (entry) => !entry.regions || entry.regions.some((where) => places.has(where)),
  );
}

/**
 * How a page writes where a company is (owner.country, the owner's choice of 2026-11-03), beyond the country's English
 * and French names: its short forms and its people's ("Swiss", "Canada’s"), and the states and provinces an address
 * names instead of the country ("Bristol, Connecticut", "Toronto, Ontario"). American Express isn't American.
 */
const countryWrittenAs: Readonly<Record<string, string>> = {
  US: [
    'U\\.S\\.(?:A\\.)?',
    'USA',
    'United States of America',
    'American(?! Express)',
    'Américaine?s?',
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Californie',
    'Colorado',
    'Connecticut',
    'Delaware',
    'District of Columbia',
    'Florida',
    'Floride',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'New Hampshire',
    'New Jersey',
    'New Mexico',
    'New York',
    'North Carolina',
    'North Dakota',
    'Ohio',
    'Oklahoma',
    'Oregon',
    'Pennsylvania',
    'Rhode Island',
    'South Carolina',
    'South Dakota',
    'Tennessee',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'West Virginia',
    'Wisconsin',
    'Wyoming',
  ].join('|'),
  CA: [
    'Canadian',
    'Canadiens?',
    'Canadiennes?',
    'Alberta',
    'British Columbia',
    'Colombie-Britannique',
    'Manitoba',
    'New Brunswick',
    'Nouveau-Brunswick',
    'Newfoundland and Labrador',
    'Terre-Neuve-et-Labrador',
    'Nova Scotia',
    'Nouvelle-Écosse',
    'Ontario',
    'Prince Edward Island',
    'Île-du-Prince-Édouard',
    'Qu[ée]bec',
    'Saskatchewan',
    'Northwest Territories',
    'Territoires du Nord-Ouest',
    'Nunavut',
    'Yukon',
  ].join('|'),
  CH: 'Swiss|Suisses?',
  SE: 'Swedish|Suédois(?:es?)?',
  RO: 'Romanian|Roumaine?s?',
  GB: 'UK|U\\.K\\.|British|Britannique',
};

/** A country's names in English and French (ICU's), escaped for a pattern; none where the runtime has no ICU names. */
function countryNames(code: string): string[] {
  return ['en', 'fr'].flatMap((locale) => {
    try {
      const name = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(code);
      return name ? [name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Whether `text` names `code` (an ISO 3166-1 country) as where a company is: its name in English or French, a short
 * form or its people's, or one of its states or provinces. Not its code alone: "CA" is California's too.
 */
export function namesCountry(text: string, code: string): boolean {
  const names = [...countryNames(code), countryWrittenAs[code]].filter(Boolean).join('|');
  return (
    names.length > 0 &&
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${names})(?![\\p{L}\\p{N}])`, 'iu').test(text)
  );
}

/** A repository's address as the card shows it: its host and path, with no https:// or trailing slash. */
export function repositoryLabel(url: string): string {
  return url.replace(/^https:\/\//, '').replace(/\/+$/, '');
}
