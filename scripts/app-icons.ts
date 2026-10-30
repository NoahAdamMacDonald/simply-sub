// Draws the app's icon (PROJECT-PLAN M10.6) and writes the files the manifest, index.html and browsers ask for into
// apps/web/public/, where they're committed: app-icons/icon.svg (the mark), icon-192.png and icon-512.png,
// maskable-512.png (the mark inside the safe zone, on a full square), apple-touch-icon.png (180 px, square, since iOS
// rounds the corners itself) and favicon.ico (16, 32 and 48 px). The mark is the logo's "Sub" pill as an app tile: its
// colours (_tokens.scss's --ss-accent and --ss-on-accent) and an S drawn as two bowls, so no font is needed.
//
//   npm run app:icons
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { repoRoot } from './lib/catalog-files';

const publicDir = new URL('apps/web/public/', repoRoot);
const tokensFile = new URL('apps/web/src/styles/_tokens.scss', repoRoot);

/** A light-theme token's hex value, as `_tokens.scss` sets it first (the light theme's block). */
function token(tokens: string, name: string): string {
  const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\b`, 'i').exec(tokens)?.[1];
  if (!value) throw new Error(`_tokens.scss has no hex value for --${name}`);
  return value;
}

/**
 * The S on a 512 square: an upper bowl drawn counterclockwise from its upper right, a lower one clockwise into its
 * lower left, meeting at the centre, each a little wider than tall, with round ends like the logo's pill.
 */
function letter(colour: string, scale: number): string {
  const rx = 74 * scale;
  const ry = 64 * scale;
  const round = (value: number) => Number(value.toFixed(2));
  const point = (cy: number, degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return `${round(256 + rx * Math.cos(radians))} ${round(cy + ry * Math.sin(radians))}`;
  };
  const arc = `${round(rx)} ${round(ry)} 0 1`;
  const d = `M${point(256 - ry, -25)}A${arc} 0 256 256A${arc} 1 ${point(256 + ry, 155)}`;
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${round(54 * scale)}" stroke-linecap="round"/>`;
}

function mark(
  accent: string,
  onAccent: string,
  { corner, scale }: { corner: number; scale: number },
) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="${corner}" fill="${accent}"/>${letter(onAccent, scale)}</svg>\n`
  );
}

function png(svg: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/** An ICO holding PNGs, which every browser reads: a 6-byte header, a 16-byte entry per image, then the images. */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const tokens = await readFile(tokensFile, 'utf8');
const accent = token(tokens, 'ss-accent');
const onAccent = token(tokens, 'ss-on-accent');
const tile = mark(accent, onAccent, { corner: 112, scale: 1 });
// Maskable: launchers crop to as little as a circle 80% across, so the S keeps well inside it.
const maskable = mark(accent, onAccent, { corner: 0, scale: 0.82 });
const square = mark(accent, onAccent, { corner: 0, scale: 1 });

const iconsDir = new URL('app-icons/', publicDir);
await mkdir(iconsDir, { recursive: true });
await writeFile(new URL('icon.svg', iconsDir), tile);
await writeFile(new URL('icon-192.png', iconsDir), await png(tile, 192));
await writeFile(new URL('icon-512.png', iconsDir), await png(tile, 512));
await writeFile(new URL('maskable-512.png', iconsDir), await png(maskable, 512));
await writeFile(new URL('apple-touch-icon.png', iconsDir), await png(square, 180));
const favicon = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, data: await png(tile, size) })),
);
await writeFile(new URL('favicon.ico', publicDir), ico(favicon));
console.log(`Wrote the app's icons in ${accent} and ${onAccent} to apps/web/public/.`);
