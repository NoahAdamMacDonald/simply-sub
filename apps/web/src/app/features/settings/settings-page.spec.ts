import type { ComponentHarnessConstructor, HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatRadioGroupHarness } from '@angular/material/radio/testing';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { Router, provideRouter } from '@angular/router';
import type { Settings } from '@simply-sub/core';
import { CatalogStore, type CatalogCheckOutcome } from '../../core/catalog/catalog-store';
import { AppUpdates, type AppCheckOutcome } from '../../core/pwa/app-updates';
import { installOffer, installedHere, type InstallPromptEvent } from '../../core/pwa/install-offer';
import { SettingsStore } from '../../core/settings/settings-store';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { ThemeService } from '../../core/theme/theme-service';
import { SettingsPage } from './settings-page';

const ontario: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  monthlyBudget: 200,
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

/** The parts of CatalogStore the Catalog line uses, with no downloads. */
class FakeCatalogStore {
  readonly version = signal<string | undefined>('37f6573');
  readonly generatedAt = signal<string | undefined>('2026-10-22T12:00:00Z');
  readonly check = vi.fn(async (): Promise<CatalogCheckOutcome> => 'current');
}

/** AppUpdates as a development build has it, with no worker, until a test gives it one. */
class FakeAppUpdates {
  readonly available = signal(false);
  readonly check = vi.fn(async (): Promise<AppCheckOutcome> => 'current');
}

