import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { serviceWorkerScript, startServiceWorker, trustedServiceWorkerUrl } from './service-worker';

// The service worker's registration (M10.5): through a Trusted Types policy of its own that takes only the app's worker,
// for every page, with SwUpdate from an injector made for it. A stand-in for the browser's container and Trusted Types.

describe('the service worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes only the app’s worker file, through its own policy where the browser has Trusted Types', () => {
    const created: string[] = [];
    vi.stubGlobal('trustedTypes', {
      createPolicy: (name: string, rules: { createScriptURL(input: string): string }) => {
        created.push(name);
        return { createScriptURL: (input: string) => ({ trusted: rules.createScriptURL(input) }) };
      },
    });

    expect(trustedServiceWorkerUrl('/ngsw-worker.js')).toEqual({ trusted: '/ngsw-worker.js' });
    expect(() => trustedServiceWorkerUrl('/chunk-ABCDEFGH.js')).toThrow(
      'Not the app’s service worker',
    );
    expect(() => trustedServiceWorkerUrl('https://example.com/ngsw-worker.js')).toThrow();
    // One policy, named as _headers allows it.
    expect(created).toEqual(['simply-sub#service-worker']);
  });

  it('registers it for every page, tells a worker that takes over to start, and gives the SwUpdate for it', async () => {
    const listeners: Record<string, (() => void)[]> = {};
    const postMessage = vi.fn();
    const register = vi.fn(() => Promise.resolve({}));
    const container = {
      register,
      controller: { postMessage },
      addEventListener: (type: string, listener: () => void) =>
        (listeners[type] = [...(listeners[type] ?? []), listener]),
      removeEventListener: () => undefined,
      getRegistration: () => Promise.resolve(undefined),
    };
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: container });

    const update = await startServiceWorker(TestBed.inject(EnvironmentInjector));

    expect(register).toHaveBeenCalledWith(serviceWorkerScript, { scope: '/' });
    expect(update).toBeInstanceOf(SwUpdate);
    // Angular's channel listens too, for the new worker.
    for (const listener of listeners['controllerchange']) listener();
    expect(postMessage).toHaveBeenCalledWith({ action: 'INITIALIZE' });
  });

  it('does nothing where the browser has no service workers', async () => {
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent });

    expect(await startServiceWorker(TestBed.inject(EnvironmentInjector))).toBeUndefined();
  });
});
