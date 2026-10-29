import { describe, expect, it } from 'vitest';
import {
  backupAssociatedData,
  backupCounts,
  backupFileName,
  backupRefusals,
  backupSchemaVersion,
  encryptedBackup,
  mergedRecords,
  migrateBackupPayload,
  passphraseIssues,
  plainBackup,
  readBackupPayload,
  readBackupText,
  type BackupData,
  type BackupPayload,
  type ListItem,
} from '../../src';
import { withValue } from '../catalog/helpers';
import {
  card,
  customSub,
  dismissedSuggestion,
  item,
  list,
  listId,
  ranking,
  settings,
  tag,
} from './fixtures';

// Backups (P13, BLUEPRINT §11.2): the file Export writes, what Import accepts, and Merge.

const data: BackupData = {
  settings,
  lists: [list],
  items: [item],
  customSubs: [customSub],
  rankings: [ranking],
  cards: [card],
  tags: [tag],
  dismissedSuggestions: [dismissedSuggestion],
} as BackupData;

const payload: BackupPayload = {
  exportedAt: '2026-10-27T18:30:00.000Z',
  catalogVersion: 'c4f9a21',
  data,
};

const envelope = {
  kdf: 'PBKDF2-SHA256',
  iterations: 600_000,
  salt: 'c2FsdHNhbHRzYWx0c2FsdA==',
  iv: 'aXZpdml2aXZpdml2',
  ciphertext: 'Y2lwaGVydGV4dA==',
} as const;

describe('plainBackup and readBackupText', () => {
  it('writes the header and the records, and reads them back as they were', () => {
    const file = plainBackup(payload);
    expect(file).toMatchObject({ app: 'simply-sub', schemaVersion: backupSchemaVersion });
    expect(readBackupText(JSON.stringify(file))).toEqual({ kind: 'backup', backup: payload });
  });

  it('keeps deleted records, so a restore gives back the data as it was', () => {
    const deleted = { ...data, lists: [{ ...list, deletedAt: '2026-10-21T08:00:00.000Z' }] };
    const reading = readBackupText(JSON.stringify(plainBackup({ ...payload, data: deleted })));
    expect(reading.kind === 'backup' && reading.backup.data.lists[0].deletedAt).toBe(
      '2026-10-21T08:00:00.000Z',
    );
  });

  it('reads a file without a catalog version', () => {
    const withoutVersion = { exportedAt: payload.exportedAt, data };
    expect(readBackupText(JSON.stringify(plainBackup(withoutVersion))).kind).toBe('backup');
  });

  it.each([
    ['text that isn’t JSON', 'not json', backupRefusals.notJson],
    [
      'another app’s file',
      JSON.stringify({ ...plainBackup(payload), app: 'other' }),
      backupRefusals.notBackup,
    ],
    ['a JSON array', '[]', backupRefusals.notBackup],
    ['no version', JSON.stringify({ app: 'simply-sub', data }), backupRefusals.notBackup],
    [
      'a newer version',
      JSON.stringify({ ...plainBackup(payload), schemaVersion: backupSchemaVersion + 1 }),
      backupRefusals.newer,
    ],
  ])('refuses %s', (_, text, reason) => {
    expect(readBackupText(text)).toEqual({ kind: 'refused', reason });
  });

  it('refuses a file whose records fail their schemas, saying nothing of what they hold', () => {
    const broken = withValue(plainBackup(payload), ['data', 'items', 0, 'listId'], 'not-an-id');
    expect(readBackupText(JSON.stringify(broken))).toEqual({
      kind: 'refused',
      reason: backupRefusals.invalid,
    });
    const extra = { ...plainBackup(payload), data: { ...data, drafts: [] } };
    expect(readBackupText(JSON.stringify(extra)).kind).toBe('refused');
  });

  it('refuses a file that lists a record twice', () => {
    const twice = { ...data, items: [item, item] as ListItem[] };
    expect(readBackupText(JSON.stringify(plainBackup({ ...payload, data: twice })))).toEqual({
      kind: 'refused',
      reason: backupRefusals.invalid,
    });
  });
});

