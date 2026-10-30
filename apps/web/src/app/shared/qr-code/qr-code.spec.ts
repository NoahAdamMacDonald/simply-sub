import encodeQR from '@paulmillr/qr';
import { qrPath, readableModules } from './qr-code';

// The QR code's path (M10.9): one rectangle per run of dark modules in a row; and its modules, which Join's scanner
// reads (M10.14).

describe('qrPath', () => {
  it('draws a rectangle for each run of dark modules', () => {
    expect(
      qrPath([
        [true, true, false, true],
        [false, false, false, false],
        [false, true, true, true],
      ]),
    ).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z');
  });
});

describe('readableModules', () => {
  // The contract's join link, whose code the encoder masks with a pattern the decoder misreads.
  const link =
    'https://sub.simplely.ca/join#YGFiY2RlZmdoaWprbG1ubw.QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8';

  it('draws a code as the encoder does when the decoder reads it', () => {
    const text = 'https://sub.simplely.ca/join#AAAAAAAAAAAAAAAAAAAAAA.' + 'B'.repeat(43);
    expect(readableModules(text)).toEqual(encodeQR(text, 'raw', { border: 4 }));
  });

  it('draws one the decoder misreads with another mask, which it reads', () => {
    const drawn = readableModules(link);
    expect(drawn).not.toEqual(encodeQR(link, 'raw', { border: 4 }));
    expect(drawn).toHaveLength(49);
  });
});
