import {
  WrongPassphraseError,
  decryptText,
  deriveKey,
  encryptText,
  fromBase64,
  kdfIterations,
  newSalt,
  openText,
  sealText,
  toBase64,
} from './passphrase-crypto';

// The crypto module (BLUEPRINT §11.5), with few iterations: 600,000 takes about half a second a key.

const fast = { iterations: 1_000 };

describe('passphrase crypto', () => {
  it('opens what it encrypted, with the same passphrase and what it was bound to', async () => {
    const envelope = await encryptText('{"lists":[]}', 'correct horse', 'simply-sub:1', fast);
    expect(envelope).toMatchObject({ kdf: 'PBKDF2-SHA256', iterations: 1_000 });
    expect(fromBase64(envelope.salt)).toHaveLength(16);
    expect(fromBase64(envelope.iv)).toHaveLength(12);
    expect(envelope.ciphertext).not.toContain('lists');
    await expect(decryptText(envelope, 'correct horse', 'simply-sub:1')).resolves.toBe(
      '{"lists":[]}',
    );
  });

  it('uses a new salt and IV each time', async () => {
    const first = await encryptText('same', 'pass', 'x', fast);
    const second = await encryptText('same', 'pass', 'x', fast);
    expect(second.salt).not.toBe(first.salt);
    expect(second.iv).not.toBe(first.iv);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it('refuses a wrong passphrase', async () => {
    const envelope = await encryptText('secret', 'correct horse', 'x', fast);
    await expect(decryptText(envelope, 'Correct horse', 'x')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it('refuses a changed ciphertext, IV or bound text', async () => {
    const envelope = await encryptText('secret', 'pass', 'simply-sub:1', fast);
    const bytes = fromBase64(envelope.ciphertext);
    bytes[0] ^= 1;
    const flipped = { ...envelope, ciphertext: toBase64(bytes) };
    await expect(decryptText(flipped, 'pass', 'simply-sub:1')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    const iv = fromBase64(envelope.iv);
    iv[0] ^= 1;
    await expect(
      decryptText({ ...envelope, iv: toBase64(iv) }, 'pass', 'simply-sub:1'),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(decryptText(envelope, 'pass', 'simply-sub:2')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    await expect(
      decryptText({ ...envelope, salt: toBase64(new Uint8Array(4)) }, 'pass', 'simply-sub:1'),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('seals with a key it holds, under a new IV each time, and opens only with that key and binding', async () => {
    const salt = newSalt();
    expect(salt).toHaveLength(16);
    const key = await deriveKey('correct horse', salt, 1_000);
    const sealed = await sealText(key, '{"name":"Work Related"}', 'simply-sub:lock:lists:1');
    expect(Object.keys(sealed)).toEqual(['iv', 'ciphertext']);
    expect(sealed.ciphertext).not.toContain('Work');
    expect((await sealText(key, '{"name":"Work Related"}', 'x')).iv).not.toBe(sealed.iv);
    await expect(openText(key, sealed, 'simply-sub:lock:lists:1')).resolves.toBe(
      '{"name":"Work Related"}',
    );
    // A row moved to another key, the same passphrase with another salt, and a short IV don't open.
    await expect(openText(key, sealed, 'simply-sub:lock:lists:2')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    const other = await deriveKey('correct horse', newSalt(), 1_000);
    await expect(openText(other, sealed, 'simply-sub:lock:lists:1')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
    await expect(
      openText(key, { ...sealed, iv: toBase64(new Uint8Array(8)) }, 'simply-sub:lock:lists:1'),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('derives keys that can’t be read back out', async () => {
    const key = await deriveKey('correct horse', newSalt(), 1_000);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('derives new keys with 600,000 iterations', () => {
    expect(kdfIterations).toBe(600_000);
  });

  it('round-trips bytes through base64', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
