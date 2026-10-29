import {
  SealedCopyError,
  completeWord,
  newSyncSeed,
  openCopy,
  sealCopy,
  seedFromWords,
  syncKeys,
  syncWords,
} from './sync-crypto';

// Sync's code and keys (M10.7): the words round-trip and a changed word fails its checksum (BIP39's own test vectors);
// a known code gives a known chain id and auth secret (worked out with Node's HKDF); a copy opens with its chain's key
// only, and a changed byte opens nothing.

const zeros = new Uint8Array(32);
const counting = Uint8Array.from({ length: 32 }, (_, index) => index);

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

describe('the sync keys', () => {
  it('derive the chain’s id and auth secret from its code, as HKDF-SHA256 does', async () => {
    expect(await syncKeys(counting)).toMatchObject({
      chainId: '7RzuOE455uZWapOAE8ToYw',
      authSecret: 'eB-fvhcPV5EjET-L_3Eq09laqjt3_jCD0EV2QhRDeDg',
    });
    expect(await syncKeys(zeros)).toMatchObject({
      chainId: 'VMybxgkJf0FdnTPfK-l9Jw',
      authSecret: '1UY944t8mExVJ2nQTtvaR47oE09v5bxwfAIf0ccTvIE',
    });
  });

  it('keep the copy’s key unreadable', async () => {
    const { key } = await syncKeys(counting);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });
});

describe('a sealed copy', () => {
  const copy = { schemaVersion: 3, data: { lists: [{ name: 'Work Related' }] } };

  it('opens with its chain’s keys, and its bytes don’t show what it holds', async () => {
    const keys = await syncKeys(counting);
    const sealed = await sealCopy(keys, copy);
    expect(new TextDecoder().decode(sealed)).not.toContain('Work Related');
    expect(await openCopy(keys, sealed)).toEqual(copy);
  });

  it('opens nothing with another chain’s keys, a changed byte, or bytes that aren’t a copy', async () => {
    const keys = await syncKeys(counting);
    const sealed = await sealCopy(keys, copy);
    await expect(openCopy(await syncKeys(zeros), sealed)).rejects.toBeInstanceOf(SealedCopyError);
    const changed = sealed.slice();
    changed[changed.length - 1] ^= 1;
    await expect(openCopy(keys, changed)).rejects.toBeInstanceOf(SealedCopyError);
    await expect(openCopy(keys, new Uint8Array(8))).rejects.toBeInstanceOf(SealedCopyError);
  });

  it('is bound to its chain: the same key under another chain’s id opens nothing', async () => {
    const keys = await syncKeys(counting);
    const sealed = await sealCopy(keys, copy);
    await expect(
      openCopy({ ...keys, chainId: 'VMybxgkJf0FdnTPfK-l9Jw' }, sealed),
    ).rejects.toBeInstanceOf(SealedCopyError);
  });
});
