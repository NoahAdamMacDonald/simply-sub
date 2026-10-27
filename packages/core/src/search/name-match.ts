import { termForms } from './plurals';

/**
 * A test of names against typed text, as Search's Features box and the Features page find a feature: a name matches
 * when a word in it starts with the text, ignoring case, accents and punctuation ("ad" isn't "download"), and a plural
 * also matches its singular ("vpns" finds VPN). Undefined for text with no words in it, which every name matches.
 */
export function nameMatcher(text: string): ((names: readonly string[]) => boolean) | undefined {
  const typed = words(text);
  if (typed === '') return undefined;
  const forms = termForms(typed);
  return (names) =>
    names.some((name) => {
      const spaced = ` ${words(name)}`;
      return forms.some((form) => spaced.includes(` ${form}`));
    });
}

/** Lower case words without accents or punctuation: "4K (Ultra HD)" is "4k ultra hd", "Ad-free" is "ad free". */
function words(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
