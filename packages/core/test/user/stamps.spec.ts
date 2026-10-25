import { describe, expect, it } from 'vitest';
import { nextUpdatedAt, softDeleted, withChanges } from '../../src';

const previous = '2026-10-20T09:15:00.000Z';

describe('nextUpdatedAt', () => {
  it('is now when now is later', () => {
    expect(nextUpdatedAt(previous, '2026-10-21T08:00:00.000Z')).toBe('2026-10-21T08:00:00.000Z');
  });

  it.each([
    ['the same moment', previous],
    ['earlier, after the clock went back', '2026-10-19T23:59:59.999Z'],
  ])('is a millisecond after the last change when now is %s', (_name, now) => {
    expect(nextUpdatedAt(previous, now)).toBe('2026-10-20T09:15:00.001Z');
  });
});

describe('withChanges', () => {
  const record = { name: 'Work', note: 'old', updatedAt: previous };
  const now = '2026-10-21T08:00:00.000Z';

  it('applies the changes and moves updatedAt forward', () => {
    expect(withChanges(record, { name: 'Family' }, now)).toEqual({
      name: 'Family',
      note: 'old',
      updatedAt: now,
    });
  });

  it('removes a key that is set to undefined', () => {
    const cleared = withChanges(record, { note: undefined }, now);
    expect(cleared).toEqual({ name: 'Work', updatedAt: now });
    expect('note' in cleared).toBe(false);
  });

  it('leaves the record it was given unchanged', () => {
    withChanges(record, { name: 'Family', note: undefined }, now);
    expect(record).toEqual({ name: 'Work', note: 'old', updatedAt: previous });
  });

  it('ignores an updatedAt in the changes', () => {
    expect(withChanges(record, { updatedAt: '2030-01-01T00:00:00.000Z' }, now).updatedAt).toBe(now);
  });
});

describe('softDeleted', () => {
  it('sets deletedAt and updatedAt to the same moment', () => {
    const now = '2026-10-21T08:00:00.000Z';
    expect(softDeleted({ name: 'Work', updatedAt: previous }, now)).toEqual({
      name: 'Work',
      updatedAt: now,
      deletedAt: now,
    });
  });
});
