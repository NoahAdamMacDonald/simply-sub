import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { Router, provideRouter } from '@angular/router';
import {
  backupRefusals,
  backupSchemaVersion,
  encryptedBackup,
  plainBackup,
  type BackupPayload,
  type Settings,
  type SubscriptionList,
  type SyncRecord,
} from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { encryptText } from '../../core/crypto/passphrase-crypto';
import { SettingsStore } from '../../core/settings/settings-store';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { ConfirmService } from '../../shared/confirm/confirm-service';
import { SyncService } from '../../shared/sync/sync-service';
import { SettingsPage } from './settings-page';

// Settings' Your data (P13): Export, Import (Replace, Merge, a passphrase, a refused file) and Delete all data, on a
// fake IndexedDB, for an Ontarian with one list; then both with sync on (M10.9), with a stand-in for SyncService. The
// clock says Oct 25, 2026.

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

/** Sync on in this browser. */
const synced: SyncRecord = {
  key: 'sync',
  seed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  deviceId: '0192f1d0-0000-7000-8000-00000000000a',
  deviceName: 'Edge on Windows',
  version: '3',
  syncedAt: '2026-10-25T11:58:00.000Z',
  updatedAt: '2026-10-25T11:58:00.000Z',
};

/** A backup with Family only, and budgets in its settings. */
const payload: BackupPayload = {
  exportedAt: '2026-10-22T18:30:00.000Z',
  data: {
    settings: { ...ontario, monthlyBudget: 150 },
    lists: [family],
    items: [],
    customSubs: [],
    rankings: [],
    cards: [],
    tags: [],
    dismissedSuggestions: [],
  },
};

