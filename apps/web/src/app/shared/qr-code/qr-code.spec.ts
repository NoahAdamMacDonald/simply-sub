import { qrPath } from './qr-code';

// The QR code's path (M10.9): one rectangle per run of dark modules in a row.

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
