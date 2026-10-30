import { DOCUMENT, effect, type Injector } from '@angular/core';
import { ThemeService, type Theme } from './theme-service';

/**
 * An installed app's title bar (PROJECT-PLAN M10.6) takes its colour from index.html's theme-color metas, the top bar's
 * colour for each OS scheme. Once the app has started (app.background.ts), both take the colour of the theme on screen,
 * which the user may have chosen against the OS's.
 */
export function followThemeInTitleBar(injector: Injector): void {
  const metas = [
    ...injector.get(DOCUMENT).querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
  ];
  const colours = new Map<Theme, string>(
    metas.map((meta) => [meta.media.includes('dark') ? 'dark' : 'light', meta.content]),
  );
  const theme = injector.get(ThemeService).theme;
  effect(
    () => {
      const colour = colours.get(theme());
      if (colour) metas.forEach((meta) => (meta.content = colour));
    },
    { injector },
  );
}
