import { syncedText } from './sync-text';

// When this device last synced, in words (M10.9).

describe('syncedText', () => {
  const now = Date.parse('2026-10-29T18:00:00.000Z');

  it.each([
    [undefined, 'Not synced yet'],
    ['2026-10-29T17:59:30.000Z', 'Synced just now'],
    ['2026-10-29T17:59:00.000Z', 'Synced a minute ago'],
    ['2026-10-29T17:12:00.000Z', 'Synced 48 minutes ago'],
    ['2026-10-29T17:00:00.000Z', 'Synced an hour ago'],
    ['2026-10-29T06:00:00.000Z', 'Synced 12 hours ago'],
    ['2026-10-27T09:00:00.000Z', 'Synced Oct 27, 2026'],
  ])('says %s as "%s"', (syncedAt, text) => {
    expect(syncedText(syncedAt, now)).toBe(text);
  });
});
