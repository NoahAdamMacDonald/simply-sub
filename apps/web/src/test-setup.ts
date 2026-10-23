// jsdom has no matchMedia. Default to an OS in light mode; specs that need more stub their own.
globalThis.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }) as unknown as MediaQueryList;
