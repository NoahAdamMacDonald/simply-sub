import { TestBed } from '@angular/core/testing';
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

describe('ThemeService', () => {
  let osQuery: FakeDarkQuery;

  function setup({ osDark = false, saved }: { osDark?: boolean; saved?: string } = {}) {
    osQuery = new FakeDarkQuery(osDark);
    vi.stubGlobal('matchMedia', () => osQuery);
    if (saved) localStorage.setItem(THEME_STORAGE_KEY, saved);
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  }

  const dataTheme = () => document.documentElement.getAttribute('data-theme');

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

  it('restores the saved mode over the OS setting', () => {
    const service = setup({ osDark: false, saved: 'dark' });
    expect(service.mode()).toBe('dark');
    expect(dataTheme()).toBe('dark');
  });

  it('treats an unknown saved value as system', () => {
    const service = setup({ osDark: true, saved: 'sepia' });
    expect(service.mode()).toBe('system');
    expect(dataTheme()).toBe('dark');
  });

  it('saves the chosen mode, including system', () => {
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
});
