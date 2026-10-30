import { decodeQR } from '@paulmillr/qr/decode.js';
import { TestBed } from '@angular/core/testing';
import { readableModules } from '../qr-code/qr-code';
import { QrScanner } from './qr-scanner';

// Join's QR scanner (M10.14): without a camera, or the user's leave, it says so in words; and the decoder it uses reads
// Show the code's QR code, a join link, from a frame like the camera's.

describe('QrScanner', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function status(): Promise<string> {
    const fixture = TestBed.createComponent(QrScanner);
    await fixture.whenStable();
    let text = '';
    await vi.waitFor(() => {
      fixture.detectChanges();
      text = (fixture.nativeElement as HTMLElement).querySelector('.status')?.textContent ?? '';
      expect(text).not.toBe('Starting the camera…');
    });
    return text;
  }

  it('says when the browser has no camera to use', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined });
    expect(await status()).toBe('This browser can’t use a camera here: type the words instead.');
  });

  it('says when the camera isn’t allowed', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: () =>
          Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      },
    });
    expect(await status()).toContain('Simply Sub isn’t allowed to use the camera');
  });

  it('reads Show the code’s QR code, a join link, from a frame like the camera’s', () => {
    const link =
      'https://sub.simplely.ca/join#YGFiY2RlZmdoaWprbG1ubw.QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8';
    const modules = readableModules(link);
    // Drawn 5 pixels a module, dark on light, in the middle of a grey 640 px square.
    const size = 640;
    const scale = 5;
    const offset = Math.floor((size - modules.length * scale) / 2);
    const data = new Uint8ClampedArray(size * size * 4).fill(200);
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const at = ((offset + y * scale + dy) * size + offset + x * scale + dx) * 4;
            data.fill(dark ? 20 : 245, at, at + 3);
          }
        }
      }),
    );

    expect(decodeQR({ width: size, height: size, data })).toBe(link);
  });
});
