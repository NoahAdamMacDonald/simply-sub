import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_ICON_DEFAULT_OPTIONS, MatIconDefaultOptions } from '@angular/material/icon';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { GlobalErrorHandler } from './core/errors/global-error-handler';
import { FirstRun } from './core/settings/first-run';
import { ThemeService } from './core/theme/theme-service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // The window is the scroll container (layout/shell.scss), so the router can scroll to the
    // top on navigation and restore the position on back/forward.
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    // Start the theme at boot, so 'system' follows the OS even before a toggle is on screen, and the first-run check,
    // which opens the settings on the way.
    provideAppInitializer(() => {
      inject(ThemeService);
      inject(FirstRun);
    }),
    {
      provide: MAT_ICON_DEFAULT_OPTIONS,
      useValue: { fontSet: 'material-symbols-outlined' } satisfies MatIconDefaultOptions,
    },
  ],
};
