import { createEnvironmentInjector, type EnvironmentInjector } from '@angular/core';
import { SwUpdate, provideServiceWorker } from '@angular/service-worker';
import { NEVER } from 'rxjs';

// The service worker (BLUEPRINT §6.3, §7.6, §14; PROJECT-PLAN M10.5): Angular's ngsw-worker.js, with ngsw-config.json.
// It keeps the app's own files, so the app starts with no network: every script and style, fetched as it installs, so
// a page never opened online works offline too, and the fonts and the providers' icons as they're used. Page loads ask
// the network first (navigationRequestStrategy 'freshness'), so Cloudflare's Web Analytics keeps seeing visits; /api/
// and /data/ are left to the network, the catalog and the rates being kept in IndexedDB (M4.3, M4.4).
//
// Angular's provideServiceWorker registers the worker with a plain string, which the CSP's Trusted Types refuse. So the
// app registers it through a policy of its own, `simply-sub#service-worker`, which _headers allows and which takes only
// this file. SwUpdate comes from an injector made here, in app.background.ts's lazy chunk, with Angular's registration
// never run (it's an app initializer, and those run only at bootstrap), so none of it is in the initial bundle.

/** The worker's file, at the root, so it controls every page. */
export const serviceWorkerScript = '/ngsw-worker.js';

/** What this needs of the browser's Trusted Types: TypeScript's DOM types don't have them. */
interface TrustedTypes {
  createPolicy(
    name: string,
    rules: { createScriptURL(input: string): string },
  ): { createScriptURL(input: string): unknown };
}

let policy: ReturnType<TrustedTypes['createPolicy']> | undefined;

/** The worker's URL as Trusted Types want it, where the browser has them; as it is elsewhere. Nothing else passes. */
export function trustedServiceWorkerUrl(url: string): string {
  const trustedTypes = (globalThis as { trustedTypes?: TrustedTypes }).trustedTypes;
  if (!trustedTypes) {
    if (url !== serviceWorkerScript) throw new TypeError('Not the app’s service worker');
    return url;
  }
  policy ??= trustedTypes.createPolicy('simply-sub#service-worker', {
    createScriptURL(input) {
      if (input !== serviceWorkerScript) throw new TypeError('Not the app’s service worker');
      return input;
    },
  });
  // A TrustedScriptURL, which register takes where a string is typed.
  return policy.createScriptURL(url) as string;
}

/**
 * Registers the worker, for every page of the app, and gives the SwUpdate that talks to it; undefined where the browser
 * has no service workers.
 */
export async function startServiceWorker(
  parent: EnvironmentInjector,
): Promise<SwUpdate | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  const container = navigator.serviceWorker;
  // A worker that takes over is told to start, as Angular's own registration tells it.
  container.addEventListener('controllerchange', () =>
    container.controller?.postMessage({ action: 'INITIALIZE' }),
  );
  await container.register(trustedServiceWorkerUrl(serviceWorkerScript), { scope: '/' });
  return createEnvironmentInjector(
    [provideServiceWorker(serviceWorkerScript, { registrationStrategy: () => NEVER })],
    parent,
  ).get(SwUpdate);
}
