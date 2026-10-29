import { newSyncSeed } from './sync-crypto';
import { completeWord, isCodeWord, seedFromWords, syncWords } from './sync-code';

// Sync's code as words (M10.7): the words round-trip and a changed word fails its checksum (BIP39's own test vectors),
// and four letters complete a word.

const zeros = new Uint8Array(32);

describe('the sync code', () => {
  it('shows a code as BIP39’s 24 words', () => {
    expect(syncWords(zeros)).toEqual([...Array<string>(23).fill('abandon'), 'art']);
    expect(syncWords(new Uint8Array(32).fill(0x7f)).join(' ')).toBe(
      'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal ' +
        'winner thank year wave sausage worth title',
    );
  });

  it('reads the words back to the code, whatever their case and spacing', () => {
    const seed = newSyncSeed();
    const words = syncWords(seed);
    expect(words).toHaveLength(24);
    expect(seedFromWords(words)).toEqual(seed);
    expect(seedFromWords(words.map((word) => ` ${word.toUpperCase()} `))).toEqual(seed);
  });

  it('refuses a changed word, which fails the checksum, a word that isn’t BIP39’s, or too few', () => {
    const words = syncWords(zeros);
    expect(seedFromWords([...words.slice(0, 23), 'zoo'])).toBeUndefined();
    expect(seedFromWords([...words.slice(0, 23), 'simplysub'])).toBeUndefined();
    expect(seedFromWords(words.slice(0, 12))).toBeUndefined();
  });

  it('completes a word from its first letters once they tell it', () => {
    expect(completeWord('aban')).toBe('abandon');
    expect(completeWord('ART')).toBe('art');
    expect(completeWord('ab')).toBeUndefined();
    expect(completeWord('zz')).toBeUndefined();
  });
});

describe('isCodeWord', () => {
  it('knows BIP39’s words, whatever their case', () => {
    expect(isCodeWord('Abandon')).toBe(true);
    expect(isCodeWord('aban')).toBe(false);
  });
});
