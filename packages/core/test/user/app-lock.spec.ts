import { describe, expect, it } from 'vitest';
import {
  appLockSchema,
  cacheTables,
  isLockedTable,
  lockBinding,
  lockIdleChoice,
  lockIdleChoices,
  lockIdleLabel,
  lockIdleMinutes,
  lockPlainFields,
  lockedTables,
  openedRecord,
  rowSeal,
  sealedRecordText,
  sealedRow,
  settingsSchema,
  unopenedRecord,
  userRecordKeys,
  userRecordSchemas,
  type UserTable,
} from '../../src';
import { item, listId, settings } from './fixtures';

// The app lock's rules (P13, P15, BLUEPRINT §11.5): Lock after, the settings it keeps, and how a row is sealed.

const appLock = {
  salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
  iterations: 600_000,
  check: { iv: 'aXZpdml2aXZpdml2', ciphertext: 'Y2lwaGVydGV4dA==' },
  idleMinutes: 15,
} as const;
const sealed = { iv: 'aXZpdml2aXZpdml2', ciphertext: 'c2VhbGVk' };

describe('Lock after', () => {
  it('offers 5, 15 and 30 minutes, an hour and never, with their labels', () => {
    expect(lockIdleChoices.map(lockIdleLabel)).toEqual([
      '5 minutes',
      '15 minutes',
      '30 minutes',
      '1 hour',
      'Never',
    ]);
  });

  it('stores never as no idleMinutes, and reads it back', () => {
    expect(lockIdleMinutes('never')).toBeUndefined();
    expect(lockIdleMinutes(30)).toBe(30);
    expect(lockIdleChoice({})).toBe('never');
    expect(lockIdleChoice({ idleMinutes: 60 })).toBe(60);
  });
});

describe('appLockSchema', () => {
  it('takes the salt, iterations, check value and Lock after, and nothing else', () => {
    expect(appLockSchema.safeParse(appLock).success).toBe(true);
    const never: Record<string, unknown> = { ...appLock };
    delete never['idleMinutes'];
    expect(appLockSchema.safeParse(never).success).toBe(true);
    expect(appLockSchema.safeParse({ ...appLock, key: 'c2VjcmV0' }).success).toBe(false);
  });

  it.each([
    ['an idle time not offered', { ...appLock, idleMinutes: 10 }],
    ['iterations a tampered record could hang the unlock with', { ...appLock, iterations: 1e12 }],
    ['a salt that isn’t base64', { ...appLock, salt: 'not base64!' }],
    ['a check value with more in it', { ...appLock, check: { ...appLock.check, tag: 'x' } }],
  ])('refuses %s', (_, lock) => {
    expect(appLockSchema.safeParse(lock).success).toBe(false);
  });

  it('is an optional setting: settings without it still pass', () => {
    expect(settingsSchema.safeParse(settings).success).toBe(true);
    expect(settingsSchema.safeParse({ ...settings, appLock }).success).toBe(true);
  });
});

describe('lockedTables', () => {
  it('are every user table but the caches', () => {
    const tables = Object.keys(userRecordSchemas) as UserTable[];
    expect([...lockedTables].sort()).toEqual(
      tables.filter((table) => !(cacheTables as readonly string[]).includes(table)).sort(),
    );
    expect(isLockedTable('items')).toBe(true);
    expect(isLockedTable('catalogCache')).toBe(false);
  });

  it('keep each table’s key in plain text', () => {
    for (const table of lockedTables) {
      expect(lockPlainFields[table]).toContain(userRecordKeys[table]);
    }
  });
});

describe('sealedRow and openedRecord', () => {
  it('keeps the key and indexes in plain text and the rest only in the sealed value', () => {
    const named = { ...item, nickname: 'Mom’s' };
    const row = sealedRow('items', named, sealed);
    expect(row).toEqual({
      id: item.id,
      listId,
      updatedAt: item.updatedAt,
      sealed,
    });
    expect(JSON.stringify(row)).not.toContain('Mom’s');
  });

  it('seals the whole record, and opens it back as it was', () => {
    const text = sealedRecordText('items', item);
    expect(JSON.parse(text)).toEqual(item);
    expect(openedRecord('items', sealedRow('items', item, sealed), text)).toEqual(item);
  });

  it('keeps the settings’ theme and lock plain, and the lock out of the sealed value', () => {
    const locked = { ...settings, appLock };
    const row = sealedRow('settings', locked, sealed);
    expect(row).toEqual({ key: 'settings', theme: 'system', appLock, sealed });
    const text = sealedRecordText('settings', locked);
    expect(JSON.parse(text)).toEqual(settings);
    // Lock after changes in plain text only, and the opened settings follow it.
    const changed = { ...row, appLock: { ...appLock, idleMinutes: 60 } };
    expect(openedRecord('settings', changed, text)).toEqual({
      ...settings,
      appLock: { ...appLock, idleMinutes: 60 },
    });
  });

  it('leaves out plain fields a record doesn’t have', () => {
    expect(sealedRow('items', { id: item.id, listId }, sealed)).toEqual({
      id: item.id,
      listId,
      sealed,
    });
  });

  it('binds a sealed value to its table and key', () => {
    expect(lockBinding('items', item.id)).toBe(`simply-sub:lock:items:${item.id}`);
    expect(lockBinding('lists', item.id)).not.toBe(lockBinding('items', item.id));
  });
});

describe('rowSeal', () => {
  it('finds the sealed value of a sealed row, and none in a plain one', () => {
    expect(rowSeal({ id: item.id, sealed })).toEqual(sealed);
    expect(rowSeal(item)).toBeUndefined();
    expect(rowSeal(undefined)).toBeUndefined();
  });

  it('reads a malformed sealed value as none, so the row fails its schema instead', () => {
    expect(rowSeal({ id: item.id, sealed: { iv: 'x' } })).toBeUndefined();
    expect(userRecordSchemas.items.safeParse({ ...item, sealed: { iv: 'x' } }).success).toBe(false);
  });
});

describe('unopenedRecord', () => {
  it('describes a row that doesn’t open by its table and key, with none of its values', () => {
    expect(unopenedRecord('items', { id: item.id, listId, sealed })).toEqual({
      table: 'items',
      key: item.id,
      issues: ['sealed: unopened'],
    });
    expect(unopenedRecord('items', { id: 'Mom’s', sealed })).toEqual({
      table: 'items',
      issues: ['sealed: unopened'],
    });
  });
});
