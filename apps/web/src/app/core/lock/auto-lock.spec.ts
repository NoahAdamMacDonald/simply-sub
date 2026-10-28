import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Settings } from '@simply-sub/core';
import { SettingsStore } from '../settings/settings-store';
import { AppLockRepository } from '../storage/app-lock-repository';
import { StorageService } from '../storage/storage-service';
import { plantRows, testStorage, until, type TestStorage } from '../storage/storage.testing';
import { AutoLock } from './auto-lock';

// Locking again (P13, P15): after Lock after's time with no input, when the page is left, and on coming back to a tab
// past the time, closing what's open over the app. Timers are faked but still run on their own, since IndexedDB's
// do; the clock moves only when the test says.

const ontario: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};
const minute = 60_000;

@Component({ template: '<p>Work Related</p>' })
class OpenDialog {}

describe('AutoLock', () => {
  let storage: TestStorage;
  let service: StorageService;
  let start: number;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    localStorage.clear();
    storage = testStorage();
    start = Date.parse(storage.clock.time);
    await plantRows(storage.indexedDB, 'settings', [ontario]);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    service = TestBed.inject(StorageService);
    TestBed.inject(AutoLock);
    await TestBed.inject(AppLockRepository).turnOn('correct horse battery', 5);
    await until(() => TestBed.inject(SettingsStore).saved()?.appLock?.idleMinutes === 5);
    expect(service.lock()).toBe('unlocked');
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  /** Moves the clock and the timers on to `minutes` after the start. */
  function at(minutes: number): void {
    const now = Date.parse(storage.clock.time);
    storage.clock.time = new Date(start + minutes * minute).toISOString();
    vi.advanceTimersByTime(start + minutes * minute - now);
  }

  it('locks after Lock after’s time with no key, click, tap or scroll', async () => {
    at(4);
    TestBed.tick();
    expect(service.lock()).toBe('unlocked');
    at(5);
    await until(() => service.lock() === 'locked');
  });

  it('counts from the last key, click, tap or scroll', async () => {
    at(4);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    at(5);
    TestBed.tick();
    expect(service.lock()).toBe('unlocked');
    at(8);
    document.dispatchEvent(new Event('pointerdown'));
    at(12);
    TestBed.tick();
    expect(service.lock()).toBe('unlocked');
    at(13);
    await until(() => service.lock() === 'locked');
  });

  it('doesn’t lock while idle when Lock after is Never', async () => {
    await TestBed.inject(AppLockRepository).setIdle('never');
    await until(() => TestBed.inject(SettingsStore).saved()?.appLock?.idleMinutes === undefined);
    at(120);
    TestBed.tick();
    expect(service.lock()).toBe('unlocked');
  });

  it('locks at once on coming back to the tab past the time, as a hidden tab’s timers run late', async () => {
    storage.clock.time = new Date(start + 6 * minute).toISOString();
    document.dispatchEvent(new Event('visibilitychange'));
    await until(() => service.lock() === 'locked');
  });

  it('locks when the page is left, so Back doesn’t bring it back unlocked', async () => {
    window.dispatchEvent(new Event('pagehide'));
    await until(() => service.lock() === 'locked');
  });

  it('closes the dialogs and the snackbar when it locks', async () => {
    const dialog = TestBed.inject(MatDialog).open(OpenDialog);
    TestBed.inject(MatSnackBar).open('Merged 4 records from the backup');
    const closed = vi.fn();
    dialog.afterClosed().subscribe(closed);
    service.lockNow();
    await until(() => closed.mock.calls.length === 1);
    await until(() => document.querySelector('.mat-mdc-snack-bar-container') === null);
  });

  it('does nothing while the lock is off', async () => {
    expect(await TestBed.inject(AppLockRepository).turnOff('correct horse battery')).toBe(true);
    window.dispatchEvent(new Event('pagehide'));
    at(60);
    TestBed.tick();
    expect(service.lock()).toBe('off');
  });
});
