import { Component, computed, input } from '@angular/core';
import encodeQR from '@paulmillr/qr';

/**
 * A QR code of `text` (PROJECT-PLAN M10.9: the sync code's words, which a phone's camera reads), drawn as one SVG path
 * bound to `d`, never as markup, dark on light in either theme, with the 4-module quiet zone scanners need.
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

  private readonly modules = computed(() => encodeQR(this.text(), 'raw', { border: 4 }));
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
