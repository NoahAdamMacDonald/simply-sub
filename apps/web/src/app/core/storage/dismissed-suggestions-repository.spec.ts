import { TestBed } from '@angular/core/testing';
import { DismissedSuggestionsRepository } from './dismissed-suggestions-repository';
import { storedRows, testStorage, until, type TestStorage } from './storage.testing';

// Dismissed optimizer suggestions (P14): stored by fingerprint, soft-deleted when shown again.

describe('DismissedSuggestionsRepository', () => {
  const listId = '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d';
  let storage: TestStorage;
  let repository: DismissedSuggestionsRepository;

  beforeEach(() => {
    storage = testStorage();
    TestBed.configureTestingModule({ providers: storage.providers });
    repository = TestBed.inject(DismissedSuggestionsRepository);
  });

  it('keeps a dismissal under its fingerprint, and soft-deletes it when shown again', async () => {
    await repository.dismiss('3f9a0c1d2e4b5a67', listId);
    await until(() => repository.fingerprints().has('3f9a0c1d2e4b5a67'));
    expect(await storedRows(storage.indexedDB, 'dismissedSuggestions')).toEqual([
      {
        fingerprint: '3f9a0c1d2e4b5a67',
        listId,
        createdAt: '2026-10-25T12:00:00.000Z',
        updatedAt: '2026-10-25T12:00:00.000Z',
      },
    ]);

    storage.clock.time = '2026-10-25T12:05:00.000Z';
    await repository.restore('3f9a0c1d2e4b5a67');
    await until(() => repository.fingerprints().size === 0);
    expect(await storedRows(storage.indexedDB, 'dismissedSuggestions')).toEqual([
      expect.objectContaining({ deletedAt: '2026-10-25T12:05:00.000Z' }),
    ]);

    // Dismissed again, it's the same record, undeleted.
    storage.clock.time = '2026-10-25T12:10:00.000Z';
    await repository.dismiss('3f9a0c1d2e4b5a67', listId);
    await until(() => repository.fingerprints().has('3f9a0c1d2e4b5a67'));
    const [row] = (await storedRows(storage.indexedDB, 'dismissedSuggestions')) as Record<
      string,
      unknown
    >[];
    expect(row).not.toHaveProperty('deletedAt');
    expect(row['createdAt']).toBe('2026-10-25T12:00:00.000Z');
  });

  it('refuses a fingerprint that isn’t one', async () => {
    await expect(repository.dismiss('not a fingerprint', listId)).rejects.toThrow();
    expect(await storedRows(storage.indexedDB, 'dismissedSuggestions')).toEqual([]);
  });
});
