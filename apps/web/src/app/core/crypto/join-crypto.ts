import { fromBase64 } from './passphrase-crypto';
import { seedBytes, toBase64Url } from './sync-crypto';

// A join link's seal (PROJECT-PLAN M10.14, BLUEPRINT §11.4), in the app's crypto module: the device that shows the QR
// code seals the sync code with a new random AES-256-GCM key, which only the link carries, after its #, so the server
// keeps bytes it can't open. The device that takes the link opens them with the key. Only sync's dialogs load this.

/** The sealed form's first byte: this way of sealing. */
const sealFormat = 1;
const ivBytes = 12;
/** What a sealed code is bound to (GCM's additional data): its format, so it opens as nothing else. */
const boundTo = new TextEncoder().encode(`simply-sub join ${sealFormat}`);

/** The sync code sealed with a new key: the key (base64url, for the link) and the sealed bytes (for the server). */
export async function sealJoinCode(
  seed: Uint8Array<ArrayBuffer>,
): Promise<{ key: string; sealed: Uint8Array<ArrayBuffer> }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: boundTo },
    key,
    seed,
  );
  const bytes = new Uint8Array(1 + ivBytes + sealed.byteLength);
  bytes[0] = sealFormat;
  bytes.set(iv, 1);
  bytes.set(new Uint8Array(sealed), 1 + ivBytes);
  return { key: toBase64Url(raw), sealed: bytes };
}

/** The sync code sealJoinCode sealed, opened with the link's key (base64url); undefined when it doesn't open. */
export async function openJoinCode(
  key: string,
  sealed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (sealed.length <= 1 + ivBytes || sealed[0] !== sealFormat) return undefined;
  try {
    const raw = fromBase64(key.replace(/-/g, '+').replace(/_/g, '/'));
    const cryptoKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const seed = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.slice(1, 1 + ivBytes), additionalData: boundTo },
        cryptoKey,
        sealed.slice(1 + ivBytes),
      ),
    );
    return seed.length === seedBytes ? seed : undefined;
  } catch {
    return undefined;
  }
}