describe('Your data', () => {
  let storage: TestStorage;
  let fixture: ComponentFixture<SettingsPage>;
  let loader: HarnessLoader;
  let saved: { name: string; text: string }[];
  /** How many sync records were stored when the synced copy was deleted. */
  let deleteCopy: ReturnType<typeof vi.fn<() => Promise<number>>>;

  beforeEach(async () => {
    storage = testStorage();
    saved = [];
    deleteCopy = vi.fn(async () => (await storedRows(storage.indexedDB, 'sync')).length);
    await plantRows(storage.indexedDB, 'settings', [ontario]);
    await plantRows(storage.indexedDB, 'lists', [work]);
    // jsdom has no Blob URLs: what a download would save is kept here.
    const blobs = new Map<string, Blob>();
    URL.createObjectURL = (blob: Blob) => {
      const url = `blob:test/${blobs.size}`;
      blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = () => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      const blob = blobs.get(this.href);
      if (blob) void blob.text().then((text) => saved.push({ name: this.download, text }));
    });
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
        // Sync's card is on the page, but there's no server to sync with.
        {
          provide: SyncService,
          useValue: {
            record: signal(undefined),
            syncing: signal(false),
            snag: signal(undefined),
            devices: signal([]),
            start: () => undefined,
            deleteCopy,
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
    vi.restoreAllMocks();
    document.querySelectorAll('.cdk-overlay-container').forEach((overlay) => overlay.remove());
  });

  /** Clicks the button whose text ends with `text`, after any icon's name. */
  async function press(text: string): Promise<void> {
    await (
      await loader.getHarness(MatButtonHarness.with({ text: new RegExp(`(^| )${text}$`) }))
    ).click();
    await fixture.whenStable();
  }

  async function input(label: string): Promise<MatInputHarness> {
    const field = await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    const control = await field.getControl(MatInputHarness);
    if (!control) throw new Error(`No ${label}`);
    return control;
  }

  async function errors(label: string): Promise<string[]> {
    return (
      await loader.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }))
    ).getTextErrors();
  }

  const snackBar = () =>
    document.querySelector('.mat-mdc-snack-bar-container')?.textContent?.trim();
  const dialogText = () =>
    document.querySelector('mat-dialog-container')?.textContent?.replace(/\s+/g, ' ').trim();
  const storedLists = async () =>
    ((await storedRows(storage.indexedDB, 'lists')) as SubscriptionList[]).map((list) => list.name);

  /** Picks `text` as a file in the import dialog's file picker. */
  async function pickFile(text: string, name = 'simply-sub-backup-2026-10-22.json'): Promise<void> {
    await until(() => document.querySelector('ss-import-backup-dialog input[type=file]') !== null);
    const picker = document.querySelector<HTMLInputElement>(
      'ss-import-backup-dialog input[type=file]',
    );
    if (!picker) throw new Error('No file picker');
    Object.defineProperty(picker, 'files', {
      value: [new File([text], name, { type: 'application/json' })],
      configurable: true,
    });
    picker.dispatchEvent(new Event('change'));
  }

  it('exports every record to a file the browser downloads, and says so', async () => {
    await press('Export backup');
    await until(() => dialogText()?.startsWith('Export a backup') === true);
    await press('Export');

    await until(() => saved.length === 1);
    expect(saved[0].name).toBe('simply-sub-backup-2026-10-25.json');
    const file = JSON.parse(saved[0].text);
    expect(file).toMatchObject({
      app: 'simply-sub',
      catalogVersion: '37f6573',
      data: { settings: ontario, lists: [work] },
    });
    await until(() => snackBar() === 'Saved simply-sub-backup-2026-10-25.json');
  });

  it('asks for a passphrase of 8 characters, typed twice, then exports the backup encrypted', async () => {
    await press('Export backup');
    await until(() => dialogText()?.startsWith('Export a backup') === true);
    await (
      await loader.getHarness(MatCheckboxHarness.with({ label: 'Protect with a passphrase' }))
    ).check();
    expect(dialogText()).toContain('Nobody can recover a forgotten passphrase');
    await (await input('Passphrase')).setValue('short');
    await (await input('Type it again')).setValue('other');
    await press('Export');
    expect(await errors('Passphrase')).toEqual(['Use at least 8 characters']);
    expect(await errors('Type it again')).toEqual(['Type the same passphrase again']);
    expect(saved).toEqual([]);

    await (await input('Passphrase')).setValue('correct horse');
    await (await input('Type it again')).setValue('correct horse');
    await press('Export');
    await until(() => saved.length === 1);
    const file = JSON.parse(saved[0].text);
    expect(file).toMatchObject({
      app: 'simply-sub',
      encrypted: { kdf: 'PBKDF2-SHA256', iterations: 600_000 },
    });
    expect(saved[0].text).not.toContain('Work Related');
  }, 20_000);

  it('imports a backup: what it has, then Replace after asking', async () => {
    await press('Import backup');
    await until(() => dialogText()?.startsWith('Import a backup') === true);
    await pickFile(JSON.stringify(plainBackup(payload)));
    await until(() => dialogText()?.includes('Exported Oct 22, 2026') === true);
    expect(dialogText()).toContain('1 list');
    expect(dialogText()).toContain('your settings');

    await press('Replace');
    await until(() => document.querySelector('ss-confirm-dialog') !== null);
    expect(document.querySelector('ss-confirm-dialog h2')?.textContent).toBe(
      'Replace everything here?',
    );
    await (
      await TestbedHarnessEnvironment.documentRootLoader(fixture)
        .getChildLoader('ss-confirm-dialog')
        .then((dialog) => dialog.getHarness(MatButtonHarness.with({ text: 'Replace' })))
    ).click();

    await until(() => snackBar() === 'Imported the backup');
    expect(await storedLists()).toEqual(['Family']);
    expect(((await storedRows(storage.indexedDB, 'settings')) as Settings[])[0].monthlyBudget).toBe(
      150,
    );
  });

  it('merges a backup, keeping what’s here', async () => {
    await press('Import backup');
    await until(() => dialogText()?.startsWith('Import a backup') === true);
    await pickFile(JSON.stringify(plainBackup(payload)));
    await until(() => dialogText()?.includes('Merge keeps what’s here') === true);
    await press('Merge');
    await until(() => snackBar() === 'Merged 1 record from the backup');
    expect((await storedLists()).sort()).toEqual(['Family', 'Work Related']);
  });

  it('opens an encrypted backup with its passphrase, saying when it’s wrong', async () => {
    const envelope = await encryptText(
      JSON.stringify(payload),
      'correct horse',
      `simply-sub:${backupSchemaVersion}`,
      {
        iterations: 1_000,
      },
    );
    await press('Import backup');
    await until(() => dialogText()?.startsWith('Import a backup') === true);
    await pickFile(JSON.stringify(encryptedBackup(envelope)));
    await until(() => dialogText()?.includes('is protected with a passphrase') === true);

    await (await input('Passphrase')).setValue('wrong horse');
    await press('Open');
    await until(() => dialogText()?.includes(backupRefusals.wrongPassphrase) === true);
    expect(document.querySelector('ss-import-backup-dialog [role=alert]')).not.toBeNull();

    await (await input('Passphrase')).setValue('correct horse');
    await press('Open');
    await until(() => dialogText()?.includes('Exported Oct 22, 2026') === true);
    expect(await storedLists()).toEqual(['Work Related']);
  });

  it('says why a file can’t be imported, and writes nothing', async () => {
    await press('Import backup');
    await until(() => dialogText()?.startsWith('Import a backup') === true);
    await pickFile('not a backup', 'notes.txt');
    await until(() => dialogText()?.includes(backupRefusals.notJson) === true);
    expect(
      document.querySelector('ss-import-backup-dialog [role=alert]')?.textContent?.trim(),
    ).toBe(`notes.txt: ${backupRefusals.notJson}`);
    expect(await storedLists()).toEqual(['Work Related']);
  });

  it('deletes everything once DELETE is typed, then goes Home', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    // Folded under its summary on the page (M4.7); the button says a dialog follows.
    await press('Delete all data…');
    await until(() => dialogText()?.startsWith('Delete all data?') === true);
    await (await input('Type DELETE to confirm')).setValue('delete');
    await (
      await loader.getHarness(
        MatButtonHarness.with({ text: 'Delete all data', selector: '.danger' }),
      )
    ).click();
    expect(await errors('Type DELETE to confirm')).toEqual([
      'Type DELETE in capitals to delete everything',
    ]);
    expect(await storedLists()).toEqual(['Work Related']);

    await (await input('Type DELETE to confirm')).setValue('DELETE');
    await (
      await loader.getHarness(
        MatButtonHarness.with({ text: 'Delete all data', selector: '.danger' }),
      )
    ).click();
    await until(() => navigate.mock.calls.length > 0);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(await storedRows(storage.indexedDB, 'settings')).toEqual([]);
    expect(await storedRows(storage.indexedDB, 'lists')).toEqual([]);
  });

  describe('with sync on (M10.9)', () => {
    beforeEach(() => plantRows(storage.indexedDB, 'sync', [synced]));

    /** Deletes everything, with or without the synced copy, then waits until it has gone Home. */
    async function deleteAll(withSyncedCopy: boolean): Promise<void> {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
      await press('Delete all data…');
      await until(() => dialogText()?.includes('Delete the synced copy too') === true);
      expect(dialogText()).toContain('Sync turns off here either way.');
      if (withSyncedCopy) {
        await (
          await loader.getHarness(MatCheckboxHarness.with({ label: 'Delete the synced copy too' }))
        ).check();
      }
      await (await input('Type DELETE to confirm')).setValue('DELETE');
      await (
        await loader.getHarness(
          MatButtonHarness.with({ text: 'Delete all data', selector: '.danger' }),
        )
      ).click();
      await until(() => navigate.mock.calls.length > 0);
    }

    it('deletes the synced copy too when asked, while its code is still here', async () => {
      await deleteAll(true);
      expect(deleteCopy).toHaveBeenCalledTimes(1);
      expect(await deleteCopy.mock.results[0].value).toBe(1);
      expect(await storedRows(storage.indexedDB, 'sync')).toEqual([]);
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([]);
    });

    it('leaves the synced copy to the other devices otherwise, and still turns sync off here', async () => {
      await deleteAll(false);
      expect(deleteCopy).not.toHaveBeenCalled();
      expect(await storedRows(storage.indexedDB, 'sync')).toEqual([]);
      expect(await storedRows(storage.indexedDB, 'lists')).toEqual([]);
    });

    it('imports by Merge only, saying why Replace waits until sync is off', async () => {
      await press('Import backup');
      await until(() => dialogText()?.startsWith('Import a backup') === true);
      await pickFile(JSON.stringify(plainBackup(payload)));
      await until(() => dialogText()?.includes('With sync on, only Merge works') === true);
      const replace = await loader.getHarness(MatButtonHarness.with({ text: 'Replace' }));
      expect(await replace.isDisabled()).toBe(true);
      expect(await (await replace.host()).getAttribute('aria-describedby')).toBe(
        'import-sync-hint',
      );
      // Material's disabledInteractive leaves a button's clicks to the button.
      const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm');
      await replace.click();
      expect(confirm).not.toHaveBeenCalled();

      await press('Merge');
      await until(() => snackBar() === 'Merged 1 record from the backup');
      expect((await storedLists()).sort()).toEqual(['Family', 'Work Related']);
    });
  });
});
