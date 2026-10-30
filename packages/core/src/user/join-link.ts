import * as z from 'zod';

// A link that adds a device to a sync chain once (PROJECT-PLAN M10.14, BLUEPRINT §11.4): the QR code Show the code
// shows. The device seals the chain's code with a new random key and sends only the sealed bytes (POST /join); the link
// carries the server's id for them and that key after its #, which a browser never sends, so the server can't open
// what it keeps. The first DELETE /join/:id answers the sealed code and deletes it in the same statement, so the link
// works once, and for 10 minutes at most: one left in a browser's History opens nothing.

/** How long a join link works. */
export const joinLinkMinutes = 10;

/** The largest sealed code the server keeps: a sealed code is 61 bytes. */
export const maxSealedCodeBytes = 256;

const linkIdPattern = /^[A-Za-z0-9_-]{22}$/;

/** POST /join's answer: the link's id, and when it stops working. */
export const joinLinkBodySchema = z.strictObject({
  data: z.strictObject({
    id: z.string().regex(linkIdPattern),
    expiresAt: z.iso.datetime(),
  }),
  meta: z.strictObject({}),
});
export type JoinLinkBody = z.infer<typeof joinLinkBodySchema>;

/** What a join link carries after its #: the server's id for the sealed code (16 bytes) and the key (32), base64url. */
export interface JoinLink {
  id: string;
  key: string;
}

/** The link to the app's Join page on `origin`, with `link` after the #. */
export function joinLinkUrl(origin: string, { id, key }: JoinLink): string {
  return `${origin}/join#${id}.${key}`;
}

/** The link a join link's fragment (without its #) carries, when it's one. */
export function readJoinLink(fragment: string): JoinLink | undefined {
  const [id = '', key = '', ...rest] = fragment.split('.');
  return rest.length === 0 && linkIdPattern.test(id) && /^[A-Za-z0-9_-]{43}$/.test(key)
    ? { id, key }
    : undefined;
}

/**
 * What a QR code scanned in Join holds: a join link of this app (`origin`), a sync code's 24 words (the QR code before
 * M10.14), a join link of another site's Simply Sub (a preview's, say), or something else.
 */
export type ScannedCode =
  | { kind: 'link'; link: JoinLink }
  | { kind: 'words'; words: string[] }
  | { kind: 'elsewhere' }
  | { kind: 'unknown' };

export function readScannedCode(text: string, origin: string): ScannedCode {
  const scanned = text.trim();
  if (/^https?:\/\//i.test(scanned)) {
    // Core has no URL class (it runs everywhere): an origin, then /join, then the link after the #.
    const [, site = '', fragment = ''] = /^(https?:\/\/[^/?#]+)\/join#(.*)$/i.exec(scanned) ?? [];
    const link = readJoinLink(fragment);
    if (link === undefined) return { kind: 'unknown' };
    return site.toLowerCase() === origin.toLowerCase()
      ? { kind: 'link', link }
      : { kind: 'elsewhere' };
  }
  const words = scanned.toLowerCase().split(/\s+/);
  return words.length === 24 && words.every((word) => /^[a-z]+$/.test(word))
    ? { kind: 'words', words }
    : { kind: 'unknown' };
}
