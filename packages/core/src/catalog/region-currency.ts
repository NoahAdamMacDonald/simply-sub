import { globalRegion } from './regions';

// The currency a region pays in (ISO 4217), for a default when the user hasn't picked one: GET /providers'
// `currency` (M2.3) and the first-run dialog (M4.2). Where several circulate, it's the one prices are usually
// shown in there (Panama: USD).

/** Each currency and the ISO 3166-1 regions that use it, most of them one region each. */
const regionsByCurrency: Readonly<Record<string, string>> = {
  AED: 'AE',
  AFN: 'AF',
  ALL: 'AL',
  AMD: 'AM',
  AOA: 'AO',
  ARS: 'AR',
  AUD: 'AU CC CX HM KI NF NR TV',
  AWG: 'AW',
  AZN: 'AZ',
  BAM: 'BA',
  BBD: 'BB',
  BDT: 'BD',
  BHD: 'BH',
  BIF: 'BI',
  BMD: 'BM',
  BND: 'BN',
  BOB: 'BO',
  BRL: 'BR',
  BSD: 'BS',
  BTN: 'BT',
  BWP: 'BW',
  BYN: 'BY',
  BZD: 'BZ',
  CAD: 'CA',
  CDF: 'CD',
  CHF: 'CH LI',
  CLP: 'CL',
  CNY: 'CN',
  COP: 'CO',
  CRC: 'CR',
  CUP: 'CU',
  CVE: 'CV',
  CZK: 'CZ',
  DJF: 'DJ',
  DKK: 'DK FO GL',
  DOP: 'DO',
  DZD: 'DZ',
  EGP: 'EG',
  ERN: 'ER',
  ETB: 'ET',
  // Bulgaria joined the euro on 1 January 2026, Croatia in 2023.
  EUR: 'AD AT AX BE BG BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA YT',
  FJD: 'FJ',
  FKP: 'FK',
  GBP: 'GB GG GS IM JE',
  GEL: 'GE',
  GHS: 'GH',
  GIP: 'GI',
  GMD: 'GM',
  GNF: 'GN',
  GTQ: 'GT',
  GYD: 'GY',
  HKD: 'HK',
  HNL: 'HN',
  HTG: 'HT',
  HUF: 'HU',
  IDR: 'ID',
  ILS: 'IL PS',
  INR: 'IN',
  IQD: 'IQ',
  IRR: 'IR',
  ISK: 'IS',
  JMD: 'JM',
  JOD: 'JO',
  JPY: 'JP',
  KES: 'KE',
  KGS: 'KG',
  KHR: 'KH',
  KMF: 'KM',
  KPW: 'KP',
  KRW: 'KR',
  KWD: 'KW',
  KYD: 'KY',
  KZT: 'KZ',
  LAK: 'LA',
  LBP: 'LB',
  LKR: 'LK',
  LRD: 'LR',
  LSL: 'LS',
  LYD: 'LY',
  MAD: 'EH MA',
  MDL: 'MD',
  MGA: 'MG',
  MKD: 'MK',
  MMK: 'MM',
  MNT: 'MN',
  MOP: 'MO',
  MRU: 'MR',
  MUR: 'MU',
  MVR: 'MV',
  MWK: 'MW',
  MXN: 'MX',
  MYR: 'MY',
  MZN: 'MZ',
  NAD: 'NA',
  NGN: 'NG',
  NIO: 'NI',
  NOK: 'BV NO SJ',
  NPR: 'NP',
  NZD: 'CK NU NZ PN TK',
  OMR: 'OM',
  PEN: 'PE',
  PGK: 'PG',
  PHP: 'PH',
  PKR: 'PK',
  PLN: 'PL',
  PYG: 'PY',
  QAR: 'QA',
  RON: 'RO',
  RSD: 'RS',
  RUB: 'RU',
  RWF: 'RW',
  SAR: 'SA',
  SBD: 'SB',
  SCR: 'SC',
  SDG: 'SD',
  SEK: 'SE',
  SGD: 'SG',
  SHP: 'SH',
  SLE: 'SL',
  SOS: 'SO',
  SRD: 'SR',
  SSP: 'SS',
  STN: 'ST',
  SYP: 'SY',
  SZL: 'SZ',
  THB: 'TH',
  TJS: 'TJ',
  TMT: 'TM',
  TND: 'TN',
  TOP: 'TO',
  TRY: 'TR',
  TTD: 'TT',
  TWD: 'TW',
  TZS: 'TZ',
  UAH: 'UA',
  UGX: 'UG',
  // Antarctica has no currency of its own.
  USD: 'AQ AS BQ EC FM GU IO MH MP PA PR PW SV TC TL UM US VG VI',
  UYU: 'UY',
  UZS: 'UZ',
  VES: 'VE',
  VND: 'VN',
  VUV: 'VU',
  WST: 'WS',
  XAF: 'CF CG CM GA GQ TD',
  // The Caribbean guilder replaced the Netherlands Antillean guilder in 2025.
  XCG: 'CW SX',
  XCD: 'AG AI DM GD KN LC MS VC',
  XOF: 'BF BJ CI GW ML NE SN TG',
  XPF: 'NC PF WF',
  YER: 'YE',
  ZAR: 'ZA',
  ZMW: 'ZM',
  ZWG: 'ZW',
};

const currencyOfRegion: ReadonlyMap<string, string> = new Map(
  Object.entries(regionsByCurrency).flatMap(([currency, regions]) =>
    regions.split(' ').map((region): [string, string] => [region, currency]),
  ),
);

/** A group's currency (regions.ts), and GLOBAL's: US dollars, the currency most prices are listed in. */
const otherRegions: Readonly<Record<string, string>> = { [globalRegion]: 'USD', EU: 'EUR' };

/**
 * The currency `region` pays in: an ISO 3166-1 region's own, a group's (EU: EUR) or GLOBAL's (USD). Undefined for a
 * code that isn't a catalog region.
 */
export function regionCurrency(region: string): string | undefined {
  return Object.hasOwn(otherRegions, region) ? otherRegions[region] : currencyOfRegion.get(region);
}

/** The currency to show `region`'s prices in when none is given: its own when there are rates for it, else USD. */
export function defaultCurrency(region: string, currencies?: readonly string[]): string {
  const own = regionCurrency(region);
  return own !== undefined && (!currencies || currencies.includes(own)) ? own : 'USD';
}

/**
 * The currencies the ECB publishes reference rates for, the euro included: the ones a price can be converted into,
 * so the ones Settings offers before the app has fetched rates (ecbCurrencies gives the live list). Checked against
 * GET /fx on 2026-10-26; the Bulgarian lev left when Bulgaria joined the euro in 2026.
 */
export const displayCurrencies: readonly string[] = [
  'AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK',
  'JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR',
].flatMap((row) => row.split(' '));