describe('encrypted backups', () => {
  it('reads an encrypted file as one that needs its passphrase', () => {
    const file = encryptedBackup(envelope);
    expect(readBackupText(JSON.stringify(file))).toEqual({ kind: 'encrypted', file });
  });

  it('refuses an envelope that isn’t well formed', () => {
    const file = { ...encryptedBackup(envelope), encrypted: { ...envelope, kdf: 'MD5' } };
    expect(readBackupText(JSON.stringify(file)).kind).toBe('refused');
    const both = { ...plainBackup(payload), encrypted: envelope };
    expect(readBackupText(JSON.stringify(both)).kind).toBe('refused');
  });

  it('checks the payload it opens to, as a plain file’s', () => {
    expect(readBackupPayload(payload, backupSchemaVersion)).toEqual({
      kind: 'backup',
      backup: payload,
    });
    expect(readBackupPayload({ ...payload, data: {} }, backupSchemaVersion)).toEqual({
      kind: 'refused',
      reason: backupRefusals.invalid,
    });
    expect(readBackupPayload(payload, backupSchemaVersion + 1).kind).toBe('refused');
  });

  it('binds the header to the ciphertext', () => {
    expect(backupAssociatedData(encryptedBackup(envelope))).toBe('simply-sub:3');
  });
});

describe('migrateBackupPayload', () => {
  it('leaves a payload of this version as it is', () => {
    expect(migrateBackupPayload(payload, backupSchemaVersion)).toBe(payload);
  });

  it('gives a version 1 file, from before M8.2, no dismissed suggestions', () => {
    const version1: Partial<BackupData> = { ...data };
    delete version1.dismissedSuggestions;
    const reading = readBackupPayload({ ...payload, data: version1 }, 1);
    expect(reading).toEqual({
      kind: 'backup',
      backup: { ...payload, data: { ...data, dismissedSuggestions: [] } },
    });
    // A version 2 file must have them.
    expect(readBackupPayload({ ...payload, data: version1 }, 2).kind).toBe('refused');
  });
});

describe('backupFileName', () => {
  it('names the file by the day', () => {
    expect(backupFileName('2026-10-27')).toBe('simply-sub-backup-2026-10-27.json');
  });
});

describe('backupCounts', () => {
  it('counts each kind of record, leaving out the deleted ones', () => {
    expect(backupCounts(data)).toEqual({
      lists: 1,
      // The fixture item is soft-deleted.
      items: 0,
      customSubs: 1,
      rankings: 1,
      cards: 1,
      tags: 1,
    });
  });
});

describe('mergedRecords', () => {
  const older = { ...list, name: 'Old', updatedAt: '2026-10-01T12:00:00.000Z' };
  const newer = { ...list, name: 'New', updatedAt: '2026-10-25T12:00:00.000Z' };
  const other = { ...list, id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e', name: 'Other' };

  it('takes a record the backup has newer, or that isn’t stored, and keeps a stored one as new or newer', () => {
    expect(mergedRecords('lists', [older], [newer, other])).toEqual([newer, other]);
    expect(mergedRecords('lists', [newer], [older])).toEqual([]);
    expect(mergedRecords('lists', [newer], [newer])).toEqual([]);
  });

  it('merges a deletion like any change, and keys rankings by their rank key', () => {
    const deleted = { ...newer, deletedAt: newer.updatedAt };
    expect(mergedRecords('lists', [older], [deleted])).toEqual([deleted]);
    const stored = data.rankings[0];
    const ranked = { ...stored, rank: 'needed' as const, updatedAt: '2026-10-26T12:00:00.000Z' };
    expect(mergedRecords('rankings', [stored], [ranked])).toEqual([ranked]);
  });

  it('takes the backup’s settings when they’re newer', () => {
    const stored = data.settings;
    const later = { ...stored, updatedAt: '2026-10-26T12:00:00.000Z' };
    expect(mergedRecords('settings', [stored], [later])).toEqual([later]);
    expect(mergedRecords('settings', [later], [stored])).toEqual([]);
  });

  it('keeps the list ids of the items it merges', () => {
    const merged = mergedRecords('items', [], [item as ListItem]);
    expect(merged[0].listId).toBe(listId);
  });
});

describe('passphraseIssues', () => {
  it('takes a passphrase of 8 characters or more, typed the same twice, as it is', () => {
    expect(passphraseIssues({ passphrase: 'correct horse', confirm: 'correct horse' })).toEqual([]);
    expect(passphraseIssues({ passphrase: '   8 chr', confirm: '   8 chr' })).toEqual([]);
  });

  it('says when it’s too short, or typed differently', () => {
    expect(passphraseIssues({ passphrase: 'short', confirm: 'shorter' })).toEqual([
      { path: ['passphrase'], message: 'Use at least 8 characters' },
      { path: ['confirm'], message: 'Type the same passphrase again' },
    ]);
  });
});
