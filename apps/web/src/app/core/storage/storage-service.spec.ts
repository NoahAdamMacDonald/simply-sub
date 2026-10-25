import { TestBed } from '@angular/core/testing';
import { ClockService } from '../clock/clock-service';
import { databaseName } from './db';
import { ListsRepository } from './lists-repository';
import { StorageService } from './storage-service';
import { FakeClock, testStorage, until } from './storage.testing';

describe('StorageService with the global IndexedDB', () => {
  afterEach(async () => {
    TestBed.resetTestingModule();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = request.onerror = request.onblocked = resolve;
    });
  });

  it('opens the IndexedDB the browser has when none is provided', async () => {
    // What the app does: no INDEXED_DB, so Dexie uses the global one (fake-indexeddb's here, test-setup.ts).
    TestBed.configureTestingModule({
      providers: [{ provide: ClockService, useValue: new FakeClock() }],
    });
    const lists = TestBed.inject(ListsRepository);
    await until(() => lists.status() === 'ready');
    await lists.create({ name: 'Work' });
    await until(() => lists.records().length === 1);
  });
});

describe('StorageService', () => {
  let persisted: ReturnType<typeof vi.fn>;
  let persist: ReturnType<typeof vi.fn>;

  function stubStorageManager(alreadyPersisted = false) {
    persisted = vi.fn().mockResolvedValue(alreadyPersisted);
    persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted, persist },
    });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testStorage().providers });
  });

  afterEach(() => {
    // jsdom has no StorageManager of its own.
    Reflect.deleteProperty(navigator, 'storage');
  });

  it('opens the database only when a repository first needs it', async () => {
    const storage = TestBed.inject(StorageService);
    const engine = vi.spyOn(storage, 'engine');
    expect(engine).not.toHaveBeenCalled();
    const lists = TestBed.inject(ListsRepository);
    await until(() => lists.status() === 'ready');
    expect(engine).toHaveBeenCalled();
  });

  it('asks for persistent storage after the first write, once', async () => {
    stubStorageManager();
    const lists = TestBed.inject(ListsRepository);
    await until(() => lists.status() === 'ready');
    expect(persisted).not.toHaveBeenCalled();

    const list = await lists.create({ name: 'Work' });
    await lists.update(list.id, { name: 'Family' });
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(persisted).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask again when the storage is persistent already", async () => {
    stubStorageManager(true);
    await TestBed.inject(ListsRepository).create({ name: 'Work' });
    await vi.waitFor(() => expect(persisted).toHaveBeenCalled());
    expect(persist).not.toHaveBeenCalled();
  });

  it('writes where the browser has no StorageManager', async () => {
    const list = await TestBed.inject(ListsRepository).create({ name: 'Work' });
    expect(list.name).toBe('Work');
  });

  it('makes UUID v7 ids that carry the time they were made', () => {
    const storage = TestBed.inject(StorageService);
    const id = storage.newId('2026-10-25T12:00:00.000Z');
    // 2026-10-25T12:00:00.000Z is 0x01a172ee9200 milliseconds after 1970.
    expect(id).toMatch(/^01a172ee-9200-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(storage.newId('2026-10-25T12:00:00.000Z')).not.toBe(id);
  });

  it('makes ids that sort in the order they were made, within a millisecond and after the clock goes back', () => {
    const storage = TestBed.inject(StorageService);
    const times = [
      ...Array<string>(20).fill('2026-10-25T12:00:00.000Z'),
      '2026-10-25T12:00:00.001Z',
      '2026-10-24T12:00:00.000Z',
      '2026-10-25T12:00:00.001Z',
    ];
    const ids = times.map((time) => storage.newId(time));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
