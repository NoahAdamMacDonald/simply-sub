import { describe, expect, it } from 'vitest';
import { iconProblem, pickIcon, readIconImage, readPngSize } from '../../src';
import { asciiBytes, pngBytes } from '../catalog/helpers';

/** An ICO holding these images: the ICONDIR header, a 16-byte entry per image, then the images. */
function icoBytes(images: Uint8Array[]): Uint8Array {
  const header = 6 + images.length * 16;
  const bytes = new Uint8Array(header + images.reduce((sum, image) => sum + image.length, 0));
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((image, index) => {
    view.setUint32(6 + index * 16 + 8, image.length, true);
    view.setUint32(6 + index * 16 + 12, offset, true);
    bytes.set(image, offset);
    offset += image.length;
  });
  return bytes;
}

/** A 48-pixel BMP image as an ICO stores it: a BITMAPINFOHEADER, which starts with its own length (40). */
const bmp = new Uint8Array(40);
bmp.set([40, 0, 0, 0, 48, 0, 0, 0, 96]);
const html = asciiBytes('<!doctype html><html><head><title>Netflix</title>');

describe('readPngSize', () => {
  it("reads a PNG's width and height", () => {
    expect(readPngSize(pngBytes(180, 120))).toEqual({ width: 180, height: 120 });
  });

  it.each([
    ['an HTML page', html],
    ['a truncated PNG', pngBytes(64, 64).slice(0, 20)],
    ['a PNG whose first chunk is not IHDR', pngBytes(64, 64).fill(0x41, 12, 16)],
  ])('rejects %s', (_case, bytes) => {
    expect(readPngSize(bytes)).toBeUndefined();
  });
});

describe('readIconImage', () => {
  it('takes a PNG as it is', () => {
    const png = pngBytes(128, 128);
    expect(readIconImage(png)).toEqual({ png, width: 128, height: 128 });
  });

  it('takes the largest PNG inside an ICO, skipping BMP images', () => {
    const large = pngBytes(64, 64);
    const image = readIconImage(icoBytes([pngBytes(16, 16), bmp, large, pngBytes(32, 32)]));
    expect(image).toEqual({ png: large, width: 64, height: 64 });
  });

  it.each([
    ['a BMP-only ICO', icoBytes([bmp, bmp])],
    ['an HTML page', html],
    ['an ICO whose entry points past the end', icoBytes([pngBytes(64, 64)]).slice(0, 30)],
    ['nothing', new Uint8Array()],
  ])('finds nothing in %s', (_case, bytes) => {
    expect(readIconImage(bytes)).toBeUndefined();
  });
});

describe('iconProblem', () => {
  const image = (width: number, height: number, padding = 0) => ({
    png: pngBytes(width, height, padding),
    width,
    height,
  });

  it('accepts a square PNG of 32 pixels or more, up to 100 KB', () => {
    expect(iconProblem(image(32, 32))).toBeUndefined();
    expect(iconProblem(image(512, 512, 99_000))).toBeUndefined();
  });

  it.each([
    [undefined, 'Not a PNG image'],
    [image(64, 48), 'Use a square image of at least 32×32 pixels (this one is 64×48)'],
    [image(16, 16), 'Use a square image of at least 32×32 pixels (this one is 16×16)'],
    [image(64, 64, 100_001), 'Use an image of at most 100 KB (this one is 101 KB)'],
  ])('rejects %#', (candidate, expected) => {
    expect(iconProblem(candidate)).toBe(expected);
  });
});

describe('pickIcon', () => {
  const candidate = (url: string, width: number, height = width) => ({
    url,
    png: pngBytes(width, height),
    width,
    height,
  });

  it('picks the largest icon that could be a logo', () => {
    const picked = pickIcon([
      candidate('site-32', 32),
      candidate('site-wide', 300, 150),
      candidate('google', 128),
      candidate('duckduckgo', 16),
    ]);
    expect(picked?.url).toBe('google');
  });

  it('prefers the earlier of two icons of the same size', () => {
    expect(pickIcon([candidate('site', 128), candidate('google', 128)])?.url).toBe('site');
  });

  it('finds nothing when no icon could be a logo', () => {
    expect(pickIcon([candidate('tiny', 16)])).toBeUndefined();
    expect(pickIcon([])).toBeUndefined();
  });
});
