import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { Router, provideRouter } from '@angular/router';
import { plainBackup, type Settings, type SubscriptionList } from '@simply-sub/core';
import { IDBKeyRange } from 'fake-indexeddb';
import { App } from '../app';
import { routes } from '../app.routes';
import { openStorageEngine } from '../core/storage/storage-engine';
import { StorageService } from '../core/storage/storage-service';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../core/storage/storage.testing';

// The lock screen (P15), in place of the app while the app lock is locked: the passphrase, a wrong one, and "Forgot
// it?" with its two ways out. On a fake IndexedDB with 1,000 iterations.

const ontario: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};
const stamps = { createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-20T09:15:00.000Z' };
const work: SubscriptionList = {
  id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
  name: 'Work Related',
  ...stamps,
};
const family: SubscriptionList = {
  ...work,
  id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4e',
  name: 'Family',
};
const passphrase = 'correct horse battery';

describe('LockScreen', () => {
  let storage: TestStorage;
  let fixture: ComponentFixture<App>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    localStorage.clear();
    storage = testStorage();
    await plantRows(storage.indexedDB, 'settings', [ontario]);
    await plantRows(storage.indexedDB, 'lists', [work]);
    // Turned on at an earlier visit.
    const engine = await openStorageEngine({
      dependencies: { indexedDB: storage.indexedDB, IDBKeyRange },
      onRejected: () => undefined,
      onWrite: () => undefined,
      lockIterations: 1_000,
    });
    await engine.enableLock(passphrase, 15);
    engine.close();

    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        provideRouter(routes),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(App);
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    await until(() => TestBed.inject(StorageService).lock() !== undefined);
    await until(() => element().querySelector('ss-lock-screen input') !== null);
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  const element = () => fixture.nativeElement as HTMLElement;
  const field = () => element().querySelector<HTMLInputElement>('ss-lock-screen input');
  const alertText = () =>
    element().querySelector('ss-lock-screen [role=alert]')?.textContent?.trim();
  const dialogText = () =>
    document.querySelector('mat-dialog-container')?.textContent?.replace(/\s+/g, ' ').trim();

  /** `text` as a pattern that matches it as written ("Forgot it?"). */
  const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Clicks the button whose text ends with `name`, after any icon's name. */
  async function press(name: string): Promise<void> {
    await (
      await loader.getHarness(MatButtonHarness.with({ text: new RegExp(`(^| )${escaped(name)}$`) }))
    ).click();
    await fixture.whenStable();
  }

  async function input(label: string): Promise<MatInputHarness> {
    const formField = await loader.getHarness(
      MatFormFieldHarness.with({ floatingLabelText: label }),
    );
    const control = await formField.getControl(MatInputHarness);
    if (!control) throw new Error(`No ${label}`);
    return control;
  }

  it('shows in place of the app, with focus in the passphrase field and no data', () => {
    expect(element().querySelector('ss-shell')).toBeNull();
    const heading = element().querySelector('h1');
    expect(heading?.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(heading?.textContent?.replace('lock', '').trim()).toBe('Simply Sub is locked');
    expect(document.activeElement).toBe(field());
    expect(field()?.type).toBe('password');
    expect(field()?.getAttribute('autocomplete')).toBe('current-password');
    expect(element().textContent).not.toContain('Work Related');
  });

  it('asks for the passphrase when the field is empty', async () => {
    await press('Unlock');
    const errors = await (
      await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: 'Passphrase' }))
    ).getTextErrors();
    expect(errors).toEqual(['Enter your passphrase']);
    expect(document.activeElement).toBe(field());
  });

  it('says a wrong passphrase is wrong, unlocks nothing, and keeps focus in the field', async () => {
    await (await input('Passphrase')).setValue('correct horse');
    await press('Unlock');
    await until(() => alertText() !== undefined, 5000);
    expect(alertText()).toBe('That passphrase is wrong, so nothing was unlocked.');
    expect(TestBed.inject(StorageService).lock()).toBe('locked');
    expect(element().querySelector('ss-shell')).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it('opens the app with the right passphrase', async () => {
    await (await input('Passphrase')).setValue(passphrase);
    await press('Unlock');
    await until(() => element().querySelector('ss-shell main#main') !== null, 5000);
    expect(element().querySelector('ss-lock-screen')).toBeNull();
    expect(TestBed.inject(StorageService).lock()).toBe('unlocked');
  });

  it('explains the ways out under “Forgot it?”', async () => {
    const toggle = await loader.getHarness(MatButtonHarness.with({ text: 'Forgot it?' }));
    expect(await (await toggle.host()).getAttribute('aria-expanded')).toBe('false');
    await toggle.click();
    expect(await (await toggle.host()).getAttribute('aria-expanded')).toBe('true');
    const forgot = element().querySelector('#forgot')?.textContent?.replace(/\s+/g, ' ');
    expect(forgot).toContain('Nobody can recover it');
    expect(forgot).toContain('Import a backup');
    expect(forgot).toContain('Delete all data');
  });

  it('deletes all data after DELETE is typed, which turns the lock off', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    await press('Forgot it?');
    await press('Delete all data');
    await until(() => dialogText()?.startsWith('Delete all data?') === true);
    expect(dialogText()).toContain('the lock is turned off');
    expect(dialogText()).not.toContain('export a backup first');
    await (await input('Type DELETE to confirm')).setValue('DELETE');
    await (
      await loader.getHarness(
        MatButtonHarness.with({ text: 'Delete all data', selector: '.danger' }),
      )
    ).click();
    await until(() => element().querySelector('ss-shell') !== null, 5000);
    expect(TestBed.inject(StorageService).lock()).toBe('off');
    expect(await storedRows(storage.indexedDB, 'settings')).toEqual([]);
    expect(await storedRows(storage.indexedDB, 'lists')).toEqual([]);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
  });

  it('imports a backup in place of everything here, after asking, which turns the lock off', async () => {
    await press('Forgot it?');
    await press('Import a backup');
    await until(() => document.querySelector('ss-import-backup-dialog input[type=file]') !== null);
    const picker = document.querySelector<HTMLInputElement>(
      'ss-import-backup-dialog input[type=file]',
    );
    const file = plainBackup({
      exportedAt: '2026-10-22T18:30:00.000Z',
      data: {
        settings: ontario,
        lists: [family],
        items: [],
        customSubs: [],
        rankings: [],
        cards: [],
        tags: [],
      },
    });
    Object.defineProperty(picker, 'files', {
      value: [new File([JSON.stringify(file)], 'simply-sub-backup-2026-10-22.json')],
      configurable: true,
    });
    picker?.dispatchEvent(new Event('change'));
    await until(() => dialogText()?.includes('turns the lock off') === true);
    // Nothing here can be merged with: the backup replaces it.
    expect(await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Merge' }))).toEqual([]);
    await press('Replace');
    await until(() => document.querySelector('ss-confirm-dialog') !== null);
    expect(document.querySelector('ss-confirm-dialog')?.textContent).toContain(
      'the lock is turned off',
    );
    await (
      await loader.getHarness(
        MatButtonHarness.with({ text: 'Replace', ancestor: 'ss-confirm-dialog' }),
      )
    ).click();
    await until(() => element().querySelector('ss-shell') !== null, 5000);
    expect(TestBed.inject(StorageService).lock()).toBe('off');
    expect(await storedRows(storage.indexedDB, 'lists')).toEqual([family]);
    expect(await storedRows(storage.indexedDB, 'settings')).toEqual([ontario]);
  });
});
