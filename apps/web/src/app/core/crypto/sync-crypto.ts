import { entropyToMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { toBase64 } from './passphrase-crypto';

// Sync's code and keys (PROJECT-PLAN M10.7, BLUEPRINT §11.4, §11.5), in the app's crypto module. A chain's code is 32
// random bytes, shown as 24 BIP39 words, the last carrying a checksum. HKDF-SHA256 derives from it, on the device, the
// chain's id, an auth secret whose SHA-256 is all the server keeps, and the AES-256-GCM key that seals the copy: a random
// seed needs no slow stretching, unlike a passphrase. The copy is gzipped, then sealed bound to the chain's id, so the
// server holds only bytes it can't read. This file is only in the lazy sync chunk, with its word list.

/** The code's length: 24 words. */
export const seedBytes = 32;

/** Thrown when a sealed copy doesn't open: another chain's key, a changed byte, or not a copy at all. */
export class SealedCopyError extends Error {
  constructor() {
    super('The copy doesn’t open with this sync code, or it was changed');
    this.name = 'SealedCopyError';
  }
}

/** What a chain's code gives a device: the chain's id and auth secret, as base64url, and the key, which can't be read. */
export interface SyncKeys {
  chainId: string;
  authSecret: string;
  key: CryptoKey;
}

/** A new chain's code. */
export function newSyncSeed(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(seedBytes));
}

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

/** The chain's id, auth secret and key, from its code. */
export async function syncKeys(seed: Uint8Array<ArrayBuffer>): Promise<SyncKeys> {
  const material = await crypto.subtle.importKey('raw', seed, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const hkdf = (info: string): HkdfParams => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(),
    info: new TextEncoder().encode(`simply-sub sync: ${info}`),
  });
  const bits = async (info: string, length: number) =>
    toBase64Url(new Uint8Array(await crypto.subtle.deriveBits(hkdf(info), material, length)));
  return {
    chainId: await bits('chain id', 128),
    authSecret: await bits('auth secret', 256),
    key: await crypto.subtle.deriveKey(
      hkdf('copy key'),
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
  };
}

/** The sealed form's first byte: this way of sealing. */
const sealFormat = 1;
const ivBytes = 12;

/** A copy (JSON) as the server keeps it: the format, a new random IV, then the gzipped JSON sealed with the key. */
export async function sealCopy(keys: SyncKeys, copy: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: boundTo(keys) },
    keys.key,
    await transform(new TextEncoder().encode(JSON.stringify(copy)), new CompressionStream('gzip')),
  );
  const bytes = new Uint8Array(1 + ivBytes + sealed.byteLength);
  bytes[0] = sealFormat;
  bytes.set(iv, 1);
  bytes.set(new Uint8Array(sealed), 1 + ivBytes);
  return bytes;
}

/** The copy sealCopy sealed, parsed. Throws a SealedCopyError if it doesn't open. */
export async function openCopy(keys: SyncKeys, bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  if (bytes.length <= 1 + ivBytes || bytes[0] !== sealFormat) throw new SealedCopyError();
  try {
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(1, 1 + ivBytes), additionalData: boundTo(keys) },
      keys.key,
      bytes.slice(1 + ivBytes),
    );
    const json = await transform(new Uint8Array(opened), new DecompressionStream('gzip'));
    return JSON.parse(new TextDecoder().decode(json)) as unknown;
  } catch {
    throw new SealedCopyError();
  }
}

/** What a copy is bound to (GCM's additional data): its format and its chain, so it opens on no other. */
function boundTo({ chainId }: SyncKeys): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`simply-sub sync ${sealFormat}:${chainId}`);
}

/** Bytes through a compression stream. */
async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = stream.writable.getWriter();
  const writing = writer.write(bytes).then(() => writer.close());
  // A failure shows on the reading side too, which throws it.
  writing.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    chunks.push(read.value);
  }
  await writing;
  const joined = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/** Bytes as base64url, unpadded: what the API's paths and bearer secrets take. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
