import { InjectionToken } from '@angular/core';

/** The browser's preferred languages, which the first-run defaults come from. Specs provide their own. */
export const BROWSER_LANGUAGES = new InjectionToken<readonly string[]>('BROWSER_LANGUAGES', {
  providedIn: 'root',
  factory: () => (navigator.languages.length > 0 ? navigator.languages : [navigator.language]),
});
