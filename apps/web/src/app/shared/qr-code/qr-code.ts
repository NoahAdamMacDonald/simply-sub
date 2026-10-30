import { Component, computed, input } from '@angular/core';
import encodeQR from '@paulmillr/qr';
import { decodeQR } from '@paulmillr/qr/decode.js';

/**
 * A QR code of `text` (PROJECT-PLAN M10.9; since M10.14 a join link, which a phone's camera or Join's scanner reads),
 * drawn as one SVG path bound to `d`, never as markup, dark on light in either theme, with the 4-module quiet zone
 * scanners need.
 */
@Component({
  selector: 'ss-qr-code',
  templateUrl: './qr-code.html',
  styleUrl: './qr-code.scss',
  host: { role: 'img', '[attr.aria-label]': 'label()' },
})
export class QrCode {
  readonly text = input.required<string>();
  /** What the code holds, for screen readers. */
  readonly label = input.required<string>();

  private readonly modules = computed(() => readableModules(this.text()));
  protected readonly size = computed(() => this.modules().length);
  protected readonly path = computed(() => qrPath(this.modules()));
}

/** The dark modules as one path: a rectangle for each run of them in a row. */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
  let path = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x++;
      path += `M${start} ${y}h${x - start + 1}v1h${start - x - 1}z`;
    }
  });
  return path;
}

/**
 * The modules of a QR code of `text` that Join's scanner reads (M10.14). `@paulmillr/qr`'s decoder misreads a few codes
 * whatever their size, by the pattern a mask makes (about 2 join links in 100), so a code it can't read from a clean
 * drawing is drawn with the first mask it can. A phone's camera reads any of them.
 */
export function readableModules(text: string): boolean[][] {
  const first = encodeQR(text, 'raw', { border: 4 });
  if (decodes(first, text)) return first;
  for (let mask = 0; mask < 8; mask++) {
    const modules = encodeQR(text, 'raw', { border: 4, mask });
    if (decodes(modules, text)) return modules;
  }
  return first;
}

/** Whether the decoder reads `text` from the modules drawn 4 pixels each, black on white. */
function decodes(modules: readonly (readonly boolean[])[], text: string): boolean {
  const scale = 4;
  const size = modules.length * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) {
        const at = ((y * scale + dy) * size + x * scale) * 4;
        for (let dx = 0; dx < scale; dx++) data.fill(0, at + dx * 4, at + dx * 4 + 3);
      }
    }),
  );
  try {
    return decodeQR({ width: size, height: size, data }) === text;
  } catch {
    return false;
  }
}
