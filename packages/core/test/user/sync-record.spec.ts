import { describe, expect, it } from 'vitest';
import { defaultDeviceName, syncRecordSchema, withSharedTime, type Settings } from '../../src';
import { settings } from './fixtures';

// Sync on a device (M10.9): its record, a name for the device from its browser, and which settings changes are shared.

const record = {
  key: 'sync',
  seed: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
  deviceId: '0192f1d0-0000-7000-8000-00000000000a',
  deviceName: 'Edge on Windows',
  version: '3',
  syncedAt: '2026-10-29T18:20:00.000Z',
  updatedAt: '2026-10-29T18:20:00.000Z',
};

describe('the sync record', () => {
  it('holds the code, this device, and where sync is', () => {
    expect(syncRecordSchema.parse(record)).toEqual(record);
    expect(syncRecordSchema.parse({ ...record, problem: 'gone' }).problem).toBe('gone');
  });

  it('refuses a code that isn’t 32 bytes, a name that’s empty or too long, or a version that isn’t one', () => {
    expect(syncRecordSchema.safeParse({ ...record, seed: 'AAEC' }).success).toBe(false);
    expect(syncRecordSchema.safeParse({ ...record, deviceName: '  ' }).success).toBe(false);
    expect(syncRecordSchema.safeParse({ ...record, deviceName: 'x'.repeat(61) }).success).toBe(
      false,
    );
    expect(syncRecordSchema.safeParse({ ...record, version: '0' }).success).toBe(false);
  });
});

describe('defaultDeviceName', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.0; rv:140.0) Gecko/20100101 Firefox/140.0',
      'Firefox on Mac',
    ],
    ['Something else', 'This browser'],
  ])('names %s', (userAgent, name) => {
    expect(defaultDeviceName(userAgent)).toBe(name);
  });
});

describe('withSharedTime', () => {
  const before = { ...settings, sharedUpdatedAt: '2026-10-19T10:00:00.000Z' } as Settings;
  const later = '2026-10-29T18:20:00.000Z';

  it('moves the shared time on when where the user is or a budget changes', () => {
    expect(
      withSharedTime(before, { ...before, monthlyBudget: 250, updatedAt: later }),
    ).toMatchObject({
      sharedUpdatedAt: later,
    });
    expect(
      withSharedTime(before, { ...before, subdivision: 'CA-QC', updatedAt: later }).sharedUpdatedAt,
    ).toBe(later);
  });

  it('keeps it when only the theme, or nothing shared, changes', () => {
    expect(
      withSharedTime(before, { ...before, theme: 'dark', updatedAt: later }).sharedUpdatedAt,
    ).toBe('2026-10-19T10:00:00.000Z');
  });

  it('takes the last change before there was one, and the save itself for new settings', () => {
    const older = { ...settings } as Settings;
    expect(
      withSharedTime(older, { ...older, theme: 'dark', updatedAt: later }).sharedUpdatedAt,
    ).toBe(settings.updatedAt);
    expect(withSharedTime(undefined, { ...older, updatedAt: later }).sharedUpdatedAt).toBe(later);
  });
});
