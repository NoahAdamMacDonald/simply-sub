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
