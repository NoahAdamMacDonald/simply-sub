// The provinces and states that the Settings menus list (BLUEPRINT §4.8): ISO 3166-2 codes with their English names,
// only for the countries where sales tax is added, since the menu exists only there. Intl has no names for them.
// The US list is the 50 states and DC: Puerto Rico, Guam and the other territories have ISO 3166-1 codes of their own,
// so they're countries in the app.

/** A province, territory or state. */
export interface Subdivision {
  /** ISO 3166-2 (CA-ON). */
  code: string;
  name: string;
}

/** Each country's subdivisions in name order, as `XX Name` rows. */
const subdivisionRows: Readonly<Record<string, readonly string[]>> = {
  CA: [
    'AB Alberta',
    'BC British Columbia',
    'MB Manitoba',
    'NB New Brunswick',
    'NL Newfoundland and Labrador',
    'NT Northwest Territories',
    'NS Nova Scotia',
    'NU Nunavut',
    'ON Ontario',
    'PE Prince Edward Island',
    'QC Quebec',
    'SK Saskatchewan',
    'YT Yukon',
  ],
  US: [
    'AL Alabama',
    'AK Alaska',
    'AZ Arizona',
    'AR Arkansas',
    'CA California',
    'CO Colorado',
    'CT Connecticut',
    'DE Delaware',
    'DC District of Columbia',
    'FL Florida',
    'GA Georgia',
    'HI Hawaii',
    'ID Idaho',
    'IL Illinois',
    'IN Indiana',
    'IA Iowa',
    'KS Kansas',
    'KY Kentucky',
    'LA Louisiana',
    'ME Maine',
    'MD Maryland',
    'MA Massachusetts',
    'MI Michigan',
    'MN Minnesota',
    'MS Mississippi',
    'MO Missouri',
    'MT Montana',
    'NE Nebraska',
    'NV Nevada',
    'NH New Hampshire',
    'NJ New Jersey',
    'NM New Mexico',
    'NY New York',
    'NC North Carolina',
    'ND North Dakota',
    'OH Ohio',
    'OK Oklahoma',
    'OR Oregon',
    'PA Pennsylvania',
    'RI Rhode Island',
    'SC South Carolina',
    'SD South Dakota',
    'TN Tennessee',
    'TX Texas',
    'UT Utah',
    'VT Vermont',
    'VA Virginia',
    'WA Washington',
    'WV West Virginia',
    'WI Wisconsin',
    'WY Wyoming',
  ],
};

const subdivisionLists: ReadonlyMap<string, readonly Subdivision[]> = new Map(
  Object.entries(subdivisionRows).map(([country, rows]) => [
    country,
    rows.map((row) => ({ code: `${country}-${row.slice(0, 2)}`, name: row.slice(3) })),
  ]),
);

/** `country`'s provinces or states in name order, or none where the app has no list (outside CA and US). */
export function subdivisionsOf(country: string): readonly Subdivision[] {
  return subdivisionLists.get(country) ?? [];
}

/** A subdivision's name (CA-ON → Ontario), or undefined for a code the lists don't have. */
export function subdivisionName(code: string): string | undefined {
  return subdivisionsOf(code.slice(0, 2)).find((subdivision) => subdivision.code === code)?.name;
}
