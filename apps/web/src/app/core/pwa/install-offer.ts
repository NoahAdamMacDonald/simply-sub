import { signal } from '@angular/core';

/** Chromium's offer to install the app, which TypeScript's DOM types don't have. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// The browser's offer to install the app (PROJECT-PLAN M10.6), for Settings' Install. Chromium makes it once a page
// load (`beforeinstallprompt`), early, so app.config.ts listens from the start: plain signals rather than a service,
// which would cost the initial bundle more. Other browsers install from their own menus.

/** The offer, until it's used: it can show the browser's install dialog once. */
export const installOffer = signal<InstallPromptEvent | undefined>(undefined);

/** Whether the app was installed from this tab, which still runs in the browser. */
export const installedHere = signal(false);

export function keepInstallOffer(): void {
  addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installOffer.set(event as InstallPromptEvent);
  });
  addEventListener('appinstalled', () => {
    installOffer.set(undefined);
    installedHere.set(true);
  });
}
