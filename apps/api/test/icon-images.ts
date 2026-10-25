// Stand-ins for the icon files Google's and DuckDuckGo's icon services send (test/icon.spec.ts, test/contract.spec.ts).

/** A PNG's signature and IHDR chunk: all core's readPngSize reads. */
export function png(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, size);
  view.setUint32(20, size);
  return bytes;
}

/** An ICO holding one PNG, as DuckDuckGo serves a site's favicon. */
export function ico(image: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(22 + image.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  view.setUint32(6 + 8, image.length, true);
  view.setUint32(6 + 12, 22, true);
  bytes.set(image, 22);
  return bytes;
}
