import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Settings } from '@simply-sub/core';
import { SettingsStore } from '../settings/settings-store';
import {
  plantRows,
  storedRows,
  testStorage,
  until,
  type TestStorage,
} from '../storage/storage.testing';
import { THEME_STORAGE_KEY, ThemeService } from './theme-service';

/** A prefers-color-scheme query whose answer the test can change. */
class FakeDarkQuery {
  private readonly listeners = new Set<(event: MediaQueryListEvent) => void>();

  constructor(public matches: boolean) {}

  addEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'change', listener: (event: MediaQueryListEvent) => void): void {
    this.listeners.delete(listener);
  }

  /** The user switches the OS between light and dark. */
  change(matches: boolean): void {
    this.matches = matches;
    this.listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
  }
}

const settings: Settings = {
  key: 'settings',
  country: 'CA',
  subdivision: 'CA-ON',
  currency: 'CAD',
  theme: 'system',
  updatedAt: '2026-10-25T12:00:00.000Z',
};

describe('ThemeService', () => {
  let osQuery: FakeDarkQuery;
  let storage: TestStorage;

  beforeEach(() => {
    storage = testStorage();
    TestBed.configureTestingModule({ providers: storage.providers });
  });

  function setup({ osDark = false, saved }: { osDark?: boolean; saved?: string } = {}) {
    osQuery = new FakeDarkQuery(osDark);
    vi.stubGlobal('matchMedia', () => osQuery);
    if (saved) localStorage.setItem(THEME_STORAGE_KEY, saved);
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  }

  /** The service once the settings have loaded, with `stored` saved before it started. */
  async function setupWithSettings(stored: Partial<Settings>, options: { saved?: string } = {}) {
    await plantRows(storage.indexedDB, 'settings', [{ ...settings, ...stored }]);
    const service = setup(options);
    await until(() => TestBed.inject(SettingsStore).saved() !== undefined);
    return service;
  }

  const dataTheme = () => document.documentElement.getAttribute('data-theme');
  const storedTheme = async () =>
    ((await storedRows(storage.indexedDB, 'settings'))[0] as Settings | undefined)?.theme;

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  it('follows the OS when nothing is saved', () => {
    const service = setup({ osDark: true });
    expect(service.mode()).toBe('system');
    expect(service.theme()).toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('updates live when the OS setting changes in system mode', () => {
    const service = setup({ osDark: false });
    osQuery.change(true);
    TestBed.tick();
    expect(service.theme()).toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('ignores OS changes once light or dark is chosen', () => {
    const service = setup({ osDark: false });
    service.setMode('light');
    osQuery.change(true);
    TestBed.tick();
    expect(dataTheme()).toBe('light');
  });

  it('starts from the cached mode over the OS setting', () => {
    const service = setup({ osDark: false, saved: 'dark' });
    expect(service.mode()).toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('treats an unknown cached value as system', () => {
    const service = setup({ osDark: true, saved: 'sepia' });
    expect(service.mode()).toBe('system');
    expect(dataTheme()).toBe('dark');
  });

  it('caches the chosen mode, including system', () => {
    const service = setup();
    service.setMode('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    service.setMode('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('toggles to the opposite of what is on screen', () => {
    const service = setup({ osDark: true });
    service.toggle();
    TestBed.tick();
    expect(service.mode()).toBe('light');
    expect(dataTheme()).toBe('light');
    service.toggle();
    expect(service.mode()).toBe('dark');
  });

  it('still switches the theme when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const service = setup();
    expect(service.mode()).toBe('system');
    service.setMode('dark');
    TestBed.tick();
    expect(dataTheme()).toBe('dark');
  });

  describe('with saved settings', () => {
    it('follows settings.theme over the cache, and caches it for the next start', async () => {
      const service = await setupWithSettings({ theme: 'dark' }, { saved: 'light' });
      expect(service.mode()).toBe('dark');
      expect(dataTheme()).toBe('dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('saves the choice in the settings', async () => {
      const service = await setupWithSettings({ theme: 'system' });
      service.setMode('light');
      await vi.waitFor(async () => expect(await storedTheme()).toBe('light'));
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });

    it('follows a change saved elsewhere: another tab, or an import', async () => {
      const service = await setupWithSettings({ theme: 'light' });
      await plantRows(storage.indexedDB, 'settings', [
        { ...settings, theme: 'dark', updatedAt: '2026-10-25T13:00:00.000Z' },
      ]);
      await until(() => service.mode() === 'dark');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });
  });

  describe('while its writes are on their way', () => {
    // The live query answers after a write resolves, with a read of its own, so for a moment the saved settings are
    // older than the screen. A fake store shows that moment; fake-indexeddb answers too quickly to.
    let saved: WritableSignal<Settings | undefined>;
    let writes: { theme: string; resolve: (stored: Settings) => void }[];

    beforeEach(() => {
      saved = signal<Settings | undefined>({ ...settings, theme: 'light' });
      writes = [];
      const fakeStore: Partial<SettingsStore> = {
        saved,
        update: (changes) =>
          new Promise<Settings | undefined>((resolve) =>
            writes.push({ theme: changes.theme ?? '', resolve }),
          ),
      };
      TestBed.overrideProvider(SettingsStore, { useValue: fakeStore });
    });

    const stamped = (theme: Settings['theme'], minute: number): Settings => ({
      ...settings,
      theme,
      updatedAt: `2026-10-25T12:0${minute}:00.000Z`,
    });

    it('keeps the last choice until the saved settings catch up with it', async () => {
      const service = setup();
      TestBed.tick();
      expect(service.mode()).toBe('light');

      service.toggle();
      service.toggle();
      service.toggle();
      expect(writes.map((write) => write.theme)).toEqual(['dark', 'light', 'dark']);

      writes.forEach((write, index) =>
        write.resolve(stamped(write.theme as Settings['theme'], index + 1)),
      );
      await Promise.resolve();
      await Promise.resolve();
      TestBed.tick();
      // Every write is saved, but the live query still has the old settings.
      expect(service.mode()).toBe('dark');

      saved.set(stamped('light', 2));
      TestBed.tick();
      expect(service.mode()).toBe('dark');

      saved.set(stamped('dark', 3));
      TestBed.tick();
      expect(service.mode()).toBe('dark');
    });

    it('then follows a newer change from elsewhere', async () => {
      const service = setup();
      service.setMode('dark');
      writes[0].resolve(stamped('dark', 1));
      await Promise.resolve();
      await Promise.resolve();
      saved.set(stamped('system', 5));
      TestBed.tick();
      expect(service.mode()).toBe('system');
    });
  });

  it('only caches the choice before the first run, which saves it', async () => {
    const service = setup();
    await until(() => TestBed.inject(SettingsStore).status() === 'ready');
    service.setMode('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(await storedRows(storage.indexedDB, 'settings')).toEqual([]);
  });
});
