// Reading downloaded icon files without an image library: a PNG's size from its header, and the PNG images inside
// an ICO. scripts/fetch-icons.ts uses it for catalog logos, and GET /icon will for custom subscriptions (M2.6).

export interface IconImage {
  png: Uint8Array;
  width: number;
  height: number;
}

/** Logos are square, at least this many pixels wide, and at most this many bytes. */
export const minIconSize = 32;
export const maxIconBytes = 100_000;

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's width and height, from its IHDR chunk. Undefined for anything that isn't a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || pngSignature.some((byte, index) => bytes[index] !== byte)) {
    return undefined;
  }
  // IHDR is always the first chunk: its length (4 bytes), its type, then the width and height.
  const type = String.fromCharCode(...bytes.subarray(12, 16));
  const width = uint32(bytes, 16);
  const height = uint32(bytes, 20);
  return type === 'IHDR' && width > 0 && height > 0 ? { width, height } : undefined;
}

/** The file as an icon image if it's a PNG. */
export function readPngImage(bytes: Uint8Array): IconImage | undefined {
  const size = readPngSize(bytes);
  return size && { png: bytes, ...size };
}

/**
 * The icon in a downloaded file: the file itself if it's a PNG, or the largest PNG inside an ICO. Undefined for
 * BMP-only ICOs, SVG, the HTML page a server sends instead of a missing file, and anything else.
 */
export function readIconImage(bytes: Uint8Array): IconImage | undefined {
  return readPngImage(bytes) ?? largestPngInIco(bytes);
}

/**
 * Why `image` can't be a logo: not a PNG, not square, under 32 pixels or over 100 KB. Undefined when it can.
 */
export function iconProblem(image: IconImage | undefined): string | undefined {
  if (!image) {
    return 'Not a PNG image';
  }
  const { width, height, png } = image;
  if (width !== height || width < minIconSize) {
    return `Use a square image of at least ${minIconSize}×${minIconSize} pixels (this one is ${width}×${height})`;
  }
  if (png.length > maxIconBytes) {
    return `Use an image of at most ${maxIconBytes / 1000} KB (this one is ${Math.ceil(png.length / 1000)} KB)`;
  }
  return undefined;
}

/**
 * The best of several candidate icons: the largest that could be a logo. On a tie the earlier one wins, so list
 * a site's own icons before the icon services'.
 */
export function pickIcon<T extends IconImage>(candidates: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (!iconProblem(candidate) && (!best || candidate.width > best.width)) {
      best = candidate;
    }
  }
  return best;
}

function largestPngInIco(bytes: Uint8Array): IconImage | undefined {
  // The ICONDIR header (reserved 0, type 1, image count), then a 16-byte entry per image that ends with the
  // image's length and offset. Modern ICOs store their larger images as PNG; older ones as BMP, which is skipped.
  if (bytes.length < 6 || uint16le(bytes, 0) !== 0 || uint16le(bytes, 2) !== 1) {
    return undefined;
  }
  let best: IconImage | undefined;
  const count = uint16le(bytes, 4);
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    if (entry + 16 > bytes.length) {
      break;
    }
    const length = uint32le(bytes, entry + 8);
    const offset = uint32le(bytes, entry + 12);
    if (offset + length > bytes.length) {
      continue;
    }
    const image = readPngImage(bytes.slice(offset, offset + length));
    if (image && (!best || image.width > best.width)) {
      best = image;
    }
  }
  return best;
}

function uint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function uint32le(bytes: Uint8Array, at: number): number {
  return ((bytes[at + 3] << 24) | (bytes[at + 2] << 16) | (bytes[at + 1] << 8) | bytes[at]) >>> 0;
}

function uint16le(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}
