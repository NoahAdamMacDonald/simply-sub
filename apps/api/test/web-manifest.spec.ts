import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// The web app's manifest and theme colours (PROJECT-PLAN M10.6), which the Worker serves with the app: the manifest's
// colours and index.html's theme-color metas are _tokens.scss's, so changing a token without them fails here, and
// every icon the manifest names is in public/app-icons/ (written by `npm run app:icons`).

interface Manifest {
  id: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

const { manifest: manifestText, tokens, indexHtml, appIcons } = env.TEST_STATIC;
const manifest = JSON.parse(manifestText) as Manifest;

/** A colour token's hex value: the light theme's (`:root`) or the dark one's (`[data-theme='dark']`). */
function token(name: string, theme: 'light' | 'dark'): string | undefined {
  const block = (
    theme === 'light' ? /:root\s*\{([^}]*)\}/ : /\[data-theme='dark'\]\s*\{([^}]*)\}/
  ).exec(tokens)?.[1];
  return block && new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1];
}

/** index.html's theme-color meta for one OS scheme. */
function themeColour(scheme: 'light' | 'dark'): string | undefined {
  const meta = [...indexHtml.matchAll(/<meta name="theme-color"[^>]*>/g)]
    .map(([tag]) => tag)
    .find((tag) => tag.includes(`(prefers-color-scheme: ${scheme})`));
  return meta && /content="([^"]+)"/.exec(meta)?.[1];
}

describe('the web app manifest (M10.6)', () => {
  it('opens the app at its root, in a window of its own', () => {
    expect(manifest).toMatchObject({
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(indexHtml).toContain('<link rel="manifest" href="manifest.webmanifest" />');
  });

  it('takes its colours from the tokens: the top bar for the title bar, the page behind the splash', () => {
    expect(manifest.theme_color).toBe(token('ss-sidebar-bg', 'light'));
    expect(manifest.background_color).toBe(token('ss-app-bg', 'light'));
  });

  it("gives index.html's theme-color metas the top bar's colour in each theme", () => {
    expect(themeColour('light')).toBe(token('ss-sidebar-bg', 'light'));
    expect(themeColour('dark')).toBe(token('ss-sidebar-bg', 'dark'));
  });

  it('names icons of 192 and 512 px and a maskable 512, each one in public/app-icons/', () => {
    expect(manifest.icons.map(({ sizes, purpose }) => `${sizes} ${purpose ?? 'any'}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    for (const { src, type } of manifest.icons) {
      expect(src).toMatch(/^app-icons\//);
      expect(appIcons).toContain(src.slice('app-icons/'.length));
      expect(type).toBe('image/png');
    }
  });
});
