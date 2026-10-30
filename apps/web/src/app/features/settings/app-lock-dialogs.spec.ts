import type { ComponentHarnessConstructor, HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideRouter } from '@angular/router';
import type { Settings, SubscriptionList } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { SettingsStore } from '../../core/settings/settings-store';
import { AppLockRepository } from '../../core/storage/app-lock-repository';
import { StorageService } from '../../core/storage/storage-service';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { SettingsPage } from './settings-page';

// Settings' Security (P13): Lock with a passphrase turned on and off through its dialogs, and Lock after, on a fake
// IndexedDB with 1,000 iterations, for an Ontarian with one list.

const ontario: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  monthlyBudget: 200,
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};
const work: SubscriptionList = {
  id: '0192f1c4-7b2e-7c3a-9d41-5e8f2a1b3c4d',
  name: 'Work Related',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-20T09:15:00.000Z',
};
const passphrase = 'correct horse battery';

describe('Security', () => {
  let storage: TestStorage;
  let fixture: ComponentFixture<SettingsPage>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    localStorage.clear();
    storage = testStorage();
    await plantRows(storage.indexedDB, 'settings', [ontario]);
    await plantRows(storage.indexedDB, 'lists', [work]);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        {
          provide: CatalogStore,
          useValue: {
            version: signal('37f6573'),
            generatedAt: signal('2026-10-22T12:00:00Z'),
            check: async () => 'current',
          },
        },
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(SettingsPage);
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    await until(() => TestBed.inject(SettingsStore).saved() !== undefined);
    await fixture.whenStable();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  const lockBox = () =>
    loader.getHarness(MatCheckboxHarness.with({ label: 'Lock with a passphrase' }));
  const dialogText = () =>
    document.querySelector('mat-dialog-container')?.textContent?.replace(/\s+/g, ' ').trim();
  /** The newest snackbar's text: the one before can still be closing. */
  const snackBar = () =>
    [...document.querySelectorAll('.mat-mdc-snack-bar-container')].at(-1)?.textContent?.trim();
  const text = () => (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ');
  const storedSettings = async () =>
    ((await storedRows(storage.indexedDB, 'settings')) as Record<string, unknown>[])[0];
  const storedLists = async () => JSON.stringify(await storedRows(storage.indexedDB, 'lists'));

  /** Clicks the button whose text ends with `name`, after any icon's name. */
  async function press(name: string): Promise<void> {
    await (
      await loader.getHarness(MatButtonHarness.with({ text: new RegExp(`(^| )${name}$`) }))
    ).click();
    await fixture.whenStable();
  }

  async function control<T extends MatInputHarness | MatSelectHarness>(
    label: string,
    type: ComponentHarnessConstructor<T>,
  ): Promise<T> {
    const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    const found = await field.getControl(type);
    if (!found) throw new Error(`No ${label}`);
    return found;
  }

  /** Lock after's chosen option. */
  async function lockAfter(): Promise<string> {
    return (await control('Lock after', MatSelectHarness)).getValueText();
  }

  /** Picks Lock after's option `text`. */
  async function pickLockAfter(text: string): Promise<void> {
    const select = await control('Lock after', MatSelectHarness);
    await select.open();
    await select.clickOptions({ text });
  }

  async function errors(label: string): Promise<string[]> {
    return (
      await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }))
    ).getTextErrors();
  }

  /** Turns the lock on through its dialog, with Lock after left at 15 minutes unless `idle` says. */
  async function turnOn(idle?: string): Promise<void> {
    await (await lockBox()).toggle();
    await until(() => dialogText()?.startsWith('Lock with a passphrase') === true);
    await (await control('Passphrase', MatInputHarness)).setValue(passphrase);
    await (await control('Type it again', MatInputHarness)).setValue(passphrase);
    if (idle !== undefined) {
      await pickLockAfter(idle);
    }
    await press('Turn on the lock');
    await until(() => dialogText() === undefined, 5000);
  }

  it('starts off, and says what the lock does', async () => {
    expect(await (await lockBox()).isChecked()).toBe(false);
    expect(text()).toContain('Encrypts your data in this browser');
    expect(text()).not.toContain('Lock after');
  });

  it('asks for a passphrase of 8 characters, typed twice, and says it can’t be recovered', async () => {
    await (await lockBox()).toggle();
    await until(() => dialogText()?.startsWith('Lock with a passphrase') === true);
    // The checkbox shows what's so until the dialog has done it.
    expect(await (await lockBox()).isChecked()).toBe(false);
    expect(dialogText()).toContain('Nobody can recover a forgotten passphrase');
    expect(await lockAfter()).toBe('15 minutes');
    await (await control('Passphrase', MatInputHarness)).setValue('short');
    await (await control('Type it again', MatInputHarness)).setValue('other');
    await press('Turn on the lock');
    expect(await errors('Passphrase')).toEqual(['Use at least 8 characters']);
    expect(await errors('Type it again')).toEqual(['Type the same passphrase again']);
    expect(await storedSettings()).toEqual(ontario);

    await press('Cancel');
    await until(() => dialogText() === undefined);
    expect(await (await lockBox()).isChecked()).toBe(false);
    expect(await storedSettings()).toEqual(ontario);
  });

  it('offers an encrypted backup first, over its own dialog', async () => {
    await (await lockBox()).toggle();
    await until(() => dialogText()?.startsWith('Lock with a passphrase') === true);
    await press('Export a backup first');
    await until(() => document.querySelectorAll('mat-dialog-container').length === 2);
    expect(document.querySelector('ss-export-backup-dialog')?.textContent).toContain(
      'Protect with a passphrase',
    );
  });

  it('turns on: every table encrypted, Lock after kept, and the page says so', async () => {
    await turnOn('1 hour');
    await until(() => snackBar() === 'The lock is on', 5000);
    // The box follows the stored settings' live query, which can come a moment after the snackbar when the suite is
    // busy.
    await vi.waitFor(async () => expect(await (await lockBox()).isChecked()).toBe(true), {
      timeout: 5000,
    });
    expect(text()).toContain('Your data in this browser is encrypted');
    expect(await lockAfter()).toBe('1 hour');
    const settings = await storedSettings();
    expect(settings['appLock']).toMatchObject({ iterations: 1_000, idleMinutes: 60 });
    expect(settings).not.toHaveProperty('monthlyBudget');
    expect(await storedLists()).not.toContain('Work Related');
    expect(TestBed.inject(StorageService).lock()).toBe('unlocked');
  });

  it('changes Lock after, Never included', async () => {
    await turnOn();
    await pickLockAfter('Never');
    await vi.waitFor(async () =>
      expect((await storedSettings())['appLock']).not.toHaveProperty('idleMinutes'),
    );
    await pickLockAfter('5 minutes');
    await vi.waitFor(async () =>
      expect((await storedSettings())['appLock']).toMatchObject({ idleMinutes: 5 }),
    );
  });

  it('turns off only with the passphrase, and stores everything plain again', async () => {
    await turnOn();
    await (await lockBox()).toggle();
    await until(() => dialogText()?.startsWith('Turn off the lock?') === true);
    expect(await (await lockBox()).isChecked()).toBe(true);

    await press('Turn off the lock');
    expect(await errors('Passphrase')).toEqual(['Enter your passphrase']);
    const passphraseInput = await control('Passphrase', MatInputHarness);
    await passphraseInput.setValue('wrong passphrase');
    await press('Turn off the lock');
    await until(() => dialogText()?.includes('That passphrase is wrong') === true, 5000);
    expect(document.querySelector('ss-lock-off-dialog [role=alert]')?.textContent?.trim()).toBe(
      'That passphrase is wrong, so the lock is still on.',
    );
    expect(await passphraseInput.isFocused()).toBe(true);
    expect(await storedLists()).not.toContain('Work Related');

    await passphraseInput.setValue(passphrase);
    await press('Turn off the lock');
    await until(() => dialogText() === undefined, 5000);
    await until(() => snackBar() === 'The lock is off');
    expect(await (await lockBox()).isChecked()).toBe(false);
    expect(await storedSettings()).toEqual(ontario);
    expect(await storedRows(storage.indexedDB, 'lists')).toEqual([work]);
  });

  it('turns off once and stays open, however often Turn off the lock and Cancel are pressed meanwhile', async () => {
    await turnOn();
    // While it decrypts, both buttons only say they're disabled (disabledInteractive): Signal Forms doesn't submit the
    // form again until the last submission is done, and mat-dialog-close ignores a button that says it's disabled.
    const lock = TestBed.inject(AppLockRepository);
    const turnOff = lock.turnOff.bind(lock);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const turningOff = vi.spyOn(lock, 'turnOff').mockImplementation(async (typed) => {
      await held;
      return turnOff(typed);
    });
    await (await lockBox()).toggle();
    await until(() => dialogText()?.startsWith('Turn off the lock?') === true);
    await (await control('Passphrase', MatInputHarness)).setValue(passphrase);
    await press('Turn off the lock');
    await press('Decrypting…');
    await press('Cancel');
    expect(turningOff).toHaveBeenCalledTimes(1);
    expect(dialogText()).toContain('Turn off the lock?');

    release();
    await until(() => dialogText() === undefined, 5000);
    await until(() => snackBar() === 'The lock is off');
    expect(await storedRows(storage.indexedDB, 'lists')).toEqual([work]);
  });

  it('can’t be turned on when nothing is saved (IndexedDB blocked)', async () => {
    TestBed.inject(StorageService).useMemory();
    await TestBed.inject(SettingsStore).save({ country: 'CA', currency: 'CAD', theme: 'system' });
    await until(() => TestBed.inject(SettingsStore).saved() !== undefined);
    await fixture.whenStable();
    expect(await (await lockBox()).isDisabled()).toBe(true);
    expect(text()).toContain('Nothing is saved in this tab, so there’s nothing to lock.');
  });
});
