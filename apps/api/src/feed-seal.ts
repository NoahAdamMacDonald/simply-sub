import { fromBase64, toBase64 } from './writes';

// A live calendar's file sealed at rest (M10.21, BLUEPRINT §11.3): the user database keeps each feed's calendar
// sealed with a key only its link's token gives, and the hash of what it was made from keyed by the token too, so
// neither the database nor a copy of it says what anyone pays for. The app's PUT and a calendar app's GET bring the
// token, which the database keeps only as its SHA-256. The token is 128 random bits, so HKDF-SHA256 needs no salt.

const encoder = new TextEncoder();

/** The sealed form's first byte, so another form can follow it. */
const format = 1;
const ivBytes = 12;

/** The key that seals the feed of `token`: AES-256-GCM. */
function fileKey(token: string): Promise<CryptoKey> {
  return derive(token, 'simply-sub cal: file key', { name: 'AES-GCM', length: 256 }, [
    'encrypt',
    'decrypt',
  ]);
}

/** The key that hashes what the feed of `token` was made from: HMAC-SHA256. */
function hashKey(token: string): Promise<CryptoKey> {
  return derive(token, 'simply-sub cal: content hash', { name: 'HMAC', hash: 'SHA-256' }, ['sign']);
}

async function derive(
  token: string,
  info: string,
  algorithm: Parameters<SubtleCrypto['deriveKey']>[2],
  usages: string[],
): Promise<CryptoKey> {
  const secret = await crypto.subtle.importKey('raw', encoder.encode(token), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) },
    secret,
    algorithm,
    false,
    usages,
  );
}

/** What a feed's row keeps of `content`, what its calendar was made from: an HMAC keyed by its token, in hex. */
export async function contentHash(token: string, content: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await hashKey(token), encoder.encode(content));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * `ics` as the row under `tokenHash` keeps it: gzipped, then sealed with the feed's key, bound to its row, as base64
 * (the format byte, the IV, then the ciphertext).
 */
export async function sealFeed(token: string, tokenHash: string, ics: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: boundTo(tokenHash) },
    await fileKey(token),
    await gzip(ics),
  );
  const bytes = new Uint8Array(1 + ivBytes + sealed.byteLength);
  bytes[0] = format;
  bytes.set(iv, 1);
  bytes.set(new Uint8Array(sealed), 1 + ivBytes);
  return toBase64(bytes);
}

/** The calendar file `sealed` holds, opened with the feed's token. It throws when it isn't that feed's. */
export async function openFeed(token: string, tokenHash: string, sealed: string): Promise<string> {
  const bytes = fromBase64(sealed);
  if (bytes[0] !== format) throw new Error('Not a sealed calendar file');
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(1, 1 + ivBytes), additionalData: boundTo(tokenHash) },
    await fileKey(token),
    bytes.subarray(1 + ivBytes),
  );
  return gunzip(new Uint8Array(opened));
}

/** The additional data a feed's file is sealed with: its form and its row, so it opens only there. */
function boundTo(tokenHash: string): Uint8Array {
  return encoder.encode(`simply-sub cal ${format} ${tokenHash}`);
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function gunzip(bytes: Uint8Array): Promise<string> {
  return new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text();
}
