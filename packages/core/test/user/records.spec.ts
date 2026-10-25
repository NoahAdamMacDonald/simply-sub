import { describe, expect, it } from 'vitest';
import { InvalidRecordError, checkRecord, readRecords, userRecordSchemas } from '../../src';
import { card, customSub, item, list, listId, ranking, settings, tag } from './fixtures';

describe('userRecordSchemas', () => {
  it.each([
    ['lists', list],
    ['items', item],
    ['customSubs', customSub],
    ['rankings', ranking],
    ['cards', card],
    ['tags', tag],
    ['settings', settings],
  ] as const)('checks the %s table with its record schema', (table, record) => {
    expect(userRecordSchemas[table].safeParse(record).success).toBe(true);
  });
});

describe('readRecords', () => {
  it('keeps the valid records and describes the rejected ones', () => {
    const broken = { ...list, id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e', name: 42 };
    const { records, rejected } = readRecords('lists', [list, broken]);
    expect(records).toEqual([list]);
    expect(rejected).toEqual([{ table: 'lists', key: broken.id, issues: ['name: invalid_type'] }]);
  });

  it('returns records as the schema does, with text trimmed', () => {
    const { records } = readRecords('lists', [{ ...list, name: ' Family ' }]);
    expect(records[0].name).toBe('Family');
  });

  it('describes a record without any of its values', () => {
    const secret = 'SECRET-4111';
    const tampered = {
      ...item,
      name: secret,
      priceOverride: { amount: secret, currency: 'CAD' },
      rankOverrides: { [`${secret} key`]: 'wanted' },
    };
    const { rejected } = readRecords('items', [tampered]);
    expect(rejected).toEqual([
      {
        table: 'items',
        key: item.id,
        issues: [
          'priceOverride.amount: invalid_type',
          'rankOverrides.…: invalid_key',
          '(record): unrecognized_keys',
        ],
      },
    ]);
    expect(JSON.stringify(rejected)).not.toContain('SECRET');
  });

  it('describes a duplicate by its code, since the message quotes the value', () => {
    const twice = { ...item, tagIds: [item.tagIds[0], item.tagIds[0]] };
    expect(readRecords('items', [twice]).rejected[0].issues).toEqual(['tagIds.1: custom']);
  });

  it('leaves out a key that is malformed, since it could be anything', () => {
    const { rejected } = readRecords('tags', [{ ...tag, id: 'Family tag' }]);
    expect(rejected).toEqual([{ table: 'tags', issues: ['id: invalid_format'] }]);
  });

  it('keys rankings by rank key and settings by their key', () => {
    const rankings = readRecords('rankings', [{ ...ranking, rank: 'essential' }]);
    expect(rankings.rejected[0].key).toBe(ranking.rankKey);
    const stored = readRecords('settings', [{ ...settings, theme: 'auto' }]);
    expect(stored.rejected[0].key).toBe('settings');
  });

  it.each([null, 'a list', 42, []])('rejects %j, which is not a record', (row) => {
    expect(readRecords('lists', [row]).rejected).toEqual([
      { table: 'lists', issues: ['(record): invalid_type'] },
    ]);
  });
});

describe('checkRecord', () => {
  it('returns the record as the schema does', () => {
    expect(checkRecord('lists', { ...list, name: 'Family ' })).toEqual({ ...list, name: 'Family' });
  });

  it('throws an InvalidRecordError that names the issues but no values', () => {
    const invalid = { ...list, name: 'x'.repeat(61) };
    expect(() => checkRecord('lists', invalid)).toThrow(InvalidRecordError);
    expect(() => checkRecord('lists', invalid)).toThrow(
      `Invalid lists record ${listId}: name: too_big`,
    );
  });
});
