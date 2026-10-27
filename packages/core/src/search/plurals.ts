/**
 * A term, and its singular when its last word has four letters or more and looks plural: vpns → vpn, boxes → box,
 * categories → category. Words in -ss, -us and -is aren't plurals (pass, plus, analysis). Search's terms
 * (searchProviders) and the Features box (featureSuggestions) read plurals alike.
 */
export function termForms(term: string): string[] {
  const word = term.slice(term.lastIndexOf(' ') + 1);
  if (word.length < 4 || !word.endsWith('s') || /(?:ss|us|is)$/.test(word)) {
    return [term];
  }
  return [
    term,
    term.slice(0, -1),
    ...(/(?:[sxz]|[cs]h)es$/.test(word) ? [term.slice(0, -2)] : []),
    ...(word.endsWith('ies') ? [`${term.slice(0, -3)}y`] : []),
  ];
}
