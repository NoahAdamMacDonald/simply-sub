import { DOCUMENT, DestroyRef, Service, computed, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Theme = Exclude<ThemeMode, 'system'>;

/**
 * localStorage key for the chosen mode. The inline script in index.html reads it too, to set
 * the theme before Angular starts. M4.2 moves the source of truth to `settings.theme` in Dexie.
 */
export const THEME_STORAGE_KEY = 'ss-theme';

/** Light/dark theme: keeps `data-theme` on <html> in sync with the user's choice and the OS. */
@Service()
export class ThemeService {
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly darkQuery = matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.darkQuery.matches);
  private readonly selectedMode = signal(readStoredMode());

  /** What the user chose. 'system' follows the OS setting. */
  readonly mode = this.selectedMode.asReadonly();

  /** The theme on screen. */
  readonly theme = computed<Theme>(() => {
    const mode = this.selectedMode();
    if (mode !== 'system') return mode;
    return this.systemDark() ? 'dark' : 'light';
  });

  constructor() {
    const onSystemChange = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.darkQuery.addEventListener('change', onSystemChange);
    inject(DestroyRef).onDestroy(() =>
      this.darkQuery.removeEventListener('change', onSystemChange),
    );

    effect(() => this.root.setAttribute('data-theme', this.theme()));
  }

  setMode(mode: ThemeMode): void {
    this.selectedMode.set(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage can be blocked (private mode); the choice then lasts until reload.
    }
  }

  /** The ☀/☾ button: switches to the opposite of what is on screen. */
  toggle(): void {
    this.setMode(this.theme() === 'dark' ? 'light' : 'dark');
  }
}

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}
