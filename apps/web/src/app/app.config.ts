import {
  ApplicationConfig,
  ApplicationRef,
  EnvironmentInjector,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_ICON_DEFAULT_OPTIONS, MatIconDefaultOptions } from '@angular/material/icon';
import { provideRouter, withInMemoryScrolling, withRouterConfig } from '@angular/router';

import { routes } from './app.routes';
import { CatalogStore } from './core/catalog/catalog-store';
import { FxStore } from './core/fx/fx-store';
import { GlobalErrorHandler } from './core/errors/global-error-handler';
import { AutoLock } from './core/lock/auto-lock';
import { keepInstallOffer } from './core/pwa/install-offer';
import { FirstRun } from './core/settings/first-run';
import { ThemeService } from './core/theme/theme-service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    // The window is the scroll container (layout/shell.scss), so the router can scroll to the
    // top on navigation and restore the position on back/forward.
    // A navigation a page refuses (the list editor's "Discard changes?", P5) puts the history back as it was, Back
    // included: 'computed' goes forward again where the default would replace the entry Back went to.
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      withRouterConfig({ canceledNavigationResolution: 'computed' }),
    ),
    // Start the theme at boot, so 'system' follows the OS even before a toggle is on screen, the first-run check,
    // which opens the settings on the way, the catalog, which shows its cached files and checks for a new version, the
    // exchange rates, the app lock's idle timer, and the browser's offer to install the app, which comes early, once.
    provideAppInitializer(() => {
      inject(ThemeService);
      inject(FirstRun);
      inject(CatalogStore);
      inject(FxStore);
      inject(AutoLock);
      keepInstallOffer();
      // Once the app has shown, from a chunk of its own: the live calendar's updates and the service worker.
      const injector = inject(EnvironmentInjector);
      void inject(ApplicationRef)
        .whenStable()
        .then(() => import('./app.background'))
        .then(({ startBackground }) => startBackground(injector))
        .catch(() => undefined);
    }),
    {
      provide: MAT_ICON_DEFAULT_OPTIONS,
      useValue: { fontSet: 'material-symbols-outlined' } satisfies MatIconDefaultOptions,
    },
  ],
};
