import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// Sync's code as words (PROJECT-PLAN M10.7, M10.9): its 32 bytes as BIP39's 24 English words, the last carrying a
// checksum, so a mistyped word is caught. Only the dialogs that show or take the code load this, with its word list.

/** The code's 24 words. */
export function syncWords(seed: Uint8Array): string[] {
  return entropyToMnemonic(seed, wordlist).split(' ');
}

/** The code the words give, or undefined when one isn't a BIP39 word or the checksum fails (a word mistyped). */
export function seedFromWords(words: readonly string[]): Uint8Array<ArrayBuffer> | undefined {
  const typed = words.map((word) => word.trim().toLowerCase());
  if (typed.length !== 24) return undefined;
  try {
    return new Uint8Array(mnemonicToEntropy(typed.join(' '), wordlist));
  } catch {
    return undefined;
  }
}

/** The one BIP39 word that starts with `typed`: four letters always tell, and fewer can. */
export function completeWord(typed: string): string | undefined {
  const start = typed.trim().toLowerCase();
  if (start === '') return undefined;
  const matches = wordlist.filter((word) => word.startsWith(start));
  return matches.length === 1 ? matches[0] : matches.find((word) => word === start);
}

/** Whether `word` is one of BIP39's English words. */
export function isCodeWord(word: string): boolean {
  return wordlist.includes(word.trim().toLowerCase());
}
