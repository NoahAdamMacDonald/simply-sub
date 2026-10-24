// The region codes a price, billingCurrency or availableIn can use (BLUEPRINT §4.7): ISO 3166-1 alpha-2 codes,
// groups of them (EU), and GLOBAL for one price wherever a provider sells. regionSchema (formats.ts) only checks
// the shape; validateCatalog checks a code is one of these.

/** One price wherever the provider sells. */
export const globalRegion = 'GLOBAL';

/** The 249 officially assigned ISO 3166-1 alpha-2 codes. The United Kingdom is GB, not UK. */
export const isoRegions: ReadonlySet<string> = new Set(
  [
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ',
    'BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ',
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ',
    'DE DJ DK DM DO DZ',
    'EC EE EG EH ER ES ET',
    'FI FJ FK FM FO FR',
    'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY',
    'HK HM HN HR HT HU',
    'ID IE IL IM IN IO IQ IR IS IT',
    'JE JM JO JP',
    'KE KG KH KI KM KN KP KR KW KY KZ',
    'LA LB LC LI LK LR LS LT LU LV LY',
    'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ',
    'NA NC NE NF NG NI NL NO NP NR NU NZ',
    'OM',
    'PA PE PF PG PH PK PL PM PN PR PS PT PW PY',
    'QA',
    'RE RO RS RU RW',
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ',
    'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ',
    'UA UG UM US UY UZ',
    'VA VC VE VG VI VN VU',
    'WF WS',
    'YE YT',
    'ZA ZM ZW',
  ].flatMap((letter) => letter.split(' ')),
);

/**
 * Regions that one price can cover: a price for the group applies in each member. A provider that prices "the EU"
 * once charges a Swede that price, so pickPrice and availability try the user's group right after their region.
 */
export const regionGroups: Readonly<Record<string, readonly string[]>> = {
  // The 27 member states. Greece is GR in ISO 3166 (the EU itself writes EL).
  EU: 'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' '),
};

/** The groups `region` belongs to (DE → EU), in the order to try them. */
export function groupsOf(region: string): string[] {
  return Object.keys(regionGroups).filter((group) => regionGroups[group].includes(region));
}

/** A group's members (EU → AT, BE, …), or none for a region that isn't a group. */
export function membersOf(region: string): readonly string[] {
  return Object.hasOwn(regionGroups, region) ? regionGroups[region] : [];
}

/** Whether a catalog file can use `code` as a region: an ISO code, a group or GLOBAL. */
export function isCatalogRegion(code: string): boolean {
  return code === globalRegion || Object.hasOwn(regionGroups, code) || isoRegions.has(code);
}

/** Why `code` isn't a region, with the fix: the message validateCatalog reports. */
export function regionProblem(code: string): string {
  return code === 'UK'
    ? '"UK" isn\'t an ISO 3166-1 region code: use GB for the United Kingdom'
    : `"${code}" isn't an ISO 3166-1 alpha-2 region code (CA, US, GB), a group (${Object.keys(regionGroups).join(', ')}) or GLOBAL`;
}
