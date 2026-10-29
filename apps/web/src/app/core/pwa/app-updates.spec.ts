import { ApplicationRef, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { SwUpdate, UnrecoverableStateEvent, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { ClockService } from '../clock/clock-service';
import { FakeClock } from '../storage/storage.testing';
import type { LockState } from '../storage/storage-engine';
import { StorageService } from '../storage/storage-service';
import { AppUpdates, RELOAD_PAGE } from './app-updates';

// New versions of the app (M10.6): the snackbar that offers a reload, the checks from Settings and from a tab shown
// after an hour, and what a check that can't be made says. A stand-in for the worker's SwUpdate.

class FakeWorker {
  readonly versionUpdates = new Subject<VersionEvent>();
  readonly unrecoverable = new Subject<UnrecoverableStateEvent>();
  readonly checkForUpdate = vi.fn(() => Promise.resolve(false));
  readonly activateUpdate = vi.fn(() => Promise.resolve(true));
}

const ready: VersionEvent = {
  type: 'VERSION_READY',
  currentVersion: { hash: 'a1' },
  latestVersion: { hash: 'b2' },
};

describe('AppUpdates', () => {
  let clock: FakeClock;
  let lock: WritableSignal<LockState>;
  let reload: () => void;
  let worker: FakeWorker;
  let updates: AppUpdates;

  beforeEach(() => {
    clock = new FakeClock();
    lock = signal<LockState>('off');
    reload = vi.fn();
    worker = new FakeWorker();
    TestBed.configureTestingModule({
      providers: [
        { provide: ClockService, useValue: clock },
        { provide: StorageService, useValue: { lock } },
        { provide: RELOAD_PAGE, useValue: reload },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    updates = TestBed.inject(AppUpdates);
  });

  afterEach(() => {
    TestBed.inject(MatSnackBar).dismiss();
    vi.unstubAllGlobals();
  });

  /** Lets the snackbar load and render. */
  async function settle() {
    await TestBed.inject(ApplicationRef).whenStable();
    await new Promise((resolve) => setTimeout(resolve));
  }

  const snackBar = () => document.querySelector('.mat-mdc-snack-bar-container');
  const watch = () => updates.watch(worker as unknown as SwUpdate);

  it('has nothing to check with until the worker starts', async () => {
    expect(updates.available()).toBe(false);
    expect(await updates.check()).toBe('failed');
    watch();
    expect(updates.available()).toBe(true);
  });

  it('offers to reload once a new version is ready, and Reload reloads', async () => {
    watch();
    worker.versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b2' } });
    await settle();
    expect(snackBar()).toBeNull();

    worker.versionUpdates.next(ready);
    await settle();
    expect(snackBar()?.textContent).toContain('A new version of Simply Sub is ready.');
    expect(snackBar()?.textContent).not.toContain('locks');
    snackBar()?.querySelector('button')?.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('moves a page that already runs the new version onto it, with no prompt', async () => {
    // A page load fetched the new index.html before the worker knew of it.
    const main = document.createElement('script');
    main.src = 'main-B2B2B2B2.js';
    document.body.append(main);
    const fetch = vi.fn(async () =>
      Response.json({ hashTable: { '/index.html': 'x', '/main-B2B2B2B2.js': 'y' } }),
    );
    vi.stubGlobal('fetch', fetch);
    try {
      watch();
      worker.versionUpdates.next(ready);
      await settle();
      expect(fetch).toHaveBeenCalledWith('/ngsw.json?ngsw-bypass', { cache: 'no-store' });
      expect(worker.activateUpdate).toHaveBeenCalledTimes(1);
      expect(snackBar()).toBeNull();

      // An older page, whose main isn't the new version's, gets the prompt.
      main.src = 'main-A1A1A1A1.js';
      worker.versionUpdates.next(ready);
      await settle();
      expect(snackBar()?.textContent).toContain('A new version of Simply Sub is ready.');
      expect(worker.activateUpdate).toHaveBeenCalledTimes(1);
    } finally {
      main.remove();
    }
  });

  it('says that reloading locks the app when the lock is on', async () => {
    lock.set('unlocked');
    watch();
    worker.versionUpdates.next(ready);
    await settle();
    expect(snackBar()?.textContent).toContain(
      'A new version of Simply Sub is ready. Reloading locks the app.',
    );
  });

  it('asks for a reload when the worker can no longer serve the app', async () => {
    watch();
    worker.unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'Hash mismatch' });
    await settle();
    expect(snackBar()?.textContent).toContain('Simply Sub needs to reload to keep working.');
  });

  it('checks when asked: a new version, none, a failure, or offline without asking', async () => {
    watch();
    worker.checkForUpdate.mockResolvedValueOnce(true);
    expect(await updates.check()).toBe('ready');
    expect(await updates.check()).toBe('current');
    worker.checkForUpdate.mockRejectedValueOnce(new Error('Service workers are disabled'));
    expect(await updates.check()).toBe('failed');
    // Offline the worker would answer "no new version": the check isn't made.
    vi.stubGlobal('navigator', { onLine: false });
    expect(await updates.check()).toBe('offline');
    expect(worker.checkForUpdate).toHaveBeenCalledTimes(3);
  });

  it('checks again when a tab is shown an hour after the last check, not before', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    try {
      watch();
      const shown = () => document.dispatchEvent(new Event('visibilitychange'));
      clock.time = '2026-10-25T12:59:00.000Z';
      shown();
      expect(worker.checkForUpdate).not.toHaveBeenCalled();
      clock.time = '2026-10-25T13:00:00.000Z';
      shown();
      expect(worker.checkForUpdate).toHaveBeenCalledTimes(1);
      shown();
      expect(worker.checkForUpdate).toHaveBeenCalledTimes(1);
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  });
});
