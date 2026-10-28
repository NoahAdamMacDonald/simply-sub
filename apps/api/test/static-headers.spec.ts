import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// public/_headers, the static files' headers (BLUEPRINT §7.6, M2.8): the CSP, the security headers and the caching
// rules. The CSP hashes the inline theme script in apps/web/src/index.html (the build keeps it byte for byte), so
// changing the script fails here with the hash to put in its place.

interface Rule {
  pattern: string;
  headers: Map<string, string>;
}

/** The file's rules: a URL pattern on its own line, then indented `Name: value` lines. # starts a comment. */
function rules(text: string): Rule[] {
  const found: Rule[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    if (!/^\s/.test(line)) {
      found.push({ pattern: line.trim(), headers: new Map() });
      continue;
    }
    const at = line.indexOf(':');
    found[found.length - 1].headers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return found;
}

const all = rules(env.TEST_STATIC.headers);
const site = all.find((rule) => rule.pattern === '/*')?.headers ?? new Map<string, string>();

/** The CSP's directives, each with its sources. */
const csp = Object.fromEntries(
  (site.get('Content-Security-Policy') ?? '').split(';').map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources];
  }),
);

/** CSP hash sources of every inline script in index.html. */
async function inlineScriptHashes(html: string): Promise<string[]> {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) => script);
  return Promise.all(
    scripts.map(async (script) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
      return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
    }),
  );
}

describe('public/_headers', () => {
  it("lets scripts come only from this origin, index.html's inline script and the Web Analytics beacon", async () => {
    const hashes = await inlineScriptHashes(env.TEST_STATIC.indexHtml);

    expect(hashes).toHaveLength(1);
    expect(csp['script-src']).toEqual([
      "'self'",
      ...hashes,
      'https://static.cloudflareinsights.com',
    ]);
    // The beacon reports to /cdn-cgi/rum on this origin, or to cloudflareinsights.com.
    expect(csp['connect-src']).toEqual(["'self'", 'https://cloudflareinsights.com']);
  });

  it("locks everything else down, with Trusted Types for Angular and the optimizer's worker only", () => {
    expect(csp).toMatchObject({
      'default-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'worker-src': ["'self'"],
      'require-trusted-types-for': ["'script'"],
      'trusted-types': ['angular', 'angular#bundler', 'simply-sub#worker'],
    });
    expect(site.get('Referrer-Policy')).toBe('no-referrer');
    expect(site.get('X-Content-Type-Options')).toBe('nosniff');
    expect(site.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('makes the hashed build files immutable and icons last a day, and caches nothing else', () => {
    const caching = Object.fromEntries(
      all.flatMap((rule) =>
        rule.headers.has('Cache-Control')
          ? [[rule.pattern, rule.headers.get('Cache-Control')]]
          : [],
      ),
    );
    const immutable = 'public, max-age=31536000, immutable';

    expect(caching).toEqual({
      '/main-*.js': immutable,
      '/chunk-*.js': immutable,
      '/worker-*.js': immutable,
      '/styles-*.css': immutable,
      '/media/*': immutable,
      '/icons/*': 'public, max-age=86400',
    });
  });
});
