// jsdom has no IndexedDB. Dexie reads the global when it loads, and its live queries never run without one, so this
// comes before any spec loads Dexie. Storage specs still get an empty database of their own (storage.testing.ts).
import 'fake-indexeddb/auto';

// jsdom has no matchMedia. Default to a wide screen and an OS in light mode; specs that need more
// stub their own.
globalThis.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // The CDK's BreakpointObserver still uses the legacy listener API.
    addListener: () => undefined,
    removeListener: () => undefined,
  }) as unknown as MediaQueryList;
