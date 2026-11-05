// Draws the app's icon (PROJECT-PLAN M10.6) and writes the files the manifest, index.html and browsers ask for into
// apps/web/public/, where they're committed: app-icons/icon.svg (the mark), icon-192.png and icon-512.png,
// maskable-512.png (the mark inside the safe zone, on a full square), apple-touch-icon.png (180 px, square, since iOS
// rounds the corners itself) and favicon.ico (16, 32 and 48 px). The mark is a coin with a dollar sign inside a renewal
// arrow, in the colours of _tokens.scss (--ss-accent, --ss-on-accent), with no tile: the Simply apps share one style,
// a plain glyph in each app's accent (Simply Files' is a folder), and a thin outline in the on-accent colour keeps it
// visible on dark backgrounds (the owner's choice of 2026-11-04). Drawn with paths, so no font is needed.
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

const round = (value: number) => Number(value.toFixed(2));

/** The point at `degrees` on an ellipse centred at (256, cy), on a 512 square. */
function onEllipse(cy: number, rx: number, ry: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [round(256 + rx * Math.cos(radians)), round(cy + ry * Math.sin(radians))];
}

/** The dollar sign: an S of two bowls meeting at the centre, with round ends, and a bar through it. */
function dollar(colour: string): string {
  const rx = 49.6;
  const ry = 41.6;
  const [x1, y1] = onEllipse(256 - ry, rx, ry, -25);
  const [x2, y2] = onEllipse(256 + ry, rx, ry, 155);
  const arc = `${rx} ${ry} 0 1`;
  const stroke = `stroke="${colour}" stroke-width="35.2" stroke-linecap="round"`;
  return (
    `<path d="M${x1} ${y1}A${arc} 0 256 256A${arc} 1 ${x2} ${y2}" fill="none" ${stroke}/>` +
    `<path d="M256 ${round(256 - 2 * ry - 32)}V${round(256 + 2 * ry + 32)}" ${stroke}/>`
  );
}

/**
 * The renewal arrow: a ring round the coin, open at its upper left, going clockwise from -60° to 230° into an
 * arrowhead. `outline` widens every stroke by that much on each side, for the halo drawn under it.
 */
function renewal(colour: string, outline = 0): string {
  const radius = 214;
  const width = 34;
  const [sx, sy] = onEllipse(256, radius, radius, -60);
  const [ex, ey] = onEllipse(256, radius, radius, 230);
  const radians = (230 * Math.PI) / 180;
  const [tx, ty] = [Math.cos(radians + Math.PI / 2), Math.sin(radians + Math.PI / 2)];
  const [nx, ny] = [Math.cos(radians), Math.sin(radians)];
  const length = width * 1.6;
  const half = width * 1.25;
  const head = [
    [ex + tx * length, ey + ty * length],
    [ex + nx * half, ey + ny * half],
    [ex - nx * half, ey - ny * half],
  ].map(([x, y]) => `${round(x)} ${round(y)}`);
  return (
    `<path d="M${sx} ${sy}A${radius} ${radius} 0 1 1 ${ex} ${ey}" fill="none" stroke="${colour}" ` +
    `stroke-width="${width + 2 * outline}" stroke-linecap="round"/>` +
    `<path d="M${head.join('L')}Z" fill="${colour}" stroke="${colour}" ` +
    `stroke-width="${round(width * 0.25 + 2 * outline)}" stroke-linejoin="round"/>`
  );
}

/**
 * The mark on a 512 square at `scale`, on `background` when one is given (the maskable and iOS icons, which must be
 * opaque): the outline first, then the coin, its dollar sign and the arrow.
 */
function mark(accent: string, onAccent: string, scale: number, background?: string): string {
  const outline = 9;
  const halo = `<circle cx="256" cy="256" r="${150 + outline}" fill="${onAccent}"/>${renewal(onAccent, outline)}`;
  const coin = `<circle cx="256" cy="256" r="150" fill="${accent}"/>${dollar(onAccent)}${renewal(accent)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    (background ? `<rect width="512" height="512" fill="${background}"/>` : '') +
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${halo}${coin}</g></svg>\n`
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
// The mark reaches 256 units from the centre at scale 1 (the arrowhead), so 0.86 leaves a margin.
const glyph = mark(accent, onAccent, 0.86);
// Maskable: launchers crop to as little as a circle 80% across, so the mark keeps inside it at 0.68.
const maskable = mark(accent, onAccent, 0.68, onAccent);
const square = mark(accent, onAccent, 0.8, onAccent);

const iconsDir = new URL('app-icons/', publicDir);
await mkdir(iconsDir, { recursive: true });
await writeFile(new URL('icon.svg', iconsDir), glyph);
await writeFile(new URL('icon-192.png', iconsDir), await png(glyph, 192));
await writeFile(new URL('icon-512.png', iconsDir), await png(glyph, 512));
await writeFile(new URL('maskable-512.png', iconsDir), await png(maskable, 512));
await writeFile(new URL('apple-touch-icon.png', iconsDir), await png(square, 180));
const favicon = await Promise.all(
  [16, 32, 48].map(async (size) => ({ size, data: await png(glyph, size) })),
);
await writeFile(new URL('favicon.ico', publicDir), ico(favicon));
console.log(`Wrote the app's icons in ${accent} and ${onAccent} to apps/web/public/.`);