describe('SettingsPage', () => {
  let catalog: FakeCatalogStore;
  let appUpdates: FakeAppUpdates;
  let storage: TestStorage;
  let fixture: ComponentFixture<SettingsPage>;
  let loader: HarnessLoader;

  beforeEach(async () => {
    storage = testStorage();
    catalog = new FakeCatalogStore();
    appUpdates = new FakeAppUpdates();
    await plantRows(storage.indexedDB, 'settings', [ontario]);
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: CatalogStore, useValue: catalog },
        { provide: AppUpdates, useValue: appUpdates },
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
    document.documentElement.removeAttribute('data-theme');
    installOffer.set(undefined);
    installedHere.set(false);
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const saved = async () => ((await storedRows(storage.indexedDB, 'settings')) as Settings[])[0];

  /** Waits for the page to show `expected`, once the live query has the saved change. */
  async function shows(expected: string) {
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(text()).toContain(expected);
    });
  }

  /** The input or menu labelled `label`. */
  async function control<T extends MatInputHarness | MatSelectHarness>(
    within: HarnessLoader,
    label: string,
    type: ComponentHarnessConstructor<T>,
  ): Promise<T> {
    const field = await within.getHarness(MatFormFieldHarness.with({ floatingLabelText: label }));
    const found = await field.getControl(type);
    if (!found) throw new Error(`No control labelled ${label}`);
    return found;
  }

  it('shows where the user is, with the sales tax that follows, and the budgets', () => {
    expect(text()).toContain('Ontario, Canada (CAD)');
    expect(text()).toContain('Sales tax 13% (Ontario)');
    expect(text()).toContain('Monthly budget: $200');
    expect(text()).toContain('Annual budget: Not set');
  });

  describe('a budget', () => {
    async function edit(label: string): Promise<MatInputHarness> {
      await (
        await loader.getHarness(MatButtonHarness.with({ selector: `[aria-label="Edit ${label}"]` }))
      ).click();
      return control(loader, label, MatInputHarness);
    }

    it('is edited in place: Enter saves, and focus goes back to ✎', async () => {
      const amount = await edit('Annual budget');
      expect(await amount.isFocused()).toBe(true);
      await amount.setValue('1000');
      // What Enter in a form's field does in a browser; jsdom doesn't.
      (fixture.nativeElement as HTMLElement).querySelector('form')!.requestSubmit();
      await vi.waitFor(async () => expect((await saved()).annualBudget).toBe(1000));
      await shows('Annual budget: $1,000');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Edit Annual budget');
    });

    it('is cleared when left empty', async () => {
      const amount = await edit('Monthly budget');
      await amount.setValue('');
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
      await vi.waitFor(async () => expect((await saved()).monthlyBudget).toBeUndefined());
      await shows('Monthly budget: Not set');
    });

    it('must be above 0', async () => {
      const amount = await edit('Monthly budget');
      await amount.setValue('0');
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
      expect(text()).toContain('Enter an amount above 0, or leave it empty');
      expect((await saved()).monthlyBudget).toBe(200);
    });

    it('is left as it was on Escape', async () => {
      const amount = await edit('Monthly budget');
      await amount.setValue('50');
      (await amount.host()).dispatchEvent('keydown', { key: 'Escape' });
      await fixture.whenStable();
      expect(text()).toContain('Monthly budget: $200');
      expect((await saved()).monthlyBudget).toBe(200);
    });
  });

  it('sets the theme, System included', async () => {
    const appearance = await loader.getHarness(MatRadioGroupHarness);
    expect(await appearance.getCheckedValue()).toBe('system');
    await appearance.checkRadioButton({ label: 'Dark' });
    expect(TestBed.inject(ThemeService).mode()).toBe('dark');
    await vi.waitFor(async () => expect((await saved()).theme).toBe('dark'));
  });

  it('keeps Search’s Sold in default, on or left out', async () => {
    const sold = await loader.getHarness(
      MatCheckboxHarness.with({ label: "Show only what's sold in Canada" }),
    );
    expect(await sold.isChecked()).toBe(false);
    expect(text()).toContain('Search starts with its “Sold in Canada” filter on.');

    await sold.check();
    await vi.waitFor(async () => expect((await saved()).searchSoldOnly).toBe(true));
    await sold.uncheck();
    await vi.waitFor(async () => expect(await saved()).not.toHaveProperty('searchSoldOnly'));
  });

  it('keeps Show every reseller, off unless it’s turned on (M5.13)', async () => {
    const sold = await loader.getHarness(
      MatCheckboxHarness.with({ label: "Show every reseller, even when it isn't cheaper" }),
    );
    expect(await sold.isChecked()).toBe(false);
    expect(text()).toContain('Search lists each official reseller of a plan');

    await sold.check();
    await vi.waitFor(async () => expect((await saved()).searchAllResellers).toBe(true));
    await sold.uncheck();
    await vi.waitFor(async () => expect(await saved()).not.toHaveProperty('searchAllResellers'));
  });

  describe('the 📍 dialog', () => {
    async function open(): Promise<HarnessLoader> {
      await (await loader.getHarness(MatButtonHarness.with({ text: /Ontario, Canada/ }))).click();
      await loader.getHarness(MatDialogHarness);
      return loader.getChildLoader('mat-dialog-container');
    }

    it('changes the province, and the tax follows', async () => {
      const dialog = await open();
      const province = await dialog.getHarness(
        MatAutocompleteHarness.with({
          ancestor: 'ss-choice-field[data-label="Province or territory"]',
        }),
      );
      await province.focus();
      await province.selectOption({ text: 'Quebec' });
      await (await dialog.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();

      await shows('Quebec, Canada (CAD)');
      expect(text()).toContain('Sales tax 14.975% (Quebec)');
      expect(await saved()).toMatchObject({
        subdivision: 'CA-QC',
        monthlyBudget: 200,
        theme: 'system',
      });
    });

    it('takes the user’s own rate', async () => {
      const dialog = await open();
      await (
        await dialog.getHarness(MatCheckboxHarness.with({ label: 'Use my own rate' }))
      ).check();
      await (await control(dialog, 'Sales tax rate', MatInputHarness)).setValue('5');
      await (await dialog.getHarness(MatButtonHarness.with({ text: 'Save' }))).click();
      await shows('Sales tax 5% (your rate)');
    });

    it('changes nothing on Cancel', async () => {
      const dialog = await open();
      const country = await dialog.getHarness(
        MatAutocompleteHarness.with({ ancestor: 'ss-choice-field[data-label="Country"]' }),
      );
      await country.focus();
      await country.selectOption({ text: 'United Kingdom' });
      await (await dialog.getHarness(MatButtonHarness.with({ text: 'Cancel' }))).click();
      await vi.waitFor(async () =>
        expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0),
      );
      expect(await saved()).toEqual(ontario);
    });
  });

  describe('the Catalog line', () => {
    const message = () =>
      (fixture.nativeElement as HTMLElement).querySelector('.check-message[role="status"]');

    it("gives the catalog's date and version", () => {
      expect(text()).toContain('Updated Oct 22, 2026 · version 37f6573');
    });

    it('says when no catalog has been downloaded', async () => {
      catalog.version.set(undefined);
      catalog.generatedAt.set(undefined);
      await fixture.whenStable();
      expect(text()).toContain('Not downloaded yet');
    });

    it.each([
      ['current', 'You have the latest catalog.'],
      ['updated', 'Downloaded the latest catalog.'],
      ['offline', "You're offline. Try again when you're back online."],
      ['failed', "Couldn't check for updates. Try again later."],
    ] as const)('checks for updates and says what it found: %s', async (outcome, expected) => {
      expect(message()?.textContent).toBe('');
      catalog.check.mockResolvedValue(outcome);
      await (await loader.getHarness(MatButtonHarness.with({ text: 'Check for updates' }))).click();
      await fixture.whenStable();
      expect(catalog.check).toHaveBeenCalledTimes(1);
      expect(message()?.textContent).toBe(expected);
    });
  });

  describe('the App group (M10.6)', () => {
    const appSection = (id: string) =>
      (fixture.nativeElement as HTMLElement).querySelector(
        `section[aria-labelledby="${id}-heading"]`,
      );

    it('is on the page and in On this page, with Install and Version', () => {
      expect(appSection('app')?.querySelector('h2')?.textContent).toBe('App');
      const links = [
        ...(fixture.nativeElement as HTMLElement).querySelectorAll(
          'nav[aria-label="On this page"] a',
        ),
      ].map((link) => link.textContent?.trim());
      expect(links.slice(-3)).toEqual(['App', 'Install', 'Version']);
    });

    it('offers Install when the browser does, which shows its dialog once', async () => {
      const prompt = vi.fn(async () => ({ outcome: 'accepted' as const }));
      installOffer.set(
        Object.assign(new Event('beforeinstallprompt'), { prompt }) as InstallPromptEvent,
      );
      await fixture.whenStable();
      await (
        await loader.getHarness(MatButtonHarness.with({ text: /Install Simply Sub$/ }))
      ).click();
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(appSection('install')?.textContent).toContain(
        'Safari on a Mac: File, then Add to Dock.',
      );

      installedHere.set(true);
      await fixture.whenStable();
      expect(appSection('install')?.textContent).toContain(
        'Installed: open Simply Sub from your apps, home screen or taskbar.',
      );
    });

    it('gives each browser’s steps when there’s no offer', () => {
      const install = appSection('install')?.textContent ?? '';
      expect(install).toContain('Safari on an iPhone or iPad: Share, then Add to Home Screen.');
      expect(install).toContain('Firefox on Android: the menu, then Install.');
      expect(appSection('install')?.querySelector('button')).toBeNull();
    });

    it('says a development build has no version, and has nothing to check with', () => {
      const version = appSection('version')?.textContent ?? '';
      expect(version).toContain('A development build');
      expect(version).toContain('Each visit loads the latest version.');
      expect(appSection('version')?.querySelector('button')).toBeNull();
    });

    it.each([
      ['current', 'You have the latest version.'],
      ['ready', 'A new version is ready: reload to use it.'],
      ['offline', "You're offline. Try again when you're back online."],
      ['failed', "Couldn't check for updates. Try again later."],
    ] as const)(
      'checks for a new version and says what it found: %s',
      async (outcome, expected) => {
        appUpdates.available.set(true);
        appUpdates.check.mockResolvedValue(outcome);
        await fixture.whenStable();
        appSection('version')?.querySelector('button')?.click();
        await fixture.whenStable();
        expect(appUpdates.check).toHaveBeenCalledTimes(1);
        expect(appSection('version')?.querySelector('[role="status"]')?.textContent).toBe(expected);
        expect(appSection('version')?.textContent).not.toContain('Each visit loads');
      },
    );
  });

  it('goes back Home when Settings was the first page opened', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    await (
      await loader.getHarness(MatButtonHarness.with({ selector: '.back', text: /Back$/ }))
    ).click();
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
