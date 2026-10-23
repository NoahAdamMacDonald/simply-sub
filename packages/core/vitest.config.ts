import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A zone west of UTC that has daylight saving, so a UTC/local mix-up or a DST slip fails on
    // every machine, CI (which runs in UTC) included.
    env: { TZ: 'America/Vancouver' },
  },
});
