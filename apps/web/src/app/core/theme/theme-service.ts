import {
  DOCUMENT,
  DestroyRef,
  Service,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { Timestamp } from '@simply-sub/core';
import { SettingsStore } from '../settings/settings-store';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Theme = Exclude<ThemeMode, 'system'>;

/**
 * localStorage key for the chosen mode: the startup cache. The inline script in index.html reads it to set the theme
 * before Angular starts, since IndexedDB can't be read that early.
 */
export const THEME_STORAGE_KEY = 'ss-theme';

/**
 * Light/dark theme: keeps `data-theme` on <html> in sync with the user's choice and the OS. `settings.theme` is the
 * source of truth (BLUEPRINT §8.1): it starts from the cache, which the inline script has painted, and follows the
 * saved settings once they load and whenever they change, in this tab or another one, or by an import. Before the
 * first run there are no settings to save it in, so it's only cached, and the first-run dialog saves it.
 */
@Service()
export class ThemeService {
  private readonly settings = inject(SettingsStore);
  private readonly root = inject(DOCUMENT).documentElement;
  private readonly darkQuery = matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.darkQuery.matches);
  private readonly selectedMode = signal(readCachedMode());
  // While the toggle's writes are being saved, and until the live query has caught up with the last one, the saved
  // settings are older than the screen.
  private readonly writing = signal(0);
  private lastWritten?: Timestamp;

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

    effect(() => {
      const saved = this.settings.saved();
      if (saved === undefined || this.writing() > 0) return;
      if (this.lastWritten !== undefined && saved.updatedAt < this.lastWritten) return;
      untracked(() => this.show(saved.theme));
    });
  }

  setMode(mode: ThemeMode): void {
    this.show(mode);
    if (this.settings.saved() === undefined) return;
    this.writing.update((count) => count + 1);
    // A failed write reaches GlobalErrorHandler; the theme stays on screen until reload.
    void this.settings
      .update({ theme: mode })
      .then((saved) => (this.lastWritten = saved?.updatedAt))
      .finally(() => this.writing.update((count) => count - 1));
  }

  /** The ☀/☾ button: switches to the opposite of what is on screen. */
  toggle(): void {
    this.setMode(this.theme() === 'dark' ? 'light' : 'dark');
  }

  private show(mode: ThemeMode): void {
    if (mode === this.selectedMode()) return;
    this.selectedMode.set(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage can be blocked (private mode); the choice then lasts until reload.
    }
  }
}

function readCachedMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}
