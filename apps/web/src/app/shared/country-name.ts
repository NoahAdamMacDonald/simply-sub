// Country names in English, like the rest of the app's text.

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });

/** A country's name (CA → Canada). */
export function countryName(code: string): string {
  return regionNames.of(code) ?? code;
}
