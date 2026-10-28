import type { SealedText } from '@simply-sub/core';

// The app's one crypto module (BLUEPRINT §11.5): a key derived from a passphrase the user types, and text encrypted
// with it. Encrypted backups (M6.9) and the app lock (M6.10) use it, and Phase 5's sync will. WebCrypto only: no key
// is ever stored, and a key derived here can't be read back out (non-extractable).

/** PBKDF2-HMAC-SHA256's iterations for a new key: OWASP's figure. */
export const kdfIterations = 600_000;

/** What an encrypted text is stored as: how its key was derived, and AES-256-GCM's IV and output, in base64. */
export interface PassphraseEnvelope extends SealedText {
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
}

/**
 * Thrown when a ciphertext doesn't open: the passphrase is wrong, or the ciphertext, its IV or what it's bound to was
 * changed. GCM's check can't tell these apart, so neither does this.
 */
export class WrongPassphraseError extends Error {
  constructor() {
    super('The passphrase is wrong, or the data was changed');
    this.name = 'WrongPassphraseError';
  }
}

const saltBytes = 16;
const ivBytes = 12;

/** A new random salt for deriveKey. */
export function newSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(saltBytes));
}

/** An AES-256-GCM key from `passphrase` and `salt`, by PBKDF2-HMAC-SHA256. It can't be exported. */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts `plaintext` with a key from `passphrase` and a new random salt, under a new random IV. `boundTo` is
 * authenticated with it (GCM's additional data), so a change to it fails decryption as a change to the ciphertext
 * does. `iterations` is for tests: everything else uses kdfIterations.
 */
export async function encryptText(
  plaintext: string,
  passphrase: string,
  boundTo: string,
  { iterations = kdfIterations }: { iterations?: number } = {},
): Promise<PassphraseEnvelope> {
  const salt = newSalt();
  const key = await deriveKey(passphrase, salt, iterations);
  return {
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: toBase64(salt),
    ...(await sealText(key, plaintext, boundTo)),
  };
}

/** The text `envelope` holds, with the key from `passphrase`. Throws a WrongPassphraseError if it doesn't open. */
export async function decryptText(
  envelope: PassphraseEnvelope,
  passphrase: string,
  boundTo: string,
): Promise<string> {
  const salt = fromBase64(envelope.salt);
  if (salt.length !== saltBytes) throw new WrongPassphraseError();
  const key = await deriveKey(passphrase, salt, envelope.iterations);
  return openText(key, envelope, boundTo);
}

/**
 * Encrypts `plaintext` with a key deriveKey made, under a new random IV, with `boundTo` authenticated alongside: the
 * app lock seals each row this way with the key it holds while unlocked.
 */
export async function sealText(
  key: CryptoKey,
  plaintext: string,
  boundTo: string,
): Promise<SealedText> {
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(boundTo) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/** The text sealText sealed. Throws a WrongPassphraseError if the key is wrong or something was changed. */
export async function openText(
  key: CryptoKey,
  { iv, ciphertext }: SealedText,
  boundTo: string,
): Promise<string> {
  const ivData = fromBase64(iv);
  if (ivData.length !== ivBytes) throw new WrongPassphraseError();
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivData, additionalData: new TextEncoder().encode(boundTo) },
      key,
      fromBase64(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Bytes as base64. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Base64 as bytes. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
