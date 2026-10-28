import type { ResolvedItem } from '../user/resolved';

// Suggestion fingerprints (P14): a dismissal is stored under one, and survives until the list changes. A fingerprint
// hashes the list's items as the optimizer read them with the suggestion's changes, so the same list gives the same
// fingerprint on every device and run, and any change to an item gives new ones. The item ids are random (UUID v7),
// so a fingerprint, which the app lock keeps in plain text as the record's key, can't be matched to plans by guessing.

/** What the optimizer reads of an item: what it is, where it's bought, its billing, its price override and ranks. */
export function itemSignature({ item, effectiveRanks }: ResolvedItem): string {
  return stableJson([
    item.id,
    item.source,
    item.region ?? null,
    item.billing,
    item.priceOverride ?? null,
    effectiveRanks,
  ]);
}

/** A fingerprint of `parts`: 16 hex digits, two 32-bit FNV-1a hashes of the text, forwards and backwards. */
export function fingerprintOf(...parts: readonly string[]): string {
  const text = parts.join('\u0000');
  return lane(text, 1) + lane(text, -1);
}

/** FNV-1a over the text's UTF-16 code units, in `direction`: 8 hex digits. */
function lane(text: string, direction: 1 | -1): string {
  let hash = 0x811c9dc5;
  for (let step = 0; step < text.length; step++) {
    hash ^= text.charCodeAt(direction === 1 ? step : text.length - 1 - step);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** JSON with every object's keys sorted, so two equal values always give the same text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : inner,
  );
}
