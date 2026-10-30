import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MatDialogHarness } from '@angular/material/dialog/testing';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatAutocompleteHarness } from '@angular/material/autocomplete/testing';
import { TestKey } from '@angular/cdk/testing';
import type { Settings } from '@simply-sub/core';
import { BROWSER_LANGUAGES } from '../../core/settings/browser-languages';
import { FirstRun } from '../../core/settings/first-run';
import { SettingsStore } from '../../core/settings/settings-store';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../../core/storage/storage.testing';
import { ThemeService } from '../../core/theme/theme-service';

@Component({ template: '' })
class Host {}

describe('First run', () => {
  let storage: TestStorage;
  let loader: HarnessLoader;

  async function start(languages: readonly string[] = ['en-CA']) {
    TestBed.configureTestingModule({
      providers: [
        storage.providers,
        { provide: BROWSER_LANGUAGES, useValue: languages },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    TestBed.inject(FirstRun);
    await until(() => TestBed.inject(SettingsStore).status() !== 'loading');
  }

  /** The dialog, once it has loaded. */
  async function dialog(): Promise<HarnessLoader> {
    // The dialog is a lazy chunk, which can take more than a second to load when every spec runs at once.
    await vi.waitFor(
      async () => {
        TestBed.tick();
        expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    return loader.getChildLoader('mat-dialog-container');
  }

  /** The form field labelled `label`, or undefined when there's none. */
  async function field(dialog: HarnessLoader, label: string) {
    const fields = await dialog.getAllHarnesses(
      MatFormFieldHarness.with({ floatingLabelText: label }),
    );
    return fields[0];
  }

  /** The menu you can type in labelled `label` (M6.16). */
  async function select(dialog: HarnessLoader, label: string): Promise<MatAutocompleteHarness> {
    return dialog.getHarness(
      MatAutocompleteHarness.with({ ancestor: `ss-choice-field[data-label="${label}"]` }),
    );
  }

  async function input(dialog: HarnessLoader, label: string): Promise<MatInputHarness> {
    const control = await (await field(dialog, label)).getControl(MatInputHarness);
    if (!control) throw new Error(`No input labelled ${label}`);
    return control;
  }

  async function choose(dialog: HarnessLoader, label: string, option: string) {
    const menu = await select(dialog, label);
    await menu.focus();
    await menu.selectOption({ text: option });
  }

  async function getStarted(dialog: HarnessLoader) {
    await (await dialog.getHarness(MatButtonHarness.with({ text: 'Get started' }))).click();
  }

  const dialogText = () => document.querySelector('mat-dialog-container')?.textContent ?? '';

  beforeEach(() => {
    storage = testStorage();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('asks once the settings have loaded, starting from the browser’s language', async () => {
    await start(['en-CA']);
    const form = await dialog();
    expect(await (await select(form, 'Country')).getValue()).toBe('Canada');
    expect(await (await select(form, 'Currency')).getValue()).toBe('CAD — Canadian Dollar');
    expect(await (await select(form, 'Province or territory')).getValue()).toBe('');
    expect(dialogText()).toContain('Your data stays in this browser. No account needed.');
  });

  it('needs a Canadian’s province, then shows its tax and saves everything with the theme on screen', async () => {
    await start(['en-CA']);
    TestBed.inject(ThemeService).setMode('dark');
    const form = await dialog();

    await getStarted(form);
    TestBed.tick();
    expect(dialogText()).toContain('Choose your province or territory');
    expect(await storedRows(storage.indexedDB, 'settings')).toEqual([]);
    // Focus goes to the province, with its list closed, so the message under it shows (M6.16).
    const province = await select(form, 'Province or territory');
    expect(await province.isFocused()).toBe(true);
    expect(await province.isOpen()).toBe(false);

    await province.blur();
    await choose(form, 'Province or territory', 'Ontario');
    expect(dialogText()).toContain('Sales tax 13% (Ontario)');
    await (await input(form, 'Monthly budget')).setValue('200');
    await getStarted(form);

    await vi.waitFor(async () =>
      expect(await storedRows(storage.indexedDB, 'settings')).toEqual([
        {
          key: 'settings',
          country: 'CA',
          subdivision: 'CA-ON',
          currency: 'CAD',
          monthlyBudget: 200,
          theme: 'dark',
          sharedUpdatedAt: '2026-10-25T12:00:00.000Z',
          updatedAt: '2026-10-25T12:00:00.000Z',
        } satisfies Settings,
      ]),
    );
    await vi.waitFor(async () =>
      expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0),
    );
  });

  it('saves a Canadian’s own rate in place of the built-in one', async () => {
    await start(['fr-CA']);
    const form = await dialog();
    await choose(form, 'Province or territory', 'Quebec');
    expect(dialogText()).toContain('Sales tax 14.975% (Quebec)');
    await (await form.getHarness(MatCheckboxHarness.with({ label: 'Use my own rate' }))).check();
    await getStarted(form);
    expect(dialogText()).toContain('Enter your rate, or untick “Use my own rate”');

    await (await input(form, 'Sales tax rate')).setValue('5');
    await getStarted(form);
    await vi.waitFor(async () =>
      expect(await storedRows(storage.indexedDB, 'settings')).toMatchObject([
        { country: 'CA', subdivision: 'CA-QC', salesTaxPercent: 5 },
      ]),
    );
  });

  it('lists only the chosen country’s subdivisions, and asks a US user for their own rate', async () => {
    await start(['en-CA']);
    const form = await dialog();
    await choose(form, 'Country', 'United States');

    expect(await (await select(form, 'Currency')).getValue()).toBe('USD — US Dollar');
    const states = await select(form, 'State');
    await states.focus();
    const options = await Promise.all(
      (await states.getOptions()).map((option) => option.getText()),
    );
    expect(options).toHaveLength(52);
    expect(options).toEqual(
      expect.arrayContaining(['Not given', 'California', 'District of Columbia']),
    );
    expect(options).not.toContain('Ontario');
    await states.blur();

    expect(dialogText()).toContain('Your state and city sales tax on subscriptions, if any');
    await getStarted(form);
    await vi.waitFor(async () =>
      expect(await storedRows(storage.indexedDB, 'settings')).toMatchObject([
        { country: 'US', currency: 'USD' },
      ]),
    );
    const [saved] = (await storedRows(storage.indexedDB, 'settings')) as Settings[];
    expect(saved.subdivision).toBeUndefined();
    expect(saved.salesTaxPercent).toBeUndefined();
  });

  it('narrows a menu as it’s typed in, and Enter picks the first left (M6.16)', async () => {
    await start(['en-CA']);
    const form = await dialog();
    const province = await select(form, 'Province or territory');
    // Focused with nothing typed, it lists them all.
    await province.focus();
    expect(await province.getOptions()).toHaveLength(13);

    await province.enterText('al');
    const shown = async () =>
      Promise.all((await province.getOptions()).map((option) => option.getText()));
    expect(await shown()).toEqual(['Alberta']);
    // The first is made active a moment after the list changes.
    await vi.waitFor(async () =>
      expect(await (await province.getOptions())[0].isActive()).toBe(true),
    );
    await (await province.host()).sendKeys(TestKey.ENTER);
    expect(await province.getValue()).toBe('Alberta');
    expect(dialogText()).toContain('Sales tax 5% (Alberta)');

    // A name's start first, then anywhere in it; or its code: "us" is US Dollar, then the rest.
    const currency = await select(form, 'Currency');
    await currency.clear();
    await currency.enterText('dollar');
    expect(
      (await Promise.all((await currency.getOptions()).map((option) => option.getText()))).slice(
        0,
        2,
      ),
    ).toEqual(['AUD — Australian Dollar', 'CAD — Canadian Dollar']);
    await currency.clear();
    await currency.enterText('usd');
    expect(
      await Promise.all((await currency.getOptions()).map((option) => option.getText())),
    ).toEqual(['USD — US Dollar']);

    // Leaving without picking puts back the one chosen.
    await currency.blur();
    await vi.waitFor(async () => expect(await currency.getValue()).toBe('CAD — Canadian Dollar'));
  });

  it('closes a menu’s list when focus moves on to the next field, though the dialog is an overlay too', async () => {
    await start(['en-CA']);
    const form = await dialog();
    const province = await select(form, 'Province or territory');
    await province.focus();
    expect(await province.isOpen()).toBe(true);

    const currency = await select(form, 'Currency');
    await currency.focus();
    expect(await province.isOpen()).toBe(false);
    expect(await currency.isOpen()).toBe(true);
  });

  it('closes a menu’s list on Tab, though Tab comes before the list is drawn', async () => {
    await start(['en-CA']);
    const form = await dialog();
    // Focused, it opens its list; the Tab key straight after, before anything is drawn.
    const box = document.querySelector<HTMLInputElement>(
      'ss-choice-field[data-label="Country"] input',
    );
    box?.focus();
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(await (await select(form, 'Country')).isOpen()).toBe(false);
  });

  it('keeps a menu’s list open when a press on a choice sends focus to the dialog', async () => {
    await start(['en-CA']);
    const form = await dialog();
    const province = await select(form, 'Province or territory');
    await province.focus();
    expect(await province.isOpen()).toBe(true);

    // A press on a choice moves focus to the nearest focusable element around it: in a browser, which draws the list
    // inside the dialog, the dialog. The list stays open for the click that follows.
    document.querySelector<HTMLElement>('mat-dialog-container')?.focus();
    expect(await province.isOpen()).toBe(true);
    await province.selectOption({ text: 'Ontario' });
    expect(await province.getValue()).toBe('Ontario');
  });

  it('asks nothing about tax where prices include it', async () => {
    await start(['en-GB']);
    const form = await dialog();
    expect(await (await select(form, 'Currency')).getValue()).toBe('GBP — British Pound');
    expect(await field(form, 'Province or territory')).toBeUndefined();
    expect(await field(form, 'State')).toBeUndefined();
    expect(dialogText()).toContain('Prices for United Kingdom already include sales tax.');
  });

  it('keeps a currency the user picked when the country changes', async () => {
    await start(['en-CA']);
    const form = await dialog();
    await choose(form, 'Currency', 'EUR — Euro');
    await choose(form, 'Country', 'United Kingdom');
    expect(await (await select(form, 'Currency')).getValue()).toBe('EUR — Euro');
  });

  it("can't be closed without saving", async () => {
    await start();
    await dialog();
    document
      .querySelector('mat-dialog-container')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    TestBed.tick();
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(1);
  });

  it("doesn't ask when settings are saved", async () => {
    await plantRows(storage.indexedDB, 'settings', [
      {
        key: 'settings',
        country: 'CA',
        subdivision: 'CA-ON',
        currency: 'CAD',
        theme: 'system',
        updatedAt: '2026-10-25T12:00:00.000Z',
      } satisfies Settings,
    ]);
    await start();
    await until(() => TestBed.inject(SettingsStore).saved() !== undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
  });

  it('imports a backup instead, which ends the first run', async () => {
    await start();
    const first = await dialog();
    await (
      await first.getHarness(MatButtonHarness.with({ text: 'Import a backup instead' }))
    ).click();
    await until(() => document.querySelector('ss-import-backup-dialog input[type=file]') !== null);
    const picker = document.querySelector<HTMLInputElement>(
      'ss-import-backup-dialog input[type=file]',
    );
    const backup = {
      app: 'simply-sub',
      schemaVersion: 1,
      exportedAt: '2026-10-22T18:30:00.000Z',
      data: {
        settings: {
          key: 'settings',
          country: 'GB',
          currency: 'GBP',
          theme: 'dark',
          updatedAt: '2026-10-20T09:15:00.000Z',
        },
        lists: [],
        items: [],
        customSubs: [],
        rankings: [],
        cards: [],
        tags: [],
      },
    };
    Object.defineProperty(picker, 'files', {
      value: [new File([JSON.stringify(backup)], 'backup.json')],
    });
    picker?.dispatchEvent(new Event('change'));
    // Nothing is here yet, so it's one Import, with nothing to ask.
    await vi.waitFor(async () => {
      TestBed.tick();
      expect(await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Import' }))).toHaveLength(
        1,
      );
    });
    expect(await loader.getAllHarnesses(MatButtonHarness.with({ text: 'Replace' }))).toHaveLength(
      0,
    );
    await (await loader.getHarness(MatButtonHarness.with({ text: 'Import' }))).click();

    await until(() => TestBed.inject(SettingsStore).saved()?.country === 'GB');
    await vi.waitFor(async () => {
      TestBed.tick();
      expect(await loader.getAllHarnesses(MatDialogHarness)).toHaveLength(0);
    });
  });
});
