import { EnvironmentInjector, effect, isDevMode } from '@angular/core';

import { AppUpdates } from './core/pwa/app-updates';
import { startServiceWorker } from './core/pwa/service-worker';
import { SyncRepository } from './core/storage/sync-repository';
import { followThemeInTitleBar } from './core/theme/title-bar';
import { LiveCalendarService } from './shared/live-calendar/live-calendar-service';

/**
 * What starts once the app has shown, loaded then as a chunk of its own, so none of it is in the initial bundle: the
 * live calendar's updates (M10.3), an installed app's title bar following the theme, sync (M10.9) once it's on and
 * readable, after the lock opens, from a chunk of its own, and, in a production build, the service worker (M10.5) with
 * its update prompt (M10.6).
 */
export function startBackground(injector: EnvironmentInjector): void {
  injector.get(LiveCalendarService);
  followThemeInTitleBar(injector);
  const sync = injector.get(SyncRepository);
  let syncing = false;
  effect(
    () => {
      if (syncing || sync.record() === undefined) return;
      syncing = true;
      import('./shared/sync/sync-service')
        .then(({ SyncService }) => injector.get(SyncService).start())
        .catch(() => (syncing = false));
    },
    { injector },
  );
  // A browser may refuse service workers (some private modes): the app then needs the network to start.
  if (!isDevMode()) {
    startServiceWorker(injector)
      .then((update) => update && injector.get(AppUpdates).watch(update))
      .catch((error: unknown) => console.warn("The service worker couldn't start:", error));
  }
}
